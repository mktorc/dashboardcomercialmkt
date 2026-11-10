import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase as typedClient } from "@/integrations/supabase/client";
import { formatLastUpdate } from "./pricing-forecast";

// Tabelas de precificação ainda não estão em types.ts (gerado): cliente sem tipos, como em occupancy-pace.ts.
const supabase = typedClient as unknown as SupabaseClient;

async function ultimo(tabela: string, coluna: string): Promise<string | null> {
  const { data, error } = await supabase
    .from(tabela)
    .select(coluna)
    .order(coluna, { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as Record<string, string> | null)?.[coluna] ?? null;
}

/**
 * "Última atualização" do Gestor de Precificação: a mais recente entre a publicação da ocupação e a última coleta de concorrentes. Vem dos
 * próprios dados, então acompanha qualquer atualização (manual ou agendada) assim que ela termina de publicar. Reconsulta a cada minuto.
 */
export function useUltimaAtualizacaoPrecificacao() {
  const opts = { refetchInterval: 60_000, refetchOnWindowFocus: true, staleTime: 30_000 } as const;
  const ocupacao = useQuery({
    queryKey: ["pricing-freshness-ocupacao"],
    queryFn: () => ultimo("pricing_occupancy_pace", "generated_at"),
    ...opts,
  });
  const coleta = useQuery({
    queryKey: ["pricing-freshness-coleta"],
    queryFn: () => ultimo("competitor_price_snapshots", "collected_at"),
    ...opts,
  });
  const valores = [ocupacao.data, coleta.data].filter((v): v is string => !!v);
  const value = valores.length
    ? valores.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b))
    : null;
  return {
    value,
    loading: ocupacao.isLoading || coleta.isLoading,
    detalhe: `Ocupação: ${ocupacao.data ? formatLastUpdate(ocupacao.data) : "sem dados"} · Coleta de concorrentes: ${coleta.data ? formatLastUpdate(coleta.data) : "sem dados"}`,
  };
}
