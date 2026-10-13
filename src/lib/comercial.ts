import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { averageDiscount, previousYearDate, yearOverYearDiscount } from "@/lib/commercial-goals";

export type CLead = {
  lead_id: string | null;
  created_at: string;
  seller_name: string | null;
  name?: string | null;
  stage_name?: string | null;
};

export const UNASSIGNED_LABEL = "Fila de Atendimento / Não Atribuído";
export type COpp = {
  opportunity_id: string;
  lead_id: string | null;
  name: string | null;
  stage_name: string | null;
  status: string | null;
  seller_name: string | null;
  pending_tasks: number;
  created_at: string;
};
export const DIRECT_SALE_LABEL = "Venda Direta / Site";
export type CRes = {
  created_at: string;
  total_amount: number;
  discount_amount: number;
  status: string;
  seller_name: string | null;
};
export type CTask = {
  lead_id: string | null;
  user_name: string | null;
  completed: boolean;
  due_date: string | null;
  created_at: string;
};
export type Goal = { 
  seller_name: string; 
  month: string; 
  revenue_goal: number; 
  ticket_goal: number; 
  discount_goal?: number;
  conversion_goal?: number; 
};

// Apelidos usados no HQ Rentals -> nome do usuário no ClickMassa
const ALIASES: Record<string, string> = { naty: "nathalia", thay: "thayanne" };

export const sellerKey = (n: string | null | undefined) => {
  const k = (n ?? "")
    .trim()
    .split(/\s+/)[0]!
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return k ? (ALIASES[k] ?? k) : "sem_vendedor";
};

const startIso = (d: string) => new Date(d + "T00:00:00").toISOString();
const endIso = (d: string) => new Date(d + "T23:59:59.999").toISOString();

// Calcula o período homólogo no mês anterior mantendo a mesma janela de dias
export function getPreviousPeriod(from: string, to: string) {
  const previousMonthDate = (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year!, month! - 2, 1));
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day!, lastDay));
    return date.toISOString().slice(0, 10);
  };

  return { prevFrom: previousMonthDate(from), prevTo: previousMonthDate(to) };
}

