import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { mcpDb, type McpDb } from "../supabase";
import {
  assertPeriod,
  compose,
  dateArg,
  dayKey,
  fetchAllFrom,
  type Filter,
  label,
  likeTerm,
  monthArg,
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
} from "./paginate";

type AdRow = {
  date: string;
  campaign_name: string | null;
  utm_campaign: string | null;
  spend: number;
  clicks: number | null;
  impressions: number | null;
  conversions?: number | null;
};

export const isCancelled = (status: string | null | undefined) => /cancel/i.test(status ?? "");

/** Rateia o custo mensal da equipe pelos dias de [from, to] (mesma regra do painel). */
export function teamCostForRange(costs: Record<string, number>, from: string, to: string): number {
  let total = 0;
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= end; t += 86_400_000) {
    const day = new Date(t);
    const amount = costs[day.toISOString().slice(0, 7)];
    if (!amount) continue;
    total +=
      amount / new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0)).getUTCDate();
  }
  return total;
}

async function fetchAds(
  sb: McpDb,
  channel: "meta" | "google" | "all",
  from: string,
  to: string,
  campaign?: string,
  utm?: string,
) {
  const f = compose(
    range("date", from, to, false),
    campaign && ((q) => q.ilike("campaign_name", likeTerm(campaign))),
    utm && ((q) => q.eq("utm_campaign", utm)),
  );
  const base = "date,campaign_name,utm_campaign,spend,clicks,impressions";
  const [meta, google] = await Promise.all([
    channel === "google" ? [] : fetchAllFrom<AdRow>(sb, "mcp_meta_ads_metrics", base, f, "id"),
    channel === "meta"
      ? []
      : fetchAllFrom<AdRow>(sb, "mcp_google_ads_metrics", `${base},conversions`, f, "id"),
  ]);
  return [
    ...meta.map((r) => ({ ...r, channel: "meta" as const })),
    ...google.map((r) => ({ ...r, channel: "google" as const })),
  ];
}

export const marketingSummary = defineTool({
  name: "marketing_summary",
  title: "Resumo de marketing",
  description:
    "Investimento (Meta + Google Ads), custo da equipe rateado, leads, reservas e faturamento (criadas no período, sem canceladas), CPL, CPA e ROAS. Valores em USD.",
  inputSchema: {
    from: dateArg.describe("Data inicial YYYY-MM-DD"),
    to: dateArg.describe("Data final YYYY-MM-DD (inclusiva)"),
  },
  annotations: readOnly,
  handler: async ({ from, to }, ctx) => {
    assertPeriod(from, to);
    const sb = mcpDb(ctx);
    const [ads, leads, res, costs] = await Promise.all([
      fetchAds(sb, "all", from, to),
      sb
        .from("mcp_crm_leads")
        .select("id", { count: "exact", head: true })
        .gte("created_at", from)
        .lte("created_at", `${to}T23:59:59.999Z`),
      fetchAllFrom<{ total_amount: number; status: string }>(
        sb,
        "mcp_reservations",
        "total_amount,status",
        range("created_at", from, to),
        "id",
      ),
      fetchAllFrom<{ month: string; amount: number }>(
        sb,
        "mcp_marketing_team_costs",
        "month,amount",
        (q) => q,
        "month",
      ),
    ]);
    if (leads.error) throw new Error(leads.error.message);
    const sum = (ch: string, k: keyof AdRow) =>
      ads.filter((r) => r.channel === ch).reduce((s, r) => s + num(r[k]), 0);
    const metaSpend = sum("meta", "spend");
    const googleSpend = sum("google", "spend");
    const spend = metaSpend + googleSpend;
    const teamCost = teamCostForRange(
      Object.fromEntries(costs.map((c) => [c.month, num(c.amount)])),
      from,
      to,
    );
    const leadCount = leads.count ?? 0;
    const confirmed = res.filter((r) => !isCancelled(r.status));
    const revenue = confirmed.reduce((s, r) => s + num(r.total_amount), 0);
    const summary = {
      from,
      to,
      meta_spend: round2(metaSpend),
      google_spend: round2(googleSpend),
      total_spend: round2(spend),
      team_cost: round2(teamCost),
      total_cost: round2(spend + teamCost),
      clicks: sum("meta", "clicks") + sum("google", "clicks"),
      impressions: sum("meta", "impressions") + sum("google", "impressions"),
      google_conversions: round2(sum("google", "conversions")),
      leads: leadCount,
      reservations: confirmed.length,
      cancelled_reservations: res.length - confirmed.length,
      revenue: round2(revenue),
      cpl: ratio(spend, leadCount),
      cpa: ratio(spend, confirmed.length),
      roas: ratio(revenue, spend),
      roas_with_team_cost: ratio(revenue, spend + teamCost),
    };
    return ok({ summary });
  },
});

