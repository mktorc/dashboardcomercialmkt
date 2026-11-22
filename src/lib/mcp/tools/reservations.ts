import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { mcpDb } from "../supabase";
import { isCancelled } from "./marketing";
import {
  assertPeriod,
  compose,
  dateArg,
  dayKey,
  endOfDay,
  fetchAllFrom,
  fetchIn,
  fetchPage,
  label,
  likeTerm,
  monthKey,
  num,
  ok,
  pagingArgs,
  range,
  ratio,
  readOnly,
  round2,
  slicePage,
  textArg,
  type Filter,
} from "./paginate";

export const RES_COLS =
  "reservation_id,car_category,rental_days,total_amount,discount_amount,rack_rate,miscellaneous_price,additional_charges_price,status,utm_campaign,seller_name,commission_partner,created_at,pick_up_at,return_at";
export type Res = {
  reservation_id: string | null;
  car_category: string | null;
  rental_days: number;
  total_amount: number;
  discount_amount: number;
  rack_rate: number | null;
  status: string;
  utm_campaign: string | null;
  seller_name: string | null;
  commission_partner: string | null;
  created_at: string;
  pick_up_at: string | null;
  return_at: string | null;
};

const statusFilter = (mode: "all" | "confirmed" | "cancelled"): Filter | undefined =>
  mode === "confirmed"
    ? (q) => q.not("status", "ilike", "%cancel%")
    : mode === "cancelled"
      ? (q) => q.ilike("status", "%cancel%")
      : undefined;

/** Métricas de um conjunto de reservas (valores em USD). */
export function resMetrics(rows: Res[]) {
  const revenue = rows.reduce((s, r) => s + num(r.total_amount), 0);
  const days = rows.reduce((s, r) => s + num(r.rental_days), 0);
  const discount = rows.reduce((s, r) => s + num(r.discount_amount), 0);
  return {
    reservations: rows.length,
    revenue: round2(revenue),
    rental_days: days,
    avg_ticket: ratio(revenue, rows.length),
    avg_daily_rate: ratio(revenue, days),
    avg_rental_days: ratio(days, rows.length),
    discount: round2(discount),
  };
}

const reservationArgs = {
  from: dateArg,
  to: dateArg,
  date_field: z
    .enum(["created_at", "pick_up_at", "return_at"])
    .default("created_at")
    .describe("Data usada no período: criação, retirada ou devolução"),
  category: textArg.optional().describe("car_category exata"),
  seller: textArg.optional().describe("Trecho do nome do vendedor"),
  status: textArg.optional().describe("Status exato"),
  status_mode: z
    .enum(["all", "confirmed", "cancelled"])
    .default("confirmed")
    .describe("confirmed exclui status com 'cancel'"),
  utm_campaign: textArg.optional(),
  commission_partner: textArg.optional().describe("Trecho do nome do parceiro"),
};

function reservationFilter(a: {
  from: string;
  to: string;
  date_field: string;
  category?: string | undefined;
  seller?: string | undefined;
  status?: string | undefined;
  status_mode: "all" | "confirmed" | "cancelled";
  utm_campaign?: string | undefined;
  commission_partner?: string | undefined;
}) {
  assertPeriod(a.from, a.to);
  return compose(
    range(a.date_field, a.from, a.to),
    a.category && ((q) => q.eq("car_category", a.category)),
    a.seller && ((q) => q.ilike("seller_name", likeTerm(a.seller!))),
    a.status && ((q) => q.eq("status", a.status)),
    statusFilter(a.status_mode),
    a.utm_campaign && ((q) => q.eq("utm_campaign", a.utm_campaign)),
    a.commission_partner && ((q) => q.ilike("commission_partner", likeTerm(a.commission_partner!))),
  );
}

