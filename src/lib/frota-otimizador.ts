// Otimizador GLOBAL da Gestão de Frota.
//
// Em vez de resolver reserva por reserva (o que faz uma decisão boa agora estragar uma reserva logo
// depois), monta a escala de TODOS os carros para TODAS as reservas da janela de uma vez e escolhe a
// combinação de menor custo total:
//
//   reserva sem carro  10000   (nunca deixar cliente sem carro, se houver qualquer arranjo)
//   conflito           11000   (carro que não chega a tempo: < 5h entre cidades ou < 1h na mesma; pior
//                              que deixar sem carro, para o plano nunca criar um conflito novo)
//   transferência        100   (Orlando ↔ Miami; pior que upgrade, por decisão do negócio)
//   upgrade grátis        30   (só para o nível imediatamente acima)
//   mudar o carro do HQ    2   (desempate: mantém a escala atual quando dá no mesmo)
//
// Pode reescalar livremente qualquer reserva futura (ainda não retirada) da janela. Reservas em curso e
// as de depois da janela ficam fixas, mas entram no custo: o plano não pode quebrar a cadeia delas.
//
// Busca local determinística a partir da escala atual do HQ: mover uma reserva de carro, trocar
// reservas entre dois carros e "encaixe com despejo" (coloca a reserva num carro e realoca as que saem).

import {
  TRANSFER_HOURS,
  TURNAROUND_HOURS,
  computeFrota,
  type FrotaLocation,
  type FrotaSegment,
  type FrotaVehicle,
  type Region,
  type Shortage,
  type Transfer,
  type Urgency,
} from "@/lib/frota";
import { REGION_SHORT, categoryRank } from "@/lib/frota-config";
import { carName, type Suggestion } from "@/lib/frota-sugestao";

const H = 3_600_000;
export const COST = {
  unassigned: 10_000,
  conflict: 11_000,
  transfer: 100,
  upgrade: 30,
  change: 2,
  /** Conflito criado pelo próprio plano: nunca aceito. */
  forbidden: 1_000_000,
} as const;
/** Atraso tolerado: reserva sem carro com retirada até 3h atrás ainda entra ("retirada atrasada"). */
export const LATE_H = 3;
const URGENT_HOURS = 48;

type Item = {
  idx: number;
  reservation_id: string;
  start: number;
  end: number;
  pickLoc: number | null;
  retLoc: number | null;
  classId: number | null;
  /** Carro escalado hoje no HQ (null = sem carro). */
  hq: number | null;
  movable: boolean;
};

export type Plan = {
  /** Transferências do plano (para linha do tempo e estoque). */
  transfers: Transfer[];
  /** Reservas que o plano não consegue atender. */
  shortages: Shortage[];
  /** Um caso por reserva que exige ação (transferir, trocar, upgrade, reescala ou sem solução). */
  suggestions: Suggestion[];
  /** Carro do plano para cada reserva da janela (null = sem carro). */
  assignment: Map<string, number | null>;
  /** Custo total do plano e da escala atual do HQ (diagnóstico). */
  cost: number;
  hqCost: number;
};

