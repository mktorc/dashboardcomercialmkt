import { useMemo, useState, type SyntheticEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase as typedClient } from "@/integrations/supabase/client";
import { guardPricingPage } from "@/lib/roles";
import { pricingTabDocument, splitPricingReport, type PricingTab } from "@/lib/pricing-report";

// A tabela pricing_study_report ainda não está em types.ts (gerado): usa o cliente sem tipos, como em lib/comissoes.
const supabase = typedClient as unknown as SupabaseClient;

export const Route = createFileRoute("/_authenticated/precificacao")({
  head: () => ({
    meta: [
      { title: "Estudo de Precificação | Orlando Rent Car Analytics" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  beforeLoad: () => guardPricingPage(),
  component: PricingHub,
});

type Report = { id: string; generated_at: string; period_start: string; period_end: string; html: string };

const ajustaAltura = (e: SyntheticEvent<HTMLIFrameElement>) => {
  const f = e.currentTarget;
  const h = f.contentDocument?.documentElement.scrollHeight;
  if (h) f.style.height = `${h + 8}px`;
};

function TabFrame({ css, tab }: { css: string; tab: PricingTab }) {
  // allow-same-origin só para medir a altura; sem allow-scripts, nada do relatório executa.
  return (
    <iframe
      title={tab.title}
      sandbox="allow-same-origin"
      srcDoc={pricingTabDocument(css, tab)}
      onLoad={ajustaAltura}
      className="min-h-[60vh] w-full rounded-xl border border-border bg-background"
    />
  );
}

function PricingHub() {
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
  const parsed = useMemo(() => (report.data ? splitPricingReport(report.data.html) : null), [report.data]);
  const [aba, setAba] = useState<string | null>(null);
  const ativa = aba ?? parsed?.tabs[0]?.id ?? "";

  return (
    <div className="min-h-screen bg-background">
      <header
        className="flex items-center justify-between gap-4 border-b border-border px-4 py-4 sm:px-6"
        style={{ background: "var(--gradient-brand)" }}
      >
        <div className="flex items-center gap-3">
          <img src="/logo-orc.png" alt="Orlando Rent Car" className="size-9 rounded-lg object-cover" />
          <div>
            <h1 className="text-lg font-semibold text-foreground">Estudo de Precificação</h1>
            <p className="text-sm text-foreground/70">
              Ocupação, antecedência, preço e elasticidade (HQ Rentals).
              {report.data
                ? ` Período ${report.data.period_start} a ${report.data.period_end} · gerado em ${new Date(report.data.generated_at).toLocaleString("pt-BR")}.`
                : null}
            </p>
          </div>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/app">
            <ArrowLeft className="mr-1 size-4" /> Módulos
          </Link>
        </Button>
      </header>

      <main className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
        {report.isLoading ? (
          <Card className="p-6 text-sm text-muted-foreground">Carregando relatório…</Card>
        ) : report.error ? (
          <Card className="p-6 text-sm text-destructive">Não foi possível carregar o relatório.</Card>
        ) : !parsed || parsed.tabs.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground">
            Nenhum relatório publicado ainda. Rode o comando publicar em scripts/precificacao.
          </Card>
        ) : (
          <Tabs value={ativa} onValueChange={setAba} className="space-y-4">
            <TabsList className="h-auto w-full flex-nowrap justify-start gap-1 overflow-x-auto">
              {parsed.tabs.map((t) => (
                <TabsTrigger key={t.id} value={t.id}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
            {parsed.tabs.map((t) => (
              <TabsContent key={t.id} value={t.id} className="mt-0">
                <TabFrame css={parsed.css} tab={t} />
              </TabsContent>
            ))}
          </Tabs>
        )}
      </main>
    </div>
  );
}
