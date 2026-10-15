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
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowUpDown,
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

import { guardPage } from "@/lib/roles";
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
  computeOpportunityTotalsBySeller,
  filterOperationalData,
  fetchComercial,
  saveGoals,
  type SellerRow,
  type Goal,
} from "@/lib/comercial";
import { fetchOccupancy, occupancyMonthVariation } from "@/lib/occupancy";
import { commissionFor, GLOBAL_GOAL, OCCUPANCY_GOAL, expectedRevenueByDate, isGeneralGoal, monthProgress, nextGoalMonth, revenueAndTicketGoals } from "@/lib/commercial-goals";

export const Route = createFileRoute("/_authenticated/comercial")({
  beforeLoad: () => guardPage("comercial"),
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
  const teamData = useMemo(() => data ? filterOperationalData(data) : null, [data]);
  const view = useMemo(() => teamData
    ? computeComercial(
        { ...teamData, goals: teamData.goals.filter((g) => !isGeneralGoal(g)) },
        from,
        to,
        "all",
        active === "comercial-operacional",
      )
    : null, [teamData, from, to, active]);
  const { data: occ } = useQuery({ queryKey: ["occupancy", from, to], queryFn: () => fetchOccupancy(from, to), enabled: active === "comercial" || active === "comercial-operacional" });
  const k = view?.kpis;
  const cardGoals = revenueAndTicketGoals(teamData?.goals ?? [], from, to);
  const revenuePace = expectedRevenueByDate(teamData?.goals ?? [], from, to);
  const monthProgressPercent = monthProgress(to) * 100;
  const ticketGoalDelta = (k?.ticket ?? 0) - cardGoals.ticket;
  const discountLimitDeltaPp = (cardGoals.discount - (k?.descontoPct ?? 0)) * 100;
  const selectedPeriodDays = Math.max(
    1,
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1,
  );

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
  const chartH = Math.min(420, Math.max(220, goalRows.length * 34));
  const opportunityRows = (view?.rows ?? [])
    .filter((r) => r.key !== "sem_vendedor" && r.key !== "venda_direta" && (r.oportunidades > 0 || r.reservas > 0))
    .sort((a, b) => b.oportunidades - a.oportunidades);
  const noTaskRows = (view?.rows ?? [])
    .filter((r) => r.key !== "venda_direta" && r.noTask > 0)
    .sort((a, b) => b.noTask - a.noTask);
  const allTimeOpportunityRows = teamData
    ? computeOpportunityTotalsBySeller(teamData.opportunities)
    : [];
  const operationalCardClass = "min-h-[190px] h-full w-full flex flex-col justify-between";
  const compactOperationalCardClass = "h-[160px] w-full px-3 py-2 flex flex-col justify-between";
  const firstRowOperationalCardClass = "h-[144px] w-full p-3 flex flex-col justify-start";
  const operationalSellerChartHeight = Math.min(
    420,
    Math.max(220, Math.max(opportunityRows.length, noTaskRows.length, allTimeOpportunityRows.length) * 34),
  );

  const opportunityCard = <KpiCard icon={Target} label="Oportunidades"
    value={k ? k.oportunidades.toLocaleString("pt-BR") : "—"}
    hint={k ? comparison(k.oportunidadesVar) : undefined}
    footer={k ? `Média de ${(k.oportunidades / selectedPeriodDays).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} por dia` : undefined}
    compact tight
    className={firstRowOperationalCardClass} />;
  const noTaskCard = <Button variant="ghost" className="block h-[144px] w-full whitespace-normal p-0 text-left hover:bg-transparent [&>div]:h-full" onClick={() => setNoTaskOpen(true)}>
    <KpiCard icon={ClipboardX} label="Oportunidades sem tarefas"
      value={k ? k.leadsNoTask.toLocaleString("pt-BR") : "—"}
      hint={k ? comparison(k.leadsNoTaskVar) : undefined} highlight
      footer={k ? `Média de ${(k.leadsNoTask / selectedPeriodDays).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} por dia sem tarefas` : undefined}
      compact tight
        className={firstRowOperationalCardClass} />
  </Button>;
  const revenueCard = <KpiCard icon={DollarSign} label="Faturamento"
    value={k ? brl(k.faturamento) : "—"}
    hint={k ? comparison(k.faturamentoVar) : undefined}
    goal={{ actual: k?.faturamento ?? 0, target: cardGoals.revenue, label: brl(cardGoals.revenue) }}
    pace={{ expected: brl(revenuePace), actual: brl(k?.faturamento ?? 0), monthPercent: monthProgressPercent }}
    compact aligned className={compactOperationalCardClass} />;
  const ticketCard = <KpiCard icon={DollarSign} label="Ticket médio"
    value={k ? brl(k.ticket) : "—"}
    hint={k ? comparison(k.ticketVar) : undefined}
    goal={{ actual: k?.ticket ?? 0, target: cardGoals.ticket, label: brl(cardGoals.ticket) }}
    footer={k && cardGoals.ticket > 0 ? `${ticketGoalDelta >= 0 ? "+" : ""}${brl(ticketGoalDelta)} da meta` : undefined}
    compact aligned className={compactOperationalCardClass} />;
  const discountCard = <KpiCard icon={Percent} label="Desconto médio"
    value={k ? pct(k.descontoPct) : "—"}
    hint={k ? k.descontoYearDiff === null ? "Sem base de comparação vs. ano anterior" : `${k.descontoYearDiff >= 0 ? "+" : ""}${k.descontoYearDiff.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} p.p. vs. ano anterior` : undefined}
    goal={{ actual: k?.descontoPct ?? 0, target: cardGoals.discount, label: pct(cardGoals.discount), kind: "limit" }}
    footer={k && cardGoals.discount > 0 ? `${discountLimitDeltaPp >= 0 ? "+" : ""}${discountLimitDeltaPp.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} p.p. do limite` : undefined}
    compact aligned className={compactOperationalCardClass} />;
  const conversionCard = <KpiCard icon={UserCheck} label="Taxa de conversão"
    value={k ? pct(k.conversao) : "—"}
    hint={k ? comparison(k.conversaoVar) : undefined} highlight
    goal={{ actual: k?.conversao ?? 0, target: cardGoals.conversion, label: pct(cardGoals.conversion) }}
    compact tight
    className={firstRowOperationalCardClass} />;
  const occupancyCards = active === "comercial" || active === "comercial-operacional" ? ["Ocupação do mês atual", "Ocupação do mês seguinte", "Ocupação do mês +2"].map((label, index) => {
    const occupancyMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + index, 1)).toISOString().slice(0, 7);
    const month = occ?.months.find((item) => item.month === occupancyMonth);
    const previousMonthKey = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + index - 1, 1)).toISOString().slice(0, 7);
    const previousMonth = occ?.months.find((item) => item.month === previousMonthKey);
    const occupancyRate = month?.rate;
    const occupancyVariation = occupancyMonthVariation(month, previousMonth);
    const occupancyTarget = data?.goals.find((g) => g.seller_name === OCCUPANCY_GOAL && g.month === occupancyMonth)?.discount_goal;
    return <KpiCard key={label} icon={CarFront} label={label} value={occupancyRate === undefined ? "—" : pct(occupancyRate)}
      hint={occupancyVariation === undefined ? undefined : comparison(occupancyVariation)}
      highlight={index === 0} compact aligned
      goal={{ actual: occupancyRate ?? 0, target: occupancyTarget, label: pct(occupancyTarget ?? 0) }} className={compactOperationalCardClass} />;
  }) : null;

  const selectedMonths = new Set<string>();
  for (const month = new Date(`${from.slice(0, 7)}-01T00:00:00Z`), last = new Date(`${to.slice(0, 7)}-01T00:00:00Z`); month <= last; month.setUTCMonth(month.getUTCMonth() + 1)) {
    selectedMonths.add(`${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  const occupancyMonths = (occ?.months ?? []).filter((month) => selectedMonths.has(month.month));
  const occupancyComparisons = occupancyMonths.map((month) => {
    const [year, monthNumber] = month.month.split("-");
    const previousKey = `${Number(year) - 1}-${monthNumber}`;
    return {
      ...month,
      yearAgoRate: occ?.months.find((previous) => previous.month === previousKey)?.rate,
    };
  });
  const previousYearKpis = new Map((view?.monthlyKpisPreviousYear ?? []).map((month) => [month.monthKey, month]));
  const monthlyKpis = (view?.monthlyKpis ?? [])
    .filter((month) => selectedMonths.has(month.monthKey))
    .map((month) => {
      const [year, monthNumber] = month.monthKey.split("-");
      const previous = previousYearKpis.get(`${Number(year) - 1}-${monthNumber}`);
      return {
        ...month,
        yearAgoConversion: previous?.conversao,
        yearAgoRevenue: previous?.faturamento,
        yearAgoReservations: previous?.reservas,
        yearAgoTicket: previous?.ticket,
        yearAgoDiscount: previous?.descontoPct,
      };
    });
  const monthlyRevenue = (view?.monthly ?? []).filter((month) => selectedMonths.has(String(month["mes"]).replace("/", "-")));

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
            {view ? <GoalsDialog sellers={view.sellers} month={view.goalMonth} goals={teamData?.goals ?? []} /> : null}
          </div>
        </header>

        <div className="space-y-6 p-6">
          {error ? (
            <Card className="border-destructive/40 p-4 text-sm text-destructive">
              Não foi possível carregar os dados comerciais agora.
              {error instanceof Error ? <p className="mt-1 break-words text-xs">{error.message}</p> : null}
            </Card>
          ) : null}

          <section className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
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
                <OpportunitySellerChart data={allTimeOpportunityRows} height={operationalSellerChartHeight} loading={isLoading && !error} expandable />
              </div>
              <div className="space-y-4">
                {revenueCard}
                <GoalChart title="Receita provisionada" subtitle="Alcançado vs. meta" data={goalRows} h={chartH} a="faturamento" b="revenueGoal" fmt={brl} expandable />
                {active === "comercial-operacional" ? occupancyCards?.[0] : null}
              </div>
              <div className="space-y-4">
                {ticketCard}
                <GoalChart title="Ticket médio" subtitle="Alcançado vs. meta" data={goalRows} h={chartH} a="ticket" b="ticketGoal" fmt={brl} expandable />
                {active === "comercial-operacional" ? occupancyCards?.[1] : null}
              </div>
              <div className="space-y-4">
                {discountCard}
                <GoalChart title="Desconto médio (%)" subtitle="Alcançado vs. meta" data={goalRows} h={chartH} a="descontoPct" b="discountGoal" fmt={pct} expandable />
                {active === "comercial-operacional" ? occupancyCards?.[2] : null}
              </div>
              {active === "comercial" ? occupancyCards : null}
          </section>

          <SellerLineChart
            title="Oportunidades por vendedor por dia"
            data={view?.dailyOpportunitiesBySeller ?? []}
            series={view?.dailyOpportunityKeys ?? []}
            expandable
          />

          {active === "comercial-operacional" ? (
            <SellerLineChart
              title="Valor fechado por vendedor por dia"
              data={view?.dailyRevenueBySeller ?? []}
              series={view?.dailyRevenueKeys ?? []}
              currency
              expandable
            />
          ) : (
            <SellerLineChart
              title="Valor fechado por vendedor ao mês"
              subtitle="Período selecionado, pela data de criação da reserva."
              data={monthlyRevenue}
              dataKey="mes"
              series={view?.stackKeys ?? []}
              currency
              expandable
            />
          )}

          {active === "comercial" ? (
            <section className="grid gap-4 xl:grid-cols-2">
              <OccupancyLineChart title="Taxa de ocupação mensal" data={occupancyComparisons} />
              <MonthlyBarChart title="Taxa de conversão mensal" data={monthlyKpis} dataKey="conversao" valueName="Conversão" formatter={pct} comparisonKey="yearAgoConversion" />
              <MonthlyBarChart title="Faturamento mensal" data={monthlyKpis} dataKey="faturamento" valueName="Faturamento" formatter={brl} currencyAxis comparisonKey="yearAgoRevenue" />
              <MonthlyBarChart title="Reservas mensais" data={monthlyKpis} dataKey="reservas" valueName="Reservas" formatter={(value) => value.toLocaleString("pt-BR")} integerAxis comparisonKey="yearAgoReservations" />
              <MonthlyBarChart title="Ticket médio mensal" data={monthlyKpis} dataKey="ticket" valueName="Ticket médio" formatter={brl} currencyAxis comparisonKey="yearAgoTicket" />
              <MonthlyBarChart title="Desconto médio mensal" data={monthlyKpis} dataKey="descontoPct" valueName="Desconto médio" formatter={pct} percentageAxis comparisonKey="yearAgoDiscount" />
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
          {active === "comercial-operacional" && view ? (
            <CommissionModule
              sellers={view.sellers.filter((x) => x.revenueGoal > 0 || x.faturamento > 0)}
              teamSold={k?.faturamento ?? 0}
              teamGoal={cardGoals.revenue}
            />
          ) : null}
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

function OccupancyLineChart({
  title,
  data,
}: {
  title: string;
  data: Record<string, string | number | undefined>[];
}) {
  return (
    <ExpandableChartPanel
      title={title}
      expandable
      render={(expanded) => (
        <div className="mt-4" style={{ height: expanded ? "70vh" : 256 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="label" {...axis} />
              <YAxis
                {...axis}
                label={{ value: "Taxa de Ocupação (%)", angle: -90, position: "insideLeft" }}
                tickFormatter={(value: number) => `${Math.round(value * 100)}%`}
                domain={[0, 1]}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value: number) => pct(value)}
                labelFormatter={(label) => `Mês: ${label}`}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="rate"
                name="Ocupação Atual"
                stroke="#44E500"
                strokeWidth={2.5}
                dot={{ r: 4 }}
                activeDot={{ r: 6 }}
              />
              <Line
                type="monotone"
                dataKey="yearAgoRate"
                name="Ocupação Ano Anterior"
                stroke="#2f9c5a"
                strokeWidth={2.5}
                dot={{ r: 4 }}
                activeDot={{ r: 6 }}
                strokeDasharray="5 5"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    />
  );
}

function MonthlyBarChart({
  title,
  data,
  dataKey,
  valueName,
  formatter,
  comparisonKey,
  comparisonName = "Ano anterior",
  currencyAxis = false,
  integerAxis = false,
  percentageAxis = false,
}: {
  title: string;
  data: object[];
  dataKey: string;
  valueName: string;
  formatter: (value: number) => string;
  comparisonKey?: string;
  comparisonName?: string;
  currencyAxis?: boolean;
  integerAxis?: boolean;
  percentageAxis?: boolean;
}) {
  return (
    <ExpandableChartPanel
      title={title}
      expandable
      render={(expanded) => (
      <div className="mt-4" style={{ height: expanded ? "70vh" : 256 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey={dataKey === "rate" ? "label" : "mes"} interval={0} minTickGap={0} {...axis} />
            <YAxis
              {...axis}
              allowDecimals={!integerAxis}
              tickFormatter={(value: number) => currencyAxis && dataKey === "faturamento" ? `$${Math.round(value / 1000)}k` : currencyAxis ? `$${Math.round(value).toLocaleString("pt-BR")}` : percentageAxis || dataKey === "rate" || dataKey === "conversao" ? `${Math.round(value * 100)}%` : value.toLocaleString("pt-BR")}
            />
              <Tooltip contentStyle={tooltipStyle} formatter={(value: number, name: string) => [formatter(value), name]} />
              {comparisonKey ? <Legend /> : null}
              <Bar dataKey={dataKey} name={valueName} fill="#44E500" radius={[4, 4, 0, 0]} />
              {comparisonKey ? <Bar dataKey={comparisonKey} name={comparisonName} fill="#2f9c5a" radius={[4, 4, 0, 0]} /> : null}
          </BarChart>
        </ResponsiveContainer>
      </div>
      )}
    />
  );
}

function OpportunitySellerChart({
  data,
  height,
  loading,
  compare = false,
  expandable = false,
}: {
  data: Pick<SellerRow, "name" | "oportunidades" | "reservas">[];
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
      subtitle={compare ? "Oportunidades e conversão em reservas por vendedor." : "Todos os períodos, sem filtro de datas."}
      expandable={expandable}
      render={(expanded) => data.length ? (
        <div className="mt-4" style={{ height: expanded ? "70vh" : height }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.34 0.045 155)" />
              <XAxis type="number" {...axis} allowDecimals={false} />
              <YAxis type="category" dataKey="name" width={sellerAxisWidth(data)} {...axis} />
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
      subtitle="Oportunidades abertas sem tarefas por vendedor no período."
      expandable={expandable}
      render={(expanded) => data.length ? (
        <div className="mt-4" style={{ height: expanded ? "70vh" : height }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.34 0.045 155)" />
              <XAxis type="number" {...axis} allowDecimals={false} />
              <YAxis type="category" dataKey="name" width={sellerAxisWidth(data)} {...axis} />
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

function SellerLineChart({
  title,
  subtitle = "Cada linha representa um vendedor por dia no período selecionado.",
  data,
  dataKey = "dia",
  series,
  currency = false,
  expandable = false,
}: {
  title: string;
  subtitle?: string;
  data: Record<string, string | number>[];
  dataKey?: string;
  series: string[];
  currency?: boolean;
  expandable?: boolean;
}) {
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(() => new Set());
  const toggleSeries = (name: string) => setHiddenSeries((current) => {
    const next = new Set(current);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    return next;
  });

  return (
    <ExpandableChartPanel title={title} subtitle={subtitle} expandable={expandable} render={(expanded) => (
      data.length && series.length ? (
        <div className="mt-4" style={{ height: expanded ? "70vh" : 320 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.34 0.045 155)" />
              <XAxis dataKey={dataKey} {...axis} minTickGap={8} />
              <YAxis {...axis} allowDecimals={!currency} tickFormatter={(value: number) => currency ? `$${Math.round(value / 1000)}k` : value.toLocaleString("pt-BR")} />
              <Tooltip
                contentStyle={tooltipStyle}
                itemSorter={(item) => -Number(item.value ?? 0)}
                formatter={(value: number) => currency ? brl(value) : value.toLocaleString("pt-BR")}
              />
              <Legend
                content={({ payload }) => (
                  <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 pt-2">
                    {payload?.map((entry) => {
                      const name = String(entry.value ?? "");
                      const hidden = hiddenSeries.has(name);
                      return (
                        <button
                          key={name}
                          type="button"
                          aria-label={`${hidden ? "Exibir" : "Ocultar"} ${name}`}
                          aria-pressed={!hidden}
                          className="inline-flex items-center gap-1.5 text-xs"
                          style={{ color: String(entry.color ?? "currentColor"), opacity: hidden ? 0.5 : 1 }}
                          onClick={() => toggleSeries(name)}
                        >
                          <span className="h-0.5 w-4 bg-current" />
                          <span className={hidden ? "line-through" : ""}>{name}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              />
              {series.map((name, index) => (
                <Line
                  key={name}
                  type="monotone"
                  dataKey={name}
                  name={name}
                  stroke={COLORS[index % COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                  hide={hiddenSeries.has(name)}
                />
              ))}
            </LineChart>
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

function sellerAxisWidth(data: Pick<SellerRow, "name">[], maxWidth = 120) {
  const longestName = data.reduce((length, row) => Math.max(length, row.name.length), 0);
  return Math.min(maxWidth, Math.max(52, Math.ceil(longestName * 6.5 + 12)));
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
          <BarChart data={data} layout="vertical" margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.34 0.045 155)" />
            <XAxis
              type="number"
              {...axis}
              tickFormatter={(value: number) => {
                if (a === "descontoPct") return pct(value);
                if (a === "ticket") return value >= 1000 ? `$${(value / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k` : `$${Math.round(value)}`;
                return `$${Math.round(value / 1000)}k`;
              }}
            />
            <YAxis type="category" dataKey="name" width={sellerAxisWidth(data, 90)} {...axis} />
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
function CommissionModule({ sellers, teamSold, teamGoal }: { sellers: { name: string; faturamento: number; revenueGoal: number }[]; teamSold: number; teamGoal: number }) {
  const teamAtt = teamGoal > 0 ? teamSold / teamGoal : 0;
  const hit = teamAtt >= 1;
  const pctBR = (v: number) => `${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  return (
    <Card className="overflow-hidden p-5">
      <h2 className="text-sm font-semibold text-foreground">Simulador / Extrato de Remuneração Variável (Comissão)</h2>
      <p className="text-xs text-muted-foreground">Calculado sobre o valor vendido individual no período selecionado.</p>
      <div className={`mt-4 rounded-md border p-4 ${hit ? "border-accent bg-accent/10" : "border-border bg-secondary/40"}`}>
        <p className="text-xs text-muted-foreground">Status da Meta Geral</p>
        <p className="text-base font-semibold text-foreground">
          {teamGoal > 0 ? `${brl(teamSold)} de ${brl(teamGoal)} (${(teamAtt * 100).toFixed(1)}%)` : "Meta geral não cadastrada"}
        </p>
        <p className="text-xs text-muted-foreground">
          {hit ? "Meta geral atingida — gatilho de 1,75% liberado para quem bateu 100% da meta individual." : `Faltam ${brl(Math.max(0, teamGoal - teamSold))} para liberar o gatilho de 1,75%.`}
        </p>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="text-xs uppercase text-muted-foreground">
            <tr>
              <th className="py-2 text-left">Atendente</th>
              <th className="py-2 text-right">Valor vendido</th>
              <th className="py-2 pl-4 text-left">Atingimento</th>
              <th className="py-2 text-left">Faixa atual</th>
              <th className="py-2 text-right">Comissão estimada</th>
              <th className="py-2 pl-4 text-left">Próximo nível</th>
            </tr>
          </thead>
          <tbody>
            {sellers.map((s) => {
              const c = commissionFor(s.faturamento, s.revenueGoal, teamAtt);
              return (
                <tr key={s.name} className="border-t border-border">
                  <td className="py-2 text-foreground">{s.name}</td>
                  <td className="py-2 text-right">{brl(s.faturamento)}</td>
                  <td className="py-2 pl-4">
                    {s.revenueGoal > 0 ? (
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-28 overflow-hidden rounded-full bg-secondary">
                          <div className="h-full bg-accent" style={{ width: `${Math.min(100, c.attainment * 100)}%` }} />
                        </div>
                        <span className="text-xs">{(c.attainment * 100).toFixed(1)}%</span>
                      </div>
                    ) : <span className="text-xs text-muted-foreground">Sem meta</span>}
                  </td>
                  <td className="py-2 text-xs">{c.label}</td>
                  <td className="py-2 text-right font-semibold text-accent">{brl(c.commission)}</td>
                  <td className="py-2 pl-4 text-xs text-muted-foreground">
                    {s.revenueGoal <= 0 ? "Cadastre a meta individual" : c.next
                      ? `Faltam ${brl(c.next.missing)} em vendas para atingir ${Math.round(c.next.pct * 100)}% e subir para ${pctBR(c.next.rate)}`
                      : hit ? "Nível máximo atingido" : "Falta a meta geral para liberar 1,75%"}
                  </td>
                </tr>
              );
            })}
            {!sellers.length ? <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">Nenhum atendente no período.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
