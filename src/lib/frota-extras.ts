// Extras da Gestão de Frota: aviso de plano alterado, pendências no HQ, conferência do "Feito",
// mensagem para o motorista, cadeia de reescalas e números da semana.

import {
  TRANSFER_HOURS,
  computeFrota,
  type FrotaLocation,
  type FrotaSegment,
  type FrotaVehicle,
} from "@/lib/frota";
import type { Action } from "@/lib/frota-acoes";
import { isAdjustmentKey, parseAdjustments, type DoneRow } from "@/lib/frota-ajustes";
import { carName } from "@/lib/frota-sugestao";
import { categoryRank } from "@/lib/frota-config";

const H = 3_600_000;
const fmt = (ms: number) =>
  new Date(ms).toLocaleString("pt-BR", {
    timeZone: "America/New_York",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

// ---- 1) Plano alterado ---------------------------------------------------------------------------

/** Assinatura da decisão de cada reserva: muda quando o tipo ou o carro muda. */
export const signatureOf = (a: Action) => `${a.type}:${a.vehicle?.id ?? "-"}`;
export type Seen = Record<string, string>;
export type PlanChange = "novo" | "alterado";

export function snapshot(actions: Action[]): Seen {
  return Object.fromEntries(actions.map((a) => [a.reservationId, signatureOf(a)]));
}

export function diffPlan(actions: Action[], seen: Seen | null) {
  const change = new Map<string, PlanChange>();
  if (!seen) return { change, added: 0, changed: 0, removed: 0 };
  const now = new Set<string>();
  for (const a of actions) {
    now.add(a.reservationId);
    const prev = seen[a.reservationId];
    if (prev == null) change.set(a.reservationId, "novo");
    else if (prev !== signatureOf(a)) change.set(a.reservationId, "alterado");
  }
  const removed = Object.keys(seen).filter((r) => !now.has(r)).length;
  const vals = [...change.values()];
  return {
    change,
    added: vals.filter((v) => v === "novo").length,
    changed: vals.filter((v) => v === "alterado").length,
    removed,
  };
}

// ---- 2 e 3) Pendências no HQ ---------------------------------------------------------------------

export type HqIssue = {
  kind:
    "sem_local" | "entrada_futura" | "retirada_sem_carro" | "conflito_hq" | "feito_nao_refletido";
  /** Reserva ou placa, para busca. */
  ref: string;
  text: string;
};

export const ISSUE_LABEL: Record<HqIssue["kind"], string> = {
  feito_nao_refletido: "Marcado como feito, mas o HQ não mostra",
  retirada_sem_carro: "Retirada passou e a reserva está sem carro",
  sem_local: "Carro sem localização",
  entrada_futura: "Data de entrada na frota no futuro, mas o carro já tem reserva",
  conflito_hq: "Conflito já gravado no HQ (depois da janela de 7 dias)",
};

/** Tempo para o HQ refletir um "Feito" antes de virar pendência. */
export const VERIFY_AFTER_H = 2;

export function hqIssues(input: {
  vehicles: FrotaVehicle[];
  segments: FrotaSegment[];
  locations: FrotaLocation[];
  done: DoneRow[];
  now: Date;
  horizonDays: number;
}): HqIssue[] {
  const { vehicles, segments, locations, done, now, horizonDays } = input;
  const t0 = now.getTime();
  const region = new Map(locations.map((l) => [l.id, l.region]));
  const active = vehicles.filter((v) => !v.exit_date || Date.parse(v.exit_date) > t0);
  const byId = new Map(vehicles.map((v) => [v.id, v]));
  const valid = segments.filter((s) => s.status === "confirmed");
  const first = new Map<string, FrotaSegment>();
  for (const s of valid) {
    const cur = first.get(s.reservation_id);
    if (!cur || s.seq < cur.seq) first.set(s.reservation_id, s);
  }
  const out: HqIssue[] = [];

  // 3) "Feito" que o HQ ainda não mostra.
  const plate = (id: number) => {
    const v = byId.get(id);
    return v ? carName(v) : `#${id}`;
  };
  const expect = (res: string, vid: number, when: string, what: string) => {
    if (t0 - Date.parse(when) < VERIFY_AFTER_H * H) return;
    const s = first.get(res);
    if (!s || Date.parse(s.pick_up_at) < t0) return; // já retirou: não adianta cobrar
    if (s.vehicle_id === vid) return;
    out.push({
      kind: "feito_nao_refletido",
      ref: res,
      text: `Reserva ${res}: ${what} ${plate(vid)} marcado em ${fmt(Date.parse(when))}, mas no HQ ela está ${s.vehicle_id ? `com ${plate(s.vehicle_id)}` : "sem carro"}.`,
    });
  };
  for (const d of done) {
    const p = d.key.split("|");
    if (p[0] === "acao" && (p[1] === "trocar" || p[1] === "upgrade") && p[2] && p[3])
      expect(p[2], Number(p[3]), d.done_at, p[1] === "upgrade" ? "upgrade para" : "troca para");
    else if (!isAdjustmentKey(d.key) && p.length === 2 && /^\d+$/.test(p[0]!)) {
      const vid = Number(p[0]);
      const res = p[1]!;
      expect(res, vid, d.done_at, "transferência do");
      // Depois da retirada prevista, o carro deveria estar na cidade de destino.
      const s = first.get(res);
      const v = byId.get(vid);
      if (
        s &&
        v &&
        Date.parse(s.pick_up_at) - TRANSFER_HOURS * H < t0 &&
        Date.parse(s.pick_up_at) > t0
      ) {
        const want = region.get(s.pick_up_location_id ?? -1);
        const at = region.get(v.current_location_id ?? -1);
        if (want && at && want !== at)
          out.push({
            kind: "feito_nao_refletido",
            ref: res,
            text: `Transferência do ${carName(v)} para ${want} marcada como feita, mas no HQ ele ainda está em ${at}. Atualizar a localização quando chegar.`,
          });
      }
    }
  }
  for (const a of parseAdjustments(done))
    if (a.vehicleId != null) expect(a.reservationId, a.vehicleId, a.doneAt, "ajuste com");

  // Retirada passou e a reserva continua sem carro.
  for (const s of first.values())
    if (s.vehicle_id == null && Date.parse(s.pick_up_at) < t0 && Date.parse(s.return_at) > t0)
      out.push({
        kind: "retirada_sem_carro",
        ref: s.reservation_id,
        text: `Reserva ${s.reservation_id}: retirada em ${fmt(Date.parse(s.pick_up_at))} e nenhum carro atribuído. Se o cliente já retirou, atribuir o carro entregue.`,
      });

  // Carros sem localização / com entrada no futuro mas já reservados.
  for (const v of active) {
    if (v.current_location_id == null)
      out.push({
        kind: "sem_local",
        ref: v.plate ?? String(v.id),
        text: `${carName(v)} (${v.class_label ?? "—"}) está sem localização atual no HQ: o painel não o usa até ser preenchida.`,
      });
    if (v.entry_date && Date.parse(v.entry_date) > t0) {
      const antes = valid.filter(
        (s) => s.vehicle_id === v.id && Date.parse(s.pick_up_at) < Date.parse(v.entry_date!),
      );
      if (antes.length)
        out.push({
          kind: "entrada_futura",
          ref: v.plate ?? String(v.id),
          text: `${carName(v)}: entrada na frota em ${fmt(Date.parse(v.entry_date))}, mas já está na reserva ${antes.map((s) => s.reservation_id).join(", ")}. Corrigir a data de entrada.`,
        });
    }
  }

  // Conflitos gravados no HQ depois da janela (os de dentro já estão na fila de ações).
  const longe = computeFrota(vehicles, segments, locations, now, 30);
  for (const t of longe.transfers)
    if (
      t.kind === "escalado" &&
      t.urgency === "conflito" &&
      Date.parse(t.needBy) > t0 + horizonDays * 86_400_000
    )
      out.push({
        kind: "conflito_hq",
        ref: t.toReservation,
        text: `${carName(t.vehicle)}: devolvido em ${t.fromRegion}${t.fromReservation ? ` (reserva ${t.fromReservation})` : ""} sem tempo para a reserva ${t.toReservation} em ${t.toRegion} (${fmt(Date.parse(t.needBy))}). Trocar o carro de uma delas no HQ.`,
      });

  const order = Object.keys(ISSUE_LABEL);
  return out.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}

// ---- 4) Mensagem para o motorista ----------------------------------------------------------------

export function whatsappText(a: Action): string | null {
  const t = a.transfer;
  if (a.type !== "transferir" || !t) return null;
  const v = t.vehicle;
  return [
    `🚗 *Transferência ${t.fromRegion} → ${t.toRegion}*`,
    `Carro: ${carName(v)} · placa ${v.plate ?? "—"}`,
    `Retirar em: ${t.fromLocation ?? t.fromRegion}${t.freeFrom ? ` (livre a partir de ${fmt(Date.parse(t.freeFrom))})` : ""}`,
    `Levar para: ${t.toLocation ?? t.toRegion}`,
    `⏰ Sair até: *${fmt(a.deadline)}*`,
    `Reserva ${t.toReservation}: retirada ${fmt(Date.parse(t.needBy))}`,
  ].join("\n");
}

// ---- 5) Cadeia de reescalas ----------------------------------------------------------------------

/** Ações encadeadas (um carro liberado por uma vai para a outra), na ordem da cadeia. */
export function chainOf(a: Action, actions: Action[]): Action[] {
  const byRes = new Map(actions.map((x) => [x.reservationId, x]));
  const freedBy = new Map<string, Action>();
  for (const x of actions) {
    const f = x.suggestion.freesFor;
    if (f && !freedBy.has(f)) freedBy.set(f, x);
  }
  // Volta até o início da cadeia.
  let start = a;
  const seen = new Set<string>([a.reservationId]);
  for (let p = freedBy.get(start.reservationId); p && !seen.has(p.reservationId);) {
    seen.add(p.reservationId);
    start = p;
    p = freedBy.get(start.reservationId);
  }
  const out: Action[] = [start];
  const used = new Set([start.reservationId]);
  for (let n = start.suggestion.freesFor; n;) {
    const x = byRes.get(n);
    if (!x || used.has(x.reservationId)) break;
    used.add(x.reservationId);
    out.push(x);
    n = x.suggestion.freesFor;
  }
  return out.length > 1 ? out : [];
}

/** Uma linha por elo: "7873 recebe QWERT-FL e libera FSDQ56-FL". */
export function chainText(chain: Action[]): string[] {
  return chain.map((x) => {
    const novo = x.vehicle ? carName(x.vehicle) : "?";
    const libera =
      x.suggestion.freesFor && x.currentVehicle ? ` e libera ${carName(x.currentVehicle)}` : "";
    const verbo = x.type === "transferir" ? "recebe por transferência" : "recebe";
    return `Reserva ${x.reservationId} ${verbo} ${novo}${libera}`;
  });
}

// ---- 6) Números da semana ------------------------------------------------------------------------

export function weekStats(done: DoneRow[], since: number) {
  const week = done.filter((d) => Date.parse(d.done_at) >= since);
  const adjs = parseAdjustments(week);
  return {
    asSuggested: week.filter((d) => !isAdjustmentKey(d.key)).length,
    adjusted: adjs.length,
    byKind: {
      outro_carro: adjs.filter((a) => a.kind === "outro_carro").length,
      mantido: adjs.filter((a) => a.kind === "mantido").length,
      fora: adjs.filter((a) => a.kind === "fora").length,
    },
  };
}

// ---- 7) Simulação --------------------------------------------------------------------------------

/** O que muda nas OUTRAS reservas entre dois planos (texto curto por reserva). */
export function diffEffects(before: Action[], after: Action[], skip: string): string[] {
  const b = new Map(before.map((a) => [a.reservationId, a]));
  const a2 = new Map(after.map((a) => [a.reservationId, a]));
  const desc = (a: Action) => {
    const car = a.vehicle ? ` ${carName(a.vehicle)}` : "";
    return a.type === "transferir"
      ? `transferir${car}`
      : a.type === "trocar"
        ? `trocar para${car}`
        : a.type === "upgrade"
          ? `upgrade com${car}`
          : "sem solução";
  };
  const out: string[] = [];
  for (const [r, x] of a2) {
    if (r === skip) continue;
    const y = b.get(r);
    if (!y) out.push(`Reserva ${r} passa a precisar de ação: ${desc(x)}`);
    else if (signatureOf(x) !== signatureOf(y)) out.push(`Reserva ${r}: ${desc(y)} → ${desc(x)}`);
  }
  for (const [r, y] of b)
    if (r !== skip && !a2.has(r))
      out.push(`Reserva ${r} deixa de precisar de ação (antes: ${desc(y)})`);
  return out;
}

// ---- Aplicar no HQ -------------------------------------------------------------------------------

/** O carro da ação é de categoria acima da reservada (precisa registrar upgrade grátis no HQ)? */
export function isUpgradeAction(a: Pick<Action, "fromClass" | "vehicle">): boolean {
  const from = categoryRank(a.fromClass);
  const to = categoryRank(a.vehicle?.class_label ?? null);
  return from != null && to != null && to > from;
}
