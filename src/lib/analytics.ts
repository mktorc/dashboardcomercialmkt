import { supabase } from "@/integrations/supabase/client";

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

export type AnalyticsData = {
  meta: AdRow[];
  google: AdRow[];
  leads: LeadRow[];
  reservations: ReservationRow[];
};

export async function fetchAnalytics(range: RangeKey): Promise<AnalyticsData> {
  const { from, to } = rangeToDates(range);
  const [meta, google, leads, reservations] = await Promise.all([
    supabase
      .from("meta_ads_metrics")
      .select("date, campaign_name, spend, clicks, impressions, utm_campaign")
      .gte("date", isoDay(from))
      .lte("date", isoDay(to)),
    supabase
      .from("google_ads_metrics")
      .select("date, campaign_name, spend, clicks, impressions, utm_campaign")
      .gte("date", isoDay(from))
      .lte("date", isoDay(to)),
    supabase
      .from("crm_leads")
      .select("created_at, stage_name, utm_source, utm_campaign")
      .gte("created_at", iso(from))
      .lte("created_at", iso(to)),
    supabase
      .from("reservations")
      .select("created_at, car_category, rental_days, total_amount, status, utm_campaign")
      .gte("created_at", iso(from))
      .lte("created_at", iso(to)),
  ]);

  const err = meta.error || google.error || leads.error || reservations.error;
  if (err) throw err;

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
  const map = new Map<
    string,
    {
      utm: string;
      campanhas: Set<string>;
      investimento: number;
      cliques: number;
      leads: number;
      reservas: number;
      faturamento: number;
    }
  >();
  const touch = (utm: string) => {
    if (!map.has(utm))
      map.set(utm, {
        utm,
        campanhas: new Set(),
        investimento: 0,
        cliques: 0,
        leads: 0,
        reservas: 0,
        faturamento: 0,
      });
    return map.get(utm)!;
  };
  [...d.meta, ...d.google].forEach((r) => {
    const row = touch(r.utm_campaign ?? "sem_utm");
    row.campanhas.add(r.campaign_name);
    row.investimento += r.spend;
    row.cliques += r.clicks;
  });
  d.leads.forEach((l) => (touch(l.utm_campaign ?? "sem_utm").leads += 1));
  d.reservations
    .filter((r) => r.status === "confirmed")
    .forEach((r) => {
      const row = touch(r.utm_campaign ?? "sem_utm");
      row.reservas += 1;
      row.faturamento += r.total_amount;
    });
  return [...map.values()]
    .map((r) => ({
      utm: r.utm,
      campanhas: [...r.campanhas].join(" • "),
      investimento: r.investimento,
      cliques: r.cliques,
      leads: r.leads,
      reservas: r.reservas,
      faturamento: r.faturamento,
      cpl: r.leads ? r.investimento / r.leads : 0,
      conversao: r.leads ? r.reservas / r.leads : 0,
      roi: r.investimento ? (r.faturamento - r.investimento) / r.investimento : 0,
      roas: r.investimento ? r.faturamento / r.investimento : 0,
    }))
    .sort((a, b) => b.faturamento - a.faturamento);
}

export function computeCategories(d: AnalyticsData) {
  const map = new Map<string, number>();
  d.reservations
    .filter((r) => r.status === "confirmed")
    .forEach((r) =>
      map.set(r.car_category ?? "Outros", (map.get(r.car_category ?? "Outros") ?? 0) + r.total_amount),
    );
  return [...map.entries()]
    .map(([categoria, faturamento]) => ({ categoria, faturamento }))
    .sort((a, b) => b.faturamento - a.faturamento);
}
