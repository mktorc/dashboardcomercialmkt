import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { GLOBAL_GOAL, OCCUPANCY_GOAL } from "../../commercial-goals";
import { mcpDb } from "../supabase";
import { isCancelled } from "./marketing";
import { RES_COLS, resMetrics, type Res } from "./reservations";
import {
  assertPeriod,
  compose,
  dateArg,
  endOfDay,
  fetchAllFrom,
  fetchIn,
  label,
  likeTerm,
  monthArg,
  monthKey,
  num,
  ok,
  pagingArgs,
  range,
  readOnly,
  round2,
  slicePage,
  textArg,
} from "./paginate";

// ---------- Frota ----------

type Vehicle = { id: number; entry_date: string; exit_date: string | null };

export const fleetOverview = defineTool({
  name: "fleet_overview",
  title: "Visão da frota",
  description:
    "Veículos ativos numa data (entrada ≤ data e sem saída ou saída posterior), entradas e saídas por mês num período e o total informado pelo sync. A frota não tem categoria nas views.",
  inputSchema: {
    date: dateArg.optional().describe("Data de referência; padrão hoje"),
    from: dateArg.optional().describe("Início do período para entradas/saídas"),
    to: dateArg.optional(),
  },
  annotations: readOnly,
  handler: async (a, ctx) => {
    assertPeriod(a.from, a.to);
    const sb = mcpDb(ctx);
    const date = a.date ?? new Date().toISOString().slice(0, 10);
    const [vehicles, stats] = await Promise.all([
      fetchAllFrom<Vehicle>(sb, "mcp_fleet_vehicles", "id,entry_date,exit_date", (q) => q, "id"),
      fetchAllFrom<{ id: number; vehicles: number; updated_at: string }>(
        sb,
        "mcp_fleet_stats",
        "id,vehicles,updated_at",
        (q) => q,
        "id",
      ),
    ]);
    const end = endOfDay(date);
    const active = vehicles.filter(
      (v) => v.entry_date <= end && (!v.exit_date || v.exit_date > end),
    ).length;
    const movement = new Map<string, { entries: number; exits: number }>();
    if (a.from || a.to) {
      const inP = (d: string | null) =>
        !!d && (!a.from || d >= a.from) && (!a.to || d <= endOfDay(a.to));
      for (const v of vehicles) {
        for (const [d, k] of [
          [v.entry_date, "entries"],
          [v.exit_date, "exits"],
        ] as const) {
          if (!inP(d)) continue;
          const e = movement.get(monthKey(d)) ?? { entries: 0, exits: 0 };
          e[k]++;
          movement.set(monthKey(d), e);
        }
      }
    }
    return ok({
      date,
      active_vehicles: active,
      registered_vehicles: vehicles.length,
      sync_fleet_stats: stats,
      movement_by_month: [...movement.entries()]
        .sort(([x], [y]) => x.localeCompare(y))
        .map(([month, e]) => ({ month, ...e })),
    });
  },
});

// ---------- Concorrência ----------

export const competitors = defineTool({
  name: "competitors",
  title: "Concorrentes",
  description:
    "Concorrentes monitorados (tipo, ativo) e, opcionalmente, o de-para de categorias de cada um para a nossa categoria normalizada.",
  inputSchema: {
    active: z.boolean().optional(),
    kind: z.enum(["direto", "tradicional"]).optional(),
    include_category_map: z.boolean().default(false),
  },
  annotations: readOnly,
  handler: async (a, ctx) => {
    const sb = mcpDb(ctx);
    const list = await fetchAllFrom<{
      id: string;
      name: string;
      kind: string;
      active: boolean;
      created_at: string;
    }>(
      sb,
      "mcp_competitors",
      "id,name,kind,active,created_at",
      compose(
        a.active !== undefined && ((q) => q.eq("active", a.active)),
        a.kind && ((q) => q.eq("kind", a.kind)),
      ),
      "name",
    );
    if (!a.include_category_map) return ok({ competitors: list });
    const map = await fetchIn<{
      competitor_id: string;
      source_category: string;
      normalized_category: string;
    }>(
      sb,
      "mcp_competitor_category_map",
      "competitor_id,source_category,normalized_category",
      "competitor_id",
      list.map((c) => c.id),
      "competitor_id,source_category",
    );
    return ok({
      competitors: list.map((c) => ({
        ...c,
        category_map: map
          .filter((m) => m.competitor_id === c.id)
          .map(({ source_category, normalized_category }) => ({
            source_category,
            normalized_category,
          })),
      })),
    });
  },
});

