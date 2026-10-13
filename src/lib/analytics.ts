import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";

export type RangeKey = "today" | "7d" | "month" | "30d";

export const RANGE_LABELS: Record<RangeKey, string> = {
  today: "Hoje",
  "7d": "Últimos 7 dias",
  month: "Este mês",
  "30d": "Últimos 30 dias",
};

export function rangeToDates(range: RangeKey): { from: Date; to: Date } {
  const to = new Date();
  to.setHours(23, 59, 59, 999);
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  if (range === "7d") from.setDate(from.getDate() - 6);
  if (range === "30d") from.setDate(from.getDate() - 29);
  if (range === "month") from.setDate(1);
  return { from, to };
}

const iso = (d: Date) => d.toISOString();
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export type AdRow = {
  date: string;
  campaign_name: string;
  spend: number;
  clicks: number;
  impressions: number;
  utm_campaign: string | null;
};
export type LeadRow = {
  created_at: string;
  stage_name: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
};
export type ReservationRow = {
  created_at: string;
  car_category: string | null;
  rental_days: number;
  total_amount: number;
  status: string;
  utm_campaign: string | null;
};
export type OpportunityOriginRow = {
  opportunity_id: string;
  lead_id: string | null;
  created_at: string;
  updated_at: string;
  stage_name: string | null;
  status: string | null;
  pipeline_step_id: number | null;
  utm_source: string | null;
};

export type AnalyticsData = {
  meta: AdRow[];
  google: AdRow[];
  leads: LeadRow[];
  reservations: ReservationRow[];
  opportunities: OpportunityOriginRow[];
  updatedOpportunities: OpportunityOriginRow[];
};