export const reservationsReport = defineTool({
  name: "reservations_report",
  title: "Relatório de reservas",
  description:
    "Reservas filtradas por período (criação, retirada ou devolução), categoria, vendedor, status, campanha e parceiro. Sem group_by: lista paginada + totais. Com group_by: receita, diárias, ticket médio, diária média e desconto por grupo. Horários (created_at, pick_up_at, return_at) são a hora LOCAL de Orlando, mesmo com sufixo Z/+00: não converter fuso.",
  inputSchema: {
    ...reservationArgs,
    group_by: z
      .enum([
        "none",
        "car_category",
        "seller_name",
        "status",
        "utm_campaign",
        "commission_partner",
        "day",
        "month",
      ])
      .default("none"),
    sort_by: z
      .enum([
        "created_at",
        "pick_up_at",
        "return_at",
        "total_amount",
        "rental_days",
        "revenue",
        "reservations",
      ])
      .default("created_at")
      .describe("revenue/reservations só com group_by"),
    ascending: z.boolean().default(false),
    ...pagingArgs,
  },
  annotations: readOnly,
  handler: async (a, ctx) => {
    const f = reservationFilter(a);
    const sb = mcpDb(ctx);
    const rows = await fetchAllFrom<Res>(sb, "mcp_reservations", RES_COLS, f, "id");
    const totals = resMetrics(rows);
    if (a.group_by === "none") {
      const sortBy =
        a.sort_by === "revenue"
          ? "total_amount"
          : a.sort_by === "reservations"
            ? "created_at"
            : a.sort_by;
      const page = await fetchPage<Res>(sb, "mcp_reservations", RES_COLS, f, {
        sortBy,
        ascending: a.ascending,
        limit: a.limit,
        offset: a.offset,
      });
      return ok({ totals, ...page });
    }
    const gb = a.group_by;
    const df = a.date_field as "created_at" | "pick_up_at" | "return_at";
    const key = (r: Res) =>
      gb === "day" ? dayKey(r[df]) : gb === "month" ? monthKey(r[df]) : label(r[gb]);
    const map = new Map<string, Res[]>();
    for (const r of rows) map.set(key(r), [...(map.get(key(r)) ?? []), r]);
    const groups = [...map.entries()].map(([k, rs]) => ({
      key: k,
      ...resMetrics(rs),
      share_of_revenue: totals.revenue
        ? round2((rs.reduce((s, r) => s + num(r.total_amount), 0) / totals.revenue) * 100)
        : null,
    }));
    const s =
      a.sort_by === "reservations"
        ? "reservations"
        : a.sort_by === "rental_days"
          ? "rental_days"
          : "revenue";
    groups.sort((x, y) =>
      gb === "day" || gb === "month"
        ? x.key.localeCompare(y.key)
        : (y[s] as number) - (x[s] as number),
    );
    return ok({ totals, ...slicePage(groups, a.limit, a.offset) });
  },
});

export const salesBySeller = defineTool({
  name: "sales_by_seller",
  title: "Vendas por vendedor",
  description:
    "Por vendedor: reservas confirmadas, valor fechado, ticket médio, diárias, diária média, desconto e canceladas, num período (criação por padrão). Filtro opcional por categoria.",
  inputSchema: {
    from: dateArg.describe("Data inicial YYYY-MM-DD"),
    to: dateArg.describe("Data final YYYY-MM-DD (inclusiva)"),
    date_field: z.enum(["created_at", "pick_up_at"]).default("created_at"),
    category: textArg.optional(),
  },
  annotations: readOnly,
  handler: async (a, ctx) => {
    const f = reservationFilter({ ...a, status_mode: "all" });
    const sb = mcpDb(ctx);
    const rows = await fetchAllFrom<Res>(sb, "mcp_reservations", RES_COLS, f, "id");
    const map = new Map<string, { ok: Res[]; cancelled: number }>();
    for (const r of rows) {
      const k = r.seller_name?.trim() || "Venda Direta / Site";
      const e = map.get(k) ?? { ok: [], cancelled: 0 };
      if (isCancelled(r.status)) e.cancelled++;
      else e.ok.push(r);
      map.set(k, e);
    }
    const sellers = [...map.entries()]
      .map(([seller, e]) => {
        const m = resMetrics(e.ok);
        return {
          seller,
          ...m,
          cancelled: e.cancelled,
          cancellation_rate: ratio(e.cancelled * 100, e.cancelled + m.reservations),
        };
      })
      .sort((x, y) => y.revenue - x.revenue);
    return ok({ from: a.from, to: a.to, sellers });
  },
});

