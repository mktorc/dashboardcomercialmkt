// Monta os dados da "Linha do tempo" e do "Saldo por cidade" a partir do mesmo resultado de
// computeFrota (janela, origem, destino e urgência vêm de lá). Só visualização: nada é recalculado.

import type {
  FrotaLocation,
  FrotaSegment,
  FrotaVehicle,
  Region,
  Shortage,
  Transfer,
  Urgency,
} from "@/lib/frota";
import { categoryRank } from "@/lib/frota-config";

export const TZ = "America/New_York";
const DAY = 86_400_000;

/** Dia (YYYY-MM-DD) no fuso de Orlando. */
export const dayKeyOf = (ms: number) => new Date(ms).toLocaleDateString("en-CA", { timeZone: TZ });

/** Meia-noite de um dia de Orlando, em ms UTC. */
export function orlandoMidnight(key: string): number {
  const utc = Date.parse(`${key}T00:00:00Z`);
  const d = new Date(utc + 6 * 3_600_000); // meio da manhã UTC para ler o offset do dia certo
  const asNy = Date.parse(d.toLocaleString("en-US", { timeZone: TZ }) + " UTC");
  const offset = d.getTime() - asNy; // 4h ou 5h
  return utc + offset;
}

export type Bar = {
  reservationId: string;
  start: number;
  end: number;
  pickRegion: Region | null;
  retRegion: Region | null;
  pickLocation: string | null;
  retLocation: string | null;
  /** Já começou (reserva atual / passada): barra sólida. Futura: tracejada. */
  started: boolean;
};

export type Gap = {
  start: number;
  end: number;
  from: Region | null;
  to: Region | null;
  /** Cidades diferentes: vem de uma transferência de computeFrota. */
  transfer: Transfer | null;
  urgency: Urgency | null;
};

export type TimelineRow = { vehicle: FrotaVehicle; bars: Bar[]; gaps: Gap[] };

export type UnassignedItem = {
  bar: Bar;
  /** Nenhum carro da categoria livre (vem de shortages). */
  shortage: boolean;
  /** Carro que a escalação simulada sugere (transferência "sugerido"). */
  suggested: Transfer | null;
};

export type TimelineGroup = {
  classLabel: string;
  rows: TimelineRow[];
  unassigned: UnassignedItem[];
};

export type Timeline = {
  start: number;
  end: number;
  days: { key: string; start: number }[];
  groups: TimelineGroup[];
};

