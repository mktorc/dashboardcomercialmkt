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
function getPreviousPeriod(from: string, to: string) {
  const fDate = new Date(from + "T00:00:00");
  const tDate = new Date(to + "T00:00:00");
  
  fDate.setMonth(fDate.getMonth() - 1);
  tDate.setMonth(tDate.getMonth() - 1);

  const ymdFormat = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  return { prevFrom: ymdFormat(fDate), prevTo: ymdFormat(tDate) };
}

export async function fetchComercial(from: string, to: string) {
  const { prevFrom, prevTo } = getPreviousPeriod(from, to);

  const sixFrom = new Date(to + "T00:00:00");
  sixFrom.setMonth(sixFrom.getMonth() - 5, 1);
  const histFrom = sixFrom < new Date(from + "T00:00:00") ? sixFrom.toISOString() : startIso(prevFrom);

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
        .gte("created_at", startIso(from))
        .lte("created_at", endIso(to))
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
  const noTaskList = sellerOpps
    .filter(hasNoTask)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((o) => ({ ...o, owner: o.seller_name?.trim() || UNASSIGNED_LABEL }));
  const leadsNoTask = noTaskList.length;

  const daily = new Map<string, { dia: string; leads: number; oportunidades: number }>();
  for (let c = new Date(from + "T00:00:00"); c <= new Date(to + "T00:00:00"); c.setDate(c.getDate() + 1)) {
    const key = `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, "0")}-${String(c.getDate()).padStart(2, "0")}`;
    daily.set(key, { dia: `${key.slice(8)}/${key.slice(5, 7)}`, leads: 0, oportunidades: 0 });
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
    const b = daily.get(dayKey(o.created_at));
    if (b) b.oportunidades++;
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
  
  const leadIdsWithTaskPrev = new Set(d.tasks.filter((t) => !t.completed).map((t) => t.lead_id).filter(Boolean));
  const prevNoTaskCount = prevFilteredOpps.filter((o: any) => (o.status ?? "open").toLowerCase() === "open" && o.pending_tasks === 0 && !leadIdsWithTaskPrev.has(o.lead_id)).length;

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
    leadsNoTaskVar: calcVariation(leadsNoTask, prevNoTaskCount),
    overdue: sum((r) => r.overdue),
    pending: pendingTasks,
    done: doneTasks,
    tasksTotal,
    taskExecutionRateFormatted,
    slaFormatted,
  };

  const monthly = new Map<string, Record<string, number | string>>();
  const end = new Date(to + "T00:00:00");
  for (let i = 5; i >= 0; i--) {
    const m = new Date(end.getFullYear(), end.getMonth() - i, 1);
    const label = `${m.getFullYear()}/${String(m.getMonth() + 1).padStart(2, "0")}`;
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
    noTaskList,
    kpis,
    rows: visible.filter((r) => r.oportunidades || r.reservas || r.overdue || r.pending || r.done),
    sellers,
    monthly: [...monthly.values()],
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