export const reservationDetails = defineTool({
  name: "reservation_details",
  title: "Detalhes de uma reserva",
  description:
    "Reserva, trechos por veículo, histórico de status e onboarding, cruzados por reservation_id.",
  inputSchema: { reservation_id: textArg.describe("reservation_id do HQ") },
  annotations: readOnly,
  handler: async ({ reservation_id }, ctx) => {
    const sb = mcpDb(ctx);
    const by: Filter = (q) => q.eq("reservation_id", reservation_id);
    const [res, segments, history, onboarding] = await Promise.all([
      fetchAllFrom<Res>(sb, "mcp_reservations", RES_COLS, by, "id"),
      fetchAllFrom(sb, "mcp_reservation_segments", "seq,status,pick_up_at,return_at", by, "seq"),
      fetchAllFrom(
        sb,
        "mcp_reservation_status_history",
        "from_status,to_status,changed_at",
        by,
        "changed_at,id",
      ),
      fetchAllFrom(
        sb,
        "mcp_reservation_onboarding",
        "realizado,responsavel,updated_at",
        by,
        "reservation_id",
      ),
    ]);
    if (!res.length) throw new ToolError("Reserva não encontrada");
    return ok({
      reservation: res[0],
      segments,
      status_history: history,
      onboarding: onboarding[0] ?? null,
    });
  },
});

export const reservationSegments = defineTool({
  name: "reservation_segments",
  title: "Trechos de reservas (veículos em uso)",
  description:
    "Trechos de reserva (um por veículo) que se sobrepõem ao período: retirada ≤ to e devolução ≥ from. Útil para saber quantos carros estão alugados em datas. Contagem por status + lista paginada.",
  inputSchema: {
    from: dateArg,
    to: dateArg,
    status: textArg.optional().describe("Status exato do trecho"),
    ...pagingArgs,
  },
  annotations: readOnly,
  handler: async (a, ctx) => {
    assertPeriod(a.from, a.to);
    const sb = mcpDb(ctx);
    const f = compose(
      (q) => q.lte("pick_up_at", endOfDay(a.to)).gte("return_at", a.from),
      a.status && ((q) => q.eq("status", a.status)),
    );
    const rows = await fetchAllFrom<{ status: string }>(
      sb,
      "mcp_reservation_segments",
      "status",
      f,
      "reservation_id,seq",
    );
    const by_status: Record<string, number> = {};
    for (const r of rows) by_status[label(r.status)] = (by_status[label(r.status)] ?? 0) + 1;
    const page = await fetchPage(
      sb,
      "mcp_reservation_segments",
      "reservation_id,seq,status,pick_up_at,return_at",
      f,
      { sortBy: "pick_up_at", ascending: true, limit: a.limit, offset: a.offset },
    );
    return ok({ by_status, ...page });
  },
});

export const reservationStatusChanges = defineTool({
  name: "reservation_status_changes",
  title: "Mudanças de status de reservas",
  description:
    "Mudanças de status no período (ex.: cancelamentos), agrupadas por transição, status final ou dia, ou listadas.",
  inputSchema: {
    from: dateArg,
    to: dateArg,
    to_status: textArg.optional().describe("Status final exato"),
    from_status: textArg.optional(),
    group_by: z.enum(["none", "transition", "to_status", "day"]).default("transition"),
    ...pagingArgs,
  },
  annotations: readOnly,
  handler: async (a, ctx) => {
    assertPeriod(a.from, a.to);
    const sb = mcpDb(ctx);
    const f = compose(
      range("changed_at", a.from, a.to),
      a.to_status && ((q) => q.eq("to_status", a.to_status)),
      a.from_status && ((q) => q.eq("from_status", a.from_status)),
    );
    const cols = "reservation_id,from_status,to_status,changed_at";
    if (a.group_by === "none")
      return ok(
        await fetchPage(sb, "mcp_reservation_status_history", cols, f, {
          sortBy: "changed_at",
          ascending: false,
          limit: a.limit,
          offset: a.offset,
        }),
      );
    const rows = await fetchAllFrom<{
      from_status: string | null;
      to_status: string;
      changed_at: string;
    }>(sb, "mcp_reservation_status_history", cols, f, "id");
    const key = (r: (typeof rows)[number]) =>
      a.group_by === "transition"
        ? `${r.from_status ?? "(início)"} → ${r.to_status}`
        : a.group_by === "to_status"
          ? r.to_status
          : dayKey(r.changed_at);
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(key(r), (counts.get(key(r)) ?? 0) + 1);
    const groups = [...counts.entries()]
      .map(([k, count]) => ({ key: k, count }))
      .sort((x, y) => (a.group_by === "day" ? x.key.localeCompare(y.key) : y.count - x.count));
    return ok({ total_changes: rows.length, ...slicePage(groups, a.limit, a.offset) });
  },
});

