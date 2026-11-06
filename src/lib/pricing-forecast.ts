import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase as typedClient } from "@/integrations/supabase/client";

// pricing_occupancy_forecast ainda não está em types.ts (gerado): cliente sem tipos, como em precificacao.tsx.
const supabase = typedClient as unknown as SupabaseClient;

/** Previsão de ocupação por categoria e data, gerada por scripts/precificacao/previsao.py (campos abreviados para caber no JSON). */
export type ForecastRow = {
  d: string; // data (AAAA-MM-DD)
  c: string; // categoria
  f: number; // carros disponíveis na data
  v: number; // diárias já vendidas hoje para a data
  o: number; // ocupação hoje
  e: number; // ocupação esperada (mediana)
  lo: number; // esperada, quartil inferior
  hi: number; // esperada, quartil superior
  n: number; // observações históricas usadas
  b: string; // base do histórico (sazonalidade ou categoria)
  s: string; // sazonalidade da data
};
export type ForecastPayload = {
  gerado_em: string;
  hoje: string;
  ate: string;
  categorias: string[];
  linhas: ForecastRow[];
};

/** Total do dia: frota e vendas somadas; esperado = soma das diárias esperadas (cada categoria × sua frota) ÷ frota total. */
export function forecastTotal(rows: ForecastRow[]) {
  const f = rows.reduce((s, r) => s + r.f, 0);
  if (!f) return null;
  const w = (k: "v" | "e" | "lo" | "hi") =>
    rows.reduce((s, r) => s + (k === "v" ? r.v : r[k] * r.f), 0) / f;
  return {
    f,
    v: rows.reduce((s, r) => s + r.v, 0),
    o: w("v"),
    e: w("e"),
    lo: w("lo"),
    hi: w("hi"),
  };
}

export function useForecast() {
  return useQuery({
    queryKey: ["pricing-occupancy-forecast"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pricing_occupancy_forecast")
        .select("generated_at,payload")
        .order("generated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as { generated_at: string; payload: ForecastPayload } | null;
    },
  });
}

/** Data e hora da última publicação, no formato do "Última atualização" dos demais hubs. */
export function formatLastUpdate(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString("pt-BR")} às ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}
