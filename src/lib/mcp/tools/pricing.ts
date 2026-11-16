import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { mcpDb, type McpDb } from "../supabase";
import {
  assertPeriod,
  compose,
  dateArg,
  fetchAllFrom,
  fetchPage,
  num,
  ok,
  pagingArgs,
  range,
  ratio,
  readOnly,
  round2,
  slicePage,
  textArg,
} from "./paginate";

type Rate = {
  pickup_date: string;
  category: string;
  daily_rate: number;
  season: string | null;
  source: string;
  currency: string | null;
  collected_at: string;
};

export const ourRates = defineTool({
  name: "our_rates",
  title: "Nossas tarifas coletadas",
  description:
    "Tarifas diárias da Orlando Rent Car coletadas por data de retirada e categoria. latest_only devolve só a coleta mais recente de cada data+categoria; group_by=category resume mín/média/máx.",
  inputSchema: {
    from: dateArg.describe("Retirada a partir de"),
    to: dateArg.describe("Retirada até"),
    category: textArg.optional().describe("Categoria exata"),
    season: textArg.optional(),
    source: textArg.optional(),
    collected_from: dateArg.optional(),
    collected_to: dateArg.optional(),
    latest_only: z.boolean().default(true),
    group_by: z.enum(["none", "category"]).default("none"),
    ...pagingArgs,
  },
  annotations: readOnly,
  handler: async (a, ctx) => {
    assertPeriod(a.from, a.to);
    assertPeriod(a.collected_from, a.collected_to);
    const sb = mcpDb(ctx);
    const rows = await fetchAllFrom<Rate>(
      sb,
      "mcp_our_rate_snapshots",
      "pickup_date,category,daily_rate,season,source,currency,collected_at",
      compose(
        range("pickup_date", a.from, a.to, false),
        range("collected_at", a.collected_from, a.collected_to),
        a.category && ((q) => q.eq("category", a.category)),
        a.season && ((q) => q.eq("season", a.season)),
        a.source && ((q) => q.eq("source", a.source)),
      ),
      "id",
    );
    let out = rows;
    if (a.latest_only) {
      const last = new Map<string, Rate>();
      for (const r of rows) {
        const k = `${r.pickup_date}|${r.category}`;
        const p = last.get(k);
        if (!p || r.collected_at > p.collected_at) last.set(k, r);
      }
      out = [...last.values()];
    }
    out = out
      .map((r) => ({ ...r, daily_rate: num(r.daily_rate) }))
      .sort(
        (x, y) =>
          x.pickup_date.localeCompare(y.pickup_date) || x.category.localeCompare(y.category),
      );
    if (a.group_by === "category") {
      const m = new Map<string, number[]>();
      for (const r of out) m.set(r.category, [...(m.get(r.category) ?? []), r.daily_rate]);
      const groups = [...m.entries()].map(([category, v]) => ({
        category,
        observations: v.length,
        min: Math.min(...v),
        avg: round2(v.reduce((s, x) => s + x, 0) / v.length),
        max: Math.max(...v),
      }));
      return ok(slicePage(groups, a.limit, a.offset));
    }
    return ok(slicePage(out, a.limit, a.offset));
  },
});

async function latestPayload<T>(
  sb: McpDb,
  view: "mcp_pricing_occupancy_forecast" | "mcp_pricing_occupancy_pace",
  asOf?: string,
) {
  let q = sb.from(view).select("id,generated_at,as_of,payload");
  if (asOf) q = q.eq("as_of", asOf);
  const { data, error } = await q
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new ToolError(error.message);
  if (!data) throw new ToolError("Nenhuma geração encontrada");
  return data as unknown as { generated_at: string; as_of: string; payload: T };
}

type FRow = {
  d: string;
  c: string;
  f: number;
  v: number;
  o: number;
  e: number;
  lo: number;
  hi: number;
  n: number;
  b: string;
  s: string;
};

