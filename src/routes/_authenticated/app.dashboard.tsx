import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  ComposedChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  LabelList,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowLeft,
  ArrowUpDown,
  DollarSign,
  Gauge,
  Maximize2,
  RefreshCw,
  Target,
  TrendingUp,
  UserCheck,
  Wallet,
} from "lucide-react";

import { guardPage } from "@/lib/roles";
import { SyncButton } from "@/components/dashboard/SyncButton";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { Card } from "@/components/ui/card";
import { PeriodoPicker } from "@/components/PeriodoPicker";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  brl,
  ALL_ORIGINS_KEY,
  buildMarketingFunnel,
  scopeMetaGoogle,
  fetchTeamCosts,
  teamCostForRange,
  computeAttribution,
  computeKpis,
  withPartnerReservations,
  channelReservations,
  channelCreated,
  usd2,
  normalizeOrigin,
  type AnalyticsData,
  computeChannelMonthly,
  MIN_CHANNEL_OPPORTUNITIES,
  MIN_CHANNEL_RESERVATIONS,
  type ChannelComparisonMode,
  type ChannelMonthlyPoint,
  computeOpportunityOrigins,
  computeTimeseries,
  buildOpportunityComparison,
  type OpportunityComparisonPoint,
  filterAnalyticsByOrigin,
  fetchAnalytics,
  pct,
} from "@/lib/analytics";

