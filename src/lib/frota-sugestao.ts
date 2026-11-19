// Motor de sugestão da Gestão de Frota.
//
// Para cada caso crítico — reserva cuja transferência tem janela < 12h ou reserva sem carro livre —
// procura uma alternativa nesta ordem:
//   a) Troca: carro da MESMA categoria, já livre na cidade de retirada no horário da reserva.
//   b) Upgrade grátis: carro da categoria imediatamente acima (depois 2 níveis acima, ...).
//   c) Sem solução: transferir com urgência ou renegociar o horário.
// Toda sugestão valida a cadeia de reservas do carro sugerido: não pode criar outro conflito (ficar
// sem tempo de transferência para a reserva seguinte dele). Os casos são resolvidos por ordem de
// retirada e cada carro sugerido fica "reservado" para não ser oferecido duas vezes.

import {
  TRANSFER_HOURS,
  type FrotaLocation,
  type FrotaSegment,
  type FrotaVehicle,
  type Region,
  type Shortage,
  type Transfer,
} from "@/lib/frota";
import { CATEGORY_RANK, REGION_SHORT, categoryRank } from "@/lib/frota-config";

const H = 3_600_000;

export type SuggestionKind = "troca" | "upgrade" | "nenhuma";

export type Suggestion = {
  /** Reserva em risco. */
  reservationId: string;
  /** Por que é um caso: janela < 12h, reserva sem carro ou transferência programável (scope "all"). */
  reason: "conflito" | "sem_carro" | "transferencia";
  /** Retirada da reserva. */
  pickUpAt: string;
  /** Transferência de computeFrota que originou o caso (null = reserva sem carro). */
  transfer: Transfer | null;
  /** Outras opções válidas (níveis seguintes), da melhor para a pior. */
  alternatives: Suggestion[];
  kind: SuggestionKind;
  /** Carro hoje escalado na reserva (null = sem carro). */
  currentVehicle: FrotaVehicle | null;
  /** Carro sugerido (null quando kind = "nenhuma"). */
  vehicle: FrotaVehicle | null;
  fromClass: string | null;
  toClass: string | null;
  /** Níveis de upgrade (0 = mesma categoria). */
  levels: number;
  /** Desde quando o carro sugerido está livre na cidade (null = já parado lá). */
  freeSince: string | null;
  freeSinceReservation: string | null;
  /** O carro sugerido precisará de uma transferência (com folga ≥ 12h) depois desta reserva. */
  transferAfter: boolean;
  region: Region | null;
  /** Texto curto do chip. */
  text: string;
  /** Instrução pronta para aplicar no HQ. */
  instruction: string;
};

type Interval = {
  start: number;
  end: number;
  pickLoc: number | null;
  retLoc: number | null;
  reservation_id: string;
};

export function carName(v: FrotaVehicle) {
  const label = v.label ?? "";
  const i = label.indexOf("]");
  return (i > 0 ? label.slice(0, i + 1) : label) || v.plate || `#${v.id}`;
}

