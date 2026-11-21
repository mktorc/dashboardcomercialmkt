// Gestão de Frota: a partir das reservas (trechos) e da frota, calcula quais carros precisam mudar de
// região (Orlando ou Miami) e até quando.
//
// 1) Carros já escalados: para cada carro, compara onde termina um trecho com onde começa o seguinte.
//    Regiões diferentes = transferência, com janela [devolução, próxima retirada].
// 2) Reservas sem carro (o HQ escala perto da data): simula a escalação, categoria por categoria, por
//    ordem de retirada. Prefere um carro livre que já estará na região; senão, um livre em outra região
//    (sugere a transferência); sem nenhum livre, a reserva fica "sem carro".

export type Region = "Orlando" | "Miami";

export type FrotaLocation = { id: number; name: string; region: Region };

export type FrotaVehicle = {
  id: number;
  plate: string | null;
  label: string | null;
  vehicle_class_id: number | null;
  class_label: string | null;
  current_location_id: number | null;
  exit_date: string | null;
};

export type FrotaSegment = {
  reservation_id: string;
  seq: number;
  status: string;
  pick_up_at: string;
  return_at: string;
  vehicle_id: number | null;
  vehicle_class_id: number | null;
  pick_up_location_id: number | null;
  return_location_id: number | null;
};

export type Urgency = "conflito" | "urgente" | "programar";

export type Transfer = {
  key: string;
  kind: "escalado" | "sugerido";
  vehicle: FrotaVehicle;
  fromRegion: Region;
  fromLocation: string | null;
  toRegion: Region;
  toLocation: string | null;
  /** A partir de quando o carro está livre na origem (null = já está parado lá). */
  freeFrom: string | null;
  /** Retirada da reserva de destino: o carro precisa chegar antes. */
  needBy: string;
  /** Reserva que libera o carro na origem (null = carro parado). */
  fromReservation: string | null;
  toReservation: string;
  urgency: Urgency;
  /** Horas entre ficar livre (ou agora) e a retirada. */
  windowHours: number;
};

export type Shortage = {
  reservation_id: string;
  vehicle_class_id: number | null;
  pickUpAt: string;
  returnAt: string;
  region: Region | null;
  location: string | null;
};

/** Caso de mesma cidade: carro escalado sem a folga mínima de 1h entre devolução e próxima retirada. */
export const isSameCity = (t: Transfer) => t.fromRegion === t.toRegion;

/** Intervalo entre a devolução e a retirada, em texto ("30 min", "0 min" se sobrepõe). */
export function gapText(t: Transfer): string {
  const free = t.freeFrom ? Date.parse(t.freeFrom) : Date.now();
  const min = Math.max(0, Math.round((Date.parse(t.needBy) - free) / 60_000));
  return `${min} min`;
}

export type FrotaResult = { transfers: Transfer[]; shortages: Shortage[] };

/** Deslocamento Orlando ↔ Miami: 5h. */
export const TRANSFER_HOURS = 5;
/** Intervalo mínimo entre duas reservas do mesmo carro na mesma cidade (devolução → próxima retirada). */
export const TURNAROUND_HOURS = 1;
/** Precisa chegar em até 2 dias: urgente. */
const URGENT_HOURS = 48;
const H = 3_600_000;

type Interval = {
  start: number;
  end: number;
  pickLoc: number | null;
  retLoc: number | null;
  reservation_id: string;
};