type Snap = {
  competitor_id: string;
  location: string;
  source_category: string | null;
  normalized_category: string | null;
  collected_at: string;
  pickup_at: string;
  return_at: string;
  total_price: number | null;
  daily_price: number | null;
  currency: string;
  available: boolean | null;
  equivalence: string;
  taxes_included: boolean | null;
};

export const competitorPrices = defineTool({
  name: "competitor_prices",
  title: "Preços da concorrência",
  description:
    "Preços coletados dos concorrentes (nome via competitor_id → competitors.id) por data de retirada, data de coleta, concorrente, categoria normalizada, local, disponibilidade e equivalência. Lista ou resumo mín/média/máx da diária por grupo. Moeda de cada coleta em currency.",
  inputSchema: {
    pickup_from: dateArg.optional(),
    pickup_to: dateArg.optional(),
    collected_from: dateArg.optional(),
    collected_to: dateArg.optional(),
    competitor: textArg.optional().describe("Trecho do nome do concorrente"),
    category: textArg.optional().describe("normalized_category exata"),
    location: textArg.optional(),
    available: z.boolean().optional(),
    equivalence: z.enum(["equivalente", "parcial", "nao_equivalente", "nao_avaliada"]).optional(),
    group_by: z
      .enum(["none", "competitor", "category", "competitor_category", "pickup_date"])
      .default("competitor_category"),
    ...pagingArgs,
  },
  annotations: readOnly,
  handler: async (a, ctx) => {
    assertPeriod(a.pickup_from, a.pickup_to);
    assertPeriod(a.collected_from, a.collected_to);
    const sb = mcpDb(ctx);
    const comps = await fetchAllFrom<{ id: string; name: string }>(
      sb,
      "mcp_competitors",
      "id,name",
      a.competitor ? (q) => q.ilike("name", likeTerm(a.competitor!)) : (q) => q,
      "id",
    );
    const names = new Map(comps.map((c) => [c.id, c.name]));
    if (a.competitor && !comps.length)
      return ok({ total: 0, rows: [], note: "Nenhum concorrente com esse nome" });
    const rows = await fetchAllFrom<Snap>(
      sb,
      "mcp_competitor_price_snapshots",
      "competitor_id,location,source_category,normalized_category,collected_at,pickup_at,return_at,total_price,daily_price,currency,available,equivalence,taxes_included",
      compose(
        range("pickup_at", a.pickup_from, a.pickup_to),
        range("collected_at", a.collected_from, a.collected_to),
        a.competitor &&
          ((q) =>
            q.in(
              "competitor_id",
              comps.map((c) => c.id),
            )),
        a.category && ((q) => q.eq("normalized_category", a.category)),
        a.location && ((q) => q.ilike("location", likeTerm(a.location!))),
        a.available !== undefined && ((q) => q.eq("available", a.available)),
        a.equivalence && ((q) => q.eq("equivalence", a.equivalence)),
      ),
      "id",
    );
    const withName = rows.map((r) => ({
      competitor: names.get(r.competitor_id) ?? r.competitor_id,
      ...r,
    }));
    if (a.group_by === "none") {
      withName.sort((x, y) => y.collected_at.localeCompare(x.collected_at));
      return ok(slicePage(withName, a.limit, a.offset));
    }
    const key = (r: (typeof withName)[number]) =>
      a.group_by === "competitor"
        ? r.competitor
        : a.group_by === "category"
          ? label(r.normalized_category)
          : a.group_by === "pickup_date"
            ? r.pickup_at.slice(0, 10)
            : `${r.competitor} | ${label(r.normalized_category)}`;
    const m = new Map<
      string,
      { prices: number[]; quotes: number; unavailable: number; currencies: Set<string> }
    >();
    for (const r of withName) {
      const e = m.get(key(r)) ?? {
        prices: [],
        quotes: 0,
        unavailable: 0,
        currencies: new Set<string>(),
      };
      e.quotes++;
      if (r.available === false) e.unavailable++;
      if (r.daily_price != null) {
        e.prices.push(num(r.daily_price));
        e.currencies.add(r.currency);
      }
      m.set(key(r), e);
    }
    const groups = [...m.entries()]
      .map(([k, e]) => ({
        key: k,
        quotes: e.quotes,
        unavailable: e.unavailable,
        priced: e.prices.length,
        currencies: [...e.currencies],
        min_daily: e.prices.length ? Math.min(...e.prices) : null,
        avg_daily: e.prices.length
          ? round2(e.prices.reduce((s, x) => s + x, 0) / e.prices.length)
          : null,
        max_daily: e.prices.length ? Math.max(...e.prices) : null,
      }))
      .sort((x, y) => x.key.localeCompare(y.key));
    return ok({ total_quotes: rows.length, ...slicePage(groups, a.limit, a.offset) });
  },
});