const fmtTime = (ms: number) =>
  new Date(ms).toLocaleString("pt-BR", {
    timeZone: "America/New_York",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

export function suggestAlternatives(input: {
  vehicles: FrotaVehicle[];
  segments: FrotaSegment[];
  locations: FrotaLocation[];
  transfers: Transfer[];
  shortages: Shortage[];
  now: Date;
  /** Posição da categoria na hierarquia; padrão: frota-config. */
  rankOf?: (classLabel: string | null) => number | null;
  /** Nomes das categorias por nível; padrão: frota-config. */
  levels?: string[][];
  /** "critical" (padrão): só janela < 12h e sem carro. "all": também transferências programáveis. */
  scope?: "critical" | "all";
}): Suggestion[] {
  const scope = input.scope ?? "critical";
  const { vehicles, segments, locations, transfers, shortages, now } = input;
  const rankOf = input.rankOf ?? categoryRank;
  const levels = input.levels ?? CATEGORY_RANK.map((l) => l.hq);
  const t0 = now.getTime();
  const loc = new Map(locations.map((l) => [l.id, l]));
  const regionOf = (id: number | null) => (id == null ? null : (loc.get(id)?.region ?? null));
  const nameOf = (id: number | null) => (id == null ? null : (loc.get(id)?.name ?? null));

  const active = vehicles.filter((v) => !v.exit_date || Date.parse(v.exit_date) > t0);
  const byId = new Map(active.map((v) => [v.id, v]));
  const classLabel = new Map<number, string>();
  for (const v of vehicles)
    if (v.vehicle_class_id != null && v.class_label)
      classLabel.set(v.vehicle_class_id, v.class_label);

  const valid = segments.filter(
    (s) => s.status === "confirmed" && !Number.isNaN(Date.parse(s.pick_up_at)),
  );
  const segOf = new Map<string, FrotaSegment>();
  for (const s of valid) if (!segOf.has(s.reservation_id)) segOf.set(s.reservation_id, s);
  const toInterval = (s: FrotaSegment): Interval => ({
    start: Date.parse(s.pick_up_at),
    end: Date.parse(s.return_at),
    pickLoc: s.pick_up_location_id,
    retLoc: s.return_location_id,
    reservation_id: s.reservation_id,
  });

  // Agenda de cada carro: reservas escaladas no HQ + as escalações simuladas (transferências sugeridas
  // para reservas sem carro), para não oferecer um carro que já cobre outra reserva.
  const schedule = new Map<number, Interval[]>();
  const add = (vid: number, it: Interval) => {
    const list = schedule.get(vid) ?? [];
    list.push(it);
    list.sort((a, b) => a.start - b.start);
    schedule.set(vid, list);
  };
  for (const s of valid)
    if (s.vehicle_id != null && byId.has(s.vehicle_id)) add(s.vehicle_id, toInterval(s));
  for (const t of transfers) {
    if (t.kind !== "sugerido") continue;
    const s = segOf.get(t.toReservation);
    if (s && byId.has(t.vehicle.id)) add(t.vehicle.id, toInterval(s));
  }

  type Case = {
    seg: FrotaSegment;
    reason: Suggestion["reason"];
    /** Carro escalado no HQ (exibição). */
    current: FrotaVehicle | null;
    /** Carro que hoje "segura" a reserva na agenda (HQ ou escalação simulada). */
    holder: number | null;
    transfer: Transfer | null;
  };
  const cases: Case[] = [];
  for (const t of transfers) {
    if (scope === "critical" && (t.urgency !== "conflito" || t.kind !== "escalado")) continue;
    const s = segOf.get(t.toReservation);
    if (!s) continue;
    cases.push({
      seg: s,
      reason: t.urgency === "conflito" ? "conflito" : "transferencia",
      current: t.kind === "escalado" ? t.vehicle : null,
      holder: t.vehicle.id,
      transfer: t,
    });
  }
  for (const sh of shortages) {
    const s = segOf.get(sh.reservation_id);
    if (s) cases.push({ seg: s, reason: "sem_carro", current: null, holder: null, transfer: null });
  }
  cases.sort((a, b) => Date.parse(a.seg.pick_up_at) - Date.parse(b.seg.pick_up_at));

  type Fit = { v: FrotaVehicle; prev: Interval | null; transferAfter: boolean; freeAt: number };

  /** O carro pode assumir a reserva sem transferência antes e sem criar conflito depois? */
  const fits = (v: FrotaVehicle, r: Interval): Fit | null => {
    const list = (schedule.get(v.id) ?? []).filter((x) => x.reservation_id !== r.reservation_id);
    if (list.some((x) => x.start < r.end && x.end > r.start)) return null;
    const prev = [...list].reverse().find((x) => x.end <= r.start) ?? null;
    const after = list.find((x) => x.start >= r.end) ?? null;
    // Onde estará na retirada: devolução futura = local da devolução; senão local atual no HQ.
    const at =
      prev && prev.end > t0 ? prev.retLoc : (v.current_location_id ?? prev?.retLoc ?? null);
    const want = regionOf(r.pickLoc);
    if (want == null || regionOf(at) !== want) return null;
    // Cadeia: se a próxima reserva dele começa em outra cidade, precisa de 12h para transferir.
    let transferAfter = false;
    if (after) {
      const a = regionOf(r.retLoc);
      const b = regionOf(after.pickLoc);
      if (a != null && b != null && a !== b) {
        if (after.start - r.end < TRANSFER_HOURS * H) return null;
        transferAfter = true;
      }
    }
    return { v, prev, transferAfter, freeAt: prev ? prev.end : -Infinity };
  };

  const pick = (pool: FrotaVehicle[], r: Interval, exclude: number | null): Fit | null => {
    let best: Fit | null = null;
    for (const v of pool) {
      if (v.id === exclude) continue;
      const f = fits(v, r);
      if (!f) continue;
      // Sem transferência depois primeiro; empate: livre há mais tempo (gira a frota).
      if (
        !best ||
        Number(f.transferAfter) < Number(best.transferAfter) ||
        (f.transferAfter === best.transferAfter && f.freeAt < best.freeAt)
      )
        best = f;
    }
    return best;
  };
  const inLevel = (lvl: number) => {
    const names = new Set(levels[lvl]!.map((n) => n.toLowerCase()));
    return active.filter((v) => names.has((v.class_label ?? "").toLowerCase()));
  };

  const out: Suggestion[] = [];
  for (const c of cases) {
    const r = toInterval(c.seg);
    const fromClass =
      (c.seg.vehicle_class_id != null ? classLabel.get(c.seg.vehicle_class_id) : null) ??
      c.current?.class_label ??
      null;
    const region = regionOf(r.pickLoc);
    const exclude = c.holder;
    const rank = rankOf(fromClass);
    // Mesmo nível da hierarquia (ex.: Exec 7 e Exec 8) conta como troca.
    const sameClass =
      rank != null
        ? inLevel(rank)
        : active.filter((v) =>
            c.seg.vehicle_class_id != null
              ? v.vehicle_class_id === c.seg.vehicle_class_id
              : v.class_label === fromClass,
          );

    // Melhor carro por nível: troca, upgrade 1, upgrade 2...
    const found: { fit: Fit; lvl: number }[] = [];
    const f0 = pick(sameClass, r, exclude);
    if (f0) found.push({ fit: f0, lvl: 0 });
    if (rank != null)
      for (let up = rank + 1; up < levels.length; up++) {
        const f = pick(inLevel(up), r, exclude);
        if (f) found.push({ fit: f, lvl: up - rank });
      }

    const short = region ? REGION_SHORT[region] : "?";
    const curTxt = c.current
      ? `${carName(c.current)} (${c.current.plate ?? "sem placa"})`
      : "(sem carro)";
    const base = {
      reservationId: c.seg.reservation_id,
      reason: c.reason,
      currentVehicle: c.current,
      fromClass,
      region,
      pickUpAt: new Date(r.start).toISOString(),
      transfer: c.transfer,
    };

    const build = ({ fit, lvl }: { fit: Fit; lvl: number }): Suggestion => {
      const v = fit.v;
      const toClass = v.class_label;
      const freeSince = fit.prev && fit.prev.end > t0 ? fit.prev.end : null;
      const desde = fit.prev
        ? `livre em ${short} desde a devolução ${fit.prev.reservation_id}${freeSince ? ` (${fmtTime(freeSince)})` : ""}`
        : `parado em ${short}`;
      const novo = `${carName(v)} (${v.plate ?? "sem placa"})`;
      const depois = fit.transferAfter
        ? " Atenção: depois desta reserva ele precisa ser transferido para a próxima (folga ≥ 12h)."
        : "";
      const text =
        lvl === 0
          ? `Trocar para ${carName(v)} (${desde})`
          : `Upgrade grátis${lvl > 1 ? ` de ${lvl} níveis` : ""} ${fromClass} → ${toClass}: ${carName(v)} (${desde})`;
      const instruction =
        lvl === 0
          ? `HQ · Reserva ${c.seg.reservation_id}: trocar o carro ${curTxt} por ${novo}, ${desde}.${depois}`
          : `HQ · Reserva ${c.seg.reservation_id}: upgrade grátis${lvl > 1 ? ` de ${lvl} níveis` : ""} de ${fromClass} para ${toClass}. Trocar o carro ${curTxt} por ${novo}, ${desde}. Manter o preço da categoria original.${depois}`;
      return {
        ...base,
        kind: lvl === 0 ? "troca" : "upgrade",
        vehicle: v,
        toClass,
        levels: lvl,
        freeSince: freeSince ? new Date(freeSince).toISOString() : null,
        freeSinceReservation: fit.prev?.reservation_id ?? null,
        transferAfter: fit.transferAfter,
        text,
        instruction,
        alternatives: [],
      };
    };

    if (found.length === 0) {
      out.push({
        ...base,
        kind: "nenhuma",
        vehicle: null,
        toClass: null,
        levels: 0,
        freeSince: null,
        freeSinceReservation: null,
        transferAfter: false,
        text: "Sem alternativa — transferir com urgência ou renegociar o horário",
        instruction: `Reserva ${c.seg.reservation_id} (${fromClass ?? "categoria ?"}, retirada ${nameOf(r.pickLoc) ?? short} em ${fmtTime(r.start)}): nenhum carro livre na cidade, nem da mesma categoria nem acima. Transferir com urgência ou renegociar o horário com o cliente.`,
        alternatives: [],
      });
      continue;
    }

    const [best, ...rest] = found.map(build);
    out.push({ ...best!, alternatives: rest });

    // Reserva o carro sugerido e libera o atual, para os próximos casos.
    if (exclude != null) {
      const list = schedule.get(exclude) ?? [];
      schedule.set(
        exclude,
        list.filter((x) => x.reservation_id !== r.reservation_id),
      );
    }
    add(found[0]!.fit.v.id, r);
  }
  return out;
}
