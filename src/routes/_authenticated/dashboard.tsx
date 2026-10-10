import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  DollarSign,
  Gauge,
  RefreshCw,
  Target,
  TrendingUp,
  UserCheck,
  Wallet,
} from "lucide-react";

import { guardPage } from "@/lib/roles";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  RANGE_LABELS,
  brl,
  computeAttribution,
  computeCategories,
  computeKpis,
  computeTimeseries,
  fetchAnalytics,
  pct,
  type RangeKey,
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
        content:
          "ROI por UTM cruzando Meta Ads, Google Ads, leads do CRM e reservas confirmadas.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

const RANGES: RangeKey[] = ["today", "7d", "month", "30d"];

const axis = { stroke: "oklch(0.74 0.03 150)", fontSize: 12 };
const tooltipStyle = {
  background: "oklch(0.22 0.03 155)",
  border: "1px solid oklch(0.34 0.045 155)",
  borderRadius: 12,
  color: "#fff",
};

function Dashboard() {
  const [range, setRange] = useState<RangeKey>("30d");
  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ["analytics", range],
    queryFn: () => fetchAnalytics(range),
  });

  const kpis = data ? computeKpis(data) : null;
  const series = data ? computeTimeseries(data) : [];
  const attribution = data ? computeAttribution(data) : [];
  const categories = data ? computeCategories(data) : [];

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
            <p className="text-sm text-foreground/70">
              Mídia paga, CRM e reservas em um só lugar — {RANGE_LABELS[range]}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {RANGES.map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  range === r
                    ? "text-[color:var(--brand-dark)]"
                    : "border border-border bg-card text-muted-foreground hover:text-foreground"
                }`}
                style={range === r ? { background: "var(--brand-vivid)" } : undefined}
              >
                {RANGE_LABELS[r]}
              </button>
            ))}
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
            </Card>
          ) : null}

          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <KpiCard
              icon={Wallet}
              label="Investimento total em mídia"
              value={kpis ? brl(kpis.spend) : "—"}
              hint={kpis ? `Meta ${brl(kpis.metaSpend)} · Google ${brl(kpis.googleSpend)}` : undefined}
            />
            <KpiCard
              icon={Target}
              label="CPL global"
              value={kpis ? brl(kpis.cpl) : "—"}
              hint={kpis ? `${kpis.leads} leads no CRM` : undefined}
            />
            <KpiCard
              icon={UserCheck}
              label="Conversão comercial"
              value={kpis ? pct(kpis.conversion) : "—"}
              hint={kpis ? `${kpis.reservations} reservas confirmadas` : undefined}
              highlight
            />
            <KpiCard
              icon={DollarSign}
              label="Ticket médio"
              value={kpis ? brl(kpis.ticket) : "—"}
              hint="Por reserva confirmada"
            />
            <KpiCard
              icon={Gauge}
              label="Diária média por veículo"
              value={kpis ? brl(kpis.dailyRate) : "—"}
              hint="Faturamento ÷ diárias locadas"
            />
            <KpiCard
              icon={TrendingUp}
              label="ROAS real global"
              value={kpis ? `${kpis.roas.toFixed(2)}x` : "—"}
              hint={kpis ? `Faturamento ${brl(kpis.revenue)}` : undefined}
              highlight
            />
          </section>

          <section className="grid gap-4 xl:grid-cols-3">
            <Card className="p-5 xl:col-span-2">
              <h2 className="text-sm font-semibold text-foreground">
                Evolução diária — Investimento x Faturamento
              </h2>
              <div className="mt-4 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={series}>
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
                    <YAxis {...axis} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => brl(v)} />
                    <Legend />
                    <Area
                      type="monotone"
                      dataKey="faturamento"
                      name="Faturamento"
                      stroke="#44E500"
                      fill="url(#rev)"
                      strokeWidth={2}
                    />
                    <Area
                      type="monotone"
                      dataKey="investimento"
                      name="Investimento"
                      stroke="#2f9c5a"
                      fill="url(#inv)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="p-5">
              <h2 className="text-sm font-semibold text-foreground">Faturamento por categoria</h2>
              <div className="mt-4 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={categories} layout="vertical" margin={{ left: 24 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.34 0.045 155)" />
                    <XAxis type="number" {...axis} />
                    <YAxis type="category" dataKey="categoria" width={90} {...axis} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => brl(v)} />
                    <Bar dataKey="faturamento" name="Faturamento" fill="#44E500" radius={[0, 6, 6, 0]} />
                  </BarChart>
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
                  Mídia paga → leads no CRM → reservas confirmadas
                </p>
              </div>
              {isLoading ? <span className="text-xs text-muted-foreground">Carregando…</span> : null}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="bg-secondary/60 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3 text-left font-medium">UTM / Campanha</th>
                    <th className="px-4 py-3 text-right font-medium">Investimento</th>
                    <th className="px-4 py-3 text-right font-medium">Leads</th>
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
                      <td className="px-5 py-3">
                        <p className="font-medium text-foreground">{row.utm}</p>
                        <p className="text-xs text-muted-foreground">{row.campanhas || "—"}</p>
                      </td>
                      <td className="px-4 py-3 text-right">{brl(row.investimento)}</td>
                      <td className="px-4 py-3 text-right">{row.leads}</td>
                      <td className="px-4 py-3 text-right">{brl(row.cpl)}</td>
                      <td className="px-4 py-3 text-right">{row.reservas}</td>
                      <td className="px-4 py-3 text-right">{pct(row.conversao)}</td>
                      <td className="px-4 py-3 text-right font-medium text-accent">
                        {brl(row.faturamento)}
                      </td>
                      <td className="px-4 py-3 text-right">{row.roas.toFixed(2)}x</td>
                      <td className="px-5 py-3 text-right">
                        <Badge
                          variant={row.roi >= 0 ? "default" : "destructive"}
                          className={row.roi >= 0 ? "bg-accent text-accent-foreground" : ""}
                        >
                          {(row.roi * 100).toFixed(0)}%
                        </Badge>
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