export function computeFrota(
  vehicles: FrotaVehicle[],
  segments: FrotaSegment[],
  locations: FrotaLocation[],
  now: Date,
  horizonDays = 60,
): FrotaResult {
  const t0 = now.getTime();
  const horizon = t0 + horizonDays * 86_400_000;
  const loc = new Map(locations.map((l) => [l.id, l]));
  const regionOf = (id: number | null) => (id == null ? null : (loc.get(id)?.region ?? null));
  const nameOf = (id: number | null) => (id == null ? null : (loc.get(id)?.name ?? null));

  const active = vehicles.filter((v) => !v.exit_date || Date.parse(v.exit_date) > t0);
  const byId = new Map(active.map((v) => [v.id, v]));

  // Só reservas confirmadas (sinal pago) seguram carro; as que já terminaram antes de hoje não importam
  // a não ser a última de cada carro (diz onde ele foi devolvido).
  const valid = segments.filter(
    (s) => s.status === "confirmed" && !Number.isNaN(Date.parse(s.pick_up_at)),
  );
  const schedule = new Map<number, Interval[]>();
  const unassigned: FrotaSegment[] = [];
  for (const s of valid) {
    const start = Date.parse(s.pick_up_at);
    const end = Date.parse(s.return_at);
    if (s.vehicle_id != null && byId.has(s.vehicle_id)) {
      const list = schedule.get(s.vehicle_id) ?? [];
      list.push({
        start,
        end,
        pickLoc: s.pick_up_location_id,
        retLoc: s.return_location_id,
        reservation_id: s.reservation_id,
      });
      schedule.set(s.vehicle_id, list);
    } else if (s.vehicle_id == null && start >= t0 - 12 * H && start <= horizon) {
      unassigned.push(s);
    }
  }
  for (const list of schedule.values()) list.sort((a, b) => a.start - b.start);

  // Onde o carro estará ao ficar livre: devolução futura = local da devolução; já devolvido (ou sem
  // reserva anterior) = local atual no HQ, que já reflete uma transferência feita.
  const originOf = (v: FrotaVehicle, prev: Interval | null) =>
    prev && prev.end > t0 ? prev.retLoc : (v.current_location_id ?? prev?.retLoc ?? null);

  const urgencyOf = (freeAt: number, needBy: number): Urgency => {
    const window = needBy - Math.max(freeAt, t0);
    if (window < TRANSFER_HOURS * H) return "conflito";
    return needBy - t0 <= URGENT_HOURS * H ? "urgente" : "programar";
  };

  const transfers: Transfer[] = [];
  const pushTransfer = (
    kind: Transfer["kind"],
    v: FrotaVehicle,
    prev: Interval | null,
    fromLoc: number | null,
    next: { start: number; pickLoc: number | null; reservation_id: string },
  ) => {
    const fromRegion = regionOf(fromLoc);
    const toRegion = regionOf(next.pickLoc);
    if (!fromRegion || !toRegion) return;
    const freeAt = prev ? prev.end : t0;
    // Mesma cidade: só vira caso se o carro escalado não tem a folga mínima de 1h entre as reservas.
    const sameCity = fromRegion === toRegion;
    if (sameCity && !(kind === "escalado" && prev && next.start - prev.end < TURNAROUND_HOURS * H))
      return;
    transfers.push({
      key: `${v.id}|${next.reservation_id}`,
      kind,
      vehicle: v,
      fromRegion,
      fromLocation: nameOf(fromLoc),
      toRegion,
      toLocation: nameOf(next.pickLoc),
      freeFrom: prev && prev.end > t0 ? new Date(prev.end).toISOString() : null,
      needBy: new Date(next.start).toISOString(),
      fromReservation: prev?.reservation_id ?? null,
      toReservation: next.reservation_id,
      urgency: sameCity ? "conflito" : urgencyOf(freeAt, next.start),
      windowHours: Math.round((next.start - Math.max(freeAt, t0)) / H),
    });
  };

  // 1) Carros escalados: pares consecutivos com retirada futura.
  for (const v of active) {
    const list = schedule.get(v.id) ?? [];
    for (let i = 0; i < list.length; i++) {
      const next = list[i]!;
      if (next.start < t0 || next.start > horizon) continue;
      const prev = i > 0 ? list[i - 1]! : null;
      const fromLoc = originOf(v, prev);
      pushTransfer("escalado", v, prev, fromLoc, next);
    }
  }

  // 2) Reservas sem carro: escalação simulada.
  const shortages: Shortage[] = [];
  unassigned.sort((a, b) => Date.parse(a.pick_up_at) - Date.parse(b.pick_up_at));
  for (const s of unassigned) {
    const start = Date.parse(s.pick_up_at);
    const end = Date.parse(s.return_at);
    const wantRegion = regionOf(s.pick_up_location_id);
    const candidates = active.filter(
      (v) => s.vehicle_class_id == null || v.vehicle_class_id === s.vehicle_class_id,
    );
    let best: {
      v: FrotaVehicle;
      prev: Interval | null;
      fromLoc: number | null;
      score: number;
    } | null = null;
    for (const v of candidates) {
      const list = schedule.get(v.id) ?? [];
      // Livre no período da reserva?
      // Livre no período da reserva, com a folga mínima de 1h antes e depois?
      const gap = TURNAROUND_HOURS * H;
      if (list.some((x) => x.start < end + gap && x.end + gap > start)) continue;
      const prev = [...list].reverse().find((x) => x.end + gap <= start) ?? null;
      const after = list.find((x) => x.start >= end + gap) ?? null;
      const fromLoc = originOf(v, prev);
      const fromRegion = regionOf(fromLoc);
      const moveBefore = fromRegion != null && wantRegion != null && fromRegion !== wantRegion;
      // Precisa de tempo para descer/subir antes da retirada.
      if (moveBefore && start - Math.max(prev?.end ?? t0, t0) < TRANSFER_HOURS * H) continue;
      const moveAfter =
        after != null &&
        regionOf(s.return_location_id) != null &&
        regionOf(after.pickLoc) != null &&
        regionOf(s.return_location_id) !== regionOf(after.pickLoc);
      // Menos transferências primeiro; empate: o carro parado há mais tempo (gira a frota).
      const score = (moveBefore ? 2 : 0) + (moveAfter ? 1 : 0) + (prev ? prev.end / 1e15 : 0);
      if (!best || score < best.score) best = { v, prev, fromLoc, score };
    }
    if (!best) {
      shortages.push({
        reservation_id: s.reservation_id,
        vehicle_class_id: s.vehicle_class_id,
        pickUpAt: s.pick_up_at,
        returnAt: s.return_at,
        region: wantRegion,
        location: nameOf(s.pick_up_location_id),
      });
      continue;
    }
    pushTransfer("sugerido", best.v, best.prev, best.fromLoc, {
      start,
      pickLoc: s.pick_up_location_id,
      reservation_id: s.reservation_id,
    });
    const list = schedule.get(best.v.id) ?? [];
    list.push({
      start,
      end,
      pickLoc: s.pick_up_location_id,
      retLoc: s.return_location_id,
      reservation_id: s.reservation_id,
    });
    list.sort((a, b) => a.start - b.start);
    schedule.set(best.v.id, list);
  }

  transfers.sort((a, b) => Date.parse(a.needBy) - Date.parse(b.needBy));
  return { transfers, shortages };
}

/** Onde cada carro está agora (ou para onde volta da locação em curso), por região e categoria. */
export function fleetPosition(
  vehicles: FrotaVehicle[],
  segments: FrotaSegment[],
  locations: FrotaLocation[],
  now: Date,
): { vehicle: FrotaVehicle; region: Region | null; rented: boolean }[] {
  const t0 = now.getTime();
  const loc = new Map(locations.map((l) => [l.id, l.region]));
  const last = new Map<number, FrotaSegment>();
  for (const s of segments) {
    if (s.status !== "confirmed" || s.vehicle_id == null) continue;
    if (Date.parse(s.pick_up_at) > t0) continue;
    const cur = last.get(s.vehicle_id);
    if (!cur || Date.parse(s.pick_up_at) > Date.parse(cur.pick_up_at)) last.set(s.vehicle_id, s);
  }
  return vehicles
    .filter((v) => !v.exit_date || Date.parse(v.exit_date) > t0)
    .map((v) => {
      const s = last.get(v.id);
      const rented = s != null && Date.parse(s.return_at) > t0;
      const id = rented ? s.return_location_id : v.current_location_id;
      return { vehicle: v, region: id == null ? null : (loc.get(id) ?? null), rented };
    });
}
