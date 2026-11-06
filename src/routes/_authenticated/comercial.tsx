import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
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
  CircleHelp,
  Calculator,
} from "lucide-react";
import { toast } from "sonner";

import { guardPage } from "@/lib/roles";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { SyncButton } from "@/components/dashboard/SyncButton";
import { InfoPopover, KpiCard } from "@/components/dashboard/KpiCard";
import { Card } from "@/components/ui/card";
import { PeriodoPicker } from "@/components/PeriodoPicker";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { brl, pct } from "@/lib/analytics";
import {
  computeComercial,
  computeOpportunityTotalsBySeller,
  filterOperationalData,
  fetchComercial,
  fetchActiveOpportunities,
  fetchLeadOrigins,
  filterNonAgencyData,
  keepNonAgencyOpps,
  saveGoals,
  sellerKey,
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
  publicView = false,
}: {
  title?: string;
  active?: "comercial" | "comercial-operacional";
  /** Acesso sem login: sem menu lateral nem botão de sincronização. */
  publicView?: boolean;
} = {}) {
  const now = new Date();
  const [from, setFrom] = useState(ymd(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [to, setTo] = useState(ymd(now));
  const [search, setSearch] = useState("");
  const [noTaskOpen, setNoTaskOpen] = useState(false);
  const [tab, setTab] = useState<"visao" | "metas">("visao");
  const showGoals = tab === "metas";
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "faturamento", dir: -1 });

  const { data, isLoading, error } = useQuery({
    queryKey: ["comercial", from, to],
    queryFn: () => fetchComercial(from, to),
  });
  const { data: activeOppsData } = useQuery({ queryKey: ["comercial", "active-opportunities"], queryFn: fetchActiveOpportunities });
  const operational = active === "comercial-operacional";
  // Aba Operacional: só oportunidades de origens que não são agência de viagem.
  const { data: leadOrigins } = useQuery({ queryKey: ["comercial", "lead-origins"], queryFn: fetchLeadOrigins, enabled: operational });
  const teamData = useMemo(() => {
    if (!data) return null;
    const base = filterOperationalData(data);
    return operational && leadOrigins ? filterNonAgencyData(base, leadOrigins) : base;
  }, [data, operational, leadOrigins]);
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
  // Cards de ocupação não consideram o filtro de período: sempre mês atual, seguinte e +2.
  const { data: occCards } = useQuery({ queryKey: ["occupancy", "cards"], queryFn: () => fetchOccupancy(), enabled: active === "comercial" || active === "comercial-operacional" });
  const k = view?.kpis;
  const cardGoals = revenueAndTicketGoals(teamData?.goals ?? [], from, to);
  const revenuePace = expectedRevenueByDate(teamData?.goals ?? [], from, to);
  const monthProgressPercent = monthProgress(to) * 100;
  const paceDelta = (k?.faturamento ?? 0) - revenuePace;
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
  const chartH = 308;
  const opportunityRows = (view?.rows ?? [])
    .filter((r) => r.key !== "sem_vendedor" && r.key !== "venda_direta" && (r.oportunidades > 0 || r.reservas > 0))
    .sort((a, b) => b.oportunidades - a.oportunidades);
  const activeOpps = activeOppsData ?? [];
  const chartActiveOpps = operational && leadOrigins ? keepNonAgencyOpps(activeOpps, leadOrigins) : activeOpps;
  const noTaskMap = new Map<string, { name: string; noTask: number }>();
  activeOpps.filter((o) => o.total_tasks === 0 && o.seller_name?.trim()).forEach((o) => {
    const k = sellerKey(o.seller_name);
    const row = noTaskMap.get(k) ?? { name: o.seller_name!.trim(), noTask: 0 };
    row.noTask++;
    noTaskMap.set(k, row);
  });
  const noTaskList = activeOpps
    .filter((o) => o.total_tasks === 0 && o.seller_name?.trim())
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((o) => ({ ...o, owner: o.seller_name!.trim() }));
  const noTaskRows = [...noTaskMap.values()].sort((a, b) => b.noTask - a.noTask);
  // Sem vendedor = oportunidades sem nenhum responsável atribuído (campo vazio), de todos os períodos.
  const noSellerOpportunities = chartActiveOpps
    .filter((o) => !o.seller_name?.trim())
    .sort((x, y) => y.created_at.localeCompare(x.created_at));
  const allTimeOpportunityRows: { name: string; oportunidades: number; reservas: number; key: string; selectKey?: string }[] = [
    ...computeOpportunityTotalsBySeller(chartActiveOpps.filter((o) => o.seller_name?.trim())),
    ...(noSellerOpportunities.length
      ? [{ key: "__none", name: "Sem vendedor", oportunidades: noSellerOpportunities.length, reservas: 0, selectKey: "__none" }]
      : []),
  ].sort((x, y) => y.oportunidades - x.oportunidades);
  const [noSellerOpen, setNoSellerOpen] = useState(false);
  const operationalCardClass = "min-h-[190px] h-full w-full flex flex-col justify-between";
  const compactOperationalCardClass = "h-[200px] w-full px-3 py-2 flex flex-col justify-between";
  const occupancyCardClass = "h-[160px] w-full px-3 py-2 flex flex-col justify-between";
  const firstRowOperationalCardClass = "h-[160px] w-full p-3 flex flex-col justify-start";
  const operationalSellerChartHeight = chartH;

  const opportunityCard = <KpiCard icon={Target} label="Oportunidades"
    help={"Oportunidades criadas no ClickMassa no período.\nA média por dia divide o total pelos dias do período."}
    calc={k ? `${k.oportunidades.toLocaleString("pt-BR")} oportunidades ÷ ${selectedPeriodDays} dias = ${(k.oportunidades / selectedPeriodDays).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} por dia` : undefined}
    value={k ? k.oportunidades.toLocaleString("pt-BR") : "—"}
    hint={k ? comparison(k.oportunidadesVar) : undefined}
    footer={k ? `Média de ${(k.oportunidades / selectedPeriodDays).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} por dia` : undefined}
    compact tight
    className={firstRowOperationalCardClass} />;
  const noTaskCard = <Button variant="ghost" className="block h-[160px] w-full whitespace-normal p-0 text-left hover:bg-transparent [&>div]:h-full" onClick={() => setNoTaskOpen(true)}>
    <KpiCard icon={ClipboardX} label="Oportunidades sem tarefas"
    help={"Oportunidades ativas na base que não têm nenhuma tarefa cadastrada.\nNão usa filtro de datas."}
    calc={activeOppsData ? `${noTaskList.length.toLocaleString("pt-BR")} de ${activeOpps.length.toLocaleString("pt-BR")} oportunidades ativas estão sem tarefa` : undefined}
      value={activeOppsData ? noTaskList.length.toLocaleString("pt-BR") : "—"}
      highlight
      footer="Leads ativos na base, sem filtro de datas"
      compact tight
        className={firstRowOperationalCardClass} />
  </Button>;
  const revenueCard = <KpiCard icon={DollarSign} label="Faturamento"
    help={"Soma do rack rate das reservas do período.\nO ritmo compara o que já foi faturado com o esperado para o ponto do mês em que estamos."}
    calc={k ? `${brl(k.faturamento)} faturados no período${cardGoals.revenue > 0 ? ` ÷ meta ${brl(cardGoals.revenue)} = ${((k.faturamento / cardGoals.revenue) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% da meta` : ""}` : undefined}
    value={k ? brl(k.faturamento) : "—"}
    hint={k ? comparison(k.faturamentoVar) : undefined}
    goal={{ actual: k?.faturamento ?? 0, target: cardGoals.revenue, label: brl(cardGoals.revenue) }}
    pace={{ expected: brl(revenuePace), actual: brl(k?.faturamento ?? 0), monthPercent: monthProgressPercent, delta: { label: `${paceDelta >= 0 ? "+" : "−"}${brl(Math.abs(paceDelta))} ${paceDelta >= 0 ? "acima" : "abaixo"}`, positive: paceDelta >= 0 } }}
    compact aligned className={compactOperationalCardClass} />;
  const ticketCard = <KpiCard icon={DollarSign} label="Ticket médio"
    help={"Valor médio por reserva.\nFaturamento ÷ número de reservas do período."}
    calc={k ? `${brl(k.faturamento)} de faturamento ÷ ${k.reservas.toLocaleString("pt-BR")} reservas = ${brl(k.ticket)}` : undefined}
    value={k ? brl(k.ticket) : "—"}
    hint={k ? comparison(k.ticketVar) : undefined}
    goal={{ actual: k?.ticket ?? 0, target: cardGoals.ticket, label: brl(cardGoals.ticket) }}
    footer={k && cardGoals.ticket > 0 ? `${ticketGoalDelta >= 0 ? "+" : ""}${brl(ticketGoalDelta)} da meta` : undefined}
    compact aligned className={compactOperationalCardClass} />;
  const discountCard = <KpiCard icon={Percent} label="Desconto médio"
    help={"Percentual médio de desconto concedido.\nDesconto ÷ (valor cobrado + desconto) nas reservas do período. Quanto menor, melhor."}
    calc={k ? `Desconto médio de ${pct(k.descontoPct)} em ${k.reservas.toLocaleString("pt-BR")} reservas${cardGoals.discount > 0 ? `, limite ${pct(cardGoals.discount)}` : ""}` : undefined}
    value={k ? pct(k.descontoPct) : "—"}
    hint={k ? k.descontoYearDiff === null ? "Sem base de comparação vs. ano anterior" : `${k.descontoYearDiff >= 0 ? "+" : ""}${k.descontoYearDiff.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} p.p. vs. ano anterior` : undefined}
    goal={{ actual: k?.descontoPct ?? 0, target: cardGoals.discount, label: pct(cardGoals.discount), kind: "limit" }}
    footer={k && cardGoals.discount > 0 ? `${discountLimitDeltaPp >= 0 ? "+" : ""}${discountLimitDeltaPp.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} p.p. do limite` : undefined}
    compact aligned className={compactOperationalCardClass} />;
  const conversionCard = <KpiCard icon={UserCheck} label="Taxa de conversão"
    help={"Percentual de oportunidades que viraram reserva.\nReservas ÷ oportunidades criadas no período."}
    calc={k ? `${k.reservas.toLocaleString("pt-BR")} reservas ÷ ${k.oportunidades.toLocaleString("pt-BR")} oportunidades = ${pct(k.conversao)}` : undefined}
    value={k ? pct(k.conversao) : "—"}
    hint={k ? comparison(k.conversaoVar) : undefined} highlight
    goal={{ actual: k?.conversao ?? 0, target: cardGoals.conversion, label: pct(cardGoals.conversion) }}
    compact tight
    className={firstRowOperationalCardClass} />;
  const occupancyCards = active === "comercial" || active === "comercial-operacional" ? ["Ocupação do mês atual", "Ocupação do mês seguinte", "Ocupação do mês +2"].map((label, index) => {
    const occupancyMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + index, 1)).toISOString().slice(0, 7);
    const monthName = new Date(`${occupancyMonth}-01T00:00:00Z`).toLocaleDateString("pt-BR", { month: "long", timeZone: "UTC" }).replace(/^./, (c) => c.toUpperCase());
    const month = occCards?.months.find((item) => item.month === occupancyMonth);
    const previousMonthKey = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + index - 1, 1)).toISOString().slice(0, 7);
    const previousMonth = occCards?.months.find((item) => item.month === previousMonthKey);
    const occupancyRate = month?.rate;
    const occupancyVariation = occupancyMonthVariation(month, previousMonth);
    const occupancyTarget = data?.goals.find((g) => g.seller_name === OCCUPANCY_GOAL && g.month === occupancyMonth)?.discount_goal;
    return <KpiCard key={label} icon={CarFront} label={`${label} (${monthName})`} value={occupancyRate === undefined ? "—" : pct(occupancyRate)}
      hint={occupancyVariation === undefined ? undefined : comparison(occupancyVariation)}
      highlight={index === 0} compact aligned
      help={"Percentual de ocupação da frota prevista para o mês, comparado com o mês anterior.\nA meta vem da aba Metas."}
      calc={occupancyRate === undefined ? undefined : `Ocupação de ${occupancyMonth.split("-").reverse().join("/")}: ${pct(occupancyRate)}${occupancyTarget ? ` (meta ${pct(occupancyTarget)})` : ""}`}
      goal={{ actual: occupancyRate ?? 0, target: occupancyTarget, label: pct(occupancyTarget ?? 0) }} className={occupancyCardClass} />;
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

  const Th = ({ k: key, label, left }: { k: SortKey; label: string; left?: boolean }) => (
    <th className={`px-4 py-3 font-medium ${left ? "text-left" : "text-right"}`}>
      <button
        className="inline-flex items-center gap-1 hover:text-foreground"
        onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((s.dir * -1) as 1 | -1) : -1 }))}
      >
        {label}
        <ArrowUpDown className={`size-3 ${sort.key === key ? "text-accent" : ""}`} />
      </button>
      {COLUMN_HELP[label] ? <span className="ml-1 inline-flex align-middle"><InfoPopover icon={CircleHelp} ariaLabel={`O que é ${label}`} text={COLUMN_HELP[label]} /></span> : null}
    </th>
  );

  return (
    <div className="flex min-h-screen flex-col bg-background lg:flex-row">
      {publicView ? null : <Sidebar active={active} />}
      <main className="min-w-0 flex-1 overflow-x-hidden">
        <header
          className="flex flex-wrap items-end justify-between gap-4 border-b border-border px-4 py-4 sm:px-6 sm:py-5"
          style={{ background: "var(--gradient-brand)" }}
        >
          <div>
            <h1 className="text-xl font-semibold text-foreground">{title}</h1>
            <p className="text-sm text-foreground/70">Equipe de vendas — ClickMassa + HQ Rentals</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            {publicView ? (
              <Button asChild variant="outline" size="sm" className="h-9">
                <Link to="/app">Voltar aos Módulos</Link>
              </Button>
            ) : (
              <SyncButton />
            )}
            <div className="text-xs text-foreground/70">
              Período
              <PeriodoPicker inicio={from} fim={to} className="mt-1 h-9 w-56 bg-card" onChange={(i, f) => { if (i && f) { setFrom(i); setTo(f); } }} />
            </div>
          </div>
        </header>

        <div className="space-y-6 p-4 sm:p-6">
          {(
            <div className="flex gap-2 border-b border-border pb-2">
              <Button size="sm" variant={tab === "visao" ? "default" : "outline"} onClick={() => setTab("visao")}>Visão geral</Button>
              <Button size="sm" variant={tab === "metas" ? "default" : "outline"} onClick={() => setTab("metas")}>
                <Target className="mr-1 size-4" /> Metas
              </Button>
            </div>
          )}
          {error ? (
            <Card className="border-destructive/40 p-4 text-sm text-destructive">
              Não foi possível carregar os dados comerciais agora.
              {error instanceof Error ? <p className="mt-1 break-words text-xs">{error.message}</p> : null}
            </Card>
          ) : null}

          {showGoals ? (
            view ? (
              active === "comercial" ? (
                <GoalsPanel sellers={view.sellers} month={view.goalMonth} goals={teamData?.goals ?? []} />
              ) : (
                <GoalsReadOnly sellers={view.sellers} month={view.goalMonth} goals={teamData?.goals ?? []} />
              )
            ) : (
              <Card className="p-4 text-sm text-muted-foreground">Carregando metas…</Card>
            )
          ) : (<>
          <section className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div className="space-y-4">
                {revenueCard}
                <GoalChart title="Receita provisionada" subtitle="Alcançado vs. meta" data={goalRows} h={chartH} a="faturamento" b="revenueGoal" fmt={brl} expandable showAttainment />
                {active === "comercial-operacional" ? occupancyCards?.[0] : null}
              </div>
              <div className="space-y-4">
                {ticketCard}
                <GoalChart title="Ticket médio" subtitle="Alcançado vs. meta" data={goalRows} h={chartH} a="ticket" b="ticketGoal" fmt={brl} expandable deltaMode="higher" />
                {active === "comercial-operacional" ? occupancyCards?.[1] : null}
              </div>
              <div className="space-y-4">
                {discountCard}
                <GoalChart title="Desconto médio (%)" subtitle="Alcançado vs. limite" data={goalRows} h={chartH} a="descontoPct" b="discountGoal" bLabel="Limite" fmt={pct} expandable deltaMode="lower" />
                {active === "comercial-operacional" ? occupancyCards?.[2] : null}
              </div>
              {active === "comercial" ? occupancyCards : null}
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
                <OpportunitySellerChart data={allTimeOpportunityRows} height={operationalSellerChartHeight} loading={isLoading && !error} expandable onSelect={(key) => { if (key === "__none") setNoSellerOpen(true); }} />
              </div>
          </section>

          {active === "comercial" ? (
            <>
              <SellerLineChart
                title="Oportunidades por vendedor por dia"
                data={view?.dailyOpportunitiesBySeller ?? []}
                series={view?.dailyOpportunityKeys ?? []}
                expandable
              />
              <SellerLineChart
                title="Valor fechado por vendedor por dia"
                subtitle="Cada linha representa um vendedor por dia no período selecionado, pela data de criação da reserva."
                data={view?.dailyRevenueBySeller ?? []}
                series={view?.dailyRevenueKeys ?? []}
                currency
                expandable
              />
            </>
          ) : null}

          {active === "comercial" ? (
            <section className="grid gap-4 xl:grid-cols-2">
              <MonthlyBarChart title="Taxa de ocupação mensal" data={occupancyComparisons} dataKey="rate" valueName="Ocupação" formatter={pct} comparisonKey="yearAgoRate" />
              <MonthlyBarChart title="Taxa de conversão mensal" data={monthlyKpis} dataKey="conversao" valueName="Conversão" formatter={pct} comparisonKey="yearAgoConversion" />
              <MonthlyBarChart title="Faturamento mensal" data={monthlyKpis} dataKey="faturamento" valueName="Faturamento" formatter={brl} currencyAxis comparisonKey="yearAgoRevenue" />
              <MonthlyBarChart title="Reservas mensais" data={monthlyKpis} dataKey="reservas" valueName="Reservas" formatter={(value) => value.toLocaleString("pt-BR")} integerAxis comparisonKey="yearAgoReservations" />
              <MonthlyBarChart title="Ticket médio mensal" data={monthlyKpis} dataKey="ticket" valueName="Ticket médio" formatter={brl} currencyAxis comparisonKey="yearAgoTicket" />
              <MonthlyBarChart title="Desconto médio mensal" data={monthlyKpis} dataKey="descontoPct" valueName="Desconto médio" formatter={pct} percentageAxis comparisonKey="yearAgoDiscount" />
            </section>
          ) : null}

          {view?.revenueBreakdown ? (
            <Card className="p-5">
              <RevenueBreakdownChart data={view.revenueBreakdown} />
            </Card>
          ) : null}

          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
              <div>
                <div className="flex items-center gap-1.5">
                  <h2 className="text-sm font-semibold text-foreground">Detalhamento por vendedor</h2>
                  <InfoPopover icon={CircleHelp} ariaLabel="O que é o detalhamento por vendedor" text={"Resumo de tarefas, reservas e valor fechado de cada vendedor no período.\nCada coluna tem o seu próprio \"?\". Clique no título da coluna para ordenar."} />
                </div>
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
          </>)}
        </div>
      </main>
      <Dialog open={noSellerOpen} onOpenChange={setNoSellerOpen}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Oportunidades sem vendedor ({noSellerOpportunities.length.toLocaleString("pt-BR")})</DialogTitle>
          </DialogHeader>
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-2 text-left">Criado em</th>
                <th className="py-2 text-left">Contato</th>
                <th className="py-2 text-left">Etapa</th>
              </tr>
            </thead>
            <tbody>
              {noSellerOpportunities.slice(0, 500).map((o, i) => (
                <tr key={o.opportunity_id + i} className="border-t border-border">
                  <td className="py-2">{new Date(o.created_at).toLocaleDateString("pt-BR")}</td>
                  <td className="py-2 text-foreground">{o.name ?? "—"}</td>
                  <td className="py-2">{o.stage_name ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {noSellerOpportunities.length > 500 ? <p className="text-xs text-muted-foreground">Mostrando as 500 mais recentes.</p> : null}
        </DialogContent>
      </Dialog>
      <Dialog open={noTaskOpen} onOpenChange={setNoTaskOpen}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Oportunidades sem tarefa ({noTaskList.length})</DialogTitle>
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
              {noTaskList.slice(0, 500).map((l, i) => (
                <tr key={(l.lead_id ?? "") + i} className="border-t border-border">
                  <td className="py-2">{new Date(l.created_at).toLocaleDateString("pt-BR")}</td>
                  <td className="py-2 text-foreground">{l.name ?? "—"}</td>
                  <td className="py-2">{l.stage_name ?? "—"}</td>
                  <td className="py-2">{l.owner}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(noTaskList.length) > 500 ? <p className="text-xs text-muted-foreground">Mostrando os 500 mais recentes.</p> : null}
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
      <div className="mt-4 w-full" style={{ height: expanded ? "70vh" : 284, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 24, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey={dataKey === "rate" ? "label" : "mes"} interval={0} minTickGap={8} {...axis} />
            <YAxis
              {...axis}
              allowDecimals={!integerAxis}
              tickFormatter={(value: number) => currencyAxis && dataKey === "faturamento" ? `$${Math.round(value / 1000)}k` : currencyAxis ? `$${Math.round(value).toLocaleString("pt-BR")}` : percentageAxis || dataKey === "rate" || dataKey === "conversao" ? `${Math.round(value * 100)}%` : value.toLocaleString("pt-BR")}
            />
              <Tooltip contentStyle={tooltipStyle} formatter={(value: number, name: string) => [formatter(value), name]} />
              {comparisonKey ? <Legend /> : null}
              {comparisonKey ? <Bar dataKey={comparisonKey} name={comparisonName} fill="#2f9c5a" radius={[4, 4, 0, 0]} /> : null}
              <Bar dataKey={dataKey} name={valueName} fill="#44E500" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      )}
    />
  );
}

/** Rótulo ao lado da barra, com a mesma fonte e cor do gráfico de Receita provisionada. */
const barSideLabel = (texts: string[]) => (props: { x?: number | string | undefined; y?: number | string | undefined; width?: number | string | undefined; height?: number | string | undefined; index?: number | undefined }) => {
  const text = texts[props.index ?? -1];
  if (!text) return null;
  return (
    <text
      x={Number(props.x) + Number(props.width) + 6}
      y={Number(props.y) + Number(props.height) / 2}
      dominantBaseline="central"
      fontSize={11}
      fontWeight={600}
      fill="currentColor"
      className="text-foreground"
    >
      {text}
    </text>
  );
};

function OpportunitySellerChart({
  data,
  height,
  loading,
  compare = false,
  expandable = true,
  onSelect,
}: {
  data: (Pick<SellerRow, "name" | "oportunidades" | "reservas"> & { selectKey?: string })[];
  /** Clique numa barra abre o detalhamento (nome do vendedor, "__all" ou "__none"). */
  onSelect?: ((key: string) => void) | undefined;
  height: number;
  loading: boolean;
  compare?: boolean;
  expandable?: boolean;
}) {
  const totalOpps = data.reduce((sum, row) => sum + row.oportunidades, 0);
  const chartData = data.map((row) => ({
    ...row,
    sharePct: totalOpps ? pct(row.oportunidades / totalOpps) : "—",
    reservasPct: row.oportunidades && row.selectKey !== "__none" ? pct(row.reservas / row.oportunidades) : "—",
  }));
  return (
    <ExpandableChartPanel
      title={compare ? "Oportunidades vs. reservas por vendedor" : "Oportunidades por vendedor"}
      subtitle={compare ? "Oportunidades e conversão em reservas por vendedor." : "Leads ativos na base (sem ganhos e perdidos), sem filtro de datas."}
      expandable={expandable}
      render={(expanded) => data.length ? (
        <div className="mt-4 w-full" style={{ height: expanded ? "70vh" : height, minHeight: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ top: 10, right: 56, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.34 0.045 155)" />
              <XAxis type="number" {...axis} allowDecimals={false} />
              <YAxis type="category" dataKey="name" width={sellerAxisWidth(data)} tickFormatter={axisName} {...axis} />
              <Tooltip
                contentStyle={tooltipStyle}
                content={({ active, payload }) => {
                  const row = active ? payload?.[0]?.payload as (typeof chartData)[number] | undefined : undefined;
                  if (!row) return null;
                  return (
                    <div style={tooltipStyle} className="px-3 py-2 text-sm">
                      <div className="font-medium">{row.name}</div>
                      <div>Oportunidades: {row.oportunidades.toLocaleString("pt-BR")}</div>
                      <div>% do total de oportunidades: {row.sharePct}</div>
                      {compare ? <div>Reservas concluídas: {row.reservas.toLocaleString("pt-BR")}</div> : null}
                      {compare ? <div>Taxa de conversão: {row.reservasPct}</div> : null}
                    </div>
                  );
                }}
              />
              <Bar
                dataKey="oportunidades"
                name="Oportunidades"
                fill={compare ? "#44E500" : "#2f9c5a"}
                radius={[0, 4, 4, 0]}
                {...(onSelect ? { cursor: "pointer", onClick: (entry: { payload?: { name: string; selectKey?: string } }) => entry.payload && onSelect(entry.payload.selectKey ?? entry.payload.name) } : {})}
              >
                <LabelList dataKey="sharePct" content={barSideLabel(chartData.map((r) => r.sharePct))} />
              </Bar>
              {compare ? (
                <Bar dataKey="reservas" name="Reservas concluídas" fill="#2f9c5a" radius={[0, 4, 4, 0]}
                  {...(onSelect ? { cursor: "pointer", onClick: (entry: { payload?: { name: string; selectKey?: string } }) => entry.payload && onSelect(entry.payload.selectKey ?? entry.payload.name) } : {})}>
                  <LabelList dataKey="reservasPct" content={barSideLabel(chartData.map((r) => r.reservasPct))} />
                </Bar>
              ) : null}
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="mt-4 flex items-center justify-center text-sm text-muted-foreground" style={{ height: expanded ? "70vh" : 248 }}>
          {loading ? "Carregando..." : "Nenhuma oportunidade no período."}
        </div>
      )}
    />
  );
}

function NoTaskBySellerChart({
  data,
  height,
  expandable = true,
}: {
  data: Pick<SellerRow, "name" | "noTask">[];
  height: number;
  expandable?: boolean;
}) {
  const total = data.reduce((sum, row) => sum + row.noTask, 0);
  const chartData = data.map((row) => ({
    ...row,
    sharePct: total ? pct(row.noTask / total) : "—",
  }));
  return (
    <ExpandableChartPanel
      title="Oportunidades sem tarefas por vendedor"
      subtitle="Leads ativos na base (sem ganhos e perdidos), sem filtro de datas."
      expandable={expandable}
      render={(expanded) => data.length ? (
        <div className="mt-4 w-full" style={{ height: expanded ? "70vh" : height, minHeight: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ top: 10, right: 56, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.34 0.045 155)" />
              <XAxis type="number" {...axis} allowDecimals={false} />
              <YAxis type="category" dataKey="name" width={sellerAxisWidth(data)} tickFormatter={axisName} {...axis} />
              <Tooltip
                contentStyle={tooltipStyle}
                content={({ active, payload }) => {
                  const row = active ? payload?.[0]?.payload as (typeof chartData)[number] | undefined : undefined;
                  if (!row) return null;
                  return (
                    <div style={tooltipStyle} className="px-3 py-2 text-sm">
                      <div className="font-medium">{row.name}</div>
                      <div>Sem tarefas: {row.noTask.toLocaleString("pt-BR")}</div>
                      <div>% do total sem tarefas: {row.sharePct}</div>
                    </div>
                  );
                }}
              />
              <Bar dataKey="noTask" name="Sem tarefas" fill="#44E500" radius={[0, 4, 4, 0]}>
                <LabelList dataKey="sharePct" content={barSideLabel(chartData.map((r) => r.sharePct))} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="mt-4 flex items-center justify-center text-sm text-muted-foreground" style={{ height: expanded ? "70vh" : 248 }}>
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
  expandable = true,
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
        <div className="mt-4 w-full" style={{ height: expanded ? "70vh" : 348, minHeight: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 24, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.34 0.045 155)" />
              <XAxis dataKey={dataKey} {...axis} minTickGap={8} />
              <YAxis {...axis} allowDecimals={!currency} tickFormatter={(value: number) => currency ? `$${Math.round(value / 1000)}k` : value.toLocaleString("pt-BR")} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const fmt = (value: number) => currency ? brl(value) : value.toLocaleString("pt-BR");
                  const items = [...payload].sort((a, b) => Number(b.value ?? 0) - Number(a.value ?? 0));
                  const total = items.reduce((sum, item) => sum + Number(item.value ?? 0), 0);
                  return (
                    <div style={tooltipStyle} className="px-3 py-2 text-sm">
                      <p className="mb-1 font-semibold text-foreground">{label}</p>
                      {items.map((item) => (
                        <p key={String(item.dataKey)} style={{ color: item.color }}>{item.name} : {fmt(Number(item.value ?? 0))}</p>
                      ))}
                      <p className="mt-1 border-t border-border pt-1 font-semibold text-foreground">Total : {fmt(total)}</p>
                    </div>
                  );
                }}
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

const CHART_HELP: Record<string, string> = {
  "Receita provisionada": "Faturamento (rack rate) de cada vendedor no período comparado com a meta individual.\nO % ao lado da barra é alcançado ÷ meta.",
  "Ticket médio": "Ticket médio de cada vendedor (faturamento ÷ reservas) contra a meta.\nO valor ao lado da barra é a diferença para a meta: verde se bateu, amarelo entre 50% e 99%, vermelho abaixo de 50%.",
  "Desconto médio (%)": "Desconto médio de cada vendedor contra o limite.\nO valor ao lado da barra é a diferença para o limite: verde se igual ou abaixo, vermelho se acima.",
  "Oportunidades por vendedor por dia": "Quantas oportunidades cada vendedor recebeu por dia no período, pela data de criação.\nClique na legenda para ocultar um vendedor.",
  "Valor fechado por vendedor por dia": "Valor das reservas fechadas por cada vendedor por dia, pela data de criação da reserva.\nClique na legenda para ocultar um vendedor.",
  "Taxa de ocupação mensal": "Ocupação da frota em cada mês do período, comparada com o mesmo mês do ano anterior.",
  "Taxa de conversão mensal": "Reservas ÷ oportunidades de cada mês, comparada com o mesmo mês do ano anterior.",
  "Faturamento mensal": "Faturamento (rack rate) de cada mês, comparado com o mesmo mês do ano anterior.",
  "Reservas mensais": "Número de reservas criadas em cada mês, comparado com o mesmo mês do ano anterior.",
  "Ticket médio mensal": "Faturamento ÷ reservas de cada mês, comparado com o mesmo mês do ano anterior.",
  "Desconto médio mensal": "Desconto ÷ (valor cobrado + desconto) de cada mês, comparado com o mesmo mês do ano anterior. Quanto menor, melhor.",
  "Oportunidades por vendedor": "Oportunidades ativas na base por vendedor (sem ganhas e perdidas), sem filtro de datas.",
  "Oportunidades vs. reservas por vendedor": "Oportunidades de cada vendedor e quantas viraram reserva no período.",
  "Oportunidades sem tarefas por vendedor": "Oportunidades ativas sem nenhuma tarefa cadastrada, por vendedor, sem filtro de datas.",
  "Faturamento mensal por componente (Time Comercial)": "Faturamento dos últimos 13 meses separado em Rack Rate, Taxas Diversas e Cobranças Adicionais.",
};

const COLUMN_HELP: Record<string, string> = {
  Vendedor: "Responsável pela oportunidade ou reserva.",
  Oportunidades: "Oportunidades criadas no período para o vendedor.",
  "Tarefas totais": "Total de tarefas das oportunidades do vendedor.",
  Atrasadas: "Tarefas com prazo vencido e ainda não concluídas.",
  Concluídas: "Tarefas já concluídas.",
  "Sem tarefa": "Oportunidades ativas do vendedor sem nenhuma tarefa.",
  Reservas: "Reservas criadas no período.",
  Conversão: "Reservas ÷ oportunidades.",
  "Ticket médio": "Valor fechado ÷ reservas.",
  "Valor fechado": "Soma do rack rate das reservas do período.",
};

function ExpandableChartPanel({
  title,
  subtitle,
  expandable = true,
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
        <div className="min-h-7">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            {CHART_HELP[title] ? <InfoPopover icon={CircleHelp} ariaLabel={`O que é ${title}`} text={CHART_HELP[title]} /> : null}
          </div>
        </div>
        {expandable ? (
          <Button variant="ghost" size="icon" className="size-7" aria-label={`Expandir gráfico: ${title}`} title="Expandir gráfico" onClick={() => setOpen(true)}>
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

/** Nome curto para o eixo: só o primeiro nome quando o nome é longo (o tooltip mostra o nome completo). */
const axisName = (name: string) => (name.length > 12 ? (name.split(" ")[0] ?? name) : name);

function sellerAxisWidth(data: Pick<SellerRow, "name">[], maxWidth = 130) {
  const longestName = data.reduce((length, row) => Math.max(length, axisName(row.name).length), 0);
  return Math.min(maxWidth, Math.max(52, Math.ceil(longestName * 6.5 + 14)));
}

function GoalChart({
  title,
  subtitle,
  data,
  h,
  a,
  b,
  bLabel = "Meta",
  fmt,
  expandable = true,
  showAttainment = false,
  deltaMode,
}: {
  title: string;
  subtitle: string;
  data: SellerRow[];
  h: number;
  a: keyof SellerRow;
  b?: keyof SellerRow;
  bLabel?: string;
  fmt: (v: number) => string;
  expandable?: boolean;
  /** Mostra, ao lado da barra de cada vendedor, o % de atingimento (alcançado ÷ meta). */
  showAttainment?: boolean;
  /** Mostra a diferença (alcançado − meta) ao lado da barra, colorida: "higher" = maior é melhor; "lower" = menor é melhor. */
  deltaMode?: "higher" | "lower";
}) {
  const showLabel = showAttainment || !!deltaMode;
  return (
    <ExpandableChartPanel title={title} subtitle={subtitle} expandable={expandable} render={(expanded) => (
      <div className="mt-4 w-full" style={{ height: expanded ? "70vh" : h, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 10, right: deltaMode ? 76 : showAttainment ? 56 : 24, left: 0, bottom: 8 }}>
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
            <YAxis type="category" dataKey="name" width={sellerAxisWidth(data)} tickFormatter={axisName} {...axis} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => fmt(v)} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey={a} name="Alcançado" fill="#44E500" radius={[0, 4, 4, 0]}>
              {showLabel && b ? (
                <LabelList
                  dataKey={a}
                  content={(props) => {
                    const row = data[props.index ?? -1];
                    const goal = row ? Number(row[b]) : 0;
                    if (!row || !(goal > 0)) return null;
                    const value = (Number(row[a]) / goal) * 100;
                    let text = `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
                    let color: string | undefined;
                    if (deltaMode) {
                      const delta = Number(row[a]) - goal;
                      text = `${delta > 0 ? "+" : ""}${fmt(delta)}`;
                      if (deltaMode === "higher") color = value >= 100 ? "#44E500" : value < 50 ? "#ef4444" : "#facc15";
                      else color = delta <= 0 ? "#44E500" : "#ef4444";
                    }
                    return (
                      <text
                        x={Number(props.x) + Number(props.width) + 6}
                        y={Number(props.y) + Number(props.height) / 2}
                        dominantBaseline="central"
                        fontSize={11}
                        fontWeight={600}
                        fill={color ?? "currentColor"}
                        className={color ? undefined : "text-foreground"}
                      >
                        {text}
                      </text>
                    );
                  }}
                />
              ) : null}
            </Bar>
            {b ? <Bar dataKey={b} name={bLabel} fill="#2f9c5a" radius={[0, 4, 4, 0]} /> : null}
          </BarChart>
        </ResponsiveContainer>
      </div>
    )} />
  );
}

// Visualização somente leitura das metas cadastradas na aba Gerencial.
function GoalsReadOnly({ sellers, month, goals }: { sellers: SellerRow[]; month: string; goals: Goal[] }) {
  const [m, setM] = useState(month);
  useEffect(() => setM(month), [month]);
  const pctOrDash = (v: number | null | undefined) => (v == null || v === 0 ? "—" : pct(v));
  const moneyOrDash = (v: number | null | undefined) => (v ? brl(v) : "—");
  const general = goals.find((g) => g.seller_name === GLOBAL_GOAL && g.month === m);
  const occCurrent = goals.find((g) => g.seller_name === OCCUPANCY_GOAL && g.month === m);
  const occNext = goals.find((g) => g.seller_name === OCCUPANCY_GOAL && g.month === nextGoalMonth(m));
  const items = [
    { label: "Faturamento geral", value: moneyOrDash(general?.revenue_goal) },
    { label: "Ticket médio geral", value: moneyOrDash(general?.ticket_goal) },
    { label: "Conversão geral", value: pctOrDash(general?.conversion_goal) },
    { label: "Desconto geral", value: pctOrDash(general?.discount_goal) },
    { label: "Ocupação — mês de referência", value: pctOrDash(occCurrent?.discount_goal) },
    { label: "Ocupação — mês seguinte", value: pctOrDash(occNext?.discount_goal) },
  ];
  return (
    <Card className="w-full space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Metas</h2>
          <p className="text-xs text-muted-foreground">Somente visualização — definidas na aba Gerencial.</p>
        </div>
        <label className="w-full text-xs text-muted-foreground sm:w-56">
          Mês de referência
          <Input type="month" value={m} onChange={(e) => e.target.value && setM(e.target.value)} className="mt-1" />
        </label>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((i) => (
          <div key={i.label} className="rounded-lg border border-border/50 bg-card/40 p-3">
            <p className="text-xs text-muted-foreground">{i.label}</p>
            <p className="mt-1 text-lg font-semibold">{i.value}</p>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="px-2 py-2 text-left font-medium">Vendedor</th>
              <th className="px-2 py-2 text-center font-medium">Receita (US$)</th>
              <th className="px-2 py-2 text-center font-medium">Ticket (US$)</th>
              <th className="px-2 py-2 text-center font-medium">Desconto (%)</th>
              <th className="px-2 py-2 text-center font-medium">Conversão (%)</th>
            </tr>
          </thead>
          <tbody>
            {sellers.map((s) => {
              const g = goals.find((x) => x.month === m && x.seller_name === s.name);
              return (
                <tr key={s.key} className="border-b border-border/50">
                  <td className="px-2 py-2 font-medium">{s.name}</td>
                  <td className="px-2 py-2 text-center">{moneyOrDash(g?.revenue_goal)}</td>
                  <td className="px-2 py-2 text-center">{moneyOrDash(g?.ticket_goal)}</td>
                  <td className="px-2 py-2 text-center">{pctOrDash(g?.discount_goal)}</td>
                  <td className="px-2 py-2 text-center">{pctOrDash(g?.conversion_goal)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function GoalsPanel({
  sellers,
  month,
  goals,
}: {
  sellers: SellerRow[];
  month: string;
  goals: Goal[];
}) {
  const qc = useQueryClient();
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
    },
    onError: (e) => toast.error((e as Error).message),
  });

  useEffect(() => {
    setM(month);
  }, [month]);
  useEffect(() => {
    load(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m, goals, sellers]);

  return (
    <Card className="w-full p-4 sm:p-6">
      <h2 className="mb-3 text-base font-semibold">Definição de Metas</h2>
      <div>
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
        <div className="mb-4 w-full sm:w-56">
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
            <div className="grid grid-cols-2 sm:grid-cols-[minmax(8rem,1.5fr)_repeat(4,minmax(5rem,1fr))] gap-2 text-xs font-medium text-muted-foreground px-[calc(0.5rem+1px)]">
              <span>Vendedor</span>
              <span className="text-center">Receita (US$)</span>
              <span className="text-center">Ticket (US$)</span>
              <span className="text-center">Desconto (%)</span>
              <span className="text-center">Conversão (%)</span>
            </div>
            {sellers.map((s: SellerRow) => (
              <div key={s.key} className="grid grid-cols-2 sm:grid-cols-[minmax(8rem,1.5fr)_repeat(4,minmax(5rem,1fr))] gap-2 items-center bg-card/40 p-2 rounded-lg border border-border/50">
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
          <div className="grid grid-cols-1 gap-4 py-2 sm:grid-cols-2 xl:grid-cols-3">
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

        <div className="mt-4 flex justify-end">
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            Salvar metas
          </Button>
        </div>
      </div>
    </Card>
  );
}

function RevenueBreakdownChart({
  data,
}: {
  data: Array<{ dia: string; rackRate: number; miscellaneousPrice: number; additionalChargesPrice: number; total: number }>;
}) {
  return (
    <ExpandableChartPanel
      title="Faturamento mensal por componente (Time Comercial)"
      subtitle="Últimos 13 meses — Rack Rate, Taxas Diversas e Cobranças Adicionais"
      expandable
      render={(expanded) => (
        <div className="mt-4 w-full" style={{ height: expanded ? "70vh" : 348, minHeight: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 24, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="dia" interval={0} minTickGap={8} {...axis} angle={-45} textAnchor="end" height={80} />
              <YAxis
                {...axis}
                tickFormatter={(value: number) => `$${Math.round(value / 1000)}k`}
              />
              <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => brl(value)} />
              <Legend wrapperStyle={{ paddingTop: '16px' }} />
              <Bar dataKey="rackRate" name="Rack Rate" fill="#44E500" stackId="a" radius={[4, 4, 0, 0]} />
              <Bar dataKey="miscellaneousPrice" name="Taxas Diversas" fill="#2f9c5a" stackId="a" />
              <Bar dataKey="additionalChargesPrice" name="Cobranças Adicionais" fill="#9be870" stackId="a" radius={[0, 0, 4, 4]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    />
  );
}

function useUsdBrl() {
  return useQuery({
    queryKey: ["usd-brl"],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const res = await fetch("https://economia.awesomeapi.com.br/json/last/USD-BRL");
      if (!res.ok) throw new Error("cotação indisponível");
      const json = await res.json();
      const bid = Number(json?.USDBRL?.bid);
      if (!Number.isFinite(bid) || bid <= 0) throw new Error("cotação inválida");
      return bid;
    },
  });
}

function CommissionModule({ sellers, teamSold, teamGoal }: { sellers: { name: string; faturamento: number; revenueGoal: number }[]; teamSold: number; teamGoal: number }) {
  const teamAtt = teamGoal > 0 ? teamSold / teamGoal : 0;
  const { data: usdBrl } = useUsdBrl();
  const brlReais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const hit = teamAtt >= 1;
  const pctBR = (v: number) => `${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  return (
    <Card className="overflow-hidden p-5">
      <div className="flex items-center gap-1.5">
        <h2 className="text-sm font-semibold text-foreground">Simulador / Extrato de Remuneração Variável (Comissão)</h2>
        <InfoPopover icon={CircleHelp} ariaLabel="O que é o simulador de remuneração variável" text={"Estimativa da comissão de cada atendente, calculada sobre o valor vendido individual no período selecionado.\nA faixa depende do atingimento da meta individual; o gatilho de 1,75% só é liberado quando a meta geral da equipe é atingida.\nO valor em reais usa a cotação atual do dólar."} />
        <InfoPopover icon={Calculator} ariaLabel="Níveis de comissão" text={"Níveis de comissão sobre o valor vendido:\n• Abaixo de 75% da meta: 1,25%\n• 75% da meta: 1,25%\n• 85% da meta: 1,40%\n• 100% da meta: 1,55%\n• 100% da meta + meta geral atingida: 1,75%\nComissão = valor vendido × percentual da faixa."} />
      </div>
      <div className={`mt-4 rounded-md border p-4 ${hit ? "border-accent bg-accent/10" : "border-border bg-secondary/40"}`}>
        <p className="text-xs text-muted-foreground">Status da Meta Geral</p>
        <p className="text-base font-semibold text-foreground">
          {teamGoal > 0 ? `${brl(teamSold)} de ${brl(teamGoal)} (${(teamAtt * 100).toFixed(1)}%)` : "Meta geral não cadastrada"}
        </p>
        <p className="text-xs text-muted-foreground">
          {hit ? "Meta geral atingida — gatilho de 1,75% liberado para quem bateu 100% da meta individual." : `Faltam ${brl(Math.max(0, teamGoal - teamSold))} para liberar o gatilho de 1,75%.`}
        </p>
      </div>
      <div className="mt-4 space-y-3 md:hidden">
        {sellers.map((s) => {
          const c = commissionFor(s.faturamento, s.revenueGoal, teamAtt);
          const tone = c.attainment < 0.75 ? "text-red-500" : c.attainment < 0.9 ? "text-yellow-500" : "text-green-500";
          return (
            <div key={s.name} className="rounded-md border border-border p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <span className="font-semibold text-foreground">{s.name}</span>
                <div className="text-right font-semibold text-accent">
                  <div>{brl(c.commission)}</div>
                  <div className="text-xs font-normal text-muted-foreground">{usdBrl ? brlReais(c.commission * usdBrl) : "cotação indisponível"}</div>
                </div>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Vendido: {brl(s.faturamento)}</p>
              {s.revenueGoal > 0 ? (
                <div className="mt-2 flex items-center gap-2">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                    <div className="h-full bg-accent" style={{ width: `${Math.min(100, c.attainment * 100)}%` }} />
                  </div>
                  <span className="text-xs tabular-nums">{(c.attainment * 100).toFixed(1)}%</span>
                </div>
              ) : <p className="mt-2 text-xs text-muted-foreground">Sem meta</p>}
              <p className={`mt-2 text-xs font-medium ${tone}`}>{c.label}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {s.revenueGoal <= 0 ? "Cadastre a meta individual" : c.next
                  ? `Faltam ${brl(c.next.missing)} em vendas para atingir ${Math.round(c.next.pct * 100)}% e subir para ${pctBR(c.next.rate)}`
                  : hit ? "Nível máximo atingido" : "Falta a meta geral para liberar 1,75%"}
              </p>
            </div>
          );
        })}
        {!sellers.length ? <p className="py-6 text-center text-muted-foreground">Nenhum atendente no período.</p> : null}
      </div>
      <div className="mt-4 hidden overflow-x-auto md:block">
        <table className="w-full min-w-[960px] text-sm [&_td]:px-3 [&_th]:px-3 [&_td]:align-middle">
          <thead className="text-xs uppercase text-muted-foreground">
            <tr>
              <th className="py-2 text-left whitespace-nowrap">Atendente</th>
              <th className="py-2 text-right whitespace-nowrap">Valor vendido</th>
              <th className="py-2 text-left">Atingimento</th>
              <th className="py-2 text-left">Faixa atual</th>
              <th className="py-2 text-right">Comissão estimada (USD / BRL{usdBrl ? ` · US$1 = R$${usdBrl.toFixed(2).replace(".", ",")}` : ""})</th>
              <th className="py-2 text-left">Próximo nível</th>
            </tr>
          </thead>
          <tbody>
            {sellers.map((s) => {
              const c = commissionFor(s.faturamento, s.revenueGoal, teamAtt);
              return (
                <tr key={s.name} className="border-t border-border">
                  <td className="py-3 text-foreground">{s.name}</td>
                  <td className="py-3 text-right whitespace-nowrap">{brl(s.faturamento)}</td>
                  <td className="py-3 min-w-[190px]">
                    {s.revenueGoal > 0 ? (
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-24 shrink-0 overflow-hidden rounded-full bg-secondary">
                          <div className="h-full bg-accent" style={{ width: `${Math.min(100, c.attainment * 100)}%` }} />
                        </div>
                        <span className="w-12 shrink-0 text-right text-xs tabular-nums">{(c.attainment * 100).toFixed(1)}%</span>
                      </div>
                    ) : <span className="text-xs text-muted-foreground">Sem meta</span>}
                  </td>
                  <td className={`py-3 text-xs min-w-[180px] font-medium ${c.attainment < 0.75 ? "text-red-500" : c.attainment < 0.9 ? "text-yellow-500" : "text-green-500"}`}>{c.label}</td>
                  <td className="py-3 text-right font-semibold text-accent whitespace-nowrap">
                    <div>{brl(c.commission)}</div>
                    <div className="text-xs font-normal text-muted-foreground">{usdBrl ? brlReais(c.commission * usdBrl) : "cotação indisponível"}</div>
                  </td>
                  <td className="py-3 text-xs text-muted-foreground min-w-[240px]">
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
