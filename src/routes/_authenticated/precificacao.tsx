import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Card } from "@/components/ui/card";
import { supabase as typedClient } from "@/integrations/supabase/client";
import { guardPricingPage } from "@/lib/roles";

// A tabela pricing_study_report ainda não está em types.ts (gerado): usa o cliente sem tipos, como em lib/comissoes.
const supabase = typedClient as unknown as SupabaseClient;

export const Route = createFileRoute("/_authenticated/precificacao")({
  head: () => ({
    meta: [
      { title: "Precificação | Orlando Rent Car Analytics" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  beforeLoad: () => guardPricingPage(),
  component: PricingPage,
});

type Report = { id: string; generated_at: string; period_start: string; period_end: string; html: string };

function PricingPage() {
  const report = useQuery({
    queryKey: ["pricing-study-report"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pricing_study_report")
        .select("id,generated_at,period_start,period_end,html")
        .order("generated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as Report | null;
    },
  });

  return (
    <div className="flex min-h-screen flex-col bg-background lg:flex-row">
      <Sidebar active="precificacao" />
      <main className="min-w-0 flex-1 space-y-4 p-4 sm:p-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Precificação</h1>
          <p className="text-sm text-muted-foreground">
            Estudo histórico de ocupação, antecedência e preço (HQ Rentals).
            {report.data
              ? ` Período ${report.data.period_start} a ${report.data.period_end} · gerado em ${new Date(report.data.generated_at).toLocaleString("pt-BR")}.`
              : null}
          </p>
        </div>
        {report.isLoading ? (
          <Card className="p-6 text-sm text-muted-foreground">Carregando relatório…</Card>
        ) : report.error ? (
          <Card className="p-6 text-sm text-destructive">Não foi possível carregar o relatório.</Card>
        ) : !report.data ? (
          <Card className="p-6 text-sm text-muted-foreground">
            Nenhum relatório publicado ainda. Rode o comando publicar em scripts/precificacao.
          </Card>
        ) : (
          // sandbox vazio: o relatório é HTML estático e não executa scripts nem acessa a sessão do app
          <iframe
            title="Relatório de precificação"
            sandbox=""
            srcDoc={report.data.html}
            className="h-[calc(100vh-9rem)] w-full rounded-xl border border-border bg-background"
          />
        )}
      </main>
    </div>
  );
}