export function buildTimeline(input: {
  vehicles: FrotaVehicle[];
  segments: FrotaSegment[];
  locations: FrotaLocation[];
  transfers: Transfer[];
  shortages: Shortage[];
  now: Date;
  horizonDays: number;
}): Timeline {
  const { vehicles, segments, locations, transfers, shortages, now, horizonDays } = input;
  const t0 = now.getTime();
  const loc = new Map(locations.map((l) => [l.id, l]));
  const regionOf = (id: number | null) => (id == null ? null : (loc.get(id)?.region ?? null));
  const nameOf = (id: number | null) => (id == null ? null : (loc.get(id)?.name ?? null));

  // Eixo: de ontem (meia-noite de Orlando) até o fim do horizonte.
  const days: { key: string; start: number }[] = [];
  let k = dayKeyOf(t0 - DAY);
  for (let i = 0; i < horizonDays + 2; i++) {
    const s = orlandoMidnight(k);
    days.push({ key: k, start: s });
    k = dayKeyOf(s + DAY + 3_600_000 * 3);
  }
  const start = days[0]!.start;
  const end = orlandoMidnight(dayKeyOf(days[days.length - 1]!.start + DAY + 3_600_000 * 3));

  const active = vehicles.filter((v) => !v.exit_date || Date.parse(v.exit_date) > t0);
  const byId = new Map(active.map((v) => [v.id, v]));
  const classLabel = new Map<number, string>();
  for (const v of vehicles)
    if (v.vehicle_class_id != null && v.class_label)
      classLabel.set(v.vehicle_class_id, v.class_label);

  const toBar = (s: FrotaSegment): Bar => {
    const a = Date.parse(s.pick_up_at);
    return {
      reservationId: s.reservation_id,
      start: a,
      end: Date.parse(s.return_at),
      pickRegion: regionOf(s.pick_up_location_id),
      retRegion: regionOf(s.return_location_id),
      pickLocation: nameOf(s.pick_up_location_id),
      retLocation: nameOf(s.return_location_id),
      started: a <= t0,
    };
  };

  const transferByKey = new Map(transfers.map((t) => [t.key, t]));
  const suggestedByRes = new Map(
    transfers.filter((t) => t.kind === "sugerido").map((t) => [t.toReservation, t]),
  );
  const shortageIds = new Set(shortages.map((s) => s.reservation_id));

  const barsByCar = new Map<number, Bar[]>();
  const unassignedByClass = new Map<string, UnassignedItem[]>();
  for (const s of segments) {
    if (s.status !== "confirmed" || Number.isNaN(Date.parse(s.pick_up_at))) continue;
    const b = toBar(s);
    if (s.vehicle_id != null && byId.has(s.vehicle_id)) {
      barsByCar.set(s.vehicle_id, [...(barsByCar.get(s.vehicle_id) ?? []), b]);
    } else if (s.vehicle_id == null && b.end > start && b.start < end) {
      const cls = (s.vehicle_class_id != null ? classLabel.get(s.vehicle_class_id) : null) ?? "—";
      unassignedByClass.set(cls, [
        ...(unassignedByClass.get(cls) ?? []),
        {
          bar: b,
          shortage: shortageIds.has(s.reservation_id),
          suggested: suggestedByRes.get(s.reservation_id) ?? null,
        },
      ]);
    }
  }

  const rowsByClass = new Map<string, TimelineRow[]>();
  for (const v of active) {
    const all = (barsByCar.get(v.id) ?? []).sort((a, b) => a.start - b.start);
    const gaps: Gap[] = [];
    for (let i = 0; i < all.length; i++) {
      const next = all[i]!;
      const prev = i > 0 ? all[i - 1]! : null;
      const t = transferByKey.get(`${v.id}|${next.reservationId}`) ?? null;
      if (t) {
        const from = prev && prev.end > t0 ? prev.end : t0;
        gaps.push({
          start: from,
          end: next.start,
          from: t.fromRegion,
          to: t.toRegion,
          transfer: t,
          urgency: t.urgency,
        });
      } else if (prev && next.start > prev.end) {
        gaps.push({
          start: prev.end,
          end: next.start,
          from: prev.retRegion,
          to: next.pickRegion,
          transfer: null,
          urgency: null,
        });
      }
    }
    const inView = (x: { start: number; end: number }) => x.end > start && x.start < end;
    const row: TimelineRow = { vehicle: v, bars: all.filter(inView), gaps: gaps.filter(inView) };
    const cls = v.class_label ?? "—";
    rowsByClass.set(cls, [...(rowsByClass.get(cls) ?? []), row]);
  }

  const classes = [...new Set([...rowsByClass.keys(), ...unassignedByClass.keys()])].sort(
    (a, b) => (categoryRank(a) ?? 99) - (categoryRank(b) ?? 99) || a.localeCompare(b),
  );
  const groups = classes.map((c) => ({
    classLabel: c,
    rows: (rowsByClass.get(c) ?? []).sort((a, b) =>
      (a.vehicle.label ?? a.vehicle.plate ?? "").localeCompare(
        b.vehicle.label ?? b.vehicle.plate ?? "",
      ),
    ),
    unassigned: (unassignedByClass.get(c) ?? []).sort((a, b) => a.bar.start - b.bar.start),
  }));
  return { start, end, days, groups };
}