// ---------- Gestão e metas ----------

type Goal = {
  seller_name: string;
  month: string;
  revenue_goal: number;
  ticket_goal: number;
  conversion_goal: number | null;
  discount_goal: number | null;
};

export const salesGoalsProgress = defineTool({
  name: "sales_goals_progress",
  title: "Metas x realizado",
  description:
    "Metas mensais (faturamento, ticket, conversão, desconto) por vendedor e o realizado em reservas confirmadas criadas no mês (cruzamento sales_goals.seller_name = reservations.seller_name). A meta geral ('empresa') compara com todas as reservas. Conversão e desconto: devolve a meta; o realizado de desconto é o total em USD.",
  inputSchema: {
    from_month: monthArg,
    to_month: monthArg.optional().describe("Padrão = from_month"),
    seller: textArg.optional(),
  },
  annotations: readOnly,
  handler: async (a, ctx) => {
    const to = a.to_month ?? a.from_month;
    assertPeriod(a.from_month, to);
    const sb = mcpDb(ctx);
    const goals = await fetchAllFrom<Goal>(
      sb,
      "mcp_sales_goals",
      "seller_name,month,revenue_goal,ticket_goal,conversion_goal,discount_goal",
      compose(
        (q) => q.gte("month", a.from_month).lte("month", to),
        a.seller && ((q) => q.ilike("seller_name", likeTerm(a.seller!))),
      ),
      "id",
    );
    const [y, m] = to.split("-").map(Number) as [number, number];
    const lastDay = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    const res = (
      await fetchAllFrom<Res>(
        sb,
        "mcp_reservations",
        RES_COLS,
        range("created_at", `${a.from_month}-01`, lastDay),
        "id",
      )
    ).filter((r) => !isCancelled(r.status));
    const rows = goals
      .filter((g) => g.seller_name !== OCCUPANCY_GOAL)
      .map((g) => {
        const mine = res.filter(
          (r) =>
            monthKey(r.created_at) === g.month &&
            (g.seller_name === GLOBAL_GOAL || r.seller_name?.trim() === g.seller_name.trim()),
        );
        const actual = resMetrics(mine);
        return {
          seller: g.seller_name === GLOBAL_GOAL ? "empresa (meta geral)" : g.seller_name,
          month: g.month,
          revenue_goal: num(g.revenue_goal),
          revenue_actual: actual.revenue,
          revenue_attainment_pct: g.revenue_goal
            ? round2((actual.revenue / num(g.revenue_goal)) * 100)
            : null,
          ticket_goal: num(g.ticket_goal),
          ticket_actual: actual.avg_ticket,
          reservations: actual.reservations,
          discount_actual: actual.discount,
          discount_goal: g.discount_goal,
          conversion_goal: g.conversion_goal,
        };
      })
      .sort((x, y) => x.month.localeCompare(y.month) || y.revenue_actual - x.revenue_actual);
    const occupancy = goals
      .filter((g) => g.seller_name === OCCUPANCY_GOAL)
      .map((g) => ({
        month: g.month,
        revenue_goal: num(g.revenue_goal),
        ticket_goal: num(g.ticket_goal),
        conversion_goal: g.conversion_goal,
      }));
    return ok({
      goals: rows,
      occupancy_goals_raw: occupancy,
      note: "Mês da reserva = YYYY-MM de created_at (hora local de Orlando gravada como UTC: não converter fuso).",
    });
  },
});

// ---------- Integrações ----------

export const syncStatus = defineTool({
  name: "sync_status",
  title: "Status das sincronizações",
  description:
    "Último sucesso de cada integração (HQ Rentals, CRM, Meta, Google...) e há quantas horas, para avaliar se os dados estão atualizados.",
  inputSchema: { stale_after_hours: z.number().min(1).max(720).default(24), ...pagingArgs },
  annotations: readOnly,
  handler: async (a, ctx) => {
    const sb = mcpDb(ctx);
    const rows = await fetchAllFrom<{ service: string; last_success_at: string }>(
      sb,
      "mcp_sync_runs",
      "service,last_success_at",
      (q) => q,
      "service",
    );
    const now = Date.now();
    const services = rows.map((r) => {
      const hours = round2((now - Date.parse(r.last_success_at)) / 3_600_000);
      return {
        service: r.service,
        last_success_at: r.last_success_at,
        hours_since: hours,
        stale: hours > a.stale_after_hours,
      };
    });
    return ok(slicePage(services, a.limit, a.offset));
  },
});
