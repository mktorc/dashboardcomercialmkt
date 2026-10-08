import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  LabelList,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowUpDown,
  CheckCircle2,
  Clock,
  ClipboardX,
  DollarSign,
  Maximize2,
  Search,
  CarFront,
  Target,
  UserCheck,
  Percent,
} from "lucide-react";
import { toast } from "sonner";

import { Sidebar } from "@/components/dashboard/Sidebar";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { brl, pct } from "@/lib/analytics";
import {
  computeComercial,
  fetchComercial,
  saveGoals,
  type SellerRow,
  type Goal,
} from "@/lib/comercial";
import { fetchOccupancy } from "@/lib/occupancy";
import { GLOBAL_GOAL, OCCUPANCY_GOAL, isGeneralGoal, nextGoalMonth, revenueAndTicketGoals } from "@/lib/commercial-goals";

export const Route = createFileRoute("/_authenticated/comercial")({
  head: () => ({
    meta: [
      { title: "Gerencial | Orlando Rent Car Analytics" },
      {
        name: "description",
        content: "Desempenho individual e da equipe de vendas: oportunidades, conversão, ticket, tarefas e metas.",
      },
      { property: "og:title", content: "Gerencial | Orlando Rent Car Analytics" },
      {
        property: "og:description",
        content: "Vendas por vendedor cruzando ClickMassa e HQ Rentals.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <ComercialPage />,
});

const COLORS = ["#44E500", "#2f9c5a", "#9be870", "#0f7a3d", "#c6f5a8", "#5fbf86", "#e8f9d9", "#1d5e38", "#7ad64a", "#3fae6a"];
const axis = { stroke: "oklch(0.74 0.03 150)", fontSize: 12 };
const tooltipStyle = {
  background: "oklch(0.22 0.03 155)",
  border: "1px solid oklch(0.34 0.045 155)",
  borderRadius: 12,
  color: "#fff",
};
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const comparison = (value: number) => `${value >= 0 ? "+" : ""}${value.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% vs. mês anterior`;
const duration = (minutes: number) =>
  minutes < 60 ? `${Math.round(minutes)} min` : `${(minutes / 60).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h`;

type SortKey = keyof Pick<SellerRow, "name" | "oportunidades" | "tasksTotal" | "overdue" | "done" | "noTask" | "reservas" | "conversao" | "ticket" | "faturamento">;

export function ComercialPage({
  title = "Gerencial",
  active = "comercial",
}: {
  title?: string;
  active?: "comercial" | "comercial-operacional";
} = {}) {
  const now = new Date();
  const [from, setFrom] = useState(ymd(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [to, setTo] = useState(ymd(now));
  const [search, setSearch] = useState("");
  const [noTaskOpen, setNoTaskOpen] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "faturamento", dir: -1 });

  const { data, isLoading, error } = useQuery({
    queryKey: ["comercial", from, to],
    queryFn: () => fetchComercial(from, to),
  });
  const view = useMemo(() => (data ? computeComercial({ ...data, goals: data.goals.filter((g) => !isGeneralGoal(g)) }, from, to, "all") : null), [data, from, to]);
  const { data: occ } = useQuery({ queryKey: ["occupancy"], queryFn: fetchOccupancy, enabled: active === "comercial" });
  const k = view?.kpis;
  const cardGoals = revenueAndTicketGoals(data?.goals ?? [], from, to);

  const tableRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (view?.rows ?? [])
      .filter((r) => !q || r.name.toLowerCase().includes(q))
      .sort((a, b) => {
        const va = a[sort.key];
        const vb = b[sort.key];
        return (typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number)) * sort.dir;
      });
  }, [view, search, sort]);

  const goalRows = (view?.rows ?? []).filter((r) => r.key !== "sem_vendedor" && r.key !== "venda_direta" && (r.faturamento || r.revenueGoal));
  const chartH = Math.max(220, goalRows.length * 34);
  const opportunityRows = (view?.rows ?? [])
    .filter((r) => r.key !== "sem_vendedor" && r.key !== "venda_direta" && (r.oportunidades > 0 || r.reservas > 0))
    .sort((a, b) => b.oportunidades - a.oportunidades);
  const opportunityChartH = Math.max(220, opportunityRows.length * 34);
  const noTaskRows = (view?.rows ?? [])
    .filter((r) => r.key !== "venda_direta" && r.noTask > 0)
    .sort((a, b) => b.noTask - a.noTask);
  const conversionRows = (view?.rows ?? [])
    .filter((r) => r.key !== "sem_vendedor" && r.key !== "venda_direta" && r.oportunidades > 0)
    .sort((a, b) => b.conversao - a.conversao);
  const operationalCardClass = active === "comercial-operacional" ? "h-[208px] w-full" : undefined;
  const operationalSellerChartHeight = Math.max(
    220,
    Math.max(opportunityRows.length, noTaskRows.length, conversionRows.length) * 34,
  );

  const opportunityCard = <KpiCard icon={Target} label="Oportunidades"
    value={k ? k.oportunidades.toLocaleString("pt-BR") : "—"}
    hint={k ? comparison(k.oportunidadesVar) : undefined} className={operationalCardClass} />;
  const noTaskCard = <Button variant="ghost" className={`block w-full ${active === "comercial-operacional" ? "h-[208px]" : "h-auto"} whitespace-normal p-0 text-left hover:bg-transparent [&>div]:h-full`} onClick={() => setNoTaskOpen(true)}>
    <KpiCard icon={ClipboardX} label="Oportunidades sem tarefas"
      value={k ? k.leadsNoTask.toLocaleString("pt-BR") : "—"}
      hint={k ? comparison(k.leadsNoTaskVar) : undefined} highlight className={operationalCardClass} />
  </Button>;
  const revenueCard = <KpiCard icon={DollarSign} label="Faturamento (Rack Rate)"
    value={k ? brl(k.faturamento) : "—"}
    hint={k ? comparison(k.faturamentoVar) : undefined}
    goal={{ actual: k?.faturamento ?? 0, target: cardGoals.revenue, label: brl(cardGoals.revenue) }} className={operationalCardClass} />;
  const ticketCard = <KpiCard icon={DollarSign} label="Ticket médio"
    value={k ? brl(k.ticket) : "—"}
    hint={k ? comparison(k.ticketVar) : undefined}
    goal={{ actual: k?.ticket ?? 0, target: cardGoals.ticket, label: brl(cardGoals.ticket) }} className={operationalCardClass} />;
  const discountCard = <KpiCard icon={Percent} label="Desconto médio"
    value={k ? pct(k.descontoPct) : "—"}
    hint={k ? k.descontoYearDiff === null ? "Sem base de comparação vs. ano anterior" : `${k.descontoYearDiff >= 0 ? "+" : ""}${k.descontoYearDiff.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} p.p. vs. ano anterior` : undefined}
    goal={{ actual: k?.descontoPct ?? 0, target: cardGoals.discount, label: pct(cardGoals.discount) }} className={operationalCardClass} />;
  const conversionCard = <KpiCard icon={UserCheck} label="Taxa de conversão"
    value={k ? pct(k.conversao) : "—"}
    hint={k ? comparison(k.conversaoVar) : undefined} highlight
    goal={{ actual: k?.conversao ?? 0, target: cardGoals.conversion, label: pct(cardGoals.conversion) }} className={operationalCardClass} />;
  const occupancyCards = active === "comercial" ? ["Ocupação do mês atual", "Ocupação do mês seguinte"].map((label, index) => {
    const month = occ?.months[index + 2];
    const occupancyMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + index, 1)).toISOString().slice(0, 7);
    const occupancyTarget = data?.goals.find((g) => g.seller_name === OCCUPANCY_GOAL && g.month === occupancyMonth)?.discount_goal;
    return <KpiCard key={label} icon={CarFront} label={label} value={month ? pct(month.rate) : "—"}
      highlight={index === 0}
      goal={{ actual: month?.rate ?? 0, target: occupancyTarget, label: pct(occupancyTarget ?? 0) }} />;
  }) : null;

  const Th = ({ k: key, label, left }: { k: SortKey; label: string; left?: boolean }) => (
    <th className={`px-4 py-3 font-medium ${left ? "text-left" : "text-right"}`}>
      <button
        className="inline-flex items-center gap-1 hover:text-foreground"
        onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((s.dir * -1) as 1 | -1) : -1 }))}
      >
        {label}
        <ArrowUpDown className={`size-3 ${sort.key === key ? "text-accent" : ""}`} />
      </button>
    </th>
  );

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar active={active} />
      <main className="flex-1 overflow-x-hidden">
        <header
          className="flex flex-wrap items-end justify-between gap-4 border-b border-border px-6 py-5"
          style={{ background: "var(--gradient-brand)" }}
        >
          <div>
            <h1 className="text-xl font-semibold text-foreground">{title}</h1>
            <p className="text-sm text-foreground/70">Equipe de vendas — ClickMassa + HQ Rentals</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-foreground/70">
              De
              <Input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className="mt-1 h-9 w-40 bg-card" />
            </label>
            <label className="text-xs text-foreground/70">
              Até
              <Input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} className="mt-1 h-9 w-40 bg-card" />
            </label>
            {view ? <GoalsDialog sellers={view.sellers} month={view.goalMonth} goals={data?.goals ?? []} /> : null}
          </div>
        </header>

        <div className="space-y-6 p-6">
          {error ? (
            <Card className="border-destructive/40 p-4 text-sm text-destructive">
              Não foi possível carregar os dados comerciais agora.
            </Card>
          ) : null}

          {active === "comercial-operacional" ? (
            <section className="grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <div className="space-y-4">
                {opportunityCard}
                <OpportunitySellerChart data={opportunityRows} height={operationalSellerChartHeight} loading={isLoading && !error} compare expandable />
              </div>
              <div className="space-y-4">
                {noTaskCard}
                <NoTaskBySellerChart data={noTaskRows} height={operationalSellerChartHeight} expandable />
              </div>
              <div className="space-y-4">
                {conversionCard}
                <ConversionBySellerChart data={conversionRows} height={operationalSellerChartHeight} total={k?.conversao ?? 0} expandable />
              </div>
              <div className="space-y-4">
                {revenueCard}
                <GoalChart title="Receita provisionada" subtitle="Alcançado vs. meta" data={goalRows} h={chartH} a="faturamento" b="revenueGoal" fmt={brl} expandable />
              </div>
              <div className="space-y-4">
                {ticketCard}
                <GoalChart title="Ticket médio" subtitle="Alcançado vs. meta" data={goalRows} h={chartH} a="ticket" b="ticketGoal" fmt={brl} expandable />
              </div>
              <div className="space-y-4">
                {discountCard}
                <GoalChart title="Desconto médio (%)" subtitle="Alcançado vs. meta" data={goalRows} h={chartH} a="descontoPct" b="discountGoal" fmt={pct} expandable />
              </div>
            </section>
          ) : (
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {opportunityCard}
              {noTaskCard}
              <KpiCard icon={CheckCircle2} label="Reservas concluídas"
                value={k ? k.reservas.toLocaleString("pt-BR") : "—"}
                hint={k ? comparison(k.reservasVar) : undefined} highlight />
              {revenueCard}
              {ticketCard}
              {discountCard}
              {conversionCard}
              {occupancyCards}
            </section>
          )}

          {active === "comercial-operacional" ? (
            <DailyStackedChart
              title="Oportunidades por vendedor por dia"
              data={view?.dailyOpportunitiesBySeller ?? []}
              series={view?.dailyOpportunityKeys ?? []}
              expandable
            />
          ) : (
            <section className="grid gap-4 xl:grid-cols-1">
              <Card className="p-5">
                <h2 className="text-sm font-semibold text-foreground">Oportunidades criadas por dia</h2>
                <p className="text-xs text-muted-foreground">Atendimentos ativos no funil — equipe inteira</p>
                <div className="mt-4 h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={view?.daily ?? []}>
                      <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.34 0.045 155)" />
                      <XAxis dataKey="dia" {...axis} />
                      <YAxis {...axis} allowDecimals={false} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Bar dataKey="oportunidades" name="Oportunidades" fill="#2f9c5a" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
              <OpportunitySellerChart data={opportunityRows} height={opportunityChartH} loading={isLoading && !error} />
            </section>
          )}

          {active === "comercial" ? (
            <section className="grid gap-4 xl:grid-cols-2">
              <MonthlyBarChart title="Taxa de ocupação mensal" data={occ?.months ?? []} dataKey="rate" valueName="Ocupação" formatter={pct} />
              <MonthlyBarChart title="Taxa de conversão mensal" data={view?.monthlyKpis ?? []} dataKey="conversao" valueName="Conversão" formatter={pct} />
              <MonthlyBarChart title="Faturamento mensal" data={view?.monthlyKpis ?? []} dataKey="faturamento" valueName="Faturamento" formatter={brl} currencyAxis />
              <MonthlyBarChart title="Reservas mensais" data={view?.monthlyKpis ?? []} dataKey="reservas" valueName="Reservas" formatter={(value) => value.toLocaleString("pt-BR")} integerAxis />
              <MonthlyLineChart title="Ticket médio mensal" data={view?.monthlyKpis ?? []} dataKey="ticket" valueName="Ticket médio" formatter={brl} currencyAxis />
              <MonthlyLineChart title="Desconto médio mensal" data={view?.monthlyKpis ?? []} dataKey="descontoPct" valueName="Desconto médio" formatter={pct} percentageAxis />
            </section>
          ) : null}

          {active === "comercial-operacional" ? (
            <DailyStackedChart
              title="Valor fechado por vendedor por dia"
              data={view?.dailyRevenueBySeller ?? []}
              series={view?.dailyRevenueKeys ?? []}
              currency
              expandable
            />
          ) : (
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-foreground">Valor fechado por vendedor ao mês</h2>
              <p className="text-xs text-muted-foreground">Últimos 5 meses até o fim do período, pela data de criação da reserva</p>
              <div className="mt-4 h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={view?.monthly ?? []}>
                    <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.34 0.045 155)" />
                    <XAxis dataKey="mes" {...axis} />
                    <YAxis {...axis} tickFormatter={(v: number) => `$${Math.round(v / 1000)}k`} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => brl(v)} />
                    <Legend />
                    {view?.stackKeys.map((n, i) => (
                      <Bar key={n} dataKey={n} stackId="a" fill={COLORS[i % COLORS.length]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}

          {active === "comercial" ? (
            <section className="grid gap-4 xl:grid-cols-3">
              <GoalChart title="Receita provisionada" subtitle="Alcançado vs. meta" data={goalRows} h={chartH} a="faturamento" b="revenueGoal" fmt={brl} />
              <GoalChart title="Ticket médio" subtitle="Alcançado vs. meta" data={goalRows} h={chartH} a="ticket" b="ticketGoal" fmt={brl} />
              <GoalChart title="Desconto médio (%)" subtitle="Alcançado vs. meta" data={goalRows} h={chartH} a="descontoPct" b="discountGoal" fmt={pct} />
            </section>
          ) : null}

          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Detalhamento por vendedor</h2>
                <p className="text-xs text-muted-foreground">Clique no título da coluna para ordenar</p>
              </div>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                <Input placeholder="Buscar vendedor" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 w-56 pl-8" />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-sm">
                <thead className="bg-secondary/60 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <Th k="name" label="Vendedor" left />
                    <Th k="oportunidades" label="Oportunidades" />
                    <Th k="tasksTotal" label="Tarefas totais" />
                    <Th k="overdue" label="Atrasadas" />
                    <Th k="done" label="Concluídas" />
                    <Th k="noTask" label="Sem tarefa" />
                    <Th k="reservas" label="Reservas" />
                    <Th k="conversao" label="Conversão" />
                    <Th k="ticket" label="Ticket médio" />
                    <Th k="faturamento" label="Valor fechado" />
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((r) => (
                    <tr key={r.key} className="border-t border-border">
                      <td className="px-4 py-3 font-medium text-foreground">{r.name}</td>
                      <td className="px-4 py-3 text-right">{r.oportunidades.toLocaleString("pt-BR")}</td>
                      <td className="px-4 py-3 text-right">{r.tasksTotal}</td>
                      <td className="px-4 py-3 text-right">{r.overdue}</td>
                      <td className="px-4 py-3 text-right">{r.done}</td>
                      <td className="px-4 py-3 text-right">{r.noTask}</td>
                      <td className="px-4 py-3 text-right">{r.reservas}</td>
                      <td className="px-4 py-3 text-right">{r.key === "venda_direta" ? "—" : pct(r.conversao)}</td>
                      <td className="px-4 py-3 text-right">{brl(r.ticket)}</td>
                      <td className="px-4 py-3 text-right font-medium text-accent">{brl(r.faturamento)}</td>
                    </tr>
                  ))}
                  {!tableRows.length ? (
                    <tr>
                      <td colSpan={10} className="px-5 py-10 text-center text-muted-foreground">
                        {isLoading ? "Carregando…" : "Nenhum dado no período."}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </main>
      <Dialog open={noTaskOpen} onOpenChange={setNoTaskOpen}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Oportunidades sem tarefa ({view?.noTaskList.length ?? 0})</DialogTitle>
          </DialogHeader>
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-2 text-left">Criado em</th>
                <th className="py-2 text-left">Contato</th>
                <th className="py-2 text-left">Etapa</th>
                <th className="py-2 text-left">Responsável</th>
              </tr>
            </thead>
            <tbody>
              {(view?.noTaskList ?? []).slice(0, 500).map((l, i) => (
                <tr key={(l.lead_id ?? "") + i} className="border-t border-border">
                  <td className="py-2">{new Date(l.created_at).toLocaleDateString("pt-BR")}</td>
                  <td className="py-2 text-foreground">{l.name ?? "—"}</td>
                  <td className="py-2">{l.stage_name ?? "—"}</td>
                  <td className="py-2">{l.owner}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(view?.noTaskList.length ?? 0) > 500 ? <p className="text-xs text-muted-foreground">Mostrando os 500 mais recentes.</p> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MonthlyBarChart({
  title,
  data,
  dataKey,
  valueName,
  formatter,
  currencyAxis = false,
  integerAxis = false,
}: {
  title: string;
  data: object[];
  dataKey: string;
  valueName: string;
  formatter: (value: number) => string;
  currencyAxis?: boolean;
  integerAxis?: boolean;
}) {
  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <div className="mt-4 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey={dataKey === "rate" ? "label" : "mes"} interval={0} minTickGap={0} {...axis} />
            <YAxis
              {...axis}
              allowDecimals={!integerAxis}
              tickFormatter={(value: number) => currencyAxis && dataKey === "faturamento" ? `$${Math.round(value / 1000)}k` : currencyAxis ? `$${Math.round(value).toLocaleString("pt-BR")}` : dataKey === "rate" || dataKey === "conversao" ? `${Math.round(value * 100)}%` : value.toLocaleString("pt-BR")}
            />
            <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => [formatter(value), valueName]} />
            <Bar dataKey={dataKey} name={valueName} fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function MonthlyLineChart({
  title,
  data,
  dataKey,
  valueName,
  formatter,
  currencyAxis = false,
  percentageAxis = false,
}: {
  title: string;
  data: object[];
  dataKey: string;
  valueName: string;
  formatter: (value: number) => string;
  currencyAxis?: boolean;
  percentageAxis?: boolean;
}) {
  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <div className="mt-4 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="mes" interval={0} minTickGap={0} {...axis} />
            <YAxis
              {...axis}
              tickFormatter={(value: number) => currencyAxis ? `$${Math.round(value).toLocaleString("pt-BR")}` : percentageAxis ? `${Math.round(value * 100)}%` : value.toLocaleString("pt-BR")}
            />
            <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => [formatter(value), valueName]} />
            <Line type="monotone" dataKey={dataKey} name={valueName} stroke="var(--chart-1)" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function OpportunitySellerChart({
  data,
  height,
  loading,
  compare = false,
  expandable = false,
}: {
  data: SellerRow[];
  height: number;
  loading: boolean;
  compare?: boolean;
  expandable?: boolean;
}) {
  const chartData = data.map((row) => ({
    ...row,
    reservasPct: row.oportunidades ? pct(row.reservas / row.oportunidades) : "—",
  }));
  return (
    <ExpandableChartPanel
      title={compare ? "Oportunidades vs. reservas por vendedor" : "Oportunidades por vendedor"}
      expandable={expandable}
      render={(expanded) => data.length ? (
        <div className="mt-4" style={{ height: expanded ? "70vh" : height }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 48 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.34 0.045 155)" />
              <XAxis type="number" {...axis} allowDecimals={false} />
              <YAxis type="category" dataKey="name" width={120} {...axis} />
              <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => value.toLocaleString("pt-BR")} />
              <Bar dataKey="oportunidades" name="Oportunidades" fill={compare ? "#44E500" : "#2f9c5a"} radius={[0, 4, 4, 0]} />
              {compare ? (
                <Bar dataKey="reservas" name="Reservas concluídas" fill="#2f9c5a" radius={[0, 4, 4, 0]}>
                  <LabelList dataKey="reservasPct" position="right" formatter={(value: string) => value} />
                </Bar>
              ) : null}
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="mt-4 flex items-center justify-center text-sm text-muted-foreground" style={{ height: expanded ? "70vh" : 220 }}>
          {loading ? "Carregando..." : "Nenhuma oportunidade no período."}
        </div>
      )}
    />
  );
}

function NoTaskBySellerChart({
  data,
  height,
  expandable = false,
}: {
  data: Pick<SellerRow, "name" | "noTask">[];
  height: number;
  expandable?: boolean;
}) {
  return (
    <ExpandableChartPanel
      title="Oportunidades sem tarefas por vendedor"
      expandable={expandable}
      render={(expanded) => data.length ? (
        <div className="mt-4" style={{ height: expanded ? "70vh" : height }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ left: 8, right: 36 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.34 0.045 155)" />
              <XAxis type="number" {...axis} allowDecimals={false} />
              <YAxis type="category" dataKey="name" width={120} {...axis} />
              <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => value.toLocaleString("pt-BR")} />
              <Bar dataKey="noTask" name="Sem tarefas" fill="#44E500" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="mt-4 flex items-center justify-center text-sm text-muted-foreground" style={{ height: expanded ? "70vh" : 220 }}>
          Nenhuma oportunidade sem tarefas no período.
        </div>
      )}
    />
  );
}

function ConversionBySellerChart({
  data,
  height,
  total,
  expandable = false,
}: {
  data: Pick<SellerRow, "name" | "conversao">[];
  height: number;
  total: number;
  expandable?: boolean;
}) {
  return (
    <ExpandableChartPanel
      title="Taxa de conversão por vendedor"
      expandable={expandable}
      render={(expanded) => data.length ? (
        <div className="mt-4" style={{ height: expanded ? "70vh" : height }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ left: 8, right: 36 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.34 0.045 155)" />
              <XAxis type="number" {...axis} tickFormatter={(value: number) => pct(value)} />
              <YAxis type="category" dataKey="name" width={120} {...axis} />
              <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => pct(value)} />
              <ReferenceLine x={total} stroke="#f2b84b" strokeDasharray="4 4" />
              <Bar dataKey="conversao" name="Conversão" fill="#44E500" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="mt-4 flex items-center justify-center text-sm text-muted-foreground" style={{ height: expanded ? "70vh" : 220 }}>
          Nenhuma oportunidade no período.
        </div>
      )}
    />
  );
}

function DailyStackedChart({
  title,
  data,
  series,
  currency = false,
  expandable = false,
}: {
  title: string;
  data: Record<string, string | number>[];
  series: string[];
  currency?: boolean;
  expandable?: boolean;
}) {
  return (
    <ExpandableChartPanel title={title} subtitle="Cada barra representa um dia do período selecionado." expandable={expandable} render={(expanded) => (
      data.length && series.length ? (
        <div className="mt-4" style={{ height: expanded ? "70vh" : 320 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.34 0.045 155)" />
              <XAxis dataKey="dia" {...axis} minTickGap={8} />
              <YAxis {...axis} allowDecimals={!currency} tickFormatter={(value: number) => currency ? `$${Math.round(value / 1000)}k` : value.toLocaleString("pt-BR")} />
              <Tooltip
                contentStyle={tooltipStyle}
                itemSorter={(item) => -Number(item.value ?? 0)}
                formatter={(value: number) => currency ? brl(value) : value.toLocaleString("pt-BR")}
              />
              <Legend />
              {series.map((name, index) => (
                <Bar key={name} dataKey={name} stackId="daily" fill={COLORS[index % COLORS.length]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="mt-4 flex h-64 items-center justify-center text-sm text-muted-foreground">
          Nenhum dado no período.
        </div>
      )
    )} />
  );
}

function ExpandableChartPanel({
  title,
  subtitle,
  expandable = false,
  render,
}: {
  title: string;
  subtitle?: string;
  expandable?: boolean;
  render: (expanded: boolean) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-h-10">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
        {expandable ? (
          <Button variant="ghost" size="icon" aria-label={`Expandir gráfico: ${title}`} title="Expandir gráfico" onClick={() => setOpen(true)}>
            <Maximize2 className="size-4" />
          </Button>
        ) : null}
      </div>
      {render(false)}
      {expandable ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="w-[min(96vw,1200px)] max-w-none">
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
            </DialogHeader>
            {render(true)}
          </DialogContent>
        </Dialog>
      ) : null}
    </Card>
  );
}

function GoalChart({
  title,
  subtitle,
  data,
  h,
  a,
  b,
  fmt,
  expandable = false,
}: {
  title: string;
  subtitle: string;
  data: SellerRow[];
  h: number;
  a: keyof SellerRow;
  b?: keyof SellerRow;
  fmt: (v: number) => string;
  expandable?: boolean;
}) {
  return (
    <ExpandableChartPanel title={title} subtitle={subtitle} expandable={expandable} render={(expanded) => (
      <div className="mt-4" style={{ height: expanded ? "70vh" : h }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.34 0.045 155)" />
            <XAxis type="number" {...axis} tickFormatter={(v: number) => (a === "descontoPct" ? pct(v) : `$${Math.round(v / 1000)}k`)} />
            <YAxis type="category" dataKey="name" width={90} {...axis} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => fmt(v)} />
            <Legend />
            <Bar dataKey={a} name="Alcançado" fill="#44E500" radius={[0, 4, 4, 0]} />
            {b ? <Bar dataKey={b} name="Meta" fill="#2f9c5a" radius={[0, 4, 4, 0]} /> : null}
          </BarChart>
        </ResponsiveContainer>
      </div>
    )} />
  );
}

function GoalsDialog({
  sellers,
  month,
  goals,
}: {
  sellers: SellerRow[];
  month: string;
  goals: Goal[];
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"commercial" | "general">("commercial");
  const [m, setM] = useState(month);
  
  // Estado para metas por vendedor (Aba Comercial)
  const [vals, setVals] = useState<Record<string, { r: string; t: string; d: string; c: string }>>({});
  
  // Estado para a aba Meta Geral (Ocupação e Metas Globais)
  const [generalVals, setGeneralVals] = useState({
    occupancyCurrent: "",
    occupancyNext: "",
    revenue: "",
    ticket: "",
    discount: "",
    conversion: "",
  });

  const load = (mm: string) => {
    const next: Record<string, { r: string; t: string; d: string; c: string }> = {};
    sellers.forEach((s) => {
      const g = goals.find((x) => x.month === mm && x.seller_name === s.name);
      next[s.name] = { 
        r: g ? String(g.revenue_goal) : "", 
        t: g ? String(g.ticket_goal) : "",
        d: g && g.discount_goal !== undefined ? String(g.discount_goal * 100) : "",
        c: g?.conversion_goal != null ? String(g.conversion_goal * 100) : "" 
      };
    });
    setVals(next);
    const general = goals.find((g) => g.seller_name === GLOBAL_GOAL && g.month === mm);
    const current = goals.find((g) => g.seller_name === OCCUPANCY_GOAL && g.month === mm);
    const following = goals.find((g) => g.seller_name === OCCUPANCY_GOAL && g.month === nextGoalMonth(mm));
    setGeneralVals({
      revenue: general ? String(general.revenue_goal) : "",
      ticket: general ? String(general.ticket_goal) : "",
      conversion: general?.conversion_goal != null ? String(general.conversion_goal * 100) : "",
      discount: general?.discount_goal != null ? String(general.discount_goal * 100) : "",
      occupancyCurrent: current?.discount_goal != null ? String(current.discount_goal * 100) : "",
      occupancyNext: following?.discount_goal != null ? String(following.discount_goal * 100) : "",
    });
  };

  const mut = useMutation({
    mutationFn: () => {
      const percentageValues = activeTab === "commercial"
        ? Object.values(vals).flatMap((v) => [v.d, v.c])
        : [generalVals.discount, generalVals.conversion, generalVals.occupancyCurrent, generalVals.occupancyNext];
      if (percentageValues.some((v) => v !== "" && (!Number.isFinite(Number(v)) || Number(v) < 0 || Number(v) > 100))) {
        return Promise.reject(new Error("Informe percentuais entre 0 e 100%."));
      }
      if (activeTab === "commercial") {
        return saveGoals(
          Object.entries(vals)
            .filter(([, v]) => v.r !== "" || v.t !== "" || v.d !== "" || v.c !== "")
            .map(([name, v]) => ({ 
              seller_name: name, 
              month: m, 
              revenue_goal: Number(v.r) || 0, 
              ticket_goal: Number(v.t) || 0,
              discount_goal: (Number(v.d) || 0) / 100,
              conversion_goal: (Number(v.c) || 0) / 100, 
            })),
        );
      } else {
        const values = Object.values(generalVals).filter((v) => v !== "").map(Number);
        if (values.some((v) => !Number.isFinite(v) || v < 0) || Number(generalVals.occupancyCurrent) > 100 || Number(generalVals.occupancyNext) > 100) {
          return Promise.reject(new Error("Informe metas válidas; ocupação deve estar entre 0 e 100%."));
        }
        return saveGoals([
          { seller_name: GLOBAL_GOAL, month: m, revenue_goal: Number(generalVals.revenue) || 0, ticket_goal: Number(generalVals.ticket) || 0, discount_goal: (Number(generalVals.discount) || 0) / 100, conversion_goal: (Number(generalVals.conversion) || 0) / 100 },
          { seller_name: OCCUPANCY_GOAL, month: m, revenue_goal: 0, ticket_goal: 0, discount_goal: (Number(generalVals.occupancyCurrent) || 0) / 100 },
          { seller_name: OCCUPANCY_GOAL, month: nextGoalMonth(m), revenue_goal: 0, ticket_goal: 0, discount_goal: (Number(generalVals.occupancyNext) || 0) / 100 },
        ]);
      }
    },
    onSuccess: () => {
      toast.success("Metas salvas com sucesso");
      qc.invalidateQueries({ queryKey: ["comercial"] });
      setOpen(false);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setM(month);
          load(month);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-9">
          <Target className="mr-1 size-4" /> Metas
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Definição de Metas</DialogTitle>
        </DialogHeader>

        {/* Seletor de Abas */}
        <div className="flex space-x-2 border-b pb-2 mb-3">
          <Button
            variant={activeTab === "commercial" ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveTab("commercial")}
          >
            Metas Individuais
          </Button>
          <Button
            variant={activeTab === "general" ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveTab("general")}
          >
            Metas Gerais
          </Button>
        </div>

        {/* Seletor de Mês comum */}
        <div className="mb-4">
          <label className="text-xs text-muted-foreground block mb-1">Mês de referência:</label>
          <Input
            type="month"
            value={m}
            onChange={(e) => {
              setM(e.target.value);
              load(e.target.value);
            }}
          />
        </div>

        {activeTab === "commercial" ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-[minmax(0,1fr)_5rem_5rem_5rem_5rem] gap-2 text-xs font-medium text-muted-foreground px-1">
              <span>Vendedor</span>
              <span className="text-right">Receita (US$)</span>
              <span className="text-right">Ticket (US$)</span>
              <span className="text-right">Desconto (%)</span>
              <span className="text-right">Conversão (%)</span>
            </div>
            {sellers.map((s: SellerRow) => (
              <div key={s.key} className="grid grid-cols-2 sm:grid-cols-[minmax(0,1fr)_5rem_5rem_5rem_5rem] gap-2 items-center bg-card/40 p-2 rounded-lg border border-border/50">
                <span className="text-sm font-medium text-foreground truncate">{s.name}</span>
                <Input 
                  type="number"
                  inputMode="decimal"
                  step="any"
                  placeholder="0"
                  value={vals[s.name]?.r ?? ""} 
                  onChange={(e) => setVals((v) => ({ ...v, [s.name]: { c: v[s.name]?.c ?? "", r: e.target.value, t: v[s.name]?.t ?? "", d: v[s.name]?.d ?? "" } }))} 
                />
                <Input 
                  type="number"
                  inputMode="decimal"
                  step="any"
                  placeholder="0"
                  value={vals[s.name]?.t ?? ""} 
                  onChange={(e) => setVals((v) => ({ ...v, [s.name]: { c: v[s.name]?.c ?? "", r: v[s.name]?.r ?? "", t: e.target.value, d: v[s.name]?.d ?? "" } }))} 
                />
                <Input 
                  type="number"
                  inputMode="decimal"
                  step="any"
                  placeholder="0"
                  value={vals[s.name]?.d ?? ""} 
                  onChange={(e) => setVals((v) => ({ ...v, [s.name]: { c: v[s.name]?.c ?? "", r: v[s.name]?.r ?? "", t: v[s.name]?.t ?? "", d: e.target.value } }))} 
                />
                <Input type="number" inputMode="decimal" step="any" min="0" max="100" placeholder="0"
                  aria-label={`Meta de conversão de ${s.name} (%)`}
                  value={vals[s.name]?.c ?? ""}
                  onChange={(e) => setVals((v) => ({ ...v, [s.name]: { r: v[s.name]?.r ?? "", t: v[s.name]?.t ?? "", d: v[s.name]?.d ?? "", c: e.target.value } }))} />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Meta de Ocupação - Mês Atual (%)</label>
              <Input
                type="number"
                inputMode="decimal"
                step="any"
                placeholder="Ex: 75.5"
                value={generalVals.occupancyCurrent}
                onChange={(e) => setGeneralVals((prev) => ({ ...prev, occupancyCurrent: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Meta de Ocupação - Mês Seguinte (%)</label>
              <Input
                type="number"
                inputMode="decimal"
                step="any"
                placeholder="Ex: 80.0"
                value={generalVals.occupancyNext}
                onChange={(e) => setGeneralVals((prev) => ({ ...prev, occupancyNext: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Meta Geral de Faturamento (US$)</label>
              <Input
                type="number"
                inputMode="decimal"
                step="any"
                placeholder="Ex: 50000"
                value={generalVals.revenue}
                onChange={(e) => setGeneralVals((prev) => ({ ...prev, revenue: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Meta Geral de Ticket Médio (US$)</label>
              <Input
                type="number"
                inputMode="decimal"
                step="any"
                placeholder="Ex: 750"
                value={generalVals.ticket}
                onChange={(e) => setGeneralVals((prev) => ({ ...prev, ticket: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="global-conversion" className="text-sm font-medium">Meta Geral de Conversão (%)</label>
              <Input id="global-conversion" type="number" inputMode="decimal" step="any" min="0" max="100"
                value={generalVals.conversion}
                onChange={(e) => setGeneralVals((prev) => ({ ...prev, conversion: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Meta Geral de Desconto (%)</label>
              <Input
                type="number"
                inputMode="decimal"
                step="any"
                placeholder="Ex: 10"
                value={generalVals.discount}
                onChange={(e) => setGeneralVals((prev) => ({ ...prev, discount: e.target.value }))}
              />
            </div>
          </div>
        )}

        <DialogFooter className="mt-4">
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            Salvar metas
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}