export async function fetchAnalytics(range: RangeKey): Promise<AnalyticsData> {
  const { from, to } = rangeToDates(range);
  const [meta, google, leads, reservations, createdOpportunities, updatedOpportunities] =
    await Promise.all([
      fetchAll((a, b) =>
        supabase
          .from("meta_ads_metrics")
          .select("date, campaign_name, spend, clicks, impressions, utm_campaign")
          .gte("date", isoDay(from))
          .lte("date", isoDay(to))
          .range(a, b),
      ),
      fetchAll((a, b) =>
        supabase
          .from("google_ads_metrics")
          .select("date, campaign_name, spend, clicks, impressions, utm_campaign")
          .gte("date", isoDay(from))
          .lte("date", isoDay(to))
          .range(a, b),
      ),
      fetchAll((a, b) =>
        supabase
          .from("crm_leads")
          .select("created_at, stage_name, utm_source, utm_campaign")
          .gte("created_at", iso(from))
          .lte("created_at", iso(to))
          .range(a, b),
      ),
      fetchAll((a, b) =>
        supabase
          .from("reservations")
          .select("created_at, car_category, rental_days, total_amount, status, utm_campaign")
          .gte("created_at", iso(from))
          .lte("created_at", iso(to))
          .range(a, b),
      ),
      fetchAll((a, b) =>
        supabase
          .from("crm_opportunities")
          .select(
            "opportunity_id, lead_id, created_at, updated_at, stage_name, status, pipeline_step_id",
          )
          .eq("pipeline_name", "Comercial")
          .gte("created_at", iso(from))
          .lte("created_at", iso(to))
          .range(a, b),
      ),
      fetchAll((a, b) =>
        supabase
          .from("crm_opportunities")
          .select(
            "opportunity_id, lead_id, created_at, updated_at, stage_name, status, pipeline_step_id",
          )
          .eq("pipeline_name", "Comercial")
          .gte("updated_at", iso(from))
          .lte("updated_at", iso(to))
          .range(a, b),
      ),
    ]);

  const err =
    meta.error ||
    google.error ||
    leads.error ||
    reservations.error ||
    createdOpportunities.error ||
    updatedOpportunities.error;
  if (err) throw err;

  const createdRows = (createdOpportunities.data ?? []) as Omit<
    OpportunityOriginRow,
    "utm_source"
  >[];
  const updatedRows = (updatedOpportunities.data ?? []) as Omit<
    OpportunityOriginRow,
    "utm_source"
  >[];
  const leadIds = [
    ...new Set(
      [...createdRows, ...updatedRows]
        .map((opportunity) => opportunity.lead_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const originLeadPages = await Promise.all(
    Array.from({ length: Math.ceil(leadIds.length / 400) }, (_, index) =>
      fetchAll((a, b) =>
        supabase
          .from("crm_leads")
          .select("lead_id, utm_source")
          .in("lead_id", leadIds.slice(index * 400, (index + 1) * 400))
          .range(a, b),
      ),
    ),
  );
  const originLeadError = originLeadPages.find((page) => page.error)?.error;
  if (originLeadError) throw originLeadError;
  const sourceByLeadId = new Map<string, string | null>();
  originLeadPages.forEach((page) => {
    (page.data as { lead_id: string | null; utm_source: string | null }[]).forEach((lead) => {
      if (lead.lead_id) sourceByLeadId.set(lead.lead_id, lead.utm_source);
    });
  });
  const attachOrigin = (rows: Omit<OpportunityOriginRow, "utm_source">[]): OpportunityOriginRow[] =>
    rows.map((opportunity) => ({
      ...opportunity,
      utm_source: opportunity.lead_id ? (sourceByLeadId.get(opportunity.lead_id) ?? null) : null,
    }));

  const num = <T extends { spend: unknown }>(rows: T[]) =>
    rows.map((r) => ({ ...r, spend: Number(r.spend) })) as unknown as AdRow[];

  return {
    meta: num((meta.data ?? []) as never[]),
    google: num((google.data ?? []) as never[]),
    leads: (leads.data ?? []) as LeadRow[],
    reservations: ((reservations.data ?? []) as ReservationRow[]).map((r) => ({
      ...r,
      total_amount: Number(r.total_amount),
    })),
    opportunities: attachOrigin(createdRows),
    updatedOpportunities: attachOrigin(updatedRows),
  };
}

export const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
export const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

export function computeKpis(d: AnalyticsData) {
  const metaSpend = d.meta.reduce((s, r) => s + r.spend, 0);
  const googleSpend = d.google.reduce((s, r) => s + r.spend, 0);
  const spend = metaSpend + googleSpend;
  const leads = d.leads.length;
  const confirmed = d.reservations.filter((r) => r.status === "confirmed");
  const revenue = confirmed.reduce((s, r) => s + r.total_amount, 0);
  const days = confirmed.reduce((s, r) => s + r.rental_days, 0);
  return {
    metaSpend,
    googleSpend,
    spend,
    leads,
    cpl: leads ? spend / leads : 0,
    conversion: leads ? confirmed.length / leads : 0,
    reservations: confirmed.length,
    revenue,
    ticket: confirmed.length ? revenue / confirmed.length : 0,
    dailyRate: days ? revenue / days : 0,
    roas: spend ? revenue / spend : 0,
  };
}

export function computeTimeseries(d: AnalyticsData) {
  const map = new Map<string, { date: string; investimento: number; faturamento: number }>();
  const touch = (key: string) => {
    if (!map.has(key)) map.set(key, { date: key, investimento: 0, faturamento: 0 });
    return map.get(key)!;
  };
  [...d.meta, ...d.google].forEach((r) => (touch(r.date).investimento += r.spend));
  d.reservations.forEach((r) => (touch(r.created_at.slice(0, 10)).faturamento += r.total_amount));
  return [...map.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => ({ ...r, label: r.date.slice(8) + "/" + r.date.slice(5, 7) }));
}

export function computeAttribution(d: AnalyticsData) {
  const normalizeSource = (value: string | null | undefined) => {
    const source = (value ?? "").trim().toLowerCase();
    if (["meta", "facebook", "fb", "instagram", "ig"].some((alias) => source.includes(alias)))
      return "meta";
    if (["google", "adwords"].some((alias) => source.includes(alias))) return "google";
    return source || "sem_origem";
  };
  const sourceLabel = (source: string) =>
    source === "meta"
      ? "Meta"
      : source === "google"
        ? "Google"
        : source === "sem_origem"
          ? "Sem origem"
          : source;
  const campaignSources = new Map<string, Set<string>>();
  const addCampaignSource = (campaign: string | null, source: string) => {
    const key = campaign?.trim().toLowerCase();
    if (!key) return;
    const sources = campaignSources.get(key) ?? new Set<string>();
    sources.add(source);
    campaignSources.set(key, sources);
  };
  d.leads.forEach((lead) => addCampaignSource(lead.utm_campaign, normalizeSource(lead.utm_source)));
  d.meta.forEach((ad) => addCampaignSource(ad.utm_campaign, "meta"));
  d.google.forEach((ad) => addCampaignSource(ad.utm_campaign, "google"));

  const map = new Map<
    string,
    {
      utm: string;
      investimento: number;
      cliques: number;
      leads: number;
      reservas: number;
      faturamento: number;
    }
  >();
  const touch = (sourceValue: string, campaignValue: string, campaignLabel = campaignValue) => {
    const source = normalizeSource(sourceValue);
    const key = `${source}\u0000${campaignValue.trim().toLowerCase()}`;
    if (!map.has(key))
      map.set(key, {
        utm: `${sourceLabel(source)} / ${campaignLabel}`,
        investimento: 0,
        cliques: 0,
        leads: 0,
        reservas: 0,
        faturamento: 0,
      });
    return map.get(key)!;
  };
  const addAds = (rows: AdRow[], source: string) =>
    rows.forEach((ad) => {
      const campaign = ad.utm_campaign?.trim() || `sem_utm:${ad.campaign_name}`;
      const label = ad.utm_campaign?.trim() || `sem_utm · ${ad.campaign_name}`;
      const row = touch(source, campaign, label);
      row.investimento += ad.spend;
      row.cliques += ad.clicks;
    });
  addAds(d.meta, "meta");
  addAds(d.google, "google");
  d.leads.forEach((lead) => {
    const campaign = lead.utm_campaign?.trim() || "sem_utm";
    touch(lead.utm_source ?? "sem_origem", campaign).leads += 1;
  });
  d.reservations
    .filter((r) => r.status === "confirmed")
    .forEach((r) => {
      const tagged = r.utm_campaign?.trim();
      // Sem UTM não há como saber a origem: nunca herdar a origem de outra linha.
      const campaign = tagged || "sem_utm";
      const sources = tagged ? campaignSources.get(tagged.toLowerCase()) : undefined;
      const source = sources?.size === 1 ? [...sources][0]! : "sem_origem";
      const row = tagged ? touch(source, campaign) : touch("sem_origem", "sem_utm", "sem rastreamento");
      row.reservas += 1;
      row.faturamento += r.total_amount;
    });
  return [...map.values()]
    .map((r) => ({
      utm: r.utm,
      investimento: r.investimento,
      cliques: r.cliques,
      leads: r.leads,
      reservas: r.reservas,
      faturamento: r.faturamento,
      cpl: r.leads ? r.investimento / r.leads : 0,
      conversao: r.leads ? r.reservas / r.leads : 0,
      // Sem leads/reservas rastreados, ROI é desconhecido (não -100%).
      roi:
        r.investimento && (r.leads || r.reservas)
          ? (r.faturamento - r.investimento) / r.investimento
          : null,
      roas: r.investimento && (r.leads || r.reservas) ? r.faturamento / r.investimento : null,
    }))
    .sort((a, b) => b.investimento - a.investimento || b.faturamento - a.faturamento);
}

export type OpportunityOriginAnalytics = {
  sources: { key: string; label: string }[];
  byOrigin: { key: string; origin: string; opportunities: number }[];
  createdMonthly: Record<string, string | number>[];
  closedMonthly: Record<string, string | number>[];
  stages: { key: string; label: string; id: number | null }[];
  funnel: { key: string; origin: string; stages: { count: number; conversion: number | null }[] }[];
};

const MONTH_ABBR = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const originKey = (value: string | null) => {
  const source = (value ?? "").trim().toLowerCase();
  if (["meta", "facebook", "fb", "instagram", "ig"].some((alias) => source.includes(alias)))
    return "meta";
  if (["google", "adwords"].some((alias) => source.includes(alias))) return "google";
  return source || "sem_origem";
};
const originLabel = (key: string) =>
  key === "meta" ? "Meta" : key === "google" ? "Google" : key === "sem_origem" ? "Sem origem" : key === "whatsapp" ? "WhatsApp" : key;
const isWonOpportunity = (opportunity: OpportunityOriginRow) => {
  const value = `${opportunity.status ?? ""} ${opportunity.stage_name ?? ""}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (/(lost|perdid|cancelad)/.test(value)) return false;
  return /(won|ganh|fechad|closed|concluid)/.test(value);
};

export function computeOpportunityOrigins(
  opportunities: OpportunityOriginRow[],
  updatedOpportunities: OpportunityOriginRow[],
  from: string,
  to: string,
): OpportunityOriginAnalytics {
  const months: { key: string; label: string }[] = [];
  const [fromYear, fromMonth] = from.slice(0, 7).split("-").map(Number);
  const [toYear, toMonth] = to.slice(0, 7).split("-").map(Number);
  const month = new Date(Date.UTC(fromYear!, fromMonth! - 1, 1));
  const lastMonth = new Date(Date.UTC(toYear!, toMonth! - 1, 1));
  for (; month <= lastMonth; month.setUTCMonth(month.getUTCMonth() + 1)) {
    const key = `${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, "0")}`;
    months.push({
      key,
      label: `${MONTH_ABBR[month.getUTCMonth()]}/${month.getUTCFullYear()}`,
    });
  }

  const sourceKeys = [
    ...new Set([
      ...opportunities.map((opportunity) => originKey(opportunity.utm_source)),
      ...updatedOpportunities
        .filter(isWonOpportunity)
        .map((opportunity) => originKey(opportunity.utm_source)),
    ]),
  ].sort((a, b) => originLabel(a).localeCompare(originLabel(b)));
  const sources = sourceKeys.map((key, index) => ({
    key: `origin_${index}`,
    label: originLabel(key),
  }));
  const chartKeyByOrigin = new Map(sourceKeys.map((key, index) => [key, `origin_${index}`]));
  const labelByOrigin = new Map(sourceKeys.map((key) => [key, originLabel(key)]));
  const byOriginMap = new Map(sourceKeys.map((key) => [key, 0]));
  const createdMonthly = months.map(
    ({ label }) => ({ month: label }) as Record<string, string | number>,
  );
  const closedMonthly = months.map(
    ({ label }) => ({ month: label }) as Record<string, string | number>,
  );
  const monthlyIndex = new Map(months.map(({ key }, index) => [key, index]));

  opportunities.forEach((opportunity) => {
    const key = originKey(opportunity.utm_source);
    const chartKey = chartKeyByOrigin.get(key)!;
    byOriginMap.set(key, (byOriginMap.get(key) ?? 0) + 1);
    const index = monthlyIndex.get(opportunity.created_at.slice(0, 7));
    if (index !== undefined)
      createdMonthly[index]![chartKey] = Number(createdMonthly[index]![chartKey] ?? 0) + 1;
  });
  updatedOpportunities.filter(isWonOpportunity).forEach((opportunity) => {
    const chartKey = chartKeyByOrigin.get(originKey(opportunity.utm_source));
    const index = monthlyIndex.get(opportunity.updated_at.slice(0, 7));
    if (chartKey && index !== undefined)
      closedMonthly[index]![chartKey] = Number(closedMonthly[index]![chartKey] ?? 0) + 1;
  });

  const stagesByKey = new Map<string, { key: string; label: string; id: number | null }>();
  opportunities.forEach((opportunity) => {
    const label =
      opportunity.stage_name?.trim() ||
      (opportunity.pipeline_step_id ? `Etapa ${opportunity.pipeline_step_id}` : "Sem etapa");
    const id = opportunity.pipeline_step_id;
    const key = id === null ? `name:${label.toLowerCase()}` : `id:${id}`;
    stagesByKey.set(key, { key, label, id });
  });
  const stages = [...stagesByKey.values()].sort((a, b) =>
    a.id !== null && b.id !== null
      ? a.id - b.id
      : a.id !== null
        ? -1
        : b.id !== null
          ? 1
          : a.label.localeCompare(b.label),
  );
  const stagePosition = new Map(stages.map((stage, index) => [stage.key, index]));
  const positionFor = (opportunity: OpportunityOriginRow) => {
    const stageKey =
      opportunity.pipeline_step_id === null
        ? `name:${(opportunity.stage_name?.trim() || "Sem etapa").toLowerCase()}`
        : `id:${opportunity.pipeline_step_id}`;
    return stagePosition.get(stageKey) ?? -1;
  };
  const funnel = sourceKeys.map((key, originIndex) => {
    const sourceOpportunities = opportunities.filter(
      (opportunity) => originKey(opportunity.utm_source) === key,
    );
    let previousCount: number | null = null;
    return {
      key: `origin_${originIndex}`,
      origin: labelByOrigin.get(key)!,
      stages: stages.map((stage, stageIndex) => {
        const count = sourceOpportunities.filter(
          (opportunity) => positionFor(opportunity) >= stageIndex,
        ).length;
        const conversion =
          previousCount === null ? null : previousCount ? count / previousCount : 0;
        previousCount = count;
        return { count, conversion };
      }),
    };
  });

  return {
    sources,
    byOrigin: sourceKeys
      .map((key, index) => ({
        key: `origin_${index}`,
        origin: originLabel(key),
        opportunities: byOriginMap.get(key) ?? 0,
      }))
      .sort((a, b) => b.opportunities - a.opportunities),
    createdMonthly,
    closedMonthly,
    stages,
    funnel,
  };
}

export function computeCategories(d: AnalyticsData) {
  const map = new Map<string, number>();
  d.reservations
    .filter((r) => r.status === "confirmed")
    .forEach((r) =>
      map.set(
        r.car_category ?? "Outros",
        (map.get(r.car_category ?? "Outros") ?? 0) + r.total_amount,
      ),
    );
  return [...map.entries()]
    .map(([categoria, faturamento]) => ({ categoria, faturamento }))
    .sort((a, b) => b.faturamento - a.faturamento);
}
