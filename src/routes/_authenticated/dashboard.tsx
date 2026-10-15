import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Area,
  ComposedChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowUpDown, DollarSign, Gauge, Maximize2, RefreshCw, Target, TrendingUp, UserCheck, Wallet, X } from "lucide-react";

import { guardPage } from "@/lib/roles";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  brl,
  buildDynamicFunnel,
  computeAttribution,
  computeKpis,
  computeOpportunityOrigins,
  computeTimeseries,
  computeYoYComparison,
  filterAnalyticsByOrigin,
  fetchAnalytics,
  pct,
} from "@/lib/analytics";

export const Route = createFileRoute("/_authenticated/dashboard")({
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

type AttributionSortKey = "utm" | "investimento" | "leads" | "cpl" | "reservas" | "conversao" | "faturamento" | "roas" | "roi";

function Dashboard() {
  const today = new Date();
  const [from, setFrom] = useState(
    localDateInput(new Date(today.getFullYear(), today.getMonth(), 1)),
  );
  const [to, setTo] = useState(localDateInput(today));
  const [originFilter, setOriginFilter] = useState("all");
  const [attributionSort, setAttributionSort] = useState<{ key: AttributionSortKey; dir: 1 | -1 }>({ key: "investimento", dir: -1 });
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

  const originAnalytics = data
    ? computeOpportunityOrigins(
        data.current.opportunities,
        data.current.updatedOpportunities,
        from,
        to,
      )
    : null;

  const priorYearAnalytics = data
    ? computeOpportunityOrigins(
        data.prior.opportunities,
        data.prior.updatedOpportunities,
        priorYear.from,
        priorYear.to,
      )
    : null;

  const selectedOrigin = originFilter === "all" ? null : originFilter;
  const originData = data ? filterAnalyticsByOrigin(data.current, selectedOrigin) : null;
  const kpis = originData ? computeKpis(originData) : null;
  const series = originData ? computeTimeseries(originData, from) : [];
  let attribution = originData ? computeAttribution(originData) : [];
  attribution = attribution.sort((a, b) => {
    const va = a[attributionSort.key];
    const vb = b[attributionSort.key];
    if (va === null || vb === null) return (vb === null ? 1 : 0) - (va === null ? 1 : 0);
    const cmp = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
    return cmp * attributionSort.dir;
  });
  const originSources = (originAnalytics?.sources ?? []).filter(
    (source) => originFilter === "all" || source.label === originFilter,
  );

  const yoyCreatedMonthly =
    originAnalytics && priorYearAnalytics
      ? computeYoYComparison(
          originAnalytics.createdMonthly,
          priorYearAnalytics.createdMonthly,
          originAnalytics.sources.map((s) => s.key),
        )
      : [];

  const yoyClosedMonthly =
    originAnalytics && priorYearAnalytics
      ? computeYoYComparison(
          originAnalytics.closedMonthly,
          priorYearAnalytics.closedMonthly,
          originAnalytics.sources.map((s) => s.key),
        )
      : [];

  const dynamicFunnel = (() => {
    if (!data || !kpis) return null;
    const mk = computeKpis(filterAnalyticsByOrigin(data.current, "meta"));
    const gk = computeKpis(filterAnalyticsByOrigin(data.current, "google"));
    const mode = originFilter === "all" ? "all" : /meta/i.test(originFilter) ? "meta" : /google/i.test(originFilter) ? "google" : "other";
    return buildDynamicFunnel(mode, {
      conversations: data.current.meta.reduce((s, r) => s + (Number(r.conversations) || 0), 0),
      metaLeads: mk.leads, metaRes: mk.reservations, googleLeads: gk.leads, googleRes: gk.reservations,
      otherLeads: kpis.leads, otherRes: kpis.reservations, otherLabel: originFilter,
    });
  })();

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar active="dashboard" />
      <main className="flex-1 overflow-x-hidden">
        <header
          className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-6 py-5"
          style={{ background: "var(--gradient-brand)" }}
        >
          <div>
            <h1 className="text-xl font-semibold text-foreground">Painel de Performance</h1>
            <p className="text-sm text-foreground/70">Mídia paga, oportunidades ClickMassa e reservas HQ</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-foreground/70">
              De
              <Input
                type="date"
                value={from}
                max={to}
                onChange={(event) => event.target.value && setFrom(event.target.value)}
                className="mt-1 h-9 w-40 bg-card"
              />
            </label>
            <label className="text-xs text-foreground/70">
              Até
              <Input
                type="date"
                value={to}
                min={from}
                onChange={(event) => event.target.value && setTo(event.target.value)}
                className="mt-1 h-9 w-40 bg-card"
              />
            </label>
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
            <button
              onClick={() => refetch()}
              className="flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold text-[color:var(--brand-dark)]"
              style={{ background: "var(--brand-vivid)", boxShadow: "var(--shadow-glow)" }}
            >
              <RefreshCw className={`size-3.5 ${isFetching ? "animate-spin" : ""}`} />
              Sincronizar
            </button>
          </div>
        </header>

        <div className="space-y-6 p-6">
          {error ? (
            <Card className="border-destructive/40 p-4 text-sm text-destructive">
              Não foi possível carregar os dados agora. Tente sincronizar novamente.
              {error instanceof Error ? <p className="mt-1 break-words text-xs">{error.message}</p> : null}
            </Card>
          ) : null}

          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <KpiCard
              icon={Wallet}
              label="Investimento total em mídia"
              value={kpis ? brl(kpis.spend) : "—"}
              hint={
                kpis ? `Meta ${brl(kpis.metaSpend)} · Google ${brl(kpis.googleSpend)}` : undefined
              }
              compact
              aligned
              className="h-[160px]"
            />
            <KpiCard
              icon={Target}
              label="CPL global"
              value={kpis ? brl(kpis.cpl) : "—"}
              hint={kpis ? `${kpis.leads} oportunidades no ClickMassa` : undefined}
              compact
              aligned
              className="h-[160px]"
            />
            <KpiCard
              icon={UserCheck}
              label="Conversão comercial"
              value={kpis ? pct(kpis.conversion) : "—"}
              hint={kpis ? `${kpis.reservations} reservas fechadas no HQ` : undefined}
              highlight
              compact
              aligned
              className="h-[160px]"
            />
            <KpiCard
              icon={DollarSign}
              label="Ticket médio"
              value={kpis ? brl(kpis.ticket) : "—"}
              hint="Valor médio por reserva HQ"
              compact
              aligned
              className="h-[160px]"
            />
            <KpiCard
              icon={Gauge}
              label="Custo de aquisição de clientes"
              value={kpis?.cac == null ? "—" : brl(kpis.cac)}
              hint={kpis ? `Somente mídia · Meta + Google ÷ ${kpis.reservations} reservas HQ` : undefined}
              compact
              aligned
              className="h-[160px]"
            />
            <KpiCard
              icon={TrendingUp}
              label="ROAS real global"
              value={kpis ? `${kpis.roas.toFixed(2)}x` : "—"}
              hint={kpis ? `Faturamento ${brl(kpis.revenue)}` : undefined}
              highlight
              compact
              aligned
              className="h-[160px]"
            />
          </section>

          <section className="grid gap-4">
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-foreground">
                Evolução diária — Investimento x Faturamento
              </h2>
              <div className="mt-4 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={series} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                    <defs>
                      <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#44E500" stopOpacity={0.5} />
                        <stop offset="95%" stopColor="#44E500" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="inv" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#005C29" stopOpacity={0.7} />
                        <stop offset="95%" stopColor="#005C29" stopOpacity={0} />
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
                    <Legend />
                    <Area
                      type="monotone"
                      dataKey="faturamento"
                      yAxisId="revenue"
                      name="Faturamento"
                      stroke="#44E500"
                      fill="url(#rev)"
                      strokeWidth={2}
                    />
                    <Line
                      type="monotone"
                      dataKey="investimento"
                      yAxisId="spend"
                      name="Investimento"
                      stroke="#ffd23f"
                      strokeWidth={2.5}
                      dot={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </section>

          <section className="grid min-w-0 gap-4 xl:grid-cols-2">
            <OriginMonthlyChart
              title="Oportunidades criadas (Ano Atual vs. Ano Anterior)"
              subtitle="Comparação YoY para o período selecionado."
              data={yoyCreatedMonthly}
              sources={originSources}
              loading={isLoading}
              isYoY={true}
            />
            <OriginMonthlyChart
              title="Oportunidades ganhas (Ano Atual vs. Ano Anterior)"
              subtitle="Comparação YoY para o período selecionado."
              data={yoyClosedMonthly}
              sources={originSources}
              loading={isLoading}
              isYoY={true}
            />
            <Card className="overflow-hidden p-5 xl:col-span-2">
              <h2 className="text-sm font-semibold text-foreground">Funil — {dynamicFunnel?.title ?? "—"}</h2>
              <p className="text-xs text-muted-foreground">
                Safra de leads criados no período e reservas HQ ligadas a esses leads.
              </p>
              {dynamicFunnel ? (
                <>
                  <div className="mt-6 flex flex-col items-center gap-2">
                    {dynamicFunnel.stages.map((stage, index) => {
                      const base = dynamicFunnel.stages[0]?.count ?? 0;
                      const w = base ? Math.max(40, (stage.count / base) * 100) : 40;
                      return (
                        <div
                          key={index}
                          className="flex min-h-14 max-w-full items-center justify-center gap-3 rounded-sm border border-border bg-secondary/70 px-3 py-2 text-center"
                          style={{ width: `${Math.min(100, w)}%` }}
                        >
                          <span className="text-xs font-medium">{stage.label}</span>
                          <span className="text-sm font-semibold text-accent">{stage.count.toLocaleString("pt-BR")}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-5 grid gap-3 sm:grid-cols-3">
                    {dynamicFunnel.metrics.map((m) => (
                      <div key={m.label} className="rounded-md border border-border p-3">
                        <p className="text-[11px] text-muted-foreground">{m.label}</p>
                        <p className="text-lg font-semibold text-foreground">{m.value === null ? "—" : pct(m.value)}</p>
                      </div>
                    ))}
                  </div>
                  {originFilter !== "all" && /meta/i.test(originFilter) && !dynamicFunnel.stages[0]?.count ? (
                    <p className="mt-3 text-xs text-muted-foreground">Conversas do Meta aparecem após a próxima sincronização do Meta Ads.</p>
                  ) : null}
                </>
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">{isLoading ? "Carregando…" : "Sem dados."}</p>
              )}
            </Card>
          </section>

          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  Atribuição e ROI por UTM / Campanha
                </h2>
                <p className="text-xs text-muted-foreground">
                  Mídia paga → oportunidades ClickMassa → reservas fechadas no HQ. ROI "—" = nenhum lead ou reserva
                  chegou com a UTM desta campanha.
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
                        onClick={() => setAttributionSort((s) => ({ key: "utm", dir: s.key === "utm" ? ((s.dir * -1) as 1 | -1) : -1 }))}
                      >
                        UTM / Campanha
                        <ArrowUpDown className={`size-3 ${attributionSort.key === "utm" ? "text-accent" : ""}`} />
                      </button>
                    </th>
                    <th className="px-4 py-3 text-right font-medium">
                      <button
                        className="inline-flex items-center gap-1 hover:text-foreground float-right"
                        onClick={() => setAttributionSort((s) => ({ key: "investimento", dir: s.key === "investimento" ? ((s.dir * -1) as 1 | -1) : -1 }))}
                      >
                        Investimento
                        <ArrowUpDown className={`size-3 ${attributionSort.key === "investimento" ? "text-accent" : ""}`} />
                      </button>
                    </th>
                    <th className="px-4 py-3 text-right font-medium">
                      <button
                        className="inline-flex items-center gap-1 hover:text-foreground float-right"
                        onClick={() => setAttributionSort((s) => ({ key: "leads", dir: s.key === "leads" ? ((s.dir * -1) as 1 | -1) : -1 }))}
                      >
                        Leads / Oportunidades
                        <ArrowUpDown className={`size-3 ${attributionSort.key === "leads" ? "text-accent" : ""}`} />
                      </button>
                    </th>
                    <th className="px-4 py-3 text-right font-medium">
                      <button
                        className="inline-flex items-center gap-1 hover:text-foreground float-right"
                        onClick={() => setAttributionSort((s) => ({ key: "cpl", dir: s.key === "cpl" ? ((s.dir * -1) as 1 | -1) : -1 }))}
                      >
                        CPL
                        <ArrowUpDown className={`size-3 ${attributionSort.key === "cpl" ? "text-accent" : ""}`} />
                      </button>
                    </th>
                    <th className="px-4 py-3 text-right font-medium">
                      <button
                        className="inline-flex items-center gap-1 hover:text-foreground float-right"
                        onClick={() => setAttributionSort((s) => ({ key: "reservas", dir: s.key === "reservas" ? ((s.dir * -1) as 1 | -1) : -1 }))}
                      >
                        Reservas
                        <ArrowUpDown className={`size-3 ${attributionSort.key === "reservas" ? "text-accent" : ""}`} />
                      </button>
                    </th>
                    <th className="px-4 py-3 text-right font-medium">
                      <button
                        className="inline-flex items-center gap-1 hover:text-foreground float-right"
                        onClick={() => setAttributionSort((s) => ({ key: "conversao", dir: s.key === "conversao" ? ((s.dir * -1) as 1 | -1) : -1 }))}
                      >
                        Conversão
                        <ArrowUpDown className={`size-3 ${attributionSort.key === "conversao" ? "text-accent" : ""}`} />
                      </button>
                    </th>
                    <th className="px-4 py-3 text-right font-medium">
                      <button
                        className="inline-flex items-center gap-1 hover:text-foreground float-right"
                        onClick={() => setAttributionSort((s) => ({ key: "faturamento", dir: s.key === "faturamento" ? ((s.dir * -1) as 1 | -1) : -1 }))}
                      >
                        Faturamento
                        <ArrowUpDown className={`size-3 ${attributionSort.key === "faturamento" ? "text-accent" : ""}`} />
                      </button>
                    </th>
                    <th className="px-4 py-3 text-right font-medium">
                      <button
                        className="inline-flex items-center gap-1 hover:text-foreground float-right"
                        onClick={() => setAttributionSort((s) => ({ key: "roas", dir: s.key === "roas" ? ((s.dir * -1) as 1 | -1) : -1 }))}
                      >
                        ROAS
                        <ArrowUpDown className={`size-3 ${attributionSort.key === "roas" ? "text-accent" : ""}`} />
                      </button>
                    </th>
                    <th className="px-5 py-3 text-right font-medium">
                      <button
                        className="inline-flex items-center gap-1 hover:text-foreground float-right"
                        onClick={() => setAttributionSort((s) => ({ key: "roi", dir: s.key === "roi" ? ((s.dir * -1) as 1 | -1) : -1 }))}
                      >
                        ROI
                        <ArrowUpDown className={`size-3 ${attributionSort.key === "roi" ? "text-accent" : ""}`} />
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
                        {row.roi === null ? (
                          <span
                            className="text-muted-foreground"
                            title="Sem leads ou reservas com esta UTM"
                          >
                            —
                          </span>
                        ) : (
                          <Badge
                            variant={(row.roi ?? 0) >= 0 ? "default" : "destructive"}
                            className={
                              (row.roi ?? 0) >= 0 ? "bg-accent text-accent-foreground" : ""
                            }
                          >
                            {(row.roi * 100).toFixed(0)}%
                          </Badge>
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
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Card className="relative min-w-0 overflow-hidden p-5">
        <div className="absolute right-5 top-5">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setOpen(true)}
            aria-label={`Expandir ${title}`}
            title="Expandir gráfico"
          >
            <Maximize2 className="size-4" />
          </Button>
        </div>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        <div className="mt-4 min-w-0">
          {children}
        </div>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[min(96vw,1200px)] max-w-none">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <div style={{ height: "70vh", overflow: "auto" }}>
            {children}
          </div>
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

function OriginMonthlyChart({
  title,
  subtitle,
  data,
  sources,
  loading,
  isYoY,
}: {
  title: string;
  subtitle: string;
  data: Record<string, string | number>[];
  sources: { key: string; label: string }[];
  loading: boolean;
  isYoY?: boolean;
}) {
  return (
    <ExpandableChartPanel title={title} subtitle={subtitle}>
      <div className="h-52 min-w-0">
        {data.length && sources.length ? (
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <BarChart
              data={data}
              maxBarSize={isYoY ? 24 : 48}
              barCategoryGap={isYoY ? "20%" : "14%"}
              margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.34 0.045 155)" />
              <XAxis
                dataKey="month"
                interval="preserveStartEnd"
                minTickGap={12}
                tick={{ fontSize: 10 }}
                height={36}
                {...axis}
              />
              <YAxis {...axis} allowDecimals={false} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value: number) => value.toLocaleString("pt-BR")}
              />
              {sources.map((source, index) => {
                const color = ORIGIN_COLORS[index % ORIGIN_COLORS.length];
                if (isYoY) {
                  return (
                    <Bar
                      key={`${source.key}_group`}
                      dataKey={`${source.key}_current`}
                      name={`${source.label} (Atual)`}
                      fill={color}
                      opacity={1}
                    />
                  );
                }
                return (
                  <Bar
                    key={source.key}
                    dataKey={source.key}
                    name={source.label}
                    stackId="origins"
                    fill={color}
                  />
                );
              })}
              {isYoY &&
                sources.map((source, index) => {
                  const color = ORIGIN_COLORS[index % ORIGIN_COLORS.length];
                  return (
                    <Bar
                      key={`${source.key}_prior`}
                      dataKey={`${source.key}_prior`}
                      name={`${source.label} (Anterior)`}
                      fill={color}
                      opacity={0.5}
                    />
                  );
                })}
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyOriginChart loading={loading} />
        )}
      </div>
    </ExpandableChartPanel>
  );
}
