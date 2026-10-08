import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";

export type OccRes = { pick_up_at: string | null; return_at: string | null };
export type OccMonth = { label: string; rate: number; carDays: number; capacity: number };

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
      rate: capacity ? carDays / capacity : 0,
      carDays,
      capacity,
    });
  }
  return out;
}

export async function fetchOccupancy() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1)).toISOString();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 3, 1)).toISOString();
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
  return { vehicles, months: computeOccupancy(res.data as OccRes[], vehicles, now, 5, -2) };
}
