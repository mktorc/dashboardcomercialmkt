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
import { DollarSign, Gauge, RefreshCw, Target, TrendingUp, UserCheck, Wallet } from "lucide-react";

import { guardPage } from "@/lib/roles";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  brl,
  computeAttribution,
  computeKpis,
  computeOpportunityOrigins,
  computeTimeseries,
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

function Dashboard() {
  const today = new Date();
  const [from, setFrom] = useState(
    localDateInput(new Date(today.getFullYear(), today.getMonth(), 1)),
  );
  const [to, setTo] = useState(localDateInput(today));
  const [originFilter, setOriginFilter] = useState("all");
  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ["analytics", from, to],
    queryFn: () => fetchAnalytics(from, to),
  });

  const originAnalytics = data
    ? computeOpportunityOrigins(data.opportunities, data.updatedOpportunities, from, to)
    : null;
  const selectedOrigin = originFilter === "all" ? null : originFilter;
  const originData = data ? filterAnalyticsByOrigin(data, selectedOrigin) : null;
  const kpis = originData ? computeKpis(originData) : null;
  const series = originData ? computeTimeseries(originData, from) : [];
  const attribution = originData
    ? computeAttribution(originData).filter(
        (row) =>
          originFilter !== "all" ||
          row.utm.startsWith("Meta Ads /") ||
          row.utm.startsWith("Google Ads /"),
      )
    : [];
  const originSources = (originAnalytics?.sources ?? []).filter(
    (source) => originFilter === "all" || source.label === originFilter,
  );
  const selectedOriginKey = originAnalytics?.sources.find(
    (source) => source.label === originFilter,
  )?.key;
  const funnelRows = (originAnalytics?.funnel ?? []).filter(
    (row) => row.key === (originFilter === "all" ? "all" : selectedOriginKey),
  );

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
                    <th className="px-5 py-3 text-left font-medium">UTM / Campanha</th>
                    <th className="px-4 py-3 text-right font-medium">Investimento</th>
                    <th className="px-4 py-3 text-right font-medium">Leads / Oportunidades</th>
                    <th className="px-4 py-3 text-right font-medium">CPL</th>
                    <th className="px-4 py-3 text-right font-medium">Reservas</th>
                    <th className="px-4 py-3 text-right font-medium">Conversão</th>
                    <th className="px-4 py-3 text-right font-medium">Faturamento</th>
                    <th className="px-4 py-3 text-right font-medium">ROAS</th>
                    <th className="px-5 py-3 text-right font-medium">ROI</th>
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

          <section className="grid min-w-0 gap-4 xl:grid-cols-2">
            <OriginMonthlyChart
              title="Evolução mensal de oportunidades criadas por origem"
              subtitle="Oportunidades agrupadas pelo mês de criação."
              data={originAnalytics?.createdMonthly ?? []}
              sources={originSources}
              loading={isLoading}
            />
            <OriginMonthlyChart
              title="Evolução mensal de oportunidades ganhas por origem"
              subtitle="Mês da última atualização registrada para oportunidades ganhas."
              data={originAnalytics?.closedMonthly ?? []}
              sources={originSources}
              loading={isLoading}
            />
            <Card className="overflow-hidden p-5 xl:col-span-2">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Funil por origem</h2>
                  <p className="text-xs text-muted-foreground">
                    Oportunidades que chegaram a cada etapa; passagem calculada em relação à etapa
                    anterior.
                  </p>
                </div>
              </div>
              <div className="mt-6 space-y-7">
                {funnelRows.map((row) => {
                  const firstStageCount = row.stages[0]?.count ?? 0;
                  return (
                    <div key={row.key}>
                      <h3 className="text-sm font-medium text-foreground">{row.origin}</h3>
                      <div className="mt-3 flex flex-col items-center gap-2">
                        {row.stages.map((stage, index) => {
                          const stageWidth = firstStageCount
                            ? Math.max(45, (stage.count / firstStageCount) * 100)
                            : 45;
                          return (
                            <div
                              key={`${row.key}-${index}`}
                              className="flex min-h-14 max-w-full flex-col justify-center rounded-sm border border-border bg-secondary/70 px-3 py-2 text-center"
                              style={{ width: `${stageWidth}%` }}
                            >
                              <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
                                <span className="text-xs font-medium">
                                  {originAnalytics?.stages[index]?.label}
                                </span>
                                <span className="text-sm font-semibold text-accent">
                                  {stage.count.toLocaleString("pt-BR")}
                                </span>
                                <span className="text-[11px] text-muted-foreground">
                                  {stage.conversion === null
                                    ? `Base inicial (${stage.count.toLocaleString("pt-BR")})`
                                    : stage.isFinal
                                      ? `${pct(stage.conversion)} de conversão total (${stage.count.toLocaleString("pt-BR")} / ${(row.stages[0]?.count ?? 0).toLocaleString("pt-BR")})`
                                      : `${pct(stage.conversion)} de passagem`}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                {!funnelRows.length ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    {isLoading ? "Carregando…" : "Nenhuma oportunidade por etapa no período."}
                  </p>
                ) : null}
              </div>
            </Card>
          </section>
        </div>
      </main>
    </div>
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
}: {
  title: string;
  subtitle: string;
  data: Record<string, string | number>[];
  sources: { key: string; label: string }[];
  loading: boolean;
}) {
  return (
    <Card className="min-w-0 overflow-hidden p-5">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <p className="text-xs text-muted-foreground">{subtitle}</p>
      <div className="mt-4 h-52 min-w-0">
        {data.length && sources.length ? (
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <BarChart
              data={data}
              maxBarSize={48}
              barCategoryGap="14%"
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
              <Legend />
              {sources.map((source, index) => (
                <Bar
                  key={source.key}
                  dataKey={source.key}
                  name={source.label}
                  stackId="origins"
                  fill={ORIGIN_COLORS[index % ORIGIN_COLORS.length]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyOriginChart loading={loading} />
        )}
      </div>
    </Card>
  );
}