export const reservationOnboardingReport = defineTool({
  name: "reservation_onboarding_report",
  title: "Onboarding de reservas",
  description:
    "Onboarding das reservas confirmadas com retirada no período (cruza reservations.reservation_id = reservation_onboarding.reservation_id): realizados, pendentes e por responsável. Lista paginada das reservas com seu status de onboarding.",
  inputSchema: {
    from: dateArg.describe("Retirada a partir de"),
    to: dateArg.describe("Retirada até"),
    category: textArg.optional(),
    responsavel: textArg.optional(),
    only_pending: z.boolean().default(false),
    ...pagingArgs,
  },
  annotations: readOnly,
  handler: async (a, ctx) => {
    const f = reservationFilter({
      from: a.from,
      to: a.to,
      date_field: "pick_up_at",
      category: a.category,
      status_mode: "confirmed",
    });
    const sb = mcpDb(ctx);
    const res = await fetchAllFrom<Res>(sb, "mcp_reservations", RES_COLS, f, "id");
    const onb = await fetchIn<{
      reservation_id: string;
      realizado: boolean;
      responsavel: string | null;
      updated_at: string;
    }>(
      sb,
      "mcp_reservation_onboarding",
      "reservation_id,realizado,responsavel,updated_at",
      "reservation_id",
      res.map((r) => r.reservation_id ?? ""),
      "reservation_id",
    );
    const byId = new Map(onb.map((o) => [o.reservation_id, o]));
    let rows = res
      .map((r) => {
        const o = r.reservation_id ? byId.get(r.reservation_id) : undefined;
        return {
          reservation_id: r.reservation_id,
          car_category: r.car_category,
          seller_name: r.seller_name,
          pick_up_at: r.pick_up_at,
          realizado: !!o?.realizado,
          responsavel: o?.responsavel ?? null,
        };
      })
      .sort((x, y) => (x.pick_up_at ?? "").localeCompare(y.pick_up_at ?? ""));
    const by_responsavel: Record<string, number> = {};
    for (const r of rows)
      if (r.realizado)
        by_responsavel[label(r.responsavel)] = (by_responsavel[label(r.responsavel)] ?? 0) + 1;
    const summary = {
      reservations: rows.length,
      realizados: rows.filter((r) => r.realizado).length,
      pendentes: rows.filter((r) => !r.realizado).length,
      by_responsavel,
    };
    if (a.only_pending) rows = rows.filter((r) => !r.realizado);
    if (a.responsavel)
      rows = rows.filter((r) =>
        r.responsavel?.toLowerCase().includes(a.responsavel!.toLowerCase()),
      );
    return ok({ summary, ...slicePage(rows, a.limit, a.offset) });
  },
});

const COMM_COLS =
  "hq_reservation_id,commission_partner,seller_name,created_at,total_price,total_paid,rack_rate,commission_rate,valor_comissao,valor_repasse,desconto,manual_charge,status_repasse,paga_em,hq_status,liberada,retida_agencia,exige_validacao,currency";
type Comm = {
  commission_partner: string;
  seller_name: string | null;
  created_at: string;
  status_repasse: string;
  hq_status: string | null;
  total_price: number;
  total_paid: number;
  valor_comissao: number | null;
  valor_repasse: number | null;
};