export const Route = createFileRoute("/_authenticated/app/dashboard")({
  beforeLoad: () => guardPage("dashboard"),
  head: () => ({
    meta: [
      { title: "Orlando Rent Car | Analytics, BI e Growth" },
      {
        name: "description",
        content:
          "Painel de performance da Orlando Rent Car: investimento em mídia, CPL, conversão comercial, ticket médio e ROAS real por campanha.",
      },
      { property: "og:title", content: "Orlando Rent Car | Analytics, BI e Growth" },
      {
        property: "og:description",
        content: "ROI por UTM cruzando mídia paga, oportunidades do ClickMassa e reservas do HQ.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

const axis = { stroke: "oklch(0.74 0.03 150)", fontSize: 12 };
const tooltipStyle = {
  background: "oklch(0.22 0.03 155)",
  border: "1px solid oklch(0.34 0.045 155)",
  borderRadius: 12,
  color: "#fff",
};
// Paleta padrão dos gráficos de duas séries: principal (atual/receita) e secundária (anterior/investimento).
const CHART_PRIMARY = "#44E500";
const CHART_SECONDARY = "#2f9c5a";
const ORIGIN_COLORS = [
  "#2f9c5a",
  "#44E500",
  "#3b82f6",
  "#f2b84b",
  "#e66b5b",
  "#8b9a46",
  "#7a68a6",
  "#26a69a",
];
const localDateInput = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const getPriorYearDates = (from: string, to: string) => {
  const [fromYear, fromMonth, fromDay] = from.split("-").map(Number);
  const [toYear, toMonth, toDay] = to.split("-").map(Number);
  const priorFromDate = new Date(fromYear! - 1, fromMonth! - 1, fromDay!);
  const priorToDate = new Date(toYear! - 1, toMonth! - 1, toDay!);
  return {
    from: localDateInput(priorFromDate),
    to: localDateInput(priorToDate),
  };
};

type AttributionSortKey =
  | "utm"
  | "investimento"
  | "leads"
  | "cpl"
  | "reservas"
  | "conversao"
  | "faturamento"
  | "roas"
  | "cac";

function useIsMainReady() {
  const qc = useQueryClient();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (ready) return;
    const check = () => {
      const q = qc.getQueryCache().findAll({ queryKey: ["analytics"], exact: false });
      if (q.some((x) => x.queryKey[0] === "analytics" && x.state.data !== undefined))
        setReady(true);
    };
    check();
    return qc.getQueryCache().subscribe(check);
  }, [qc, ready]);
  return ready;
}

function Dashboard() {
  const today = new Date();
  const [from, setFrom] = useState(
    localDateInput(new Date(today.getFullYear(), today.getMonth(), 1)),
  );
  const [to, setTo] = useState(localDateInput(today));
  const [originFilter, setOriginFilter] = useState("all");
  const [includeTeam, setIncludeTeam] = useState(false);
  const { data: teamCosts } = useQuery({
    queryKey: ["team-costs"],
    queryFn: fetchTeamCosts,
    staleTime: 10 * 60 * 1000,
  });
  // Pronto quando a consulta do período (números do topo) já tem dados, mesmo que do cache.
  const mainReady = useIsMainReady();
  // De janeiro do ano atual até o mês atual.
  const last12 = Array.from({ length: today.getMonth() + 1 }, (_, i) => {
    const d = new Date(today.getFullYear(), i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const { data: data12 } = useQuery({
    queryKey: ["analytics-12m", last12[0]],
    queryFn: () => fetchAnalytics(`${last12[0]}-01`, localDateInput(today)),
    staleTime: 10 * 60 * 1000,
    // Só depois dos números do topo: as cargas do ano são pesadas e disputavam a rede com eles.
    enabled: mainReady,
  });
  // Gráficos de oportunidades criadas/ganhas: sempre o ano todo (janeiro até hoje), independente do período.
  const yearStart = `${last12[0]}-01`;
  const priorYearStart = `${today.getFullYear() - 1}-01-01`;
  const priorYearToday = localDateInput(
    new Date(today.getFullYear() - 1, today.getMonth(), today.getDate()),
  );
  const { data: data12Prior } = useQuery({
    queryKey: ["analytics-12m-prior", priorYearStart, priorYearToday],
    queryFn: () => fetchAnalytics(priorYearStart, priorYearToday),
    staleTime: 10 * 60 * 1000,
    enabled: mainReady,
  });
  const [channelMode, setChannelMode] = useState<ChannelComparisonMode>("both");
  // O funil tem seu próprio seletor (independe do filtro de origem do topo).
  const [funnelMode, setFunnelMode] = useState<ChannelComparisonMode>("both");
  const [attributionSort, setAttributionSort] = useState<{ key: AttributionSortKey; dir: 1 | -1 }>({
    key: "investimento",
    dir: -1,
  });
  const priorYear = getPriorYearDates(from, to);
  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ["analytics", from, to],
    queryFn: async () => {
      const [current, prior] = await Promise.all([
        fetchAnalytics(from, to),
        fetchAnalytics(priorYear.from, priorYear.to),
      ]);
      return { current, prior };
    },
  });

  // Cálculos pesados guardados (useMemo): antes rodavam a cada renderização e travavam a tela.
  const originAnalytics = useMemo(
    () =>
      data
        ? computeOpportunityOrigins(
            data.current.opportunities,
            data.current.updatedOpportunities,
            from,
            to,
          )
        : null,
    [data, from, to],
  );

  const priorYearAnalytics = useMemo(
    () =>
      data
        ? computeOpportunityOrigins(
            data.prior.opportunities,
            data.prior.updatedOpportunities,
            priorYear.from,
            priorYear.to,
          )
        : null,
    [data, priorYear.from, priorYear.to],
  );

  // Conversas iniciadas por mensagem no Meta, uma barra por dia do período (dias sem dado = 0).
  const metaConversationsDaily = (() => {
    if (!data) return [];
    const byDay = new Map<string, number>();
    data.current.meta.forEach((r) =>
      byDay.set(r.date, (byDay.get(r.date) ?? 0) + (Number(r.conversations) || 0)),
    );
    const days: { date: string; label: string; conversations: number }[] = [];
    for (
      let t = Date.parse(`${from}T00:00:00Z`);
      t <= Date.parse(`${to}T00:00:00Z`);
      t += 86_400_000
    ) {
      const date = new Date(t).toISOString().slice(0, 10);
      days.push({
        date,
        label: date.slice(8) + "/" + date.slice(5, 7),
        conversations: byDay.get(date) ?? 0,
      });
    }
    return days;
  })();

  const metaConversationsTotal = metaConversationsDaily.reduce(
    (sum, d) => sum + d.conversations,
    0,
  );
  const selectedOrigin = originFilter === "all" ? null : originFilter;
  const originData = data ? filterAnalyticsByOrigin(data.current, selectedOrigin) : null;
  // Equipe de marketing atende todos os canais: só entra em "Todas as origens".
  const teamSpend =
    includeTeam && !selectedOrigin && teamCosts ? teamCostForRange(teamCosts, from, to) : 0;
  // Meta e Google: reservas pela mesma regra mês a mês do comparativo de CAC (parceiro do HQ desde ago/2026,
  // antes disso a origem do lead). Demais origens: parceiro de comissão do HQ.
  // Atribuição por canal (regra mês a mês do comparativo de CAC): pesada, calculada uma vez por carga.
  const channelData = useMemo(() => {
    if (!data) return null;
    const modes = ["meta", "google", "both"] as const;
    return {
      reservations: Object.fromEntries(
        modes.map((m) => [m, channelReservations(data.current, m)]),
      ) as Record<(typeof modes)[number], ReturnType<typeof channelReservations>>,
      created: Object.fromEntries(modes.map((m) => [m, channelCreated(data.current, m)])) as Record<
        (typeof modes)[number],
        number
      >,
    };
  }, [data]);
  const reservationsFor = (
    origin: string | null,
    d: NonNullable<typeof data>,
    scoped: AnalyticsData,
  ) => {
    const key = origin ? normalizeOrigin(origin) : null;
    return (key === "meta" || key === "google") && channelData
      ? { ...scoped, reservations: channelData.reservations[key] }
      : withPartnerReservations(scoped, origin, d.current.reservations);
  };
  const baseKpis =
    originData && data
      ? computeKpis(reservationsFor(selectedOrigin, data, originData), teamSpend)
      : null;
  // ROAS global: só o faturamento atribuído a Meta + Google (o investimento é só mídia/equipe de marketing).
  const marketingRows = channelData && !selectedOrigin ? channelData.reservations.both : null;
  const marketingRevenue = marketingRows
    ? marketingRows.reduce((s, r) => s + r.total_amount, 0)
    : null;
  // CPL: oportunidades criadas pela mesma contagem do funil/CAC (Meta + Google em "Todas as origens").
  const cplMode = (origin: string | null) => {
    const key = origin ? normalizeOrigin(origin) : null;
    return key === "meta" || key === "google" ? key : key === null ? ("both" as const) : null;
  };
  // Mantém `leads` (usado na conversão); o CPL ganha a própria contagem em `cplLeads`.
  const withCpl = <K extends ReturnType<typeof computeKpis>>(k: K, origin: string | null) => {
    const mode = cplMode(origin);
    const cplLeads = channelData && mode ? channelData.created[mode] : k.leads;
    // Conversão com as mesmas ganhas e criadas do funil/CAC (Meta + Google em "Todas as origens").
    const convWon = mode === "both" && marketingRows ? marketingRows.length : k.reservations;
    return {
      ...k,
      cplLeads,
      cpl: cplLeads ? k.spend / cplLeads : 0,
      convWon,
      conversion: cplLeads ? convWon / cplLeads : 0,
    };
  };
  const kpis = baseKpis
    ? {
        ...withCpl(baseKpis, selectedOrigin),
        roas:
          marketingRevenue == null
            ? baseKpis.roas
            : baseKpis.spend
              ? marketingRevenue / baseKpis.spend
              : 0,
        roasRevenue: marketingRevenue ?? baseKpis.revenue,
        // CAC global: só reservas e faturamento de Meta + Google (o ticket segue com todas as reservas).
        cacReservations: marketingRows ? marketingRows.length : baseKpis.reservations,
        cacRevenue: marketingRevenue ?? baseKpis.revenue,
        cac: marketingRows
          ? marketingRows.length
            ? baseKpis.spend / marketingRows.length
            : null
          : baseKpis.cac,
        cacPct:
          marketingRevenue == null
            ? baseKpis.cacPct
            : marketingRevenue > 0
              ? baseKpis.spend / marketingRevenue
              : null,
      }
    : null;
  // Mesmo cálculo do filtro de origem, por canal, para a linha "Meta · Google" de cada card.
  const channelKpis = (origin: "meta" | "google") =>
    data
      ? withCpl(
          computeKpis(reservationsFor(origin, data, filterAnalyticsByOrigin(data.current, origin))),
          origin,
        )
      : null;
  const metaKpis = !selectedOrigin ? channelKpis("meta") : null;
  const googleKpis = !selectedOrigin ? channelKpis("google") : null;
  const fmtPct = (v: number | null) =>
    v == null ? "—" : `${(v * 100).toFixed(1).replace(".", ",")}%`;
  const channelRows = (format: (k: ReturnType<typeof computeKpis>) => string) =>
    metaKpis && googleKpis
      ? [
          { label: "Meta", values: [format(metaKpis)] },
          { label: "Google", values: [format(googleKpis)] },
        ]
      : null;
  const breakdownOf = (column: string, format: (k: ReturnType<typeof computeKpis>) => string) => {
    const rows = channelRows(format);
    return rows ? { columns: [column], rows } : undefined;
  };
  const last12Key = last12.join(",");
  const channelMonthly = useMemo(
    () =>
      data12
        ? computeChannelMonthly(data12, channelMode, last12Key.split(","), teamCosts ?? {})
        : [],
    [data12, channelMode, last12Key, teamCosts],
  );
  const series = originData ? computeTimeseries(originData, from) : [];
  let attribution = originData ? computeAttribution(originData) : [];
  attribution = attribution.sort((a, b) => {
    const va = a[attributionSort.key];
    const vb = b[attributionSort.key];
    if (va === null || vb === null) return (vb === null ? 1 : 0) - (va === null ? 1 : 0);
    const cmp =
      typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
    return cmp * attributionSort.dir;
  });
  // "Todas as Origens": uma única série consolidada (atual vs. anterior), sem barras por origem.
  const originSources =
    originFilter === "all"
      ? [{ key: ALL_ORIGINS_KEY, label: "Todas as origens" }]
      : (originAnalytics?.sources ?? []).filter((source) => source.label === originFilter);

  const todayStr = localDateInput(today);
  const yearOrigin = useMemo(
    () =>
      data12
        ? computeOpportunityOrigins(
            data12.opportunities,
            data12.updatedOpportunities,
            yearStart,
            todayStr,
          )
        : null,
    [data12, yearStart, todayStr],
  );
  const yearPriorOrigin = useMemo(
    () =>
      data12Prior
        ? computeOpportunityOrigins(
            data12Prior.opportunities,
            data12Prior.updatedOpportunities,
            priorYearStart,
            priorYearToday,
          )
        : null,
    [data12Prior, priorYearStart, priorYearToday],
  );
  const yoyCreatedMonthly =
    yearOrigin && yearPriorOrigin
      ? buildOpportunityComparison(
          yearOrigin.createdMonthly,
          yearOrigin.sources,
          yearPriorOrigin.createdMonthly,
          yearPriorOrigin.sources,
          selectedOrigin,
        )
      : [];

  const yoyClosedMonthly =
    yearOrigin && yearPriorOrigin
      ? buildOpportunityComparison(
          yearOrigin.closedMonthly,
          yearOrigin.sources,
          yearPriorOrigin.closedMonthly,
          yearPriorOrigin.sources,
          selectedOrigin,
        )
      : [];

  // Entre set/2024 e nov/2025 o Kommo quase não etiquetou leads como Google (origem vazia ou "Outros Canais").
  const googleNote =
    selectedOrigin && /google/i.test(selectedOrigin)
      ? 'Atenção: de set/2024 a nov/2025 a origem Google está subestimada, pois o Kommo deixou de etiquetar esses leads (ficaram sem origem ou como "Outros Canais"). Comparações com 2026 mostram um salto que não é real.'
      : undefined;

  const funnelOrigin = funnelMode === "both" ? null : funnelMode;
  // Consolidado do funil = Meta + Google, o mesmo escopo do Consolidado do comparativo de CAC.
  const dynamicFunnel = data
    ? buildMarketingFunnel(
        funnelOrigin
          ? filterAnalyticsByOrigin(data.current, funnelOrigin)
          : scopeMetaGoogle(data.current),
        funnelOrigin,
        data.current.reservations,
        !funnelOrigin,
      )
    : null;

  return (
    <div className="flex min-h-screen flex-col bg-background lg:flex-row">
      <main className="min-w-0 flex-1 overflow-x-hidden">
        <header
          className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-4 py-4 sm:px-6 sm:py-5"
          style={{ background: "var(--gradient-brand)" }}
        >
          <div>
            <h1 className="text-xl font-semibold text-foreground">Painel de Performance</h1>
            <p className="text-sm text-foreground/70">
              Mídia paga, oportunidades ClickMassa e reservas HQ
            </p>
          </div>
          <div className="flex w-full flex-wrap items-end gap-2 sm:w-auto">
            <Button asChild variant="outline" size="sm" className="h-9">
              <Link to="/app">
                <ArrowLeft className="mr-1 size-4" /> Voltar aos Módulos
              </Link>
            </Button>
            <SyncButton />
            <div className="text-xs text-foreground/70">
              Período
              <PeriodoPicker
                inicio={from}
                fim={to}
                className="mt-1 h-9 w-full bg-card sm:w-56"
                onChange={(i, f) => {
                  if (i && f) {
                    setFrom(i);
                    setTo(f);
                  }
                }}
              />
            </div>
            <label className="text-xs text-foreground/70">
              Origem
              <select
                aria-label="Filtrar página por origem"
                className="mt-1 block h-9 min-w-40 rounded-md border border-input bg-card px-3 text-sm text-foreground"
                value={originFilter}
                onChange={(event) => setOriginFilter(event.target.value)}
              >
                <option value="all">Todas as origens</option>
                {(originAnalytics?.sources ?? []).map((source) => (
                  <option key={source.key} value={source.label}>
                    {source.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </header>

        <div className="space-y-6 p-4 sm:p-6">
          {error ? (
            <Card className="border-destructive/40 p-4 text-sm text-destructive">
              Não foi possível carregar os dados agora. Tente sincronizar novamente.
              {error instanceof Error ? (
                <p className="mt-1 break-words text-xs">{error.message}</p>
              ) : null}
            </Card>
          ) : null}

          <label
            className="flex w-fit items-center gap-2 text-xs text-foreground/80"
            title={
              selectedOrigin
                ? 'Disponível só em "Todas as origens"'
                : "Soma o investimento mensal da equipe (Configurações) a Investimento, CPL, CAC e ROAS"
            }
          >
            <input
              type="checkbox"
              checked={includeTeam && !selectedOrigin}
              disabled={Boolean(selectedOrigin)}
              onChange={(event) => setIncludeTeam(event.target.checked)}
            />
            Incluir investimento da equipe de marketing (Investimento total, CPL, CAC e ROAS)
          </label>

          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <KpiCard
              icon={Wallet}
              label="Investimento total em mídia"
              help={
                "Quanto foi investido em anúncios no período.\nSoma do gasto do Meta Ads e do Google Ads (mais a equipe de marketing, se a opção estiver marcada)."
              }
              value={kpis ? brl(kpis.spend) : "—"}
              calc={
                kpis
                  ? `Meta ${brl(kpis.metaSpend)} + Google ${brl(kpis.googleSpend)}${kpis.teamSpend ? ` + Equipe ${brl(kpis.teamSpend)}` : ""} = ${brl(kpis.spend)}`
                  : undefined
              }
              breakdown={
                kpis
                  ? {
                      columns: ["Investido"],
                      rows: [
                        { label: "Meta", values: [brl(kpis.metaSpend)] },
                        { label: "Google", values: [brl(kpis.googleSpend)] },
                      ],
                    }
                  : undefined
              }
              wrapHint
              compact
              className="h-full"
            />
            <KpiCard
              icon={Target}
              label="CPL global"
              help={
                "Custo por lead: investimento ÷ oportunidades criadas no período (Meta + Google em Todas as origens).\nMostra quanto custa gerar cada oportunidade."
              }
              value={kpis ? usd2(kpis.cpl) : "—"}
              calc={
                kpis
                  ? `${brl(kpis.spend)} investidos ÷ ${kpis.cplLeads} oportunidades criadas${selectedOrigin ? "" : " de Meta + Google"} = ${usd2(kpis.cpl)}\nOportunidades: ClickMassa desde 15/06/2026; antes, leads do Kommo da origem.`
                  : undefined
              }
              breakdown={breakdownOf("CPL", (k) => usd2(k.cpl))}
              wrapHint
              compact
              className="h-full"
            />
            <KpiCard
              icon={UserCheck}
              label="Conversão comercial"
              help={
                "Percentual de oportunidades que viraram reserva.\nGanhas ÷ oportunidades criadas no período (Meta + Google em Todas as origens)."
              }
              value={kpis ? pct(kpis.conversion) : "—"}
              calc={
                kpis
                  ? `${kpis.convWon} ganhas ÷ ${kpis.cplLeads} oportunidades criadas${selectedOrigin ? "" : " de Meta + Google"} = ${pct(kpis.conversion)}\nMesma contagem do funil e do comparativo de CAC.`
                  : undefined
              }
              breakdown={breakdownOf("Conversão", (k) => pct(k.conversion))}
              highlight
              wrapHint
              compact
              className="h-full"
            />
            <KpiCard
              icon={DollarSign}
              label="Ticket médio"
              help={
                "Valor médio por reserva HQ.\nFaturamento das reservas confirmadas ÷ número de reservas."
              }
              value={kpis ? brl(kpis.ticket) : "—"}
              calc={
                kpis
                  ? `${brl(kpis.revenue)} de faturamento ÷ ${kpis.reservations} reservas HQ = ${brl(kpis.ticket)}`
                  : undefined
              }
              breakdown={breakdownOf("Ticket", (k) => brl(k.ticket))}
              wrapHint
              compact
              className="h-full"
            />
            <KpiCard
              icon={Gauge}
              label="Custo de aquisição de clientes"
              help={
                "CAC: quanto custa conquistar cada reserva.\nInvestimento em mídia (Meta + Google, mais equipe se marcada) ÷ reservas de Meta + Google (ou da origem filtrada).\nCAC percentual: investimento ÷ faturamento em rack rate dessas reservas."
              }
              value={kpis?.cac == null ? "—" : `${brl(kpis.cac)} (${fmtPct(kpis.cacPct)})`}
              calc={
                kpis
                  ? `CAC: ${brl(kpis.spend)} investidos ÷ ${kpis.cacReservations} reservas${selectedOrigin ? "" : " de Meta + Google"} = ${kpis.cac == null ? "—" : brl(kpis.cac)}\nCAC percentual: ${brl(kpis.spend)} investidos ÷ ${brl(kpis.cacRevenue)} de faturamento em rack rate = ${fmtPct(kpis.cacPct)}${kpis.teamSpend ? "\nO investimento inclui a equipe de marketing." : "\nSomente mídia (Meta + Google)."}`
                  : undefined
              }
              breakdown={
                metaKpis && googleKpis
                  ? {
                      columns: ["CAC", "CAC %"],
                      rows: [
                        {
                          label: "Meta",
                          values: [
                            metaKpis.cac == null ? "—" : brl(metaKpis.cac),
                            fmtPct(metaKpis.cacPct),
                          ],
                        },
                        {
                          label: "Google",
                          values: [
                            googleKpis.cac == null ? "—" : brl(googleKpis.cac),
                            fmtPct(googleKpis.cacPct),
                          ],
                        },
                      ],
                    }
                  : undefined
              }
              wrapHint
              compact
              className="h-full"
            />
            <KpiCard
              icon={TrendingUp}
              label="ROAS real global"
              help={
                "Retorno sobre o investimento.\nFaturamento das reservas de Meta + Google (ou da origem filtrada) ÷ investimento. 2x = cada US$ 1 investido voltou US$ 2."
              }
              value={kpis ? `${kpis.roas.toFixed(2)}x` : "—"}
              calc={
                kpis
                  ? `${brl(kpis.roasRevenue)} de faturamento ${selectedOrigin ? "" : "de Meta + Google "}÷ ${brl(kpis.spend)} investidos = ${kpis.roas.toFixed(2)}x`
                  : undefined
              }
              breakdown={breakdownOf("ROAS", (k) => `${k.roas.toFixed(2)}x`)}
              highlight
              wrapHint
              compact
              className="h-full"
            />
          </section>

          <section className="grid gap-4">
            <ExpandableChartPanel title="Evolução diária — Investimento x Faturamento">
              {(expanded) => (
                <div style={{ height: expanded ? "70vh" : 288 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={series} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                      <defs>
                        <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={CHART_PRIMARY} stopOpacity={0.5} />
                          <stop offset="95%" stopColor={CHART_PRIMARY} stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="inv" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={CHART_SECONDARY} stopOpacity={0.7} />
                          <stop offset="95%" stopColor={CHART_SECONDARY} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.34 0.045 155)" />
                      <XAxis dataKey="label" {...axis} />
                      <YAxis
                        yAxisId="revenue"
                        {...axis}
                        tickFormatter={(value: number) => `$${Math.round(value / 1000)}k`}
                      />
                      <YAxis
                        yAxisId="spend"
                        orientation="right"
                        {...axis}
                        domain={[0, "auto"]}
                        tickFormatter={(value: number) => `$${Math.round(value)}`}
                      />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => brl(v)} />
                      <Area
                        isAnimationActive={false}
                        type="monotone"
                        dataKey="faturamento"
                        yAxisId="revenue"
                        name="Faturamento"
                        stroke={CHART_PRIMARY}
                        fill="url(#rev)"
                        strokeWidth={2}
                      />
                      <Line
                        isAnimationActive={false}
                        type="monotone"
                        dataKey="investimento"
                        yAxisId="spend"
                        name="Investimento"
                        stroke={CHART_SECONDARY}
                        strokeWidth={2.5}
                        dot={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}
            </ExpandableChartPanel>
          </section>

          <section className="grid min-w-0 gap-4 xl:grid-cols-2">
            <OriginMonthlyChart
              title="Oportunidades criadas (Ano Atual vs. Ano Anterior)"
              subtitle="Comparação YoY do ano todo (janeiro até hoje), independente do período selecionado."
              data={yoyCreatedMonthly}
              loading={!data12 || !data12Prior}
              currentYear={today.getFullYear()}
              previousYear={today.getFullYear() - 1}
              note={googleNote}
            />
            <OriginMonthlyChart
              title="Oportunidades ganhas (Ano Atual vs. Ano Anterior)"
              subtitle="Comparação YoY do ano todo (janeiro até hoje), independente do período selecionado."
              data={yoyClosedMonthly}
              loading={!data12 || !data12Prior}
              currentYear={today.getFullYear()}
              previousYear={today.getFullYear() - 1}
              note={googleNote}
            />
            <div className="xl:col-span-2">
              <ExpandableChartPanel
                title="Conversas iniciadas por mensagem (Meta Ads)"
                subtitle="Uma barra por dia do período selecionado. Fonte: Meta, ação messaging_conversation_started_7d."
              >
                {(expanded) => (
                  <>
                    <p className="-mt-2 mb-2 text-2xl font-bold text-foreground">
                      {metaConversationsTotal.toLocaleString("pt-BR")}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        conversas no período (soma de todos os dias)
                      </span>
                    </p>
                    {metaConversationsDaily.length ? (
                      <div className="w-full min-w-0" style={{ height: expanded ? "65vh" : 300 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={metaConversationsDaily}
                            margin={{ top: 8, right: 16, left: 0, bottom: 8 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                            <XAxis dataKey="label" minTickGap={8} {...axis} />
                            <YAxis allowDecimals={false} {...axis} />
                            <Tooltip
                              contentStyle={tooltipStyle}
                              formatter={(v: number) => [
                                v.toLocaleString("pt-BR"),
                                "Conversas iniciadas",
                              ]}
                              labelFormatter={(_, payload) =>
                                String(payload?.[0]?.payload?.date ?? "")
                                  .split("-")
                                  .reverse()
                                  .join("/")
                              }
                            />
                            <Bar
                              isAnimationActive={false}
                              dataKey="conversations"
                              name="Conversas iniciadas"
                              fill={CHART_PRIMARY}
                              radius={[4, 4, 0, 0]}
                            />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
                        {isLoading ? "Carregando..." : "Sem dados no período."}
                      </div>
                    )}
                  </>
                )}
              </ExpandableChartPanel>
            </div>
            <ExpandableChartPanel
              className="xl:col-span-2"
              title="Comparativo de Conversão e CAC % (Marketing)"
              subtitle="Desde janeiro · Conversão = ganhas ÷ criadas · CAC % = investimento ÷ faturamento em rack rate."
              actions={
                <div className="flex gap-1">
                  {(
                    [
                      ["meta", "Meta Ads"],
                      ["google", "Google Ads"],
                      ["both", "Consolidado"],
                    ] as const
                  ).map(([key, label]) => (
                    <Button
                      key={key}
                      size="sm"
                      variant={channelMode === key ? "default" : "outline"}
                      onClick={() => setChannelMode(key)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              }
            >
              {(expanded) => (
                <>
                  <div className="w-full min-w-0" style={{ height: expanded ? "60vh" : 300 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={channelMonthly}
                        margin={{ top: 8, right: 16, left: 0, bottom: 8 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                        <XAxis dataKey="month" interval={0} tick={{ fontSize: 11 }} />
                        <YAxis tickFormatter={(v: number) => `${v}%`} tick={{ fontSize: 12 }} />
                        <Tooltip
                          content={({ active, payload, label }) => {
                            const point = active
                              ? (payload?.[0]?.payload as ChannelMonthlyPoint | undefined)
                              : undefined;
                            if (!point) return null;
                            const d = point.detail;
                            const fmt = (v: number | null) =>
                              v == null
                                ? "sem dados suficientes"
                                : `${v.toFixed(2).replace(".", ",")}%`;
                            return (
                              <div className="rounded-md border border-border bg-card p-3 text-xs text-foreground shadow-md">
                                <p className="mb-1 font-semibold">{label}</p>
                                <p>Conversão: {fmt(point.conversao)}</p>
                                <p className="text-muted-foreground">
                                  {d.won} ganhas ÷ {d.created} oportunidades criadas
                                </p>
                                <p className="mt-1">CAC %: {fmt(point.cac)}</p>
                                <p className="text-muted-foreground">
                                  {brl(d.media)} mídia{d.team ? ` + ${brl(d.team)} equipe` : ""} ÷{" "}
                                  {brl(d.revenue)} faturamento ({d.reservations} reservas/ganhas)
                                </p>
                              </div>
                            );
                          }}
                        />
                        <Legend />
                        <Bar
                          isAnimationActive={false}
                          dataKey="conversao"
                          name="Taxa de Conversão (%)"
                          fill={CHART_PRIMARY}
                          radius={[4, 4, 0, 0]}
                        />
                        <Bar
                          isAnimationActive={false}
                          dataKey="cac"
                          name="CAC Percentual (%)"
                          fill={CHART_SECONDARY}
                          radius={[4, 4, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
                    Meses sem barra não têm dados suficientes: o canal precisa de pelo menos{" "}
                    {MIN_CHANNEL_OPPORTUNITIES} oportunidades (conversão) e{" "}
                    {MIN_CHANNEL_RESERVATIONS} reservas atribuídas (CAC %). Quando o Kommo não
                    registrou a origem do lead, quase nenhuma reserva é atribuída ao canal e a razão
                    fica distorcida. Isso ocorre sobretudo no Google Ads antes de junho/2026. No
                    Consolidado, o CAC % também inclui o investimento mensal na equipe de marketing
                    (Configurações).
                  </p>
                </>
              )}
            </ExpandableChartPanel>
            <ExpandableChartPanel
              className="xl:col-span-2"
              title="Funil de marketing"
              subtitle="Cada etapa é contada pela sua própria data de criação no período: contatos (pessoas), oportunidades criadas (um contato pode ter mais de uma, ou ser anterior ao período) e oportunidades ganhas, as mesmas do gráfico de Comparativo de CAC. Por isso uma etapa pode superar a anterior. A primeira etapa de mídia aparece para Meta Ads (leads) e Google Ads (cliques e conversões)."
              actions={
                <div className="flex gap-1">
                  {(
                    [
                      ["meta", "Meta Ads"],
                      ["google", "Google Ads"],
                      ["both", "Consolidado"],
                    ] as const
                  ).map(([key, label]) => (
                    <Button
                      key={key}
                      size="sm"
                      variant={funnelMode === key ? "default" : "outline"}
                      onClick={() => setFunnelMode(key)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              }
            >
              {() => (
                <>
                  {dynamicFunnel ? (
                    <>
                      <div className="mt-6 flex flex-col items-center gap-2">
                        {dynamicFunnel.stages.map((stage, index) => {
                          const base = dynamicFunnel.stages[0]?.count ?? 0;
                          const w = base ? Math.max(40, (stage.count / base) * 100) : 40;
                          return (
                            <div
                              key={index}
                              className="flex min-h-14 max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-sm border border-border bg-secondary/70 px-3 py-2 text-center"
                              style={{ width: `${Math.min(100, w)}%` }}
                            >
                              <span className="text-xs font-medium">{stage.label}</span>
                              <span className="text-sm font-semibold text-accent">
                                {stage.count.toLocaleString("pt-BR")}
                              </span>
                              {stage.hint ? (
                                <span className="text-xs text-muted-foreground">{stage.hint}</span>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                      <div className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))] gap-3">
                        {dynamicFunnel.metrics.map((m) => (
                          <div
                            key={m.label}
                            className="flex min-w-0 flex-col justify-between gap-1 rounded-md border border-border p-3"
                          >
                            <p className="break-words text-[11px] leading-4 text-muted-foreground">
                              {m.label}
                            </p>
                            <p className="text-lg font-semibold leading-6 text-foreground">
                              {m.value === null ? "—" : pct(m.value)}
                            </p>
                          </div>
                        ))}
                      </div>
                      {funnelOrigin === "meta" && !dynamicFunnel.stages[0]?.count ? (
                        <p className="mt-3 text-xs text-muted-foreground">
                          Leads do Meta aparecem após a próxima sincronização do Meta Ads.
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      {isLoading ? "Carregando…" : "Sem dados."}
                    </p>
                  )}
                </>
              )}
            </ExpandableChartPanel>
          </section>

          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  Atribuição e CAC por UTM / Campanha
                </h2>
                <p className="text-xs text-muted-foreground">
                  Mídia paga → oportunidades ClickMassa → reservas fechadas no HQ. CAC "—" = sem
                  investimento ou nenhuma reserva chegou com a UTM desta campanha.
                </p>
              </div>
              {isLoading ? (
                <span className="text-xs text-muted-foreground">Carregando…</span>
              ) : null}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="bg-secondary/60 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3 text-left font-medium">
                      <button
                        className="inline-flex items-center gap-1 hover:text-foreground"
                        onClick={() =>
                          setAttributionSort((s) => ({
                            key: "utm",
                            dir: s.key === "utm" ? ((s.dir * -1) as 1 | -1) : -1,
                          }))
                        }
                      >
                        UTM / Campanha
                        <ArrowUpDown
                          className={`size-3 ${attributionSort.key === "utm" ? "text-accent" : ""}`}
                        />
                      </button>
                    </th>
                    <th className="px-4 py-3 text-right font-medium">
                      <button
                        className="inline-flex items-center gap-1 hover:text-foreground float-right"
                        onClick={() =>
                          setAttributionSort((s) => ({
                            key: "investimento",
                            dir: s.key === "investimento" ? ((s.dir * -1) as 1 | -1) : -1,
                          }))
                        }
                      >
                        Investimento
                        <ArrowUpDown
                          className={`size-3 ${attributionSort.key === "investimento" ? "text-accent" : ""}`}
                        />
                      </button>
                    </th>
                    <th className="px-4 py-3 text-right font-medium">
                      <button
                        className="inline-flex items-center gap-1 hover:text-foreground float-right"
                        onClick={() =>
                          setAttributionSort((s) => ({
                            key: "leads",
                            dir: s.key === "leads" ? ((s.dir * -1) as 1 | -1) : -1,
                          }))
                        }
                      >
                        Leads / Oportunidades
                        <ArrowUpDown
                          className={`size-3 ${attributionSort.key === "leads" ? "text-accent" : ""}`}
                        />
                      </button>
                    </th>
                    <th className="px-4 py-3 text-right font-medium">
                      <button
                        className="inline-flex items-center gap-1 hover:text-foreground float-right"
                        onClick={() =>
                          setAttributionSort((s) => ({
                            key: "cpl",
                            dir: s.key === "cpl" ? ((s.dir * -1) as 1 | -1) : -1,
                          }))
                        }
                      >
                        CPL
                        <ArrowUpDown
                          className={`size-3 ${attributionSort.key === "cpl" ? "text-accent" : ""}`}
                        />
                      </button>
                    </th>
                    <th className="px-4 py-3 text-right font-medium">
                      <button
                        className="inline-flex items-center gap-1 hover:text-foreground float-right"
                        onClick={() =>
                          setAttributionSort((s) => ({
                            key: "reservas",
                            dir: s.key === "reservas" ? ((s.dir * -1) as 1 | -1) : -1,
                          }))
                        }
                      >
                        Reservas
                        <ArrowUpDown
                          className={`size-3 ${attributionSort.key === "reservas" ? "text-accent" : ""}`}
                        />
                      </button>
                    </th>
                    <th className="px-4 py-3 text-right font-medium">
                      <button
                        className="inline-flex items-center gap-1 hover:text-foreground float-right"
                        onClick={() =>
                          setAttributionSort((s) => ({
                            key: "conversao",
                            dir: s.key === "conversao" ? ((s.dir * -1) as 1 | -1) : -1,
                          }))
                        }
                      >
                        Conversão
                        <ArrowUpDown
                          className={`size-3 ${attributionSort.key === "conversao" ? "text-accent" : ""}`}
                        />
                      </button>
                    </th>
                    <th className="px-4 py-3 text-right font-medium">
                      <button
                        className="inline-flex items-center gap-1 hover:text-foreground float-right"
                        onClick={() =>
                          setAttributionSort((s) => ({
                            key: "faturamento",
                            dir: s.key === "faturamento" ? ((s.dir * -1) as 1 | -1) : -1,
                          }))
                        }
                      >
                        Faturamento
                        <ArrowUpDown
                          className={`size-3 ${attributionSort.key === "faturamento" ? "text-accent" : ""}`}
                        />
                      </button>
                    </th>
                    <th className="px-4 py-3 text-right font-medium">
                      <button
                        className="inline-flex items-center gap-1 hover:text-foreground float-right"
                        onClick={() =>
                          setAttributionSort((s) => ({
                            key: "roas",
                            dir: s.key === "roas" ? ((s.dir * -1) as 1 | -1) : -1,
                          }))
                        }
                      >
                        ROAS
                        <ArrowUpDown
                          className={`size-3 ${attributionSort.key === "roas" ? "text-accent" : ""}`}
                        />
                      </button>
                    </th>
                    <th className="px-5 py-3 text-right font-medium">
                      <button
                        className="inline-flex items-center gap-1 hover:text-foreground float-right"
                        onClick={() =>
                          setAttributionSort((s) => ({
                            key: "cac",
                            dir: s.key === "cac" ? ((s.dir * -1) as 1 | -1) : -1,
                          }))
                        }
                      >
                        CAC
                        <ArrowUpDown
                          className={`size-3 ${attributionSort.key === "cac" ? "text-accent" : ""}`}
                        />
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {attribution.map((row) => (
                    <tr key={row.utm} className="border-t border-border">
                      <td className="max-w-[360px] px-5 py-2.5">
                        <p
                          className="truncate text-[11px] font-medium text-foreground"
                          title={row.utm}
                        >
                          {row.utm}
                        </p>
                      </td>
                      <td className="px-4 py-2.5 text-right">{brl(row.investimento)}</td>
                      <td className="px-4 py-2.5 text-right">{row.leads}</td>
                      <td className="px-4 py-2.5 text-right">{brl(row.cpl)}</td>
                      <td className="px-4 py-2.5 text-right">{row.reservas}</td>
                      <td className="px-4 py-2.5 text-right">{pct(row.conversao)}</td>
                      <td className="px-4 py-2.5 text-right font-medium text-accent">
                        {brl(row.faturamento)}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {row.roas === null ? "—" : `${row.roas.toFixed(2)}x`}
                      </td>
                      <td className="px-5 py-2.5 text-right">
                        {row.cac === null ? (
                          <span
                            className="text-muted-foreground"
                            title="Sem investimento ou sem reservas com esta UTM"
                          >
                            —
                          </span>
                        ) : (
                          brl(row.cac)
                        )}
                      </td>
                    </tr>
                  ))}
                  {!attribution.length && !isLoading ? (
                    <tr>
                      <td colSpan={9} className="px-5 py-10 text-center text-muted-foreground">
                        Nenhum dado no período selecionado.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </main>
    </div>
  );
}

function ExpandableChartPanel({
  title,
  subtitle,
  actions,
  className = "",
  children,
}: {
  title: string;
  subtitle?: string;
  /** Controles ao lado do título (ex.: seletor de canal); aparecem também no modo expandido. */
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode | ((expanded: boolean) => React.ReactNode);
}) {
  const [open, setOpen] = useState(false);
  const body = (expanded: boolean) =>
    typeof children === "function" ? children(expanded) : children;
  const header = (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );

  return (
    <>
      <Card className={`relative min-w-0 overflow-hidden p-5 ${className}`}>
        <div className="absolute right-5 top-5">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setOpen(true)}
            aria-label={`Expandir ${title}`}
            title="Expandir"
          >
            <Maximize2 className="size-4" />
          </Button>
        </div>
        <div className="pr-10">{header}</div>
        <div className="mt-4 min-w-0">{body(false)}</div>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] w-[min(96vw,1200px)] max-w-none overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          {actions ? <div className="flex justify-end">{actions}</div> : null}
          <div className="min-w-0">{body(true)}</div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function EmptyOriginChart({ loading }: { loading: boolean }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      {loading ? "Carregando…" : "Nenhuma oportunidade no período."}
    </div>
  );
}

function OpportunityComparisonTooltip({
  active,
  payload,
  label,
  currentYear,
  previousYear,
}: {
  active?: boolean;
  payload?: { payload: OpportunityComparisonPoint }[];
  label?: string;
  currentYear: number;
  previousYear: number;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  const variation =
    point.previousYear > 0
      ? ((point.currentYear - point.previousYear) / point.previousYear) * 100
      : null;
  return (
    <div style={tooltipStyle} className="space-y-1 p-2 text-xs">
      <div className="font-semibold">{label}</div>
      <div>
        Ano Atual ({currentYear}): {point.currentYear.toLocaleString("pt-BR")}
      </div>
      <div>
        Ano Anterior ({previousYear}): {point.previousYear.toLocaleString("pt-BR")}
      </div>
      <div>
        Variação:{" "}
        {variation === null
          ? "—"
          : `${variation > 0 ? "+" : ""}${variation.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}
      </div>
    </div>
  );
}

function OriginMonthlyChart({
  title,
  subtitle,
  data,
  loading,
  currentYear,
  previousYear,
  note,
}: {
  title: string;
  subtitle: string;
  note?: string | undefined;
  data: OpportunityComparisonPoint[];
  loading: boolean;
  currentYear: number;
  previousYear: number;
}) {
  return (
    <ExpandableChartPanel title={title} subtitle={subtitle}>
      {(expanded) => (
        <>
          <div className="min-w-0" style={{ height: expanded ? "65vh" : 208 }}>
            {data.length ? (
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <BarChart
                  data={data}
                  maxBarSize={32}
                  barCategoryGap="20%"
                  margin={{ top: 22, right: 12, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.34 0.045 155)" />
                  <XAxis
                    dataKey="monthLabel"
                    interval="preserveStartEnd"
                    minTickGap={12}
                    tick={{ fontSize: 10 }}
                    height={36}
                    {...axis}
                  />
                  <YAxis {...axis} allowDecimals={false} />
                  <Tooltip
                    content={
                      <OpportunityComparisonTooltip
                        currentYear={currentYear}
                        previousYear={previousYear}
                      />
                    }
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar
                    isAnimationActive={false}
                    dataKey="previousYear"
                    name={`Ano Anterior (${previousYear})`}
                    fill={CHART_SECONDARY}
                  />
                  <Bar
                    isAnimationActive={false}
                    dataKey="currentYear"
                    name={`Ano Atual (${currentYear})`}
                    fill={CHART_PRIMARY}
                  >
                    <LabelList
                      dataKey="currentYear"
                      content={(props) => {
                        const row = data[props.index ?? -1];
                        if (!row || !(row.previousYear > 0)) return null;
                        const variation =
                          ((row.currentYear - row.previousYear) / row.previousYear) * 100;
                        return (
                          <text
                            x={Number(props.x) + Number(props.width) / 2}
                            y={Number(props.y) - 6}
                            textAnchor="middle"
                            fontSize={8}
                            fontWeight={600}
                            fill={variation >= 0 ? CHART_PRIMARY : "#ef4444"}
                          >
                            {`${variation > 0 ? "+" : ""}${variation.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}
                          </text>
                        );
                      }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyOriginChart loading={loading} />
            )}
          </div>
          {note ? <p className="mt-2 text-[11px] leading-4 text-muted-foreground">{note}</p> : null}
        </>
      )}
    </ExpandableChartPanel>
  );
}
