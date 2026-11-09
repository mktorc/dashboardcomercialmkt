import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase as typedClient } from "@/integrations/supabase/client";
import { fetchAll } from "./fetch-all";
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

// O banco devolve no máximo 1.000 linhas por consulta: tudo é lido paginado (fetchAll), em ordem estável.
// Coletas: só as dos últimos 30 dias (a referência de mercado usa coletas de até 7 dias).
const JANELA_COLETAS_DIAS = 30;

export function useCompetitorSnapshots() {
  return useQuery({
    queryKey: ["competitor-snapshots"],
    queryFn: async (): Promise<SnapshotRow[]> => {
      const desde = new Date(Date.now() - JANELA_COLETAS_DIAS * 86400000).toISOString();
      const { data, error } = await fetchAll((from, to) =>
        supabase
          .from("competitor_price_snapshots")
          .select(
            "id,source,source_url,location,normalized_category,source_category,collected_at,pickup_at,return_at,total_price,daily_price,currency,available,equivalence,protections,mileage,cancellation_policy,competitors(name)",
          )
          .gte("collected_at", desde)
          .order("collected_at", { ascending: false })
          .order("id")
          .range(from, to),
      );
      if (error) throw error;
      return ((data ?? []) as unknown as RawSnapshot[]).map((r) => ({
        id: r.id,
        competitor: r.competitors?.name ?? "—",
        sourceCategory: r.source_category,
        category: r.normalized_category, // só categorias nossas: coleta sem categoria mapeada fica sem categoria e não entra na tela
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
      const { data, error } = await fetchAll((from, to) =>
        supabase
          .from("our_rate_snapshots")
          .select("pickup_date,category,daily_rate,currency,source,collected_at")
          .order("collected_at", { ascending: false })
          .order("id")
          .range(from, to),
      );
      if (error) throw error;
      // Por data e categoria vale a cotação do nosso site (mesma base dos concorrentes: N diárias, sem taxas e seguros); sem ela,
      // a tarifa do calendário do HQ. Dentro da mesma fonte, a mais recente (a lista já vem do mais novo para o mais antigo).
      const prefer = (source: string) => (source === "site_cotacao" ? 1 : 0);
      const best = new Map<string, { rate: OurRate; source: string }>();
      for (const r of (data ?? []) as {
        pickup_date: string;
        category: string;
        daily_rate: number;
        currency: string;
        source: string;
      }[]) {
        const k = `${r.pickup_date}|${r.category}`;
        const cur = best.get(k);
        if (cur && prefer(cur.source) >= prefer(r.source)) continue;
        best.set(k, {
          source: r.source,
          rate: {
            pickupDate: r.pickup_date,
            category: r.category,
            dailyRate: Number(r.daily_rate),
            currency: r.currency,
          },
        });
      }
      return [...best.values()].map((b) => b.rate);
    },
  });
}