export const occupancyForecast = defineTool({
  name: "occupancy_forecast",
  title: "Previsão de ocupação",
  description:
    "Previsão de ocupação por data e categoria da geração mais recente (ou de as_of): frota, diárias vendidas, ocupação atual e esperada (mediana e quartis). group_by=date dá o total do dia ponderado pela frota.",
  inputSchema: {
    from: dateArg.optional(),
    to: dateArg.optional(),
    category: textArg.optional(),
    as_of: dateArg.optional().describe("Data da geração; padrão = mais recente"),
    group_by: z.enum(["none", "date"]).default("none"),
    ...pagingArgs,
  },
  annotations: readOnly,
  handler: async (a, ctx) => {
    assertPeriod(a.from, a.to);
    const sb = mcpDb(ctx);
    const g = await latestPayload<{ linhas?: FRow[]; categorias?: string[] }>(
      sb,
      "mcp_pricing_occupancy_forecast",
      a.as_of,
    );
    const lines = (g.payload.linhas ?? []).filter(
      (r) =>
        (!a.from || r.d >= a.from) && (!a.to || r.d <= a.to) && (!a.category || r.c === a.category),
    );
    const meta = {
      generated_at: g.generated_at,
      as_of: g.as_of,
      categories: g.payload.categorias ?? [],
    };
    if (a.group_by === "none") {
      const rows = lines.map((r) => ({
        date: r.d,
        category: r.c,
        fleet: r.f,
        sold_days: r.v,
        occupancy: r.o,
        expected: r.e,
        expected_low: r.lo,
        expected_high: r.hi,
        observations: r.n,
        basis: r.b,
        season: r.s,
      }));
      return ok({ ...meta, ...slicePage(rows, a.limit, a.offset) });
    }
    const byDate = new Map<string, FRow[]>();
    for (const r of lines) byDate.set(r.d, [...(byDate.get(r.d) ?? []), r]);
    const rows = [...byDate.entries()]
      .sort(([x], [y]) => x.localeCompare(y))
      .map(([date, rs]) => {
        const f = rs.reduce((s, r) => s + r.f, 0);
        const w = (k: "e" | "lo" | "hi") =>
          f ? round2(rs.reduce((s, r) => s + r[k] * r.f, 0) / f) : null;
        const v = rs.reduce((s, r) => s + r.v, 0);
        return {
          date,
          fleet: f,
          sold_days: v,
          occupancy: f ? round2(v / f) : null,
          expected: w("e"),
          expected_low: w("lo"),
          expected_high: w("hi"),
        };
      });
    return ok({ ...meta, ...slicePage(rows, a.limit, a.offset) });
  },
});

type PRow = {
  d: string;
  c: string;
  f: number;
  g?: number;
  a?: number[];
  x?: [number, number | null][];
  m?: number[];
  v?: number;
  p?: number;
};

export const occupancyPace = defineTool({
  name: "occupancy_pace",
  title: "Ritmo de vendas (pace)",
  description:
    "Ritmo de vendas por data e categoria da geração mais recente: frota, diárias vendidas, antecedência média de compra (dias), diárias canceladas e receita das diárias (USD, quando o payload traz preço).",
  inputSchema: {
    from: dateArg.optional(),
    to: dateArg.optional(),
    category: textArg.optional(),
    as_of: dateArg.optional(),
    ...pagingArgs,
  },
  annotations: readOnly,
  handler: async (a, ctx) => {
    assertPeriod(a.from, a.to);
    const sb = mcpDb(ctx);
    const g = await latestPayload<{ versao?: number; linhas?: PRow[]; categorias?: string[] }>(
      sb,
      "mcp_pricing_occupancy_pace",
      a.as_of,
    );
    const rows = (g.payload.linhas ?? [])
      .filter(
        (r) =>
          (!a.from || r.d >= a.from) &&
          (!a.to || r.d <= a.to) &&
          (!a.category || r.c === a.category),
      )
      .map((r) => {
        const leads = r.a ?? [];
        const revenue = r.m ? r.m.reduce((s, x) => s + x, 0) : (r.v ?? null);
        return {
          date: r.d,
          category: r.c,
          fleet: r.f,
          sold_days: leads.length,
          occupancy: r.f ? round2(leads.length / r.f) : null,
          avg_lead_time_days: ratio(
            leads.reduce((s, x) => s + x, 0),
            leads.length,
          ),
          cancelled_days: r.x?.length ?? 0,
          revenue: revenue == null ? null : round2(revenue),
        };
      });
    return ok({
      generated_at: g.generated_at,
      as_of: g.as_of,
      payload_version: g.payload.versao ?? null,
      ...slicePage(rows, a.limit, a.offset),
    });
  },
});

export const pricingStudyReports = defineTool({
  name: "pricing_study_reports",
  title: "Estudos de precificação",
  description:
    "Estudos de precificação gerados (data de geração e período coberto). O conteúdo HTML não é exposto.",
  inputSchema: {
    from: dateArg.optional().describe("Período do estudo termina a partir de"),
    to: dateArg.optional().describe("Período do estudo começa até"),
    ...pagingArgs,
  },
  annotations: readOnly,
  handler: async (a, ctx) => {
    assertPeriod(a.from, a.to);
    const sb = mcpDb(ctx);
    const f = compose(
      a.from && ((q) => q.gte("period_end", a.from)),
      a.to && ((q) => q.lte("period_start", a.to)),
    );
    return ok(
      await fetchPage(
        sb,
        "mcp_pricing_study_report",
        "id,generated_at,period_start,period_end",
        f,
        { sortBy: "generated_at", ascending: false, limit: a.limit, offset: a.offset },
      ),
    );
  },
});
