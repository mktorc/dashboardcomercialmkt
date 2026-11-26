/* eslint-disable @typescript-eslint/no-explicit-any -- respostas de tabelas fora dos tipos gerados do Supabase; tipar exige regenerar types.ts */
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { fetchKommoLeads, kommoAsOpportunity } from "@/lib/kommo-leads";
import {
  averageDiscount,
  GLOBAL_GOAL,
  OCCUPANCY_GOAL,
  previousYearDate,
  yearOverYearDiscount,
} from "@/lib/commercial-goals";

export const UNASSIGNED_LABEL = "Fila de Atendimento / Não Atribuído";
export type COpp = {
  opportunity_id: string;
  lead_id: string | null;
  name: string | null;
  stage_name: string | null;
  status: string | null;
  seller_name: string | null;
  pending_tasks: number;
  /** Tarefas atrasadas segundo o ClickMassa (null = ainda não ressincronizado). */
  delayed_tasks?: number | null;
  /** Tarefas de qualquer situação no ClickMassa (null = ainda não sincronizado). */
  total_tasks: number | null;
  created_at: string;
};
// Origens que NÃO são agência de viagem: a aba Operacional só considera oportunidades vindas delas.
const NON_AGENCY_ORIGIN_NAMES = [
  "meta ads",
  "google ads",
  "camp.hispana",
  "turistorlando",
  "viajando barato para orlando",
  "alex veiga",
  "victoria salvalaggio",
  "gabi blanck",
  "theodoro",
  "talu concept",
  "natalia souza",
  "redirectbox",
  "master vacation",
  "indicacao",
  "cliente recorrente",
  "instagram",
];
// Comparação sem acento, caixa, espaço ou pontuação ("@ViajandobaratoparaOrlando" = "Viajando barato para Orlando").
const originKey = (v: string | null | undefined) =>
  (v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const NON_AGENCY_ORIGINS = new Set(NON_AGENCY_ORIGIN_NAMES.map(originKey));
export const isNonAgencyOrigin = (origin: string | null | undefined) =>
  NON_AGENCY_ORIGINS.has(originKey(origin));

/**
 * lead_id → origem do lead (apenas leads com origem preenchida), só para os leads pedidos.
 * Antes baixava a tabela inteira (~69 mil leads) e a tela levava dezenas de segundos.
 */
export async function fetchLeadOrigins(leadIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(leadIds)];
  const pages = await Promise.all(
    Array.from({ length: Math.ceil(ids.length / 300) }, (_, i) =>
      fetchAll((a, b) =>
        supabase
          .from("crm_leads")
          .select("lead_id, lead_origin")
          .not("lead_origin", "is", null)
          .in("lead_id", ids.slice(i * 300, (i + 1) * 300))
          .order("lead_id")
          .range(a, b),
      ),
    ),
  );
  const failed = pages.find((p) => p.error);
  if (failed?.error) throw failed.error;
  return new Map(
    pages.flatMap((p) =>
      (p.data as { lead_id: string; lead_origin: string }[]).map(
        (l) => [l.lead_id, l.lead_origin] as const,
      ),
    ),
  );
}

/** Mantém só oportunidades cujo lead tem origem fora de agência de viagem. */
export const keepNonAgencyOpps = <T extends { lead_id: string | null }>(
  opps: T[],
  origins: Map<string, string>,
) => opps.filter((o) => !!o.lead_id && isNonAgencyOrigin(origins.get(o.lead_id)));

export const DIRECT_SALE_LABEL = "Venda Direta / Site";
export type CRes = {
  created_at: string;
  total_amount: number;
  discount_amount: number;
  rack_rate?: number | null;
  miscellaneous_price?: number | null;
  additional_charges_price?: number | null;
  status: string;
  seller_name: string | null;
  pick_up_at?: string | null;
  reservation_id?: string | null;
};
// Faturamento / receita provisionada = coluna rack_rate (HQ) em ambas as abas comerciais.
// Sem rack_rate a reserva não contribui; não há fallback para total_amount.
const reservationRackRate = (reservation: Pick<CRes, "rack_rate">, _useHqRackRate = true) =>
  reservation.rack_rate ?? 0;
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
const ALIASES: Record<string, string> = {
  naty: "nathalia",
  nathy: "nathalia",
  thay: "thayanne",
  talita: "thalita",
};