const fmtTime = (ms: number) =>
  new Date(ms).toLocaleString("pt-BR", {
    timeZone: "America/New_York",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

export function planFrota(input: {
  vehicles: FrotaVehicle[];
  segments: FrotaSegment[];
  locations: FrotaLocation[];
  now: Date;
  horizonDays?: number;
  /** "Feito com ajuste": reserva travada num carro (vira fixa) ou "fora" do planejamento. */
  pins?: Map<string, number | "fora">;
  rankOf?: (classLabel: string | null) => number | null;
}): Plan {
  const { vehicles, segments, locations, now } = input;
  const horizonDays = input.horizonDays ?? 7;
  const rankOf = input.rankOf ?? ((c: string | null) => categoryRank(c));
  const t0 = now.getTime();
  const horizon = t0 + horizonDays * 86_400_000;
  const loc = new Map(locations.map((l) => [l.id, l]));
  const regionOf = (id: number | null): Region | null =>
    id == null ? null : (loc.get(id)?.region ?? null);
  const nameOf = (id: number | null) => (id == null ? null : (loc.get(id)?.name ?? null));

  const active = vehicles
    .filter((v) => !v.exit_date || Date.parse(v.exit_date) > t0)
    .sort((a, b) => a.id - b.id);
  const byId = new Map(active.map((v) => [v.id, v]));
  const classLabel = new Map<number, string>();
  for (const v of vehicles)
    if (v.vehicle_class_id != null && v.class_label)
      classLabel.set(v.vehicle_class_id, v.class_label);
  const vRank = new Map(active.map((v) => [v.id, rankOf(v.class_label)]));

  const valid = segments.filter(
    (s) =>
      s.status === "confirmed" &&
      !Number.isNaN(Date.parse(s.pick_up_at)) &&
      !Number.isNaN(Date.parse(s.return_at)),
  );
  const firstSeq = new Map<string, number>();
  for (const s of valid) {
    const cur = firstSeq.get(s.reservation_id);
    if (cur == null || s.seq < cur) firstSeq.set(s.reservation_id, s.seq);
  }

  // ---- Itens: reservas móveis (retirada futura na janela) e fixas (em curso / depois da janela).
  const items: Item[] = [];
  const sorted = [...valid].sort(
    (a, b) =>
      Date.parse(a.pick_up_at) - Date.parse(b.pick_up_at) ||
      a.reservation_id.localeCompare(b.reservation_id) ||
      a.seq - b.seq,
  );
  for (const s of sorted) {
    const start = Date.parse(s.pick_up_at);
    const end = Date.parse(s.return_at);
    // Trava do ajuste só vale antes da retirada; depois quem manda é o HQ.
    const pin = start >= t0 - LATE_H * H ? input.pins?.get(s.reservation_id) : undefined;
    if (pin === "fora") continue; // resolvida fora do plano: não segura carro nem gera ação
    const pinned = typeof pin === "number" && byId.has(pin);
    const hq = pinned
      ? (pin as number)
      : s.vehicle_id != null && byId.has(s.vehicle_id)
        ? s.vehicle_id
        : null;
    const isFirst = firstSeq.get(s.reservation_id) === s.seq;
    const inWindow = start <= horizon && (start >= t0 || (hq == null && start >= t0 - LATE_H * H));
    // Travada por ajuste: fica fixa no carro escolhido; as outras reservas se replanejam em volta.
    const movable = isFirst && inWindow && !pinned;
    if (!movable && hq == null) continue; // sem carro fora da janela: não interessa agora
    items.push({
      idx: items.length,
      reservation_id: s.reservation_id,
      start,
      end,
      pickLoc: s.pick_up_location_id,
      retLoc: s.return_location_id,
      classId: s.vehicle_class_id,
      hq,
      movable,
    });
  }
  const movables = items.filter((i) => i.movable);

  // ---- Compatibilidade de categoria e custo do item num carro.
  const resRank = (i: Item) =>
    rankOf(i.classId != null ? (classLabel.get(i.classId) ?? null) : null);
  /** Custo da reserva no carro (null = categoria não serve). */
  const itemCost = (i: Item, vid: number | null): number | null => {
    if (vid == null) return COST.unassigned;
    // Fora do período em que o carro está na frota (entra depois da retirada ou sai antes da devolução).
    if (vid !== i.hq) {
      const v = byId.get(vid)!;
      if (v.entry_date && Date.parse(v.entry_date) > i.start) return null;
      if (v.exit_date && Date.parse(v.exit_date) < i.end) return null;
    }
    const change = i.hq != null && vid !== i.hq ? COST.change : 0;
    const rr = resRank(i);
    const vr = vRank.get(vid) ?? null;
    if (vid === i.hq) return rr != null && vr != null && vr > rr ? COST.upgrade * (vr - rr) : 0;
    if (rr != null && vr != null) {
      if (vr === rr) return change;
      if (vr === rr + 1) return COST.upgrade + change;
      return null;
    }
    if (i.classId == null) return change;
    return byId.get(vid)?.vehicle_class_id === i.classId ? change : null;
  };
  const compatible = new Map<number, number[]>();
  for (const i of movables)
    compatible.set(
      i.idx,
      active.filter((v) => itemCost(i, v.id) != null).map((v) => v.id),
    );

  // ---- Ligação entre a reserva anterior do carro (ou a posição atual) e a seguinte.
  type Link = {
    kind: "ok" | "transfer" | "conflict";
    fromLoc: number | null;
    freeAt: number | null;
    prev: Item | null;
  };
  const link = (v: FrotaVehicle, a: Item | null, b: Item): Link => {
    const fromLoc = a && a.end > t0 ? a.retLoc : (v.current_location_id ?? a?.retLoc ?? null);
    const freeAt = a ? a.end : null;
    const base = { fromLoc, freeAt: freeAt != null && freeAt > t0 ? freeAt : null, prev: a };
    if (a && b.start < a.end) return { ...base, kind: "conflict" };
    const fr = regionOf(fromLoc);
    const tr = regionOf(b.pickLoc);
    // Carro sem localização no HQ: não dá para garantir que ele esteja na cidade. Só fica onde o HQ
    // já escalou; nunca é oferecido para outra reserva.
    if (fr == null) return { ...base, kind: b.movable && v.id !== b.hq ? "conflict" : "ok" };
    if (tr == null) return { ...base, kind: "ok" };
    if (fr === tr) {
      if (a && a.end > t0 - TURNAROUND_HOURS * H && b.start - a.end < TURNAROUND_HOURS * H)
        return { ...base, kind: "conflict" };
      return { ...base, kind: "ok" };
    }
    const window = b.start - Math.max(freeAt ?? t0, t0);
    return { ...base, kind: window >= TRANSFER_HOURS * H ? "transfer" : "conflict" };
  };
  const linkCost = (l: Link) =>
    l.kind === "conflict" ? COST.conflict : l.kind === "transfer" ? COST.transfer : 0;

  // ---- Estado: agenda de cada carro (fixas + móveis atribuídas), ordenada por retirada.
  const fixedOf = new Map<number, Item[]>();
  for (const i of items) {
    if (i.movable || i.hq == null) continue;
    const l = fixedOf.get(i.hq) ?? [];
    l.push(i);
    fixedOf.set(i.hq, l);
  }
  // Das reservas já encerradas, só a última importa (diz onde o carro foi devolvido).
  for (const [vid, l] of fixedOf) {
    const past = l.filter((x) => x.end <= t0);
    const keep = new Set(l.filter((x) => x.end > t0));
    if (past.length) keep.add(past.reduce((m, x) => (x.end > m.end ? x : m)));
    fixedOf.set(
      vid,
      l.filter((x) => keep.has(x)),
    );
  }

  const assign = new Map<number, number | null>();
  const chain = new Map<number, Item[]>();
  for (const v of active) chain.set(v.id, [...(fixedOf.get(v.id) ?? [])]);
  const byStart = (a: Item, b: Item) => a.start - b.start || a.idx - b.idx;
  for (const i of movables) {
    assign.set(i.idx, i.hq);
    if (i.hq != null) chain.get(i.hq)!.push(i);
  }
  for (const l of chain.values()) l.sort(byStart);

  /** Custo das ligações de um carro, com a agenda dada. Ligações já passadas não contam. */
  const chainCost = (vid: number, list: Item[]) => {
    const v = byId.get(vid)!;
    let c = 0;
    for (let k = 0; k < list.length; k++) {
      const b = list[k]!;
      if (b.start < t0 - LATE_H * H && !b.movable) continue;
      const a = k > 0 ? list[k - 1]! : null;
      const l = link(v, a, b);
      // Conflito criado pelo plano (reserva colocada num carro que não é o dela no HQ): proibido.
      // Sem isso, um carro que já tem conflito "absorve" reservas de graça (troca conflito por conflito).
      const moved = (x: Item | null) => x != null && x.movable && x.hq !== vid;
      if (l.kind === "conflict" && (moved(b) || moved(a))) c += COST.forbidden;
      else c += linkCost(l);
    }
    return c;
  };
  const cc = new Map<number, number>();
  for (const v of active) cc.set(v.id, chainCost(v.id, chain.get(v.id)!));

  const totalCost = () => {
    let c = 0;
    for (const x of cc.values()) c += x;
    for (const i of movables) c += itemCost(i, assign.get(i.idx) ?? null) ?? COST.unassigned;
    return c;
  };
  const hqCost = totalCost();

  const without = (list: Item[], i: Item) => list.filter((x) => x !== i);
  const withItem = (list: Item[], i: Item) => [...list, i].sort(byStart);

  /** Variação de custo ao mover i para `to` (sem aplicar). */
  const moveDelta = (i: Item, to: number | null) => {
    const from = assign.get(i.idx) ?? null;
    if (from === to) return 0;
    const ic = itemCost(i, to);
    if (ic == null) return Infinity;
    let d = ic - (itemCost(i, from) ?? COST.unassigned);
    if (from != null) d += chainCost(from, without(chain.get(from)!, i)) - cc.get(from)!;
    if (to != null) d += chainCost(to, withItem(chain.get(to)!, i)) - cc.get(to)!;
    return d;
  };
  const apply = (i: Item, to: number | null) => {
    const from = assign.get(i.idx) ?? null;
    if (from === to) return;
    if (from != null) {
      const l = without(chain.get(from)!, i);
      chain.set(from, l);
      cc.set(from, chainCost(from, l));
    }
    if (to != null) {
      const l = withItem(chain.get(to)!, i);
      chain.set(to, l);
      cc.set(to, chainCost(to, l));
    }
    assign.set(i.idx, to);
  };
  const bestTarget = (i: Item, skip: number | null) => {
    let best: { to: number | null; d: number } = { to: null, d: moveDelta(i, null) };
    for (const vid of compatible.get(i.idx) ?? []) {
      if (vid === skip) continue;
      const d = moveDelta(i, vid);
      if (d < best.d - 1e-9) best = { to: vid, d };
    }
    return best;
  };
  /** O item está "mal": sem carro, ou a ligação até ele custa transferência/conflito. */
  const badness = (i: Item) => {
    const vid = assign.get(i.idx) ?? null;
    if (vid == null) return COST.unassigned;
    const l = chain.get(vid)!;
    const k = l.indexOf(i);
    let c = linkCost(link(byId.get(vid)!, k > 0 ? l[k - 1]! : null, i));
    if (k + 1 < l.length) c += linkCost(link(byId.get(vid)!, i, l[k + 1]!));
    return c + (itemCost(i, vid) ?? 0);
  };

  const EPS = 1e-9;
  for (let round = 0; round < 40; round++) {
    let improved = false;

    // 1) Mover uma reserva para o melhor carro.
    for (const i of movables) {
      const b = bestTarget(i, assign.get(i.idx) ?? null);
      if (b.d < -EPS) {
        apply(i, b.to);
        improved = true;
      }
    }

    // 2) Trocar reservas entre dois carros (próximas no tempo).
    for (let a = 0; a < movables.length; a++) {
      const i = movables[a]!;
      for (let b = a + 1; b < movables.length; b++) {
        const j = movables[b]!;
        if (j.start - i.end > 2 * 86_400_000) break;
        const vi = assign.get(i.idx) ?? null;
        const vj = assign.get(j.idx) ?? null;
        if (vi === vj || vi == null || vj == null) continue;
        const ci = itemCost(i, vj);
        const cj = itemCost(j, vi);
        if (ci == null || cj == null) continue;
        const li = withItem(without(chain.get(vi)!, i), j);
        const lj = withItem(without(chain.get(vj)!, j), i);
        const d =
          ci +
          cj -
          itemCost(i, vi)! -
          itemCost(j, vj)! +
          chainCost(vi, li) -
          cc.get(vi)! +
          chainCost(vj, lj) -
          cc.get(vj)!;
        if (d < -EPS) {
          chain.set(vi, li);
          chain.set(vj, lj);
          cc.set(vi, chainCost(vi, li));
          cc.set(vj, chainCost(vj, lj));
          assign.set(i.idx, vj);
          assign.set(j.idx, vi);
          improved = true;
        }
      }
    }

    // 3) Encaixe com despejo: põe a reserva "mal resolvida" num carro e realoca as que saem dele.
    for (const i of movables) {
      if (badness(i) < COST.transfer) continue;
      const before = totalCost();
      const orig = assign.get(i.idx) ?? null;
      for (const vid of compatible.get(i.idx) ?? []) {
        if (vid === orig) continue;
        const gap = TRANSFER_HOURS * H;
        const evicted = chain
          .get(vid)!
          .filter((x) => x.movable && x !== i && x.start < i.end + gap && x.end + gap > i.start);
        const undo: [Item, number | null][] = [[i, orig]];
        apply(i, vid);
        for (const e of evicted) {
          undo.push([e, vid]);
          apply(e, null);
        }
        for (const e of evicted) {
          const b = bestTarget(e, vid);
          if (b.to != null) apply(e, b.to);
        }
        if (totalCost() < before - EPS) {
          improved = true;
          break;
        }
        for (const [x, to] of undo.reverse()) apply(x, to);
      }
    }

    if (!improved) break;
  }

  // ---- Saída: transferências, faltas e casos que exigem ação.
  const hqFrota = computeFrota(vehicles, segments, locations, now, horizonDays);
  const hqTransfer = new Map(
    hqFrota.transfers.filter((t) => t.kind === "escalado").map((t) => [t.key, t]),
  );
  const urgencyOf = (freeAt: number, needBy: number): Urgency => {
    const window = needBy - Math.max(freeAt, t0);
    if (window < TRANSFER_HOURS * H) return "conflito";
    return needBy - t0 <= URGENT_HOURS * H ? "urgente" : "programar";
  };
  const makeTransfer = (v: FrotaVehicle, i: Item, l: Link): Transfer | null => {
    const fromRegion = regionOf(l.fromLoc);
    const toRegion = regionOf(i.pickLoc);
    if (!fromRegion || !toRegion) return null;
    const same = fromRegion === toRegion;
    if (same && l.kind !== "conflict") return null;
    const freeAt = l.prev ? l.prev.end : t0;
    return {
      key: `${v.id}|${i.reservation_id}`,
      kind: v.id === i.hq ? "escalado" : "sugerido",
      vehicle: v,
      fromRegion,
      fromLocation: nameOf(l.fromLoc),
      toRegion,
      toLocation: nameOf(i.pickLoc),
      freeFrom: l.prev && l.prev.end > t0 ? new Date(l.prev.end).toISOString() : null,
      needBy: new Date(i.start).toISOString(),
      fromReservation: l.prev?.reservation_id ?? null,
      toReservation: i.reservation_id,
      urgency: same || l.kind === "conflict" ? "conflito" : urgencyOf(freeAt, i.start),
      windowHours: Math.round((i.start - Math.max(freeAt, t0)) / H),
    };
  };

  const transfers: Transfer[] = [];
  const shortages: Shortage[] = [];
  const suggestions: Suggestion[] = [];

  for (const i of movables) {
    const p = assign.get(i.idx) ?? null;
    const region = regionOf(i.pickLoc);
    const short = region ? REGION_SHORT[region] : "?";
    const fromClass =
      (i.classId != null ? classLabel.get(i.classId) : null) ??
      (i.hq != null ? (byId.get(i.hq)?.class_label ?? null) : null);
    const current = i.hq != null ? byId.get(i.hq)! : null;
    const hqT = i.hq != null ? (hqTransfer.get(`${i.hq}|${i.reservation_id}`) ?? null) : null;
    const base = {
      reservationId: i.reservation_id,
      pickUpAt: new Date(i.start).toISOString(),
      currentVehicle: current,
      fromClass,
      region,
      alternatives: [] as Suggestion[],
      freesFor: null as string | null,
    };
    const none = {
      kind: "nenhuma" as const,
      vehicle: null,
      toClass: null,
      levels: 0,
      freeSince: null,
      freeSinceReservation: null,
      transferAfter: false,
    };

    if (p == null) {
      shortages.push({
        reservation_id: i.reservation_id,
        vehicle_class_id: i.classId,
        pickUpAt: new Date(i.start).toISOString(),
        returnAt: new Date(i.end).toISOString(),
        region,
        location: nameOf(i.pickLoc),
      });
      const conflictT = hqT && hqT.urgency === "conflito" ? hqT : null;
      suggestions.push({
        ...base,
        ...none,
        reason: conflictT ? "conflito" : "sem_carro",
        transfer: conflictT,
        text: "Sem alternativa — transferir com urgência ou renegociar o horário",
        instruction: `Reserva ${i.reservation_id} (${fromClass ?? "categoria ?"}, retirada ${nameOf(i.pickLoc) ?? short} em ${fmtTime(i.start)}): considerando todas as reservas, nenhum carro consegue atendê-la (nem da mesma categoria, nem upgrade, nem transferindo). Renegociar o horário com o cliente.`,
      });
      continue;
    }

    const v = byId.get(p)!;
    const list = chain.get(p)!;
    const k = list.indexOf(i);
    const l = link(v, k > 0 ? list[k - 1]! : null, i);
    const t = makeTransfer(v, i, l);
    if (t) transfers.push(t);
    const nextL = k + 1 < list.length ? link(v, i, list[k + 1]!) : null;
    const transferAfter = nextL?.kind === "transfer";

    if (l.kind === "conflict") {
      suggestions.push({
        ...base,
        ...none,
        reason: "conflito",
        transfer: t,
        text: "Sem alternativa — transferir com urgência ou renegociar o horário",
        instruction: `Reserva ${i.reservation_id}: o carro ${carName(v)} não chega a tempo e nenhum outro arranjo da frota resolve. Renegociar o horário com o cliente.`,
      });
      continue;
    }

    if (l.kind === "transfer" && t) {
      suggestions.push({
        ...base,
        ...none,
        reason: i.hq == null ? "sem_carro" : "transferencia",
        transfer: t,
        text: `Levar ${carName(v)} de ${t.fromRegion} para ${t.toRegion}`,
        instruction: "",
      });
      continue;
    }

    if (p === i.hq) continue; // carro do HQ, já na cidade: nada a fazer

    // Trocar / upgrade (o carro novo já estará na cidade).
    const rr = resRank(i);
    const vr = vRank.get(p) ?? null;
    const lvl = rr != null && vr != null && vr > rr ? vr - rr : 0;
    // Reescala: o carro atual do HQ vai atender outra reserva no plano.
    let freesFor: string | null = null;
    if (i.hq != null) {
      const other = (chain.get(i.hq) ?? []).find(
        (x) => x.movable && x !== i && x.hq !== i.hq && x.start >= i.start - 86_400_000,
      );
      freesFor = other?.reservation_id ?? null;
    }
    const reason: Suggestion["reason"] =
      i.hq == null
        ? "sem_carro"
        : hqT
          ? hqT.urgency === "conflito"
            ? "conflito"
            : "transferencia"
          : "reescala";
    const freeSince = l.freeAt;
    const desde = l.prev
      ? `livre em ${short} desde a devolução ${l.prev.reservation_id}${freeSince ? ` (${fmtTime(freeSince)})` : ""}`
      : `parado em ${short}`;
    const curTxt = current
      ? `${carName(current)} (${current.plate ?? "sem placa"})`
      : "(sem carro)";
    const novo = `${carName(v)} (${v.plate ?? "sem placa"})`;
    const motivo = freesFor ? ` O ${curTxt} fica para a reserva ${freesFor}.` : "";
    suggestions.push({
      ...base,
      freesFor,
      reason,
      transfer: hqT,
      kind: lvl === 0 ? "troca" : "upgrade",
      vehicle: v,
      toClass: v.class_label,
      levels: lvl,
      freeSince: freeSince ? new Date(freeSince).toISOString() : null,
      freeSinceReservation: l.prev?.reservation_id ?? null,
      transferAfter,
      text:
        lvl === 0
          ? `Trocar para ${carName(v)} (${desde})`
          : `Upgrade grátis ${fromClass} → ${v.class_label}: ${carName(v)} (${desde})`,
      instruction:
        lvl === 0
          ? `HQ · Reserva ${i.reservation_id}: trocar o carro ${curTxt} por ${novo}, ${desde}.${motivo}`
          : `HQ · Reserva ${i.reservation_id}: upgrade grátis de ${fromClass} para ${v.class_label}. Trocar o carro ${curTxt} por ${novo}, ${desde}. Manter o preço da categoria original.${motivo}`,
    });
  }

  transfers.sort((a, b) => Date.parse(a.needBy) - Date.parse(b.needBy));
  const assignment = new Map<string, number | null>();
  for (const i of movables) assignment.set(i.reservation_id, assign.get(i.idx) ?? null);
  return { transfers, shortages, suggestions, assignment, cost: totalCost(), hqCost };
}
