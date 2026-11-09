import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CalendarDays,
  CalendarRange,
  ChevronsDownUp,
  ChevronsUpDown,
  FileText,
  Swords,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase as typedClient } from "@/integrations/supabase/client";
import { GestaoOcupacao } from "@/components/precificacao/GestaoOcupacao";
import { Competitividade } from "@/components/precificacao/Competitividade";
import { OcupacaoEsperada } from "@/components/precificacao/OcupacaoEsperada";
import {
  PrecificacaoSidebar,
  type PricingNavItem,
} from "@/components/precificacao/PrecificacaoSidebar";
import { formatLastUpdate, useForecast } from "@/lib/pricing-forecast";
import { guardPricingPage } from "@/lib/roles";
import { pricingTabDocument, splitPricingReport, type PricingTab } from "@/lib/pricing-report";

// A tabela pricing_study_report ainda não está em types.ts (gerado): usa o cliente sem tipos, como em lib/comissoes.
const supabase = typedClient as unknown as SupabaseClient;

export const Route = createFileRoute("/_authenticated/precificacao")({
  head: () => ({
    meta: [
      { title: "Gestor de Precificação Dinâmico | Orlando Rent Car Analytics" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  beforeLoad: () => guardPricingPage(),
  component: PricingHub,
});

export type Report = {
  id: string;
  generated_at: string;
  period_start: string;
  period_end: string;
  html: string;
};

// O estudo de precificação segue no código, mas fica oculto do menu até ser reativado aqui.
const SHOW_ESTUDO = false;
// A aba "Ocupação esperada" está oculta por enquanto.
const SHOW_OCUPACAO_ESPERADA = false;

type Section = "ocupacao" | "gestao" | "competitividade" | "estudo";
const NAV: PricingNavItem<Section>[] = [
  ...(SHOW_OCUPACAO_ESPERADA
    ? [{ key: "ocupacao" as const, label: "Ocupação esperada", icon: CalendarRange }]
    : []),
  { key: "gestao", label: "Gestão de Ocupação", icon: CalendarDays },
  { key: "competitividade", label: "Competitividade", icon: Swords },
  ...(SHOW_ESTUDO ? [{ key: "estudo" as const, label: "Estudo", icon: FileText }] : []),
];

const dataBR = (iso: string) => iso.split("-").reverse().join("/");

// Iframe sem scripts: o pai lê a altura do conteúdo (allow-same-origin) e acompanha mudanças de largura e de itens recolhidos.
function TabFrame({ css, tab }: { css: string; tab: PricingTab }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [observer, setObserver] = useState<ResizeObserver | null>(null);

  useEffect(() => () => observer?.disconnect(), [observer]);

  const aoCarregar = () => {
    const f = ref.current;
    const doc = f?.contentDocument;
    if (!f || !doc) return;
    const ajusta = () => {
      f.style.height = `${doc.documentElement.scrollHeight + 8}px`;
    };
    ajusta();
    observer?.disconnect();
    const ro = new ResizeObserver(ajusta);
    ro.observe(doc.documentElement);
    setObserver(ro);
    doc.addEventListener("toggle", ajusta, true);
  };

  return (
    <div className="space-y-2">
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => alternaTodos(ref.current, true)}>
          <ChevronsUpDown className="mr-1 size-4" /> Expandir tudo
        </Button>
        <Button variant="outline" size="sm" onClick={() => alternaTodos(ref.current, false)}>
          <ChevronsDownUp className="mr-1 size-4" /> Recolher tudo
        </Button>
      </div>
      <iframe
        ref={ref}
        title={tab.title}
        sandbox="allow-same-origin"
        srcDoc={pricingTabDocument(css, tab)}
        onLoad={aoCarregar}
        className="min-h-[60vh] w-full border-0 bg-background sm:rounded-xl sm:border sm:border-border"
      />
    </div>
  );
}

function alternaTodos(frame: HTMLIFrameElement | null, abrir: boolean) {
  frame?.contentDocument?.querySelectorAll("details.item").forEach((d) => {
    (d as HTMLDetailsElement).open = abrir;
  });
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
  return (
    <PricingHubView
      data={report.data ?? null}
      isLoading={report.isLoading}
      hasError={!!report.error}
    />
  );
}

export function PricingHubView({
  data,
  isLoading,
  hasError,
}: {
  data: Report | null;
  isLoading: boolean;
  hasError: boolean;
}) {
  const parsed = useMemo(() => (data ? splitPricingReport(data.html) : null), [data]);
  const [aba, setAba] = useState<string | null>(null);
  const ativa = aba ?? parsed?.tabs[0]?.id ?? "";

  const forecast = useForecast();
  const [secao, setSecao] = useState<Section>(SHOW_OCUPACAO_ESPERADA ? "ocupacao" : "gestao");

  return (
    <div className="flex min-h-screen flex-col bg-background lg:flex-row">
      <PrecificacaoSidebar items={NAV} active={secao} onSelect={setSecao} />
      <main className="min-w-0 flex-1 overflow-x-hidden">
        <header
          className="flex flex-wrap items-end justify-between gap-4 border-b border-border px-4 py-4 sm:px-6 sm:py-5"
          style={{ background: "var(--gradient-brand)" }}
        >
          <div>
            <h1 className="text-xl font-semibold text-foreground">
              Gestor de Precificação Dinâmico
            </h1>
            <p className="text-sm text-foreground/70">
              {secao === "estudo" && data
                ? `Estudo: período ${dataBR(data.period_start)} a ${dataBR(data.period_end)} · gerado em ${new Date(data.generated_at).toLocaleDateString("pt-BR")}.`
                : secao === "competitividade"
                  ? "Nossa tarifa de tabela contra os preços coletados dos concorrentes."
                  : secao === "gestao"
                    ? "Ocupação atual contra o benchmark histórico, na antecedência escolhida."
                    : "Ocupação atual e esperada por categoria, data a data."}
            </p>
          </div>
          {forecast.data ? (
            <span className="text-xs text-foreground/60">
              Última atualização: {formatLastUpdate(forecast.data.generated_at)}
            </span>
          ) : null}
        </header>
        <div className="mx-auto w-full max-w-6xl space-y-3 px-2 py-3 sm:space-y-4 sm:p-6">
          {secao === "ocupacao" ? (
            <OcupacaoEsperada />
          ) : secao === "gestao" ? (
            <GestaoOcupacao />
          ) : secao === "competitividade" ? (
            <Competitividade />
          ) : (
            <>
              {isLoading ? (
                <Card className="p-6 text-sm text-muted-foreground">Carregando relatório…</Card>
              ) : hasError ? (
                <Card className="p-6 text-sm text-destructive">
                  Não foi possível carregar o relatório.
                </Card>
              ) : !parsed || parsed.tabs.length === 0 ? (
                <Card className="p-6 text-sm text-muted-foreground">
                  Nenhum relatório publicado ainda. Rode o comando publicar em scripts/precificacao.
                </Card>
              ) : (
                <Tabs value={ativa} onValueChange={setAba} className="space-y-4">
                  <TabsList className="h-auto w-full flex-nowrap justify-start gap-1 overflow-x-auto [&>*]:shrink-0">
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
            </>
          )}
        </div>
      </main>
    </div>
  );
}
