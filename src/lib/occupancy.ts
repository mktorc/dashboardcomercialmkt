import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";

export type OccRes = { pick_up_at: string | null; return_at: string | null };
export type OccMonth = { label: string; month: string; rate: number; carDays: number; capacity: number };

const DAY = 86400000;

/** Ocupação = dias-carro reservados dentro do mês ÷ (frota × dias do mês). */
const MONTHS_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function computeOccupancy(res: OccRes[], vehicles: number, today: Date, count = 3, startOffset = 0): OccMonth[] {
  const out: OccMonth[] = [];
  for (let i = 0; i < count; i++) {
    const offset = startOffset + i;
    const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + offset, 1);
    const end = Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + offset + 1, 1);
    const days = (end - start) / DAY;
    let ms = 0;
    for (const r of res) {
      if (!r.pick_up_at || !r.return_at) continue;
      const a = Math.max(Date.parse(r.pick_up_at), start);
      const b = Math.min(Date.parse(r.return_at), end);
      if (b > a) ms += b - a;
    }
    const carDays = ms / DAY;
    const capacity = vehicles * days;
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
  return previous.rate ? ((current.rate - previous.rate) / previous.rate) * 100 : current.rate ? 100 : 0;
}

export async function fetchOccupancy(from?: string, to?: string) {
  const now = new Date();
  const currentMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodFrom = from ?? `${currentMonth.getUTCFullYear()}-${String(currentMonth.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const periodTo = to ?? now.toISOString().slice(0, 10);
  const monthOffset = (value: string) => {
    const [year, month] = value.slice(0, 7).split("-").map(Number);
    return (year! - currentMonth.getUTCFullYear()) * 12 + month! - 1 - currentMonth.getUTCMonth();
  };
  const firstOffset = monthOffset(periodFrom) - 13;
  const lastOffset = Math.max(2, monthOffset(periodTo) + 2);
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + firstOffset, 1)).toISOString();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + lastOffset + 1, 1)).toISOString();
  const [res, fleet] = await Promise.all([
    fetchAll((a, b) =>
      supabase
        .from("reservations")
        .select("pick_up_at, return_at")
        .eq("status", "confirmed")
        .lt("pick_up_at", end)
        .gt("return_at", start)
        .range(a, b),
    ),
    supabase.from("fleet_stats").select("vehicles").eq("id", 1).maybeSingle(),
  ]);
  if (res.error) throw res.error;
  const vehicles = fleet.data?.vehicles ?? 0;
  const reservations = res.data as OccRes[];
  return {
    vehicles,
    months: computeOccupancy(reservations, vehicles, now, lastOffset - firstOffset + 1, firstOffset),
  };
}
