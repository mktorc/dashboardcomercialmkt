import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";

export type CLead = {
  lead_id: string | null;
  created_at: string;
  seller_name: string | null;
  name?: string | null;
  stage_name?: string | null;
};

export const UNASSIGNED_LABEL = "Fila de Atendimento / Não Atribuído";
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
};
export type Goal = { seller_name: string; month: string; revenue_goal: number; ticket_goal: number };

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

export async function fetchComercial(from: string, to: string) {
  const sixFrom = new Date(to + "T00:00:00");
  sixFrom.setMonth(sixFrom.getMonth() - 5, 1);
  const histFrom = sixFrom < new Date(from + "T00:00:00") ? sixFrom.toISOString() : startIso(from);

  const [leads, res, tasks, goals] = await Promise.all([
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
        .select("lead_id, user_name, completed, due_date")
        .gte("created_at", startIso(from))
        .lte("created_at", endIso(to))
        .range(a, b),
    ),
    supabase.from("sales_goals").select("seller_name, month, revenue_goal, ticket_goal"),
  ]);
  const err = leads.error || res.error || tasks.error || goals.error;
  if (err) throw err;
  return {
    leads: leads.data as CLead[],
    reservations: (res.data as CRes[]).map((r) => ({
      ...r,
      total_amount: Number(r.total_amount),
      discount_amount: Number(r.discount_amount),
    })),
    tasks: tasks.data as CTask[],
    goals: ((goals.data ?? []) as Goal[]).map((g) => ({
      ...g,
      revenue_goal: Number(g.revenue_goal),
      ticket_goal: Number(g.ticket_goal),
    })),
  };
}

export type ComercialData = Awaited<ReturnType<typeof fetchComercial>>;

export type SellerRow = {
  key: string;
  name: string;
  leads: number;
  overdue: number;
  pending: number;
  done: number;
  reservas: number;
  conversao: number;
  ticket: number;
  faturamento: number;
  descontoPct: number;
  revenueGoal: number;
  ticketGoal: number;
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
        key: k, name: "", leads: 0, overdue: 0, pending: 0, done: 0, reservas: 0, conversao: 0,
        ticket: 0, faturamento: 0, descontoPct: 0, revenueGoal: 0, ticketGoal: 0, gross: 0, disc: 0,
      });
    return rows.get(k)!;
  };

  d.leads.forEach((l) => touch(nameOf(l.seller_name)).leads++);
  d.tasks.forEach((t) => {
    const r = touch(nameOf(t.user_name));
    if (t.completed) r.done++;
    else {
      r.pending++;
      if (t.due_date && t.due_date < today) r.overdue++;
    }
  });
  confirmed
    .filter((r) => inPeriod(r.created_at))
    .forEach((r) => {
      const row = touch(nameOf(r.seller_name));
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
      goalCount.set(row.key, (goalCount.get(row.key) ?? 0) + 1);
    });

  const all: SellerRow[] = [...rows.values()].map((r) => ({
    ...r,
    name: names.get(r.key) ?? r.key,
    conversao: r.leads ? r.reservas / r.leads : 0,
    ticket: r.reservas ? r.faturamento / r.reservas : 0,
    descontoPct: r.gross ? r.disc / r.gross : 0,
    ticketGoal: goalCount.get(r.key) ? r.ticketGoal / goalCount.get(r.key)! : 0,
  }));
  const sellers = all
    .filter((r) => r.key !== "sem_vendedor")
    .sort((a, b) => a.name.localeCompare(b.name));
  const visible = seller === "all" ? all : all.filter((r) => r.key === seller);

  const sum = (f: (r: SellerRow) => number) => visible.reduce((s, r) => s + f(r), 0);
  const leadIdsWithTask = new Set(d.tasks.map((t) => t.lead_id).filter(Boolean));
  const leadsNoTask = d.leads.filter(
    (l) => (seller === "all" || sellerKey(l.seller_name) === seller) && !leadIdsWithTask.has(l.lead_id),
  ).length;
  const leads = sum((r) => r.leads);
  const reservas = sum((r) => r.reservas);
  const faturamento = sum((r) => r.faturamento);
  const kpis = {
    leads,
    reservas,
    faturamento,
    conversao: leads ? reservas / leads : 0,
    ticket: reservas ? faturamento / reservas : 0,
    leadsNoTask,
    overdue: sum((r) => r.overdue),
    pending: sum((r) => r.pending),
    done: sum((r) => r.done),
  };

  // Barras empilhadas: últimos 6 meses até o fim do período
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
    const n = names.get(k)!;
    stackKeys.add(n);
    bucket[n] = ((bucket[n] as number | undefined) ?? 0) + r.total_amount;
  });

  // Auditoria: casos sem vendedor reconhecido (nulo no ClickMassa ou nome sem correspondência)
  const knownUsers = new Set(
    [...d.tasks.map((t) => t.user_name), ...d.reservations.map((r) => r.seller_name)]
      .map((n) => sellerKey(n))
      .filter((k) => k !== "sem_vendedor"),
  );
  const leadCount = new Map<string, number>();
  d.leads.forEach((l) => leadCount.set(sellerKey(l.seller_name), (leadCount.get(sellerKey(l.seller_name)) ?? 0) + 1));
  const audit = d.leads
    .filter((l) => sellerKey(l.seller_name) === "sem_vendedor" || !knownUsers.has(sellerKey(l.seller_name)))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 10)
    .map((l) => ({
      ...l,
      reason: l.seller_name?.trim() ? ("match" as const) : ("null" as const),
    }));
  const unassigned = leadCount.get("sem_vendedor") ?? 0;
  const unmatched = d.leads.filter(
    (l) => sellerKey(l.seller_name) !== "sem_vendedor" && !knownUsers.has(sellerKey(l.seller_name)),
  ).length;

  return {
    audit,
    unassigned,
    unmatched,
    kpis,
    rows: visible.filter((r) => r.leads || r.reservas || r.overdue || r.pending || r.done),
    sellers,
    monthly: [...monthly.values()],
    stackKeys: [...stackKeys],
    goalMonth: [...months][0] ?? "",
  };
}

export async function saveGoals(goals: Goal[]) {
  const { error } = await supabase
    .from("sales_goals")
    .upsert(goals.map((g) => ({ ...g, updated_at: new Date().toISOString() })), {
      onConflict: "seller_name,month",
    });
  if (error) throw error;
}