export const commissionsReport = defineTool({
  name: "commissions_report",
  title: "Comissões de parceiros",
  description:
    "Reservas comissionadas (agências/parceiros): valores, comissão e repasse por parceiro, vendedor, status do repasse, status no HQ ou mês. Filtros por período de criação, parceiro, vendedor, status e liberação.",
  inputSchema: {
    from: dateArg,
    to: dateArg,
    partner: textArg.optional(),
    seller: textArg.optional(),
    status_repasse: z.enum(["pendente", "paga"]).optional(),
    hq_status: textArg.optional(),
    liberada: z.boolean().optional(),
    group_by: z
      .enum(["none", "commission_partner", "seller_name", "status_repasse", "hq_status", "month"])
      .default("commission_partner"),
    ...pagingArgs,
  },
  annotations: readOnly,
  handler: async (a, ctx) => {
    assertPeriod(a.from, a.to);
    const sb = mcpDb(ctx);
    const f = compose(
      range("created_at", a.from, a.to),
      a.partner && ((q) => q.ilike("commission_partner", likeTerm(a.partner!))),
      a.seller && ((q) => q.ilike("seller_name", likeTerm(a.seller!))),
      a.status_repasse && ((q) => q.eq("status_repasse", a.status_repasse)),
      a.hq_status && ((q) => q.eq("hq_status", a.hq_status)),
      a.liberada !== undefined && ((q) => q.eq("liberada", a.liberada)),
    );
    if (a.group_by === "none")
      return ok(
        await fetchPage(sb, "mcp_reservas", COMM_COLS, f, {
          sortBy: "created_at",
          ascending: false,
          limit: a.limit,
          offset: a.offset,
        }),
      );
    const rows = await fetchAllFrom<Comm>(sb, "mcp_reservas", COMM_COLS, f, "id");
    const gb = a.group_by;
    const map = new Map<
      string,
      {
        reservations: number;
        total_price: number;
        total_paid: number;
        commission: number;
        repasse: number;
      }
    >();
    for (const r of rows) {
      const k = gb === "month" ? monthKey(r.created_at) : label(r[gb]);
      const e = map.get(k) ?? {
        reservations: 0,
        total_price: 0,
        total_paid: 0,
        commission: 0,
        repasse: 0,
      };
      e.reservations++;
      e.total_price += num(r.total_price);
      e.total_paid += num(r.total_paid);
      e.commission += num(r.valor_comissao);
      e.repasse += num(r.valor_repasse);
      map.set(k, e);
    }
    const groups = [...map.entries()]
      .map(([k, e]) => ({
        key: k,
        reservations: e.reservations,
        total_price: round2(e.total_price),
        total_paid: round2(e.total_paid),
        commission: round2(e.commission),
        repasse: round2(e.repasse),
      }))
      .sort((x, y) => y.commission - x.commission);
    return ok({
      total_reservations: rows.length,
      total_commission: round2(rows.reduce((s, r) => s + num(r.valor_comissao), 0)),
      ...slicePage(groups, a.limit, a.offset),
    });
  },
});

export const commissionPartners = defineTool({
  name: "commission_partners",
  title: "Parceiros comissionados",
  description:
    "Parceiros comissionados cadastrados, com a quantidade de reservas comissionadas de cada um (cruzamento por nome do parceiro).",
  inputSchema: { with_counts: z.boolean().default(true) },
  annotations: readOnly,
  handler: async ({ with_counts }, ctx) => {
    const sb = mcpDb(ctx);
    const partners = await fetchAllFrom<{ name: string; updated_at: string }>(
      sb,
      "mcp_commission_partners",
      "name,updated_at",
      (q) => q,
      "name",
    );
    if (!with_counts) return ok({ partners });
    const res = await fetchAllFrom<{ commission_partner: string }>(
      sb,
      "mcp_reservas",
      "commission_partner",
      (q) => q,
      "id",
    );
    const counts = new Map<string, number>();
    for (const r of res)
      counts.set(r.commission_partner, (counts.get(r.commission_partner) ?? 0) + 1);
    return ok({
      partners: partners.map((p) => ({ ...p, commissioned_reservations: counts.get(p.name) ?? 0 })),
    });
  },
});

