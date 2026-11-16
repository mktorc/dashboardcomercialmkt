import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";

/** Trecho de um veículo dentro da reserva (ou a própria reserva, enquanto não há trechos sincronizados). */
export type OccSegment = { pick_up_at: string | null; return_at: string | null };
/** Veículo da frota com a data em que passou a contar (e, se houver, a data de saída). */
export type OccVehicle = { entry_date: string; exit_date: string | null };
export type OccMonth = {
  label: string;
  month: string;
  rate: number;
  carDays: number;
  capacity: number;
};

const DAY = 86400000;
const HOUR = 3600000;
/** Tolerância do HQ (max_hours_before_daily_price): até 5 h além de um dia cheio não contam como novo dia. */
const GRACE_HOURS = 5;
const MONTHS_PT = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

/**
 * Dias de aluguel de um trecho no período [start, end), no critério do relatório de Utilização do HQ
 * (conferido com o relatório de out, nov e dez/2026 e com recortes de um dia, semana e mês):
 * - o trecho conta se encosta em algum dia do período, inclusive os dias de retirada e de devolução;
 * - dias = maior entre 1 e (horas dentro do período − 5 h) ÷ 24, arredondado para cima.
 * Os horários são usados como o HQ os devolve, sem converter de fuso.
 */
export function segmentDays(
  pickUpAt: string | null,
  returnAt: string | null,
  start: number,
  end: number,
): number {
  if (!pickUpAt || !returnAt) return 0;
  const pickUp = Date.parse(pickUpAt);
  const returned = Date.parse(returnAt);
  if (Number.isNaN(pickUp) || Number.isNaN(returned)) return 0;
  if (Math.floor(returned / DAY) * DAY < start || Math.floor(pickUp / DAY) * DAY >= end) return 0;
  const hours = (Math.min(returned, end) - Math.max(pickUp, start)) / HOUR;
  return Math.max(1, Math.ceil((hours - GRACE_HOURS) / 24 - 1e-9));
}

/** Dias em que o veículo já fazia parte da frota dentro do período [start, end). */
export function vehicleDays(vehicle: OccVehicle, start: number, end: number): number {
  const entry = Date.parse(vehicle.entry_date);
  if (Number.isNaN(entry) || entry >= end) return 0;
  const exit = vehicle.exit_date ? Date.parse(vehicle.exit_date) : NaN;
  const to = Number.isNaN(exit) ? end : Math.min(exit, end);
  return Math.max(0, (to - Math.max(entry, start)) / DAY);
}

/**
 * Ocupação = dias de aluguel dos trechos no mês ÷ dias em que os veículos estiveram na frota no mês.
 * `fleet` pode ser a lista de veículos (com data de entrada) ou, na falta dela, só o tamanho da frota atual.
 */
export function computeOccupancy(
  segments: OccSegment[],
  fleet: OccVehicle[] | number,
  today: Date,
  count = 3,
  startOffset = 0,
): OccMonth[] {
  const out: OccMonth[] = [];
  for (let i = 0; i < count; i++) {
    const offset = startOffset + i;
    const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + offset, 1);
    const end = Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + offset + 1, 1);
    const days = (end - start) / DAY;
    let carDays = 0;
    for (const s of segments) carDays += segmentDays(s.pick_up_at, s.return_at, start, end);
    const capacity =
      typeof fleet === "number"
        ? fleet * days
        : fleet.reduce((sum, v) => sum + vehicleDays(v, start, end), 0);
    const d = new Date(start);
    out.push({
      label: `${MONTHS_PT[d.getUTCMonth()]}/${d.getUTCFullYear()}`,
      month: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
      rate: capacity ? carDays / capacity : 0,
      carDays,
      capacity,
    });
  }
  return out;
}

export function occupancyMonthVariation(current?: OccMonth, previous?: OccMonth) {
  if (!current || !previous) return undefined;
  return previous.rate
    ? ((current.rate - previous.rate) / previous.rate) * 100
    : current.rate
      ? 100
      : 0;
}

export async function fetchOccupancy(from?: string, to?: string) {
  const now = new Date();
  const currentMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodFrom =
    from ??
    `${currentMonth.getUTCFullYear()}-${String(currentMonth.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const periodTo = to ?? now.toISOString().slice(0, 10);
  const monthOffset = (value: string) => {
    const [year, month] = value.slice(0, 7).split("-").map(Number);
    return (year! - currentMonth.getUTCFullYear()) * 12 + month! - 1 - currentMonth.getUTCMonth();
  };
  const firstOffset = monthOffset(periodFrom) - 13;
  const lastOffset = Math.max(2, monthOffset(periodTo) + 2);
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + firstOffset, 1),
  ).toISOString();
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + lastOffset + 1, 1),
  ).toISOString();
  const months = lastOffset - firstOffset + 1;

  const [segments, fleet] = await Promise.all([
    fetchAll((a, b) =>
      supabase
        .from("reservation_segments")
        .select("pick_up_at, return_at")
        .eq("status", "confirmed")
        .lt("pick_up_at", end)
        .gte("return_at", start)
        .range(a, b),
    ),
    fetchAll((a, b) => supabase.from("fleet_vehicles").select("entry_date, exit_date").range(a, b)),
  ]);

  if (!segments.error && !fleet.error && fleet.data.length > 0) {
    const vehicles = fleet.data as OccVehicle[];
    return {
      vehicles: vehicles.filter((v) => !v.exit_date || Date.parse(v.exit_date) > now.getTime())
        .length,
      months: computeOccupancy(segments.data as OccSegment[], vehicles, now, months, firstOffset),
    };
  }

  // Antes do primeiro sync que popula os trechos e a frota: usa a reserva inteira e o tamanho atual da frota.
  const [res, size] = await Promise.all([
    fetchAll((a, b) =>
      supabase
        .from("reservations")
        .select("pick_up_at, return_at")
        .eq("status", "confirmed")
        .lt("pick_up_at", end)
        .gte("return_at", start)
        .range(a, b),
    ),
    supabase.from("fleet_stats").select("vehicles").eq("id", 1).maybeSingle(),
  ]);
  if (res.error) throw res.error;
  const vehicles = size.data?.vehicles ?? 0;
  return {
    vehicles,
    months: computeOccupancy(res.data as OccSegment[], vehicles, now, months, firstOffset),
  };
}
