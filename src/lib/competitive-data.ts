import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase as typedClient } from "@/integrations/supabase/client";
import type { Equivalence, OurRate, Snapshot } from "./competitiveness";

// Tabelas da migração 0058 ainda não estão em types.ts (gerado): cliente sem tipos, como em pricing-forecast.ts.
const supabase = typedClient as unknown as SupabaseClient;

/** Coleta completa (inclui os campos que só a tabela comparativa mostra). */
export type SnapshotRow = Snapshot & {
  id: string;
  source: string;
  sourceUrl: string | null;
  protections: string | null;
  mileage: string | null;
  cancellation: string | null;
};

type RawSnapshot = {
  id: string;
  source: string;
  source_url: string | null;
  location: string;
  normalized_category: string | null;
  source_category: string | null;
  collected_at: string;
  pickup_at: string;
  return_at: string;
  total_price: number | null;
  daily_price: number | null;
  currency: string;
  available: boolean | null;
  equivalence: Equivalence;
  protections: string | null;
  mileage: string | null;
  cancellation_policy: string | null;
  competitors: { name: string } | null;
};

const LIMIT = 5000;

export function useCompetitorSnapshots() {
  return useQuery({
    queryKey: ["competitor-snapshots"],
    queryFn: async (): Promise<SnapshotRow[]> => {
      const { data, error } = await supabase
        .from("competitor_price_snapshots")
        .select(
          "id,source,source_url,location,normalized_category,source_category,collected_at,pickup_at,return_at,total_price,daily_price,currency,available,equivalence,protections,mileage,cancellation_policy,competitors(name)",
        )
        .order("collected_at", { ascending: false })
        .limit(LIMIT);
      if (error) throw error;
      return ((data ?? []) as unknown as RawSnapshot[]).map((r) => ({
        id: r.id,
        competitor: r.competitors?.name ?? "—",
        category: r.normalized_category ?? r.source_category,
        location: r.location,
        collectedAt: r.collected_at,
        pickupAt: r.pickup_at,
        returnAt: r.return_at,
        totalPrice: r.total_price == null ? null : Number(r.total_price),
        dailyPrice: r.daily_price == null ? null : Number(r.daily_price),
        currency: r.currency,
        available: r.available,
        equivalence: r.equivalence,
        source: r.source,
        sourceUrl: r.source_url,
        protections: r.protections,
        mileage: r.mileage,
        cancellation: r.cancellation_policy,
      }));
    },
  });
}

/** Nossa tarifa de tabela: a publicação mais recente de cada data e categoria. */
export function useOurRates() {
  return useQuery({
    queryKey: ["our-rate-snapshots"],
    queryFn: async (): Promise<OurRate[]> => {
      const { data, error } = await supabase
        .from("our_rate_snapshots")
        .select("pickup_date,category,daily_rate,currency,collected_at")
        .order("collected_at", { ascending: false })
        .limit(LIMIT * 4);
      if (error) throw error;
      const seen = new Set<string>();
      const out: OurRate[] = [];
      for (const r of (data ?? []) as {
        pickup_date: string;
        category: string;
        daily_rate: number;
        currency: string;
      }[]) {
        const k = `${r.pickup_date}|${r.category}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({
          pickupDate: r.pickup_date,
          category: r.category,
          dailyRate: Number(r.daily_rate),
          currency: r.currency,
        });
      }
      return out;
    },
  });
}