export async function fetchComercial(from: string, to: string) {
  const { prevFrom, prevTo } = getPreviousPeriod(from, to);

  const histFrom = startIso(prevFrom);

  const [leads, res, tasks, goals, opps, prevLeads, prevRes, prevOpps, yearRes] = await Promise.all([
    // Período atual
    fetchAll((a, b) =>
      supabase
        .from("crm_leads")
        .select("lead_id, created_at, seller_name, name, stage_name")
        .gte("created_at", startIso(from))
        .lte("created_at", endIso(to))
        .range(a, b),
    ),
    fetchAll((a, b) =>
      supabase
        .from("reservations")
        .select("created_at, total_amount, discount_amount, status, seller_name")
        .gte("created_at", histFrom)
        .lte("created_at", endIso(to))
        .range(a, b),
    ),
    fetchAll((a, b) =>
      supabase
        .from("crm_tasks")
        .select("lead_id, user_name, completed, due_date, created_at")
        .range(a, b),
    ),
    supabase.from("sales_goals").select("seller_name, month, revenue_goal, ticket_goal, discount_goal, conversion_goal"),
    fetchAll((a, b) =>
      supabase
        .from("crm_opportunities")
        .select("opportunity_id, lead_id, name, stage_name, status, seller_name, pending_tasks, created_at")
        .eq("pipeline_name", "Comercial")
        .range(a, b),
    ),
    // Período anterior (para comparação)
    fetchAll((a, b) =>
      supabase
        .from("crm_leads")
        .select("lead_id, created_at, seller_name")
        .gte("created_at", startIso(prevFrom))
        .lte("created_at", endIso(prevTo))
        .range(a, b),
    ),
    fetchAll((a, b) =>
      supabase
        .from("reservations")
        .select("created_at, total_amount, status, seller_name")
        .gte("created_at", startIso(prevFrom))
        .lte("created_at", endIso(prevTo))
        .range(a, b),
    ),
    fetchAll((a, b) =>
      supabase
        .from("crm_opportunities")
        .select("opportunity_id, lead_id, status, seller_name, pending_tasks, created_at")
        .eq("pipeline_name", "Comercial")
        .gte("created_at", startIso(prevFrom))
        .lte("created_at", endIso(prevTo))
        .range(a, b),
    ),
    fetchAll((a, b) =>
      supabase.from("reservations")
        .select("created_at, total_amount, discount_amount, status, seller_name")
        .eq("status", "confirmed")
        .gte("created_at", startIso(previousYearDate(from)))
        .lte("created_at", endIso(previousYearDate(to)))
        .range(a, b),
    ),
  ]);

  const err = leads.error || res.error || tasks.error || goals.error || opps.error || prevLeads.error || prevRes.error || prevOpps.error || yearRes.error;
  if (err) throw err;

  return {
    leads: leads.data as CLead[],
    opportunities: (opps.data ?? []) as COpp[],
    reservations: (res.data as CRes[]).map((r) => ({
      ...r,
      total_amount: Number(r.total_amount),
      discount_amount: Number(r.discount_amount),
    })),
    tasks: tasks.data as CTask[],
    goals: ((goals.data ?? []) as any[]).map((g) => ({
      ...g,
      revenue_goal: Number(g.revenue_goal),
      ticket_goal: Number(g.ticket_goal),
      discount_goal: Number(g.discount_goal ?? 0),
      conversion_goal: Number(g.conversion_goal ?? 0),
    })),
    yearReservations: (yearRes.data as CRes[]).map((r) => ({ ...r, total_amount: Number(r.total_amount), discount_amount: Number(r.discount_amount) })),
    prevData: {
      leads: prevLeads.data ?? [],
      reservations: (prevRes.data ?? []).map((r: any) => ({ ...r, total_amount: Number(r.total_amount) })),
      opportunities: prevOpps.data ?? [],
    },
  };
}

export type ComercialData = Awaited<ReturnType<typeof fetchComercial>>;

export type SellerRow = {
  key: string;
  name: string;
  leads: number;
  oportunidades: number;
  overdue: number;
  pending: number;
  done: number;
  tasksTotal: number;
  noTask: number;
  reservas: number;
  conversao: number;
  ticket: number;
  faturamento: number;
  descontoPct: number;
  revenueGoal: number;
  ticketGoal: number;
  discountGoal: number;
};

export type MonthlyCommercial = {
  mes: string;
  monthKey: string;
  oportunidades: number;
  reservas: number;
  faturamento: number;
  conversao: number;
  ticket: number;
  descontoPct: number;
};

const MONTHS_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function computeMonthlyCommercial(
  opportunities: Pick<COpp, "created_at" | "seller_name">[],
  reservations: Pick<CRes, "created_at" | "seller_name" | "status" | "total_amount" | "discount_amount">[],
  seller: string,
  from: string,
  to: string,
): MonthlyCommercial[] {
  const buckets = new Map<string, MonthlyCommercial>();
  const monthlyDiscounts = new Map<string, { net: number; discount: number }>();
  const firstMonth = new Date(`${from.slice(0, 7)}-01T00:00:00Z`);
  const lastMonth = new Date(`${to.slice(0, 7)}-01T00:00:00Z`);
  for (const date = firstMonth; date <= lastMonth; date.setUTCMonth(date.getUTCMonth() + 1)) {
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    buckets.set(key, {
      mes: `${MONTHS_PT[date.getUTCMonth()]}/${date.getUTCFullYear()}`,
      monthKey: key,
      oportunidades: 0,
      reservas: 0,
      faturamento: 0,
      conversao: 0,
      ticket: 0,
      descontoPct: 0,
    });
    monthlyDiscounts.set(key, { net: 0, discount: 0 });
  }

  opportunities.forEach((opportunity) => {
    if (seller !== "all" && sellerKey(opportunity.seller_name) !== seller) return;
    const bucket = buckets.get(opportunity.created_at.slice(0, 7));
    if (bucket) bucket.oportunidades++;
  });
  reservations.forEach((reservation) => {
    if (reservation.status !== "confirmed") return;
    const reservationSeller = sellerKey(reservation.seller_name);
    const effectiveSeller = reservationSeller === "sem_vendedor" ? "venda_direta" : reservationSeller;
    if (seller !== "all" && effectiveSeller !== seller) return;
    const bucket = buckets.get(reservation.created_at.slice(0, 7));
    if (!bucket) return;
    bucket.reservas++;
    bucket.faturamento += reservation.total_amount;
    const discount = monthlyDiscounts.get(reservation.created_at.slice(0, 7));
    if (discount) {
      discount.net += reservation.total_amount;
      discount.discount += reservation.discount_amount;
    }
  });
  buckets.forEach((bucket, key) => {
    bucket.conversao = bucket.oportunidades ? bucket.reservas / bucket.oportunidades : 0;
    bucket.ticket = bucket.reservas ? bucket.faturamento / bucket.reservas : 0;
    const discount = monthlyDiscounts.get(key);
    const gross = (discount?.net ?? 0) + (discount?.discount ?? 0);
    bucket.descontoPct = gross ? (discount?.discount ?? 0) / gross : 0;
  });
  return [...buckets.values()];
}