export const sellerKey = (n: string | null | undefined) => {
  const k = (n ?? "")
    .trim()
    .split(/\s+/)[0]!
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return k ? (ALIASES[k] ?? k) : "sem_vendedor";
};

// Limites do período em UTC, o mesmo referencial usado para agrupar por dia/mês
// (created_at.slice(...)) e igual ao do HQ; o fuso do navegador deslocava as bordas.
const startIso = (d: string) => `${d}T00:00:00.000Z`;
const endIso = (d: string) => `${d}T23:59:59.999Z`;

// Oportunidades usam o dia no horário de Brasília (UTC-3, sem horário de verão), igual ao filtro
// por data de criação do ClickMassa. Ex.: criada 31/10 22h (BRT) = 01/11 01h UTC fica em outubro.
const BRT_OFFSET_MS = 3 * 3_600_000;
const oppStartIso = (d: string) =>
  new Date(Date.parse(`${d}T00:00:00.000Z`) + BRT_OFFSET_MS).toISOString();
const oppEndIso = (d: string) =>
  new Date(Date.parse(`${d}T23:59:59.999Z`) + BRT_OFFSET_MS).toISOString();
const oppInRange = (iso: string, from: string, to: string) => {
  const t = Date.parse(iso);
  return t >= Date.parse(oppStartIso(from)) && t <= Date.parse(oppEndIso(to));
};
/** YYYY-MM da criação da oportunidade no horário de Brasília. */
const oppMonth = (iso: string) =>
  new Date(Date.parse(iso) - BRT_OFFSET_MS).toISOString().slice(0, 7);

// Calcula o período homólogo no mês anterior mantendo a mesma janela de dias
export function getPreviousPeriod(from: string, to: string) {
  const previousMonthDate = (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year!, month! - 2, 1));
    const lastDay = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
    ).getUTCDate();
    date.setUTCDate(Math.min(day!, lastDay));
    return date.toISOString().slice(0, 10);
  };

  return { prevFrom: previousMonthDate(from), prevTo: previousMonthDate(to) };
}

/** Últimos 13 meses (YYYY-MM), terminando no mês atual: em nov/2026 começa em nov/2025. */
function revenueBreakdownMonths() {
  const now = new Date();
  return Array.from({ length: 13 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 12 + i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
}

async function fetchRevenueBreakdown() {
  try {
    const histFrom = startIso(`${revenueBreakdownMonths()[0]}-01`);

    // Fetch all required columns in a single query
    const { data, error } = await fetchAll((a, b) =>
      supabase
        .from("reservations")
        .select(
          "created_at, seller_name, status, rack_rate, miscellaneous_price, additional_charges_price",
        )
        .gte("created_at", histFrom)
        .range(a, b),
    );

    if (error) {
      console.warn("fetchRevenueBreakdown error (trying with basic fields):", error);
      // Fallback to basic query without the new fields
      const { data: baseData, error: baseError } = await fetchAll((a, b) =>
        supabase
          .from("reservations")
          .select("created_at, seller_name, status, rack_rate")
          .gte("created_at", histFrom)
          .range(a, b),
      );

      if (baseError) {
        console.error("fetchRevenueBreakdown fallback error:", baseError);
        return [];
      }

      // Add zero values for missing fields
      return (baseData ?? []).map((r: any) => ({
        created_at: r.created_at,
        seller_name: r.seller_name,
        status: r.status,
        rack_rate: r.rack_rate ?? 0,
        miscellaneous_price: 0,
        additional_charges_price: 0,
      }));
    }

    // Ensure all values are numbers, not null
    return (data ?? []).map((r: any) => ({
      created_at: r.created_at,
      seller_name: r.seller_name,
      status: r.status,
      rack_rate: r.rack_rate ?? 0,
      miscellaneous_price: r.miscellaneous_price ?? 0,
      additional_charges_price: r.additional_charges_price ?? 0,
    })) as Pick<
      CRes,
      | "created_at"
      | "seller_name"
      | "status"
      | "rack_rate"
      | "miscellaneous_price"
      | "additional_charges_price"
    >[];
  } catch (err) {
    console.error("fetchRevenueBreakdown exception:", err);
    return [];
  }
}

/** Oportunidades ativas (abertas) do funil Comercial: independe do período e exclui ganhas/perdidas. */
export async function fetchActiveOpportunities(): Promise<COpp[]> {
  const { data, error } = await fetchAll((a, b) =>
    supabase
      .from("crm_opportunities")
      .select(
        "opportunity_id, lead_id, name, stage_name, status, seller_name, pending_tasks, delayed_tasks, total_tasks, created_at",
      )
      .eq("pipeline_name", "Comercial")
      .eq("status", "open")
      .order("opportunity_id")
      .range(a, b),
  );
  if (error) throw error;
  return (data as COpp[]).filter(
    (o) => isOperationalSeller(o.seller_name) || !o.seller_name?.trim(),
  );
}

/** lead_id → nº de tarefas atrasadas (não concluídas, vencimento já passou — inclusive hoje, como no
 * ClickMassa; sem hora gravada, vale o prazo anterior a hoje). Independe do período. */
export async function fetchOverdueTasksByLead(): Promise<Map<string, number>> {
  const today = ymdLocal(new Date());
  const now = new Date().toISOString();
  const { data, error } = await fetchAll((a, b) =>
    supabase
      .from("crm_tasks")
      .select("task_id, lead_id")
      .eq("completed", false)
      .or(`due_at.lt.${now},and(due_at.is.null,due_date.lt.${today})`)
      .not("lead_id", "is", null)
      .order("task_id")
      .range(a, b),
  );
  if (error) throw error;
  const map = new Map<string, number>();
  (data as { lead_id: string }[]).forEach((t) => map.set(t.lead_id, (map.get(t.lead_id) ?? 0) + 1));
  return map;
}

const ymdLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export async function fetchComercial(from: string, to: string) {
  const { prevFrom, prevTo } = getPreviousPeriod(from, to);

  const histFrom = startIso(prevFrom);

  const [res, tasks, goals, opps, prevRes, prevOpps, yearRes, yearOpps] = await Promise.all([
    fetchAll((a, b) =>
      supabase
        .from("reservations")
        .select(
          "created_at, total_amount, discount_amount, rack_rate, status, seller_name, pick_up_at, reservation_id",
        )
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
    supabase
      .from("sales_goals")
      .select("seller_name, month, revenue_goal, ticket_goal, discount_goal, conversion_goal"),
    fetchAll((a, b) =>
      supabase
        .from("crm_opportunities")
        .select(
          "opportunity_id, lead_id, name, stage_name, status, seller_name, pending_tasks, total_tasks, created_at",
        )
        .eq("pipeline_name", "Comercial")
        .order("opportunity_id")
        .range(a, b),
    ),
    // Período anterior (para comparação)
    fetchAll((a, b) =>
      supabase
        .from("reservations")
        .select("created_at, total_amount, discount_amount, rack_rate, status, seller_name")
        .gte("created_at", startIso(prevFrom))
        .lte("created_at", endIso(prevTo))
        .range(a, b),
    ),
    fetchAll((a, b) =>
      supabase
        .from("crm_opportunities")
        .select(
          "opportunity_id, lead_id, status, seller_name, pending_tasks, total_tasks, created_at",
        )
        .eq("pipeline_name", "Comercial")
        .gte("created_at", oppStartIso(prevFrom))
        .lte("created_at", oppEndIso(prevTo))
        .range(a, b),
    ),
    fetchAll((a, b) =>
      supabase
        .from("reservations")
        .select("created_at, total_amount, discount_amount, rack_rate, status, seller_name")
        .eq("status", "confirmed")
        .gte("created_at", startIso(previousYearDate(from)))
        .lte("created_at", endIso(previousYearDate(to)))
        .range(a, b),
    ),
    fetchAll((a, b) =>
      supabase
        .from("crm_opportunities")
        .select(
          "opportunity_id, lead_id, name, stage_name, status, seller_name, pending_tasks, total_tasks, created_at",
        )
        .eq("pipeline_name", "Comercial")
        .gte("created_at", oppStartIso(previousYearDate(from)))
        .lte("created_at", oppEndIso(previousYearDate(to)))
        .range(a, b),
    ),
  ]);

  // Reservas do período sem retirada em reservations: usa o primeiro trecho (reservation_segments), que o sync preenche por veículo.
  const missingPickup = ((res.data ?? []) as CRes[]).filter(
    (r) =>
      !r.pick_up_at &&
      r.reservation_id &&
      r.created_at >= startIso(from) &&
      r.created_at <= endIso(to),
  );
  if (missingPickup.length) {
    const firstPickup = new Map<string, string>();
    for (let i = 0; i < missingPickup.length; i += 200) {
      const ids = missingPickup.slice(i, i + 200).map((r) => r.reservation_id!);
      const { data: segs } = await supabase
        .from("reservation_segments")
        .select("reservation_id, pick_up_at")
        .in("reservation_id", ids);
      (segs ?? []).forEach((sg) => {
        const cur = firstPickup.get(sg.reservation_id);
        if (!cur || sg.pick_up_at < cur) firstPickup.set(sg.reservation_id, sg.pick_up_at);
      });
    }
    missingPickup.forEach((r) => {
      r.pick_up_at = firstPickup.get(r.reservation_id!) ?? null;
    });
  }

  const revenueBreakdownData = await fetchRevenueBreakdown();

  // Leads do Kommo (anteriores ao ClickMassa): período anterior, 5 meses dos gráficos e ano anterior.
  const [ty, tm] = to.split("-").map(Number);
  const chartFrom = new Date(ty!, tm! - 5, 1).toISOString();
  const kommoFrom = chartFrom < histFrom ? chartFrom : histFrom;
  const [kommo, kommoYear] = await Promise.all([
    fetchKommoLeads(kommoFrom, endIso(to)),
    fetchKommoLeads(startIso(previousYearDate(from)), endIso(previousYearDate(to))),
  ]);
  const kommoOpps = kommo.map((lead) => kommoAsOpportunity(lead));
  const err =
    res.error ||
    tasks.error ||
    goals.error ||
    opps.error ||
    prevRes.error ||
    prevOpps.error ||
    yearRes.error ||
    yearOpps.error;
  if (err) throw err;

  return {
    opportunities: [...((opps.data ?? []) as COpp[]), ...kommoOpps] as COpp[],
    reservations: (res.data as CRes[]).map((r) => ({
      ...r,
      total_amount: Number(r.total_amount),
      discount_amount: Number(r.discount_amount),
      rack_rate: r.rack_rate == null ? null : Number(r.rack_rate),
      miscellaneous_price: r.miscellaneous_price == null ? 0 : Number(r.miscellaneous_price),
      additional_charges_price:
        r.additional_charges_price == null ? 0 : Number(r.additional_charges_price),
    })),
    tasks: tasks.data as CTask[],
    goals: ((goals.data ?? []) as any[]).map((g) => ({
      ...g,
      revenue_goal: Number(g.revenue_goal),
      ticket_goal: Number(g.ticket_goal),
      discount_goal: Number(g.discount_goal ?? 0),
      conversion_goal: Number(g.conversion_goal ?? 0),
    })),
    yearReservations: (yearRes.data as CRes[]).map((r) => ({
      ...r,
      total_amount: Number(r.total_amount),
      discount_amount: Number(r.discount_amount),
      rack_rate: r.rack_rate == null ? null : Number(r.rack_rate),
      miscellaneous_price: r.miscellaneous_price == null ? 0 : Number(r.miscellaneous_price),
      additional_charges_price:
        r.additional_charges_price == null ? 0 : Number(r.additional_charges_price),
    })),
    yearOpportunities: [
      ...((yearOpps.data ?? []) as COpp[]),
      ...kommoYear.map((lead) => kommoAsOpportunity(lead)),
    ] as COpp[],
    prevData: {
      reservations: (prevRes.data ?? []).map((r: any) => ({
        ...r,
        total_amount: Number(r.total_amount),
        discount_amount: Number(r.discount_amount ?? 0),
        rack_rate: r.rack_rate == null ? null : Number(r.rack_rate),
        miscellaneous_price: r.miscellaneous_price == null ? 0 : Number(r.miscellaneous_price),
        additional_charges_price:
          r.additional_charges_price == null ? 0 : Number(r.additional_charges_price),
      })),
      opportunities: [
        ...(prevOpps.data ?? []),
        ...kommoOpps.filter((o) => oppInRange(o.created_at, prevFrom, prevTo)),
      ],
    },
    revenueBreakdownData,
  };
}

export type ComercialData = Awaited<ReturnType<typeof fetchComercial>>;

const OPERATIONAL_SELLERS = new Set(["nathalia", "mauro", "gessica", "thalita"]);
export const isOperationalSeller = (name: string | null | undefined) =>
  OPERATIONAL_SELLERS.has(sellerKey(name));

export function filterOperationalData(data: ComercialData): ComercialData {
  const keepGoal = (goal: Goal) =>
    goal.seller_name === GLOBAL_GOAL ||
    goal.seller_name === OCCUPANCY_GOAL ||
    isOperationalSeller(goal.seller_name);
  return {
    ...data,
    opportunities: data.opportunities.filter((row) => isOperationalSeller(row.seller_name)),
    reservations: data.reservations.filter((row) => isOperationalSeller(row.seller_name)),
    tasks: data.tasks.filter((row) => isOperationalSeller(row.user_name)),
    goals: data.goals.filter(keepGoal),
    yearReservations: data.yearReservations.filter((row) => isOperationalSeller(row.seller_name)),
    yearOpportunities: data.yearOpportunities.filter((row) => isOperationalSeller(row.seller_name)),
    prevData: {
      ...data.prevData,
      reservations: data.prevData.reservations.filter((row) =>
        isOperationalSeller(row.seller_name),
      ),
      opportunities: (data.prevData.opportunities as { seller_name: string | null }[]).filter(
        (row) => isOperationalSeller(row.seller_name),
      ),
    },
  };
}

export function filterNonAgencyData(
  data: ComercialData,
  origins: Map<string, string>,
): ComercialData {
  return {
    ...data,
    opportunities: keepNonAgencyOpps(data.opportunities, origins),
    yearOpportunities: keepNonAgencyOpps(data.yearOpportunities, origins),
    prevData: {
      ...data.prevData,
      opportunities: keepNonAgencyOpps(data.prevData.opportunities as COpp[], origins),
    },
  };
}

export function computeOpportunityTotalsBySeller(opportunities: Pick<COpp, "seller_name">[]) {
  const totals = new Map<
    string,
    { key: string; name: string; oportunidades: number; reservas: number }
  >();
  opportunities.forEach((opportunity) => {
    const key = sellerKey(opportunity.seller_name);
    const row = totals.get(key) ?? {
      key,
      name: opportunity.seller_name?.trim() || UNASSIGNED_LABEL,
      oportunidades: 0,
      reservas: 0,
    };
    row.oportunidades++;
    totals.set(key, row);
  });
  return [...totals.values()].sort((a, b) => b.oportunidades - a.oportunidades);
}

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

const MONTHS_PT = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

export function computeMonthlyCommercial(
  opportunities: Pick<COpp, "created_at" | "seller_name">[],
  reservations: Pick<
    CRes,
    "created_at" | "seller_name" | "status" | "total_amount" | "discount_amount" | "rack_rate"
  >[],
  seller: string,
  from: string,
  to: string,
  useHqRackRate = false,
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
    const bucket = buckets.get(oppMonth(opportunity.created_at));
    if (bucket) bucket.oportunidades++;
  });
  reservations.forEach((reservation) => {
    if (reservation.status !== "confirmed") return;
    const reservationSeller = sellerKey(reservation.seller_name);
    const effectiveSeller =
      reservationSeller === "sem_vendedor" ? "venda_direta" : reservationSeller;
    if (seller !== "all" && effectiveSeller !== seller) return;
    const bucket = buckets.get(reservation.created_at.slice(0, 7));
    if (!bucket) return;
    bucket.reservas++;
    bucket.faturamento += reservationRackRate(reservation, useHqRackRate);
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

const COMMERCIAL_TEAM = new Set(["thalita", "mauro", "nathalia", "gessica"]);
const isCommercialTeam = (name: string | null | undefined) => COMMERCIAL_TEAM.has(sellerKey(name));

export function computeDailyRevenueBreakdown(
  reservations: Pick<
    CRes,
    | "created_at"
    | "seller_name"
    | "status"
    | "rack_rate"
    | "miscellaneous_price"
    | "additional_charges_price"
  >[],
  from: string,
  to: string,
): Array<{
  dia: string;
  rackRate: number;
  miscellaneousPrice: number;
  additionalChargesPrice: number;
  total: number;
}> {
  const buckets = new Map<
    string,
    { dia: string; rackRate: number; miscellaneousPrice: number; additionalChargesPrice: number }
  >();
  for (const key of revenueBreakdownMonths()) {
    const dia = `${key.slice(5, 7)}/${key.slice(2, 4)}`;
    buckets.set(key, {
      dia,
      rackRate: 0,
      miscellaneousPrice: 0,
      additionalChargesPrice: 0,
    });
  }

  let totalRackRate = 0;
  let totalMiscellaneous = 0;
  let totalAdditionalCharges = 0;
  let processedCount = 0;

  reservations.forEach((reservation) => {
    if (reservation.status !== "confirmed") return;
    if (!isCommercialTeam(reservation.seller_name)) return;
    const key = reservation.created_at.slice(0, 7);
    const bucket = buckets.get(key);
    if (!bucket) return;

    const rr = reservation.rack_rate ?? 0;
    const mp = reservation.miscellaneous_price ?? 0;
    const acp = reservation.additional_charges_price ?? 0;

    bucket.rackRate += rr;
    bucket.miscellaneousPrice += mp;
    bucket.additionalChargesPrice += acp;

    totalRackRate += rr;
    totalMiscellaneous += mp;
    totalAdditionalCharges += acp;
    processedCount++;
  });

  if (processedCount > 0) {
    console.debug("[RevenueBreakdown] Processados:", {
      processedCount,
      totalRackRate,
      totalMiscellaneous,
      totalAdditionalCharges,
    });
  }

  return [...buckets.values()].map((b) => ({
    ...b,
    total: b.rackRate + b.miscellaneousPrice + b.additionalChargesPrice,
  }));
}

export function computeComercial(
  d: ComercialData,
  from: string,
  to: string,
  seller: string,
  useHqRackRate = false,
) {
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
        key: k,
        name: "",
        leads: 0,
        oportunidades: 0,
        overdue: 0,
        pending: 0,
        done: 0,
        tasksTotal: 0,
        noTask: 0,
        reservas: 0,
        conversao: 0,
        ticket: 0,
        faturamento: 0,
        descontoPct: 0,
        revenueGoal: 0,
        ticketGoal: 0,
        discountGoal: 0,
        gross: 0,
        disc: 0,
      });
    return rows.get(k)!;
  };

  const isOpen = (o: COpp) => (o.status ?? "open").toLowerCase() === "open";
  // Mesmo critério do filtro "Sem tarefas" do ClickMassa: aberta e que nunca teve tarefa (nem concluída).
  const hasNoTask = (o: COpp) => isOpen(o) && o.total_tasks === 0;
  const opps = d.opportunities.filter((o) => oppInRange(o.created_at, from, to));
  const sellerOpps = opps.filter((o) => seller === "all" || sellerKey(o.seller_name) === seller);

  opps.forEach((o) => {
    const r = touch(nameOf(o.seller_name));
    r.leads++;
    r.oportunidades++;
    if (hasNoTask(o)) r.noTask++;
  });

  d.tasks
    .filter((t) => inPeriod(t.created_at))
    .forEach((t) => {
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
      row.faturamento += reservationRackRate(r, useHqRackRate);
      row.disc += r.discount_amount;
      row.gross += r.total_amount + r.discount_amount;
    });

  // Faturamento das reservas criadas no período (e do vendedor filtrado), agrupado pelo mês de retirada.
  const pickupMonths = new Map<
    string,
    { monthKey: string; mes: string; faturamento: number; reservas: number }
  >();
  confirmed
    .filter(
      (r) => inPeriod(r.created_at) && (seller === "all" || sellerKey(r.seller_name) === seller),
    )
    .forEach((r) => {
      const monthKey = r.pick_up_at ? r.pick_up_at.slice(0, 7) : "sem-data";
      const [y, m] = monthKey.split("-");
      const row = pickupMonths.get(monthKey) ?? {
        monthKey,
        mes: monthKey === "sem-data" ? "Sem data" : `${MONTHS_PT[Number(m) - 1]}/${y}`,
        faturamento: 0,
        reservas: 0,
      };
      row.faturamento += reservationRackRate(r, useHqRackRate);
      row.reservas++;
      pickupMonths.set(monthKey, row);
    });
  const revenueByPickupMonth = [...pickupMonths.values()].sort((a, b) =>
    a.monthKey.localeCompare(b.monthKey),
  );

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

  // O time operacional sempre aparece (ex.: no painel de metas), mesmo sem atividade no período.
  const knownNames = [
    ...d.goals.map((g) => g.seller_name),
    ...d.yearReservations.map((r) => r.seller_name),
    ...d.yearOpportunities.map((o) => o.seller_name),
  ];
  OPERATIONAL_SELLERS.forEach((key) => {
    if (rows.has(key)) return;
    const known = knownNames.find((n) => n && sellerKey(n) === key)?.trim();
    names.set(key, known ?? key.charAt(0).toUpperCase() + key.slice(1));
    touch(key);
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
  // Oportunidades sem tarefas: todas as abertas sem tarefa criadas até o fim do período
  const noTaskList = d.opportunities
    .filter((o) => Date.parse(o.created_at) <= Date.parse(oppEndIso(to)))
    .filter((o) => seller === "all" || sellerKey(o.seller_name) === seller)
    // Somente o time comercial (vendedores operacionais).
    .filter((o) => isOperationalSeller(o.seller_name))
    .filter(hasNoTask)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((o) => ({ ...o, owner: o.seller_name?.trim() || UNASSIGNED_LABEL }));
  const leadsNoTask = noTaskList.length;
  // Sem tarefas por vendedor: todos os períodos, sem filtro de data, só time comercial.
  const noTaskBySellerMap = new Map<string, { name: string; noTask: number }>();
  d.opportunities
    .filter((o) => isOperationalSeller(o.seller_name) && hasNoTask(o))
    .forEach((o) => {
      const k = nameOf(o.seller_name);
      const row = noTaskBySellerMap.get(k) ?? { name: names.get(k) ?? UNASSIGNED_LABEL, noTask: 0 };
      row.noTask++;
      noTaskBySellerMap.set(k, row);
    });
  const noTaskBySeller = [...noTaskBySellerMap.values()].sort((a, b) => b.noTask - a.noTask);

  const daily = new Map<string, { dia: string; leads: number; oportunidades: number }>();
  const dailyOpportunitiesBySeller = new Map<string, Record<string, string | number>>();
  const dailyRevenueBySeller = new Map<string, Record<string, string | number>>();
  for (
    let c = new Date(from + "T00:00:00");
    c <= new Date(to + "T00:00:00");
    c.setDate(c.getDate() + 1)
  ) {
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
  sellerOpps.forEach((o) => {
    const key = dayKey(o.created_at);
    const b = daily.get(key);
    if (b) {
      b.leads++;
      b.oportunidades++;
    }
    const sellerName = names.get(nameOf(o.seller_name)) ?? UNASSIGNED_LABEL;
    const stacked = dailyOpportunitiesBySeller.get(key);
    if (stacked) stacked[sellerName] = Number(stacked[sellerName] ?? 0) + 1;
  });

  const dailyRevenueKeys = new Set<string>();
  confirmed
    .filter((r) => inPeriod(r.created_at))
    .forEach((r) => {
      const key = dayKey(r.created_at);
      const sellerKeyValue = nameOf(r.seller_name);
      const effectiveSeller = sellerKeyValue === "sem_vendedor" ? "venda_direta" : sellerKeyValue;
      if (seller !== "all" && effectiveSeller !== seller) return;
      if (effectiveSeller === "venda_direta") names.set(effectiveSeller, DIRECT_SALE_LABEL);
      const sellerName = names.get(effectiveSeller) ?? effectiveSeller;
      const stacked = dailyRevenueBySeller.get(key);
      if (stacked) {
        stacked[sellerName] =
          Number(stacked[sellerName] ?? 0) + reservationRackRate(r, useHqRackRate);
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
  const taskExecutionRateFormatted =
    totalTasksUnfiltered > 0
      ? `${((doneTasks / totalTasksUnfiltered) * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
      : "0%";

  const filteredTasks = d.tasks.filter(
    (t) => seller === "all" || sellerKey(t.user_name) === seller,
  );
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
  const leadCreatedAt = new Map<string, number>();
  sellerOpps.forEach((opportunity) => {
    if (!opportunity.lead_id) return;
    const createdAt = new Date(opportunity.created_at).getTime();
    if (isNaN(createdAt)) return;
    const existing = leadCreatedAt.get(opportunity.lead_id);
    if (existing === undefined || createdAt < existing)
      leadCreatedAt.set(opportunity.lead_id, createdAt);
  });
  leadCreatedAt.forEach((leadTime, leadId) => {
    const firstTaskTime = leadFirstTaskMap.get(leadId);
    if (firstTaskTime && firstTaskTime >= leadTime) {
      responseTimesInMinutes.push((firstTaskTime - leadTime) / (1000 * 60));
    }
  });

  let slaFormatted = "--";
  if (responseTimesInMinutes.length > 0) {
    const avgMinutes =
      responseTimesInMinutes.reduce((a, b) => a + b, 0) / responseTimesInMinutes.length;
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
  const prevFilteredRes =
    seller === "all"
      ? prevConfirmed
      : prevConfirmed.filter((r: any) => sellerKey(r.seller_name) === seller);
  const prevFilteredOpps =
    seller === "all"
      ? d.prevData.opportunities
      : d.prevData.opportunities.filter((o: any) => sellerKey(o.seller_name) === seller);

  const prevOppsCount = prevFilteredOpps.length;
  const prevReservasCount = prevFilteredRes.length;
  const prevFaturamento = prevFilteredRes.reduce(
    (acc: number, r: any) => acc + reservationRackRate({ rack_rate: r.rack_rate }, useHqRackRate),
    0,
  );
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

  const belongsToSeller = (r: { seller_name: string | null }) =>
    seller === "all" ||
    (sellerKey(r.seller_name) === "sem_vendedor" ? "venda_direta" : sellerKey(r.seller_name)) ===
      seller;
  const currentDiscount = averageDiscount(
    confirmed.filter((r) => inPeriod(r.created_at) && belongsToSeller(r)),
  );
  const priorYear = d.yearReservations.filter(belongsToSeller);
  const kpis = {
    descontoPct: currentDiscount,
    descontoYearDiff: yearOverYearDiscount(
      currentDiscount,
      averageDiscount(priorYear),
      priorYear.length > 0,
    ),
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
    bucket[n] = ((bucket[n] as number | undefined) ?? 0) + reservationRackRate(r, useHqRackRate);
  });

  return {
    daily: [...daily.values()],
    dailyOpportunitiesBySeller: [...dailyOpportunitiesBySeller.values()],
    dailyOpportunityKeys: [
      ...new Set(sellerOpps.map((o) => names.get(nameOf(o.seller_name)) ?? UNASSIGNED_LABEL)),
    ],
    dailyRevenueBySeller: [...dailyRevenueBySeller.values()],
    dailyRevenueKeys: [...dailyRevenueKeys],
    noTaskList,
    noTaskBySeller,
    kpis,
    rows: visible.filter((r) => r.oportunidades || r.reservas || r.overdue || r.pending || r.done),
    sellers,
    monthly: [...monthly.values()],
    revenueByPickupMonth,
    monthlyKpis: computeMonthlyCommercial(
      d.opportunities,
      d.reservations,
      seller,
      from,
      to,
      useHqRackRate,
    ),
    monthlyKpisPreviousYear: computeMonthlyCommercial(
      d.yearOpportunities,
      d.yearReservations,
      seller,
      previousYearDate(from),
      previousYearDate(to),
      useHqRackRate,
    ),
    revenueBreakdown: computeDailyRevenueBreakdown((d as any).revenueBreakdownData ?? [], from, to),
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