type CustRes = {
  customer_key: string | null;
  created_at: string;
  pick_up_at: string | null;
  status: string;
  total_amount: number;
  car_category: string | null;
  seller_name: string | null;
};

export const customersSummary = defineTool({
  name: "customers_summary",
  title: "Clientes atendidos",
  description:
    "Clientes únicos (chave anônima por e-mail, ou telefone na falta dele; sem dados pessoais): total já atendido ou num período, novos x recorrentes, reservas por cliente e receita por cliente. Considera reservas não canceladas por padrão. Reservas sem e-mail nem telefone ficam em reservations_without_customer_key.",
  inputSchema: {
    from: dateArg.optional().describe("Sem from/to = todo o histórico"),
    to: dateArg.optional(),
    date_field: z.enum(["created_at", "pick_up_at"]).default("created_at"),
    category: textArg.optional(),
    seller: textArg.optional(),
    include_cancelled: z.boolean().default(false),
  },
  annotations: readOnly,
  handler: async (a, ctx) => {
    assertPeriod(a.from, a.to);
    const sb = mcpDb(ctx);
    const cols = "customer_key,created_at,pick_up_at,status,total_amount,car_category,seller_name";
    // Histórico inteiro: necessário para saber se o cliente do período já tinha reservado antes.
    const all = (await fetchAllFrom<CustRes>(sb, "mcp_reservations", cols, (q) => q, "id")).filter(
      (r) => a.include_cancelled || !isCancelled(r.status),
    );
    const df = a.date_field;
    const inPeriod = (r: CustRes) => {
      const d = r[df];
      if (!a.from && !a.to) return true;
      if (!d) return false;
      return (!a.from || d >= a.from) && (!a.to || d <= endOfDay(a.to));
    };
    const sel = all.filter(
      (r) =>
        inPeriod(r) &&
        (!a.category || r.car_category === a.category) &&
        (!a.seller || (r.seller_name ?? "").toLowerCase().includes(a.seller.toLowerCase())),
    );
    const firstSeen = new Map<string, string>();
    for (const r of all) {
      if (!r.customer_key) continue;
      const d = r.created_at;
      const p = firstSeen.get(r.customer_key);
      if (!p || d < p) firstSeen.set(r.customer_key, d);
    }
    const per = new Map<string, { n: number; revenue: number }>();
    for (const r of sel) {
      if (!r.customer_key) continue;
      const e = per.get(r.customer_key) ?? { n: 0, revenue: 0 };
      e.n++;
      e.revenue += num(r.total_amount);
      per.set(r.customer_key, e);
    }
    const periodStart = a.from ?? "";
    let newCustomers = 0;
    for (const k of per.keys()) if ((firstSeen.get(k) ?? "") >= periodStart) newCustomers++;
    const dist: Record<string, number> = {};
    for (const e of per.values()) {
      const b = e.n >= 5 ? "5+" : String(e.n);
      dist[b] = (dist[b] ?? 0) + 1;
    }
    const customers = per.size;
    const keyed = sel.filter((r) => r.customer_key);
    const revenue = keyed.reduce((s, r) => s + num(r.total_amount), 0);
    return ok({
      period:
        a.from || a.to
          ? { from: a.from ?? null, to: a.to ?? null, date_field: df }
          : "todo o histórico",
      unique_customers: customers,
      new_customers: a.from ? newCustomers : customers,
      returning_customers: a.from ? customers - newCustomers : null,
      customers_with_more_than_one_reservation: [...per.values()].filter((e) => e.n > 1).length,
      reservations: sel.length,
      reservations_without_customer_key: sel.length - keyed.length,
      reservations_per_customer: ratio(keyed.length, customers),
      revenue_per_customer: ratio(revenue, customers),
      distribution_reservations_per_customer: dist,
      note: "Novo = primeira reserva (data de criação) dentro do período; recorrente = já tinha reserva antes. Cliente identificado por e-mail; sem e-mail, pelos 8 últimos dígitos do telefone. Base: reservas sincronizadas do HQ.",
    });
  },
});