export function computeComercial(d: ComercialData, from: string, to: string, seller: string) {
  const today = new Date().toISOString().slice(0, 10);
  const inPeriod = (iso: string) => iso >= startIso(from) && iso <= endIso(to);
  const names = new Map<string, string>();
  const nameOf = (n: string | null) => {
    const k = sellerKey(n);
    if (!names.has(k)) names.set(k, n?.trim() || UNASSIGNED_LABEL);
    return k;
  };
  const confirmed = d.reservations.filter((r) => r.status === "confirmed");
  const months = new Set<string>();
  const cur = new Date(from + "T00:00:00");
  cur.setDate(1);
  while (cur <= new Date(to + "T00:00:00")) {
    months.add(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}`);
    cur.setMonth(cur.getMonth() + 1);
  }

  const rows = new Map<string, SellerRow & { gross: number; disc: number }>();
  const touch = (k: string) => {
    if (!rows.has(k))
      rows.set(k, {
        key: k, name: "", leads: 0, oportunidades: 0, overdue: 0, pending: 0, done: 0, tasksTotal: 0, noTask: 0, reservas: 0, conversao: 0,
        ticket: 0, faturamento: 0, descontoPct: 0, revenueGoal: 0, ticketGoal: 0, discountGoal: 0, gross: 0, disc: 0,
      });
    return rows.get(k)!;
  };

  const leadIdsWithTask = new Set(d.tasks.filter((t) => !t.completed).map((t) => t.lead_id).filter(Boolean));
  const isOpen = (o: COpp) => (o.status ?? "open").toLowerCase() === "open";
  const hasNoTask = (o: COpp) => isOpen(o) && o.pending_tasks === 0 && !leadIdsWithTask.has(o.lead_id);
  const opps = d.opportunities.filter((o) => inPeriod(o.created_at));

  d.leads.forEach((l) => {
    touch(nameOf(l.seller_name)).leads++;
  });
  opps.forEach((o) => {
    const r = touch(nameOf(o.seller_name));
    r.oportunidades++;
    if (hasNoTask(o)) r.noTask++;
  });

  d.tasks.filter((t) => inPeriod(t.created_at)).forEach((t) => {
    const r = touch(nameOf(t.user_name));
    r.tasksTotal++;
    if (t.completed) r.done++;
    else {
      r.pending++;
      if (t.due_date && t.due_date < today) r.overdue++;
    }
  });

  confirmed
    .filter((r) => inPeriod(r.created_at))
    .forEach((r) => {
      const k0 = nameOf(r.seller_name);
      const k = k0 === "sem_vendedor" ? "venda_direta" : k0;
      if (k === "venda_direta") names.set(k, DIRECT_SALE_LABEL);
      const row = touch(k);
      row.reservas++;
      row.faturamento += r.total_amount;
      row.disc += r.discount_amount;
      row.gross += r.total_amount + r.discount_amount;
    });

  const goalCount = new Map<string, number>();
  d.goals
    .filter((g) => months.has(g.month))
    .forEach((g) => {
      const row = touch(nameOf(g.seller_name));
      row.revenueGoal += g.revenue_goal;
      row.ticketGoal += g.ticket_goal;
      row.discountGoal += g.discount_goal;
      goalCount.set(row.key, (goalCount.get(row.key) ?? 0) + 1);
    });

  const all: SellerRow[] = [...rows.values()].map((r) => ({
    ...r,
    name: names.get(r.key) ?? r.key,
    conversao: r.oportunidades ? r.reservas / r.oportunidades : 0,
    ticket: r.reservas ? r.faturamento / r.reservas : 0,
    descontoPct: r.gross ? r.disc / r.gross : 0,
    ticketGoal: goalCount.get(r.key) ? r.ticketGoal / goalCount.get(r.key)! : 0,
    discountGoal: goalCount.get(r.key) ? r.discountGoal / goalCount.get(r.key)! : 0,
  }));

  const sellers = all
    .filter((r) => r.key !== "sem_vendedor" && r.key !== "venda_direta")
    .sort((a, b) => a.name.localeCompare(b.name));
  const visible = seller === "all" ? all : all.filter((r) => r.key === seller);

  const sum = (f: (r: SellerRow) => number) => visible.reduce((s, r) => s + f(r), 0);
  const sellerLeads = d.leads.filter((l) => seller === "all" || sellerKey(l.seller_name) === seller);
  const sellerOpps = opps.filter((o) => seller === "all" || sellerKey(o.seller_name) === seller);
  // Oportunidades sem tarefas: todas as abertas sem tarefa criadas até o fim do período
  const noTaskList = d.opportunities
    .filter((o) => o.created_at <= endIso(to))
    .filter((o) => seller === "all" || sellerKey(o.seller_name) === seller)
    .filter(hasNoTask)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((o) => ({ ...o, owner: o.seller_name?.trim() || UNASSIGNED_LABEL }));
  const leadsNoTask = noTaskList.length;

  const daily = new Map<string, { dia: string; leads: number; oportunidades: number }>();
  const dailyOpportunitiesBySeller = new Map<string, Record<string, string | number>>();
  const dailyRevenueBySeller = new Map<string, Record<string, string | number>>();
  for (let c = new Date(from + "T00:00:00"); c <= new Date(to + "T00:00:00"); c.setDate(c.getDate() + 1)) {
    const key = `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, "0")}-${String(c.getDate()).padStart(2, "0")}`;
    const dia = `${key.slice(8)}/${key.slice(5, 7)}`;
    daily.set(key, { dia, leads: 0, oportunidades: 0 });
    dailyOpportunitiesBySeller.set(key, { dia });
    dailyRevenueBySeller.set(key, { dia });
  }
  const dayKey = (iso: string) => {
    const dt = new Date(iso);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  };
  sellerLeads.forEach((l) => {
    const b = daily.get(dayKey(l.created_at));
    if (b) b.leads++;
  });
  sellerOpps.forEach((o) => {
    const key = dayKey(o.created_at);
    const b = daily.get(key);
    if (b) b.oportunidades++;
    const sellerName = names.get(nameOf(o.seller_name)) ?? UNASSIGNED_LABEL;
    const stacked = dailyOpportunitiesBySeller.get(key);
    if (stacked) stacked[sellerName] = Number(stacked[sellerName] ?? 0) + 1;
  });

  const dailyRevenueKeys = new Set<string>();
  confirmed.filter((r) => inPeriod(r.created_at)).forEach((r) => {
    const key = dayKey(r.created_at);
    const sellerKeyValue = nameOf(r.seller_name);
    const effectiveSeller = sellerKeyValue === "sem_vendedor" ? "venda_direta" : sellerKeyValue;
    if (seller !== "all" && effectiveSeller !== seller) return;
    if (effectiveSeller === "venda_direta") names.set(effectiveSeller, DIRECT_SALE_LABEL);
    const sellerName = names.get(effectiveSeller) ?? effectiveSeller;
    const stacked = dailyRevenueBySeller.get(key);
    if (stacked) {
      stacked[sellerName] = Number(stacked[sellerName] ?? 0) + r.total_amount;
      dailyRevenueKeys.add(sellerName);
    }
  });

  const leads = sum((r) => r.leads);
  const oportunidades = sum((r) => r.oportunidades);
  const reservas = sum((r) => r.reservas);
  const faturamento = sum((r) => r.faturamento);
  const doneTasks = sum((r) => r.done);
  const pendingTasks = sum((r) => r.pending);
  const tasksTotal = sum((r) => r.tasksTotal);

  const totalTasksUnfiltered = pendingTasks + doneTasks;
  const taskExecutionRateFormatted = totalTasksUnfiltered > 0
    ? `${((doneTasks / totalTasksUnfiltered) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
    : '0%';

  const filteredTasks = d.tasks.filter((t) => seller === "all" || sellerKey(t.user_name) === seller);
  const leadFirstTaskMap = new Map<string, number>();

  filteredTasks.forEach((t) => {
    if (!t.lead_id || !t.created_at) return;
    const taskTime = new Date(t.created_at).getTime();
    if (isNaN(taskTime)) return;

    const existingTime = leadFirstTaskMap.get(t.lead_id);
    if (!existingTime || taskTime < existingTime) {
      leadFirstTaskMap.set(t.lead_id, taskTime);
    }
  });

  const responseTimesInMinutes: number[] = [];
  sellerLeads.forEach((l) => {
    if (!l.lead_id || !l.created_at) return;
    const leadTime = new Date(l.created_at).getTime();
    if (isNaN(leadTime)) return;

    const firstTaskTime = leadFirstTaskMap.get(l.lead_id);
    if (firstTaskTime && firstTaskTime >= leadTime) {
      responseTimesInMinutes.push((firstTaskTime - leadTime) / (1000 * 60));
    }
  });

  let slaFormatted = '--';
  if (responseTimesInMinutes.length > 0) {
    const avgMinutes = responseTimesInMinutes.reduce((a, b) => a + b, 0) / responseTimesInMinutes.length;
    if (!isNaN(avgMinutes) && avgMinutes >= 0) {
      if (avgMinutes < 60) {
        slaFormatted = `${Math.round(avgMinutes)} min`;
      } else {
        const hours = Math.floor(avgMinutes / 60);
        const mins = Math.round(avgMinutes % 60);
        slaFormatted = `${hours}h ${mins}m`;
      }
    }
  }

  // --- CÁLCULO DO PERÍODO ANTERIOR E VARIAÇÕES PERCENTUAIS ---
  const prevConfirmed = d.prevData.reservations.filter((r: any) => r.status === "confirmed");
  const prevFilteredRes = seller === "all" ? prevConfirmed : prevConfirmed.filter((r: any) => sellerKey(r.seller_name) === seller);
  const prevFilteredOpps = seller === "all" ? d.prevData.opportunities : d.prevData.opportunities.filter((o: any) => sellerKey(o.seller_name) === seller);

  const prevOppsCount = prevFilteredOpps.length;
  const prevReservasCount = prevFilteredRes.length;
  const prevFaturamento = prevFilteredRes.reduce((acc: number, r: any) => acc + r.total_amount, 0);
  const prevConversao = prevOppsCount ? prevReservasCount / prevOppsCount : 0;
  const prevTicket = prevReservasCount ? prevFaturamento / prevReservasCount : 0;
  
  const currentPeriodNoTaskCount = sellerOpps.filter(hasNoTask).length;
  const prevNoTaskCount = (prevFilteredOpps as COpp[]).filter(hasNoTask).length;

  const calcVariation = (curr: number, prev: number) => {
    if (!prev) return curr ? 100 : 0;
    return ((curr - prev) / prev) * 100;
  };

  const currentConversao = oportunidades ? reservas / oportunidades : 0;
  const currentTicket = reservas ? faturamento / reservas : 0;

  const belongsToSeller = (r: { seller_name: string | null }) => seller === "all" ||
    (sellerKey(r.seller_name) === "sem_vendedor" ? "venda_direta" : sellerKey(r.seller_name)) === seller;
  const currentDiscount = averageDiscount(confirmed.filter((r) => inPeriod(r.created_at) && belongsToSeller(r)));
  const priorYear = d.yearReservations.filter(belongsToSeller);
  const kpis = {
    descontoPct: currentDiscount,
    descontoYearDiff: yearOverYearDiscount(currentDiscount, averageDiscount(priorYear), priorYear.length > 0),
    leads,
    oportunidades,
    oportunidadesVar: calcVariation(oportunidades, prevOppsCount),
    reservas,
    reservasVar: calcVariation(reservas, prevReservasCount),
    faturamento,
    faturamentoVar: calcVariation(faturamento, prevFaturamento),
    rackRate: faturamento,
    rackRateVar: calcVariation(faturamento, prevFaturamento),
    conversao: currentConversao,
    conversaoVar: calcVariation(currentConversao, prevConversao),
    ticket: currentTicket,
    ticketVar: calcVariation(currentTicket, prevTicket),
    leadsNoTask,
    leadsNoTaskVar: calcVariation(currentPeriodNoTaskCount, prevNoTaskCount),
    overdue: sum((r) => r.overdue),
    pending: pendingTasks,
    done: doneTasks,
    tasksTotal,
    taskExecutionRateFormatted,
    slaFormatted,
  };

  const monthly = new Map<string, Record<string, number | string>>();
  const firstMonth = new Date(`${from.slice(0, 7)}-01T00:00:00Z`);
  const lastMonth = new Date(`${to.slice(0, 7)}-01T00:00:00Z`);
  for (const month = firstMonth; month <= lastMonth; month.setUTCMonth(month.getUTCMonth() + 1)) {
    const label = `${month.getUTCFullYear()}/${String(month.getUTCMonth() + 1).padStart(2, "0")}`;
    monthly.set(label, { mes: label });
  }

  const stackKeys = new Set<string>();
  confirmed.forEach((r) => {
    const label = r.created_at.slice(0, 7).replace("-", "/");
    const bucket = monthly.get(label);
    if (!bucket) return;
    const k = nameOf(r.seller_name);
    if (seller !== "all" && k !== seller) return;
    const n = k === "sem_vendedor" ? DIRECT_SALE_LABEL : names.get(k)!;
    stackKeys.add(n);
    bucket[n] = ((bucket[n] as number | undefined) ?? 0) + r.total_amount;
  });

  return {
    daily: [...daily.values()],
    dailyOpportunitiesBySeller: [...dailyOpportunitiesBySeller.values()],
    dailyOpportunityKeys: [...new Set(sellerOpps.map((o) => names.get(nameOf(o.seller_name)) ?? UNASSIGNED_LABEL))],
    dailyRevenueBySeller: [...dailyRevenueBySeller.values()],
    dailyRevenueKeys: [...dailyRevenueKeys],
    noTaskList,
    kpis,
    rows: visible.filter((r) => r.oportunidades || r.reservas || r.overdue || r.pending || r.done),
    sellers,
    monthly: [...monthly.values()],
    monthlyKpis: computeMonthlyCommercial(d.opportunities, d.reservations, seller, from, to),
    stackKeys: [...stackKeys],
    goalMonth: [...months][0] ?? "",
  };
}

export async function saveGoals(goals: Goal[]) {
  const { error } = await supabase
    .from("sales_goals")
    .upsert(goals.map((g) => ({ ...g, updated_at: new Date().toISOString() })) as any, {
      onConflict: "seller_name,month",
    });
  if (error) throw error;
}