export const adsPerformance = defineTool({
  name: "ads_performance",
  title: "Desempenho de anúncios",
  description:
    "Investimento, cliques, impressões, CTR e CPC do Meta/Google Ads agrupados por campanha, canal, dia ou mês. Com include_funnel e agrupamento por utm_campaign, cruza com leads e reservas pelo utm_campaign.",
  inputSchema: {
    from: dateArg,
    to: dateArg,
    channel: z.enum(["meta", "google", "all"]).default("all"),
    campaign: textArg.optional().describe("Trecho do nome da campanha"),
    utm_campaign: textArg.optional().describe("utm_campaign exato"),
    group_by: z.enum(["campaign", "utm_campaign", "channel", "day", "month"]).default("campaign"),
    include_funnel: z
      .boolean()
      .default(false)
      .describe(
        "Só com group_by=utm_campaign: soma leads e reservas criados no período com o mesmo utm_campaign",
      ),
    sort_by: z.enum(["spend", "clicks", "impressions", "ctr", "cpc", "key"]).default("spend"),
    ...pagingArgs,
  },
  annotations: readOnly,
  handler: async (a, ctx) => {
    assertPeriod(a.from, a.to);
    const sb = mcpDb(ctx);
    const ads = await fetchAds(sb, a.channel, a.from, a.to, a.campaign, a.utm_campaign);
    const key = (r: (typeof ads)[number]) =>
      a.group_by === "campaign"
        ? `${r.channel}: ${label(r.campaign_name)}`
        : a.group_by === "utm_campaign"
          ? label(r.utm_campaign)
          : a.group_by === "channel"
            ? r.channel
            : a.group_by === "day"
              ? dayKey(r.date)
              : monthKey(r.date);
    const map = new Map<
      string,
      { spend: number; clicks: number; impressions: number; conversions: number }
    >();
    for (const r of ads) {
      const k = key(r);
      const e = map.get(k) ?? { spend: 0, clicks: 0, impressions: 0, conversions: 0 };
      e.spend += num(r.spend);
      e.clicks += num(r.clicks);
      e.impressions += num(r.impressions);
      e.conversions += num(r.conversions);
      map.set(k, e);
    }
    let funnel: Map<string, { leads: number; reservations: number; revenue: number }> | undefined;
    if (a.include_funnel && a.group_by === "utm_campaign") {
      const keys = [...map.keys()].filter((k) => k !== "(vazio)");
      funnel = new Map(keys.map((k) => [k, { leads: 0, reservations: 0, revenue: 0 }]));
      if (keys.length) {
        const inKeys: Filter = (q) => q.in("utm_campaign", keys);
        const [leads, res] = await Promise.all([
          fetchAllFrom<{ utm_campaign: string }>(
            sb,
            "mcp_crm_leads",
            "utm_campaign",
            compose(range("created_at", a.from, a.to), inKeys),
            "id",
          ),
          fetchAllFrom<{ utm_campaign: string; total_amount: number; status: string }>(
            sb,
            "mcp_reservations",
            "utm_campaign,total_amount,status",
            compose(range("created_at", a.from, a.to), inKeys),
            "id",
          ),
        ]);
        for (const l of leads) funnel.get(l.utm_campaign)!.leads++;
        for (const r of res) {
          if (isCancelled(r.status)) continue;
          const f = funnel.get(r.utm_campaign)!;
          f.reservations++;
          f.revenue += num(r.total_amount);
        }
      }
    }
    const groups = [...map.entries()].map(([k, e]) => {
      const f = funnel?.get(k);
      return {
        key: k,
        spend: round2(e.spend),
        clicks: e.clicks,
        impressions: e.impressions,
        conversions: round2(e.conversions),
        ctr: e.impressions ? round2((e.clicks / e.impressions) * 100) : null,
        cpc: ratio(e.spend, e.clicks),
        ...(f
          ? {
              leads: f.leads,
              reservations: f.reservations,
              revenue: round2(f.revenue),
              cpl: ratio(e.spend, f.leads),
              roas: ratio(f.revenue, e.spend),
            }
          : {}),
      };
    });
    groups.sort((x, y) =>
      a.sort_by === "key" ? x.key.localeCompare(y.key) : num(y[a.sort_by]) - num(x[a.sort_by]),
    );
    const totalSpend = ads.reduce((s, r) => s + num(r.spend), 0);
    return ok({
      from: a.from,
      to: a.to,
      total_spend: round2(totalSpend),
      ...slicePage(groups, a.limit, a.offset),
    });
  },
});

export const marketingTeamCosts = defineTool({
  name: "marketing_team_costs",
  title: "Custos da equipe de marketing",
  description: "Custo mensal da equipe de marketing (USD) num intervalo de meses.",
  inputSchema: { from_month: monthArg.optional(), to_month: monthArg.optional() },
  annotations: readOnly,
  handler: async ({ from_month, to_month }, ctx) => {
    assertPeriod(from_month, to_month);
    const sb = mcpDb(ctx);
    const rows = await fetchAllFrom<{ month: string; amount: number; updated_at: string }>(
      sb,
      "mcp_marketing_team_costs",
      "month,amount,updated_at",
      compose(
        from_month && ((q) => q.gte("month", from_month)),
        to_month && ((q) => q.lte("month", to_month)),
      ),
      "month",
    );
    return ok({
      months: rows.map((r) => ({ ...r, amount: num(r.amount) })),
      total: round2(rows.reduce((s, r) => s + num(r.amount), 0)),
    });
  },
});
