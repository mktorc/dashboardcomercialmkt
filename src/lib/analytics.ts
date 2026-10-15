import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { fetchKommoLeads, kommoAsOpportunity, KOMMO_PREFIX } from "@/lib/kommo-leads";

const iso = (d: Date) => d.toISOString();
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const sanitizePhone = (phone: string | null) => {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 8 ? digits : null;
};
const normalizeEmail = (email: string | null) => {
  return email ? email.toLowerCase().trim() : null;
};

export type AdRow = {
  date: string;
  campaign_name: string;
  spend: number;
  conversations?: number;
  clicks: number;
  impressions: number;
  utm_campaign: string | null;
};
export type ReservationRow = {
  created_at: string;
  pick_up_at: string | null;
  car_category: string | null;
  rental_days: number;
  total_amount: number;
  status: string;
  utm_campaign: string | null;
  commission_partner?: string | null;
  reservation_id?: string | null;
  /** Origem do lead vinculado (telefone/e-mail); tem prioridade sobre o Commission Partner. */
  lead_origin?: string | null;
  /** Criação do lead da safra ao qual a reserva pertence. */
  lead_created_at?: string | null;
};

/** Deduplicação inteligente de leads Kommo + ClickMassa por email/telefone com regra de booking_date */
export function deduplicateReservations(reservations: ReservationRow[]) {
  const duplicates = new Set<string>();

  // Agrupar reservas por email/telefone normalizado
  const byContact = new Map<string, ReservationRow[]>();
  reservations.forEach((r) => {
    const email = normalizeEmail(r.lead_origin || "");
    const phone = sanitizePhone(r.lead_origin || "");
    // Usa lead_origin como identificador, mas em produção seria melhor cruzar com a tabela de leads
    const key = [email, phone].filter(Boolean).join("|") || `res-${r.reservation_id}`;
    const group = byContact.get(key) ?? [];
    group.push(r);
    byContact.set(key, group);
  });

  // Para cada grupo de contatos, deduplica por booking_date
  byContact.forEach((group) => {
    const byDate = new Map<string, ReservationRow[]>();
    group.forEach((r) => {
      const bookingDate = (r.pick_up_at ?? r.created_at).slice(0, 10);
      const dateGroup = byDate.get(bookingDate) ?? [];
      dateGroup.push(r);
      byDate.set(bookingDate, dateGroup);
    });

    // Dentro de cada data, marca duplicatas posteriores
    byDate.forEach((dateGroup) => {
      if (dateGroup.length > 1) {
        // Mantém apenas o primeiro, marca o resto como duplicata
        dateGroup.slice(1).forEach((r) => {
          if (r.reservation_id) duplicates.add(r.reservation_id);
        });
      }
    });
  });

  // Retorna apenas as reservas que não são duplicatas
  return reservations.filter((r) => !duplicates.has(r.reservation_id || ""));
}
export type OpportunityOriginRow = {
  opportunity_id: string;
  lead_id: string | null;
  created_at: string;
  updated_at: string;
  stage_name: string | null;
  status: string | null;
  pipeline_step_id: number | null;
  utm_source: string | null;
  utm_campaign?: string | null;
};

export type AnalyticsData = {
  meta: AdRow[];
  google: AdRow[];
  reservations: ReservationRow[];
  opportunities: OpportunityOriginRow[];
  updatedOpportunities: OpportunityOriginRow[];
};

// "Origem do Lead" do ClickMassa vem primeiro: utm_source quase sempre é só o canal ("whatsapp").
export const resolveLeadSource = (utmSource: string | null, leadOrigin: string | null) =>
  leadOrigin?.trim() || utmSource?.trim() || null;

export async function fetchAnalytics(from: string, to: string): Promise<AnalyticsData> {
  const fromDate = new Date(`${from}T00:00:00`);
  const toDate = new Date(`${to}T23:59:59.999`);
  const [meta, google, reservations, createdOpportunities, updatedOpportunities] = await Promise.all([
      fetchAll((a, b) =>
        supabase
          .from("meta_ads_metrics")
          .select("date, campaign_name, spend, clicks, impressions, utm_campaign, conversations")
          .gte("date", from)
          .lte("date", to)
          .range(a, b),
      ),
      fetchAll((a, b) =>
        supabase
          .from("google_ads_metrics")
          .select("date, campaign_name, spend, clicks, impressions, utm_campaign")
          .gte("date", from)
          .lte("date", to)
          .range(a, b),
      ),
      // Visão de safra: reservas (em qualquer data) dos leads criados no período.
      fetchAll((a, b) =>
        supabase
          .rpc("cohort_reservations", { _from: iso(fromDate), _to: iso(toDate) })
          .order("reservation_id")
          .range(a, b),
      ),
      fetchAll((a, b) =>
        supabase
          .from("crm_opportunities")
          .select(
            "opportunity_id, lead_id, created_at, updated_at, stage_name, status, pipeline_step_id",
          )
          .eq("pipeline_name", "Comercial")
          .gte("created_at", iso(fromDate))
          .lte("created_at", iso(toDate))
          .range(a, b),
      ),
      fetchAll((a, b) =>
        supabase
          .from("crm_opportunities")
          .select(
            "opportunity_id, lead_id, created_at, updated_at, stage_name, status, pipeline_step_id",
          )
          .eq("pipeline_name", "Comercial")
          .gte("updated_at", iso(fromDate))
          .lte("updated_at", iso(toDate))
          .range(a, b),
      ),
    ]);
  const kommoLeads = await fetchKommoLeads(iso(fromDate), iso(toDate));

  const err =
    meta.error ||
    google.error ||
    reservations.error ||
    createdOpportunities.error ||
    updatedOpportunities.error;
  if (err) throw err;

  const createdRows = [
    ...((createdOpportunities.data ?? []) as Omit<OpportunityOriginRow, "utm_source" | "utm_campaign">[]),
    ...kommoLeads.map(kommoAsOpportunity),
  ] as Omit<OpportunityOriginRow, "utm_source" | "utm_campaign">[];
  const updatedRows = (updatedOpportunities.data ?? []) as Omit<
    OpportunityOriginRow,
    "utm_source" | "utm_campaign"
  >[];
  const leadIds = [
    ...new Set(
      [...createdRows, ...updatedRows]
        .map((opportunity) => opportunity.lead_id)
        .filter((id): id is string => Boolean(id) && !id!.startsWith(KOMMO_PREFIX)),
    ),
  ];
  const originLeadPages = await Promise.all(
    Array.from({ length: Math.ceil(leadIds.length / 400) }, (_, index) =>
      fetchAll((a, b) =>
        supabase
          .from("crm_leads")
          .select("lead_id, utm_source, lead_origin, utm_campaign")
          .in("lead_id", leadIds.slice(index * 400, (index + 1) * 400))
          .range(a, b),
      ),
    ),
  );
  const originLeadError = originLeadPages.find((page) => page.error)?.error;
  if (originLeadError) throw originLeadError;
  const leadAttributionById = new Map<string, { source: string | null; campaign: string | null }>();
  kommoLeads.forEach((lead) =>
    leadAttributionById.set(lead.lead_id, {
      source: resolveLeadSource(lead.utm_source, lead.lead_origin),
      campaign: lead.utm_campaign,
    }),
  );
  originLeadPages.forEach((page) => {
    (
      page.data as {
        lead_id: string | null;
        utm_source: string | null;
        lead_origin: string | null;
        utm_campaign: string | null;
      }[]
    ).forEach((lead) => {
      if (lead.lead_id)
        leadAttributionById.set(lead.lead_id, {
          source: resolveLeadSource(lead.utm_source, lead.lead_origin),
          campaign: lead.utm_campaign,
        });
    });
  });
  const attachOrigin = (
    rows: Omit<OpportunityOriginRow, "utm_source" | "utm_campaign">[],
  ): OpportunityOriginRow[] =>
    rows.map((opportunity) => ({
      ...opportunity,
      utm_source: opportunity.lead_id
        ? (leadAttributionById.get(opportunity.lead_id)?.source ?? null)
        : null,
      utm_campaign: opportunity.lead_id
        ? (leadAttributionById.get(opportunity.lead_id)?.campaign ?? null)
        : null,
    }));

  const num = <T extends { spend: unknown }>(rows: T[]) =>
    rows.map((r) => ({ ...r, spend: Number(r.spend) })) as unknown as AdRow[];
  const opportunities = attachOrigin(createdRows);
  const updated = attachOrigin(updatedRows);

  const rawReservations = ((reservations.data ?? []) as ReservationRow[]).map((reservation) => ({
    ...reservation,
    total_amount: Number(reservation.total_amount),
  }));

  return {
    meta: num((meta.data ?? []) as never[]),
    google: num((google.data ?? []) as never[]),
    reservations: deduplicateReservations(rawReservations),
    opportunities,
    updatedOpportunities: updated,
  };
}

export const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
export const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

export function computeKpis(d: AnalyticsData) {
  const metaSpend = d.meta.reduce((s, r) => s + r.spend, 0);
  const googleSpend = d.google.reduce((s, r) => s + r.spend, 0);
  const spend = metaSpend + googleSpend;
  const leads = d.opportunities.length;
  const confirmed = d.reservations.filter((r) => r.status === "confirmed");
  const revenue = confirmed.reduce((s, r) => s + r.total_amount, 0);
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
    cac: confirmed.length ? spend / confirmed.length : null,
    roas: spend ? revenue / spend : 0,
  };
}

export function computeTimeseries(d: AnalyticsData, from?: string) {
  const map = new Map<string, { date: string; investimento: number; faturamento: number }>();
  const touch = (key: string) => {
    if (!map.has(key)) map.set(key, { date: key, investimento: 0, faturamento: 0 });
    return map.get(key)!;
  };
  [...d.meta, ...d.google].forEach((r) => (touch(r.date).investimento += r.spend));
  // Faturamento alocado pela data real da reserva (pick_up_at), não pela criação do lead.
  d.reservations.forEach(
    (r) => {
      // Usar data real do aluguel (pick_up_at). Se não disponível, usar created_at da reserva.
      const day = (r.pick_up_at ?? r.created_at).slice(0, 10);
      touch(from && day < from ? from : day).faturamento += r.total_amount;
    },
  );
  return [...map.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => ({ ...r, label: r.date.slice(8) + "/" + r.date.slice(5, 7) }));
}

// Compara por palavra: "ig"/"fb" não podem casar com trechos como "sem_orIGem".
const isMetaSource = (source: string) => {
  const tokens = source.split(/[^a-z0-9]+/).filter(Boolean);
  return (
    ["meta", "facebook", "instagram"].some((alias) => source.includes(alias)) ||
    tokens.some((token) => token === "fb" || token === "ig")
  );
};

const stripAccents = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const ORIGIN_LABELS = new Map<string, string>();
/** Normaliza a origem (Origem do Lead do ClickMassa / Commission Partner do HQ / utm_source). */
export const normalizeOrigin = (value: string | null | undefined) => {
  const raw = (value ?? "").trim();
  const source = stripAccents(raw).toLowerCase();
  if (!source || source === "sem_origem" || source === "sem origem") return "sem_origem";
  if (isMetaSource(source)) return "meta";
  if (["google", "adwords", "gclid"].some((alias) => source.includes(alias))) return "google";
  if (source === "whatsapp") {
    ORIGIN_LABELS.set("whatsapp", "WhatsApp");
    return "whatsapp";
  }
  const key = source.replace(/\s+/g, " ");
  if (!ORIGIN_LABELS.has(key)) ORIGIN_LABELS.set(key, raw.replace(/\s+/g, " "));
  return key;
};
export const originDisplay = (key: string) =>
  key === "meta"
    ? "Meta Ads"
    : key === "google"
      ? "Google Ads"
      : key === "sem_origem"
        ? "Sem origem"
        : (ORIGIN_LABELS.get(key) ?? key);
export const reservationOrigin = (r: ReservationRow) =>
  r.lead_origin?.trim() || r.commission_partner || null;

export function computeAttribution(d: AnalyticsData) {
  const normalizeSource = normalizeOrigin;
  const sourceLabel = originDisplay;
  const campaignSources = new Map<string, Set<string>>();
  const addCampaignSource = (campaign: string | null, source: string) => {
    const key = campaign?.trim().toLowerCase();
    if (!key) return;
    const sources = campaignSources.get(key) ?? new Set<string>();
    sources.add(source);
    campaignSources.set(key, sources);
  };
  d.opportunities.forEach((opportunity) =>
    addCampaignSource(opportunity.utm_campaign ?? null, normalizeSource(opportunity.utm_source)),
  );
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
      // Campanhas sem UTM somam no canal, onde caem os leads/reservas pela origem do CRM/HQ.
      const campaign = ad.utm_campaign?.trim() || "sem_utm";
      const label = ad.utm_campaign?.trim() || "todas as campanhas (por origem)";
      const row = touch(source, campaign, label);
      row.investimento += ad.spend;
      row.cliques += ad.clicks;
    });
  addAds(d.meta, "meta");
  addAds(d.google, "google");
  d.opportunities.forEach((opportunity) => {
    const tagged = opportunity.utm_campaign?.trim();
    const source = opportunity.utm_source ?? "sem_origem";
    const paid = ["meta", "google"].includes(normalizeSource(source));
    const row = tagged
      ? touch(source, tagged)
      : touch(source, "sem_utm", paid ? "todas as campanhas (por origem)" : "por origem");
    row.leads += 1;
  });
  d.reservations
    .filter((r) => r.status === "confirmed")
    .forEach((r) => {
      const tagged = r.utm_campaign?.trim();
      // Sem UTM não há como saber a origem: nunca herdar a origem de outra linha.
      const campaign = tagged || "sem_utm";
      const sources = tagged ? campaignSources.get(tagged.toLowerCase()) : undefined;
      const partner = reservationOrigin(r);
      const source = sources?.size === 1 ? [...sources][0]! : (partner ?? "sem_origem");
      const paid = ["meta", "google"].includes(normalizeSource(partner));
      const row = tagged
        ? touch(source, campaign)
        : partner
          ? touch(partner, "sem_utm", paid ? "todas as campanhas (por origem)" : "por origem")
          : touch("sem_origem", "sem_utm", "sem rastreamento");
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
  stages: { key: string; label: string; id: number | null; isFinal?: boolean }[];
  funnel: {
    key: string;
    origin: string;
    stages: { count: number; conversion: number | null; isFinal: boolean }[];
  }[];
};

const MONTH_ABBR = [
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
const originKey = (value: string | null) => normalizeOrigin(value);
const originLabel = originDisplay;
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

  const combinedStageLabel = "Agência de viagem / Proposta enviada";
  const stageKeyFor = (opportunity: OpportunityOriginRow, label: string) => {
    const normalizedLabel = stripAccents(label).toLowerCase().replace(/\s+/g, " ").trim();
    if (normalizedLabel === "agencia de viagem" || normalizedLabel === "proposta enviada") {
      return "group:travel_agency_proposal";
    }
    return opportunity.pipeline_step_id === null
      ? `name:${normalizedLabel}`
      : `id:${opportunity.pipeline_step_id}`;
  };
  const stagesByKey = new Map<string, { key: string; label: string; id: number | null }>();
  opportunities.forEach((opportunity) => {
    const label =
      opportunity.stage_name?.trim() ||
      (opportunity.pipeline_step_id ? `Etapa ${opportunity.pipeline_step_id}` : "Sem etapa");
    const id = opportunity.pipeline_step_id;
    const key = stageKeyFor(opportunity, label);
    const displayLabel = key === "group:travel_agency_proposal" ? combinedStageLabel : label;
    const existing = stagesByKey.get(key);
    if (!existing) {
      stagesByKey.set(key, { key, label: displayLabel, id });
    } else if (key === "group:travel_agency_proposal" && id !== null) {
      existing.id = existing.id === null ? id : Math.min(existing.id, id);
    }
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
  const funnelStages: { key: string; label: string; id: number | null; isFinal?: boolean }[] = [
    ...stages,
    { key: "won", label: "Ganhos / Reservas Fechadas", id: null, isFinal: true },
  ];
  const stagePosition = new Map(stages.map((stage, index) => [stage.key, index]));
  const positionFor = (opportunity: OpportunityOriginRow) => {
    const label =
      opportunity.stage_name?.trim() ||
      (opportunity.pipeline_step_id ? `Etapa ${opportunity.pipeline_step_id}` : "Sem etapa");
    const stageKey = stageKeyFor(opportunity, label);
    return stagePosition.get(stageKey) ?? -1;
  };
  const latestById = new Map(updatedOpportunities.map((o) => [o.opportunity_id, o]));
  const isWonNow = (o: OpportunityOriginRow) => isWonOpportunity(latestById.get(o.opportunity_id) ?? o);
  const funnel = sourceKeys.map((key, originIndex) => {
    const sourceOpportunities = opportunities.filter(
      (opportunity) => originKey(opportunity.utm_source) === key,
    );
    let previousCount: number | null = null;
    let baseCount = 0;
    return {
      key: `origin_${originIndex}`,
      origin: labelByOrigin.get(key)!,
      stages: funnelStages.map((stage, stageIndex) => {
        const count = stage.isFinal
          ? sourceOpportunities.filter(isWonNow).length
          : sourceOpportunities.filter((opportunity) => positionFor(opportunity) >= stageIndex)
              .length;
        const conversion = stage.isFinal
          ? baseCount
            ? count / baseCount
            : 0
          : previousCount === null
            ? null
            : previousCount
              ? count / previousCount
              : 0;
        if (stageIndex === 0) baseCount = count;
        previousCount = count;
        return { count, conversion, isFinal: Boolean(stage.isFinal) };
      }),
    };
  });
  let previousCount: number | null = null;
  let baseCount = 0;
  const allOriginsFunnel = {
    key: "all",
    origin: "Todas as origens",
    stages: funnelStages.map((stage, stageIndex) => {
      const count = stage.isFinal
        ? opportunities.filter(isWonNow).length
        : opportunities.filter((opportunity) => positionFor(opportunity) >= stageIndex).length;
      const conversion = stage.isFinal
        ? baseCount
          ? count / baseCount
          : 0
        : previousCount === null
          ? null
          : previousCount
            ? count / previousCount
            : 0;
      if (stageIndex === 0) baseCount = count;
      previousCount = count;
      return { count, conversion, isFinal: Boolean(stage.isFinal) };
    }),
  };

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
    stages: funnelStages,
    funnel: [allOriginsFunnel, ...funnel],
  };
}

export function filterAnalyticsByOrigin(data: AnalyticsData, origin: string | null) {
  if (!origin) return data;
  const selectedOrigin = normalizeOrigin(origin);
  const campaignSources = new Map<string, Set<string>>();
  const addCampaignSource = (campaign: string | null, source: string) => {
    const key = campaign?.trim().toLowerCase();
    if (!key) return;
    const sources = campaignSources.get(key) ?? new Set<string>();
    sources.add(source);
    campaignSources.set(key, sources);
  };
  data.opportunities.forEach((opportunity) =>
    addCampaignSource(opportunity.utm_campaign ?? null, normalizeOrigin(opportunity.utm_source)),
  );
  data.meta.forEach((ad) => addCampaignSource(ad.utm_campaign, "meta"));
  data.google.forEach((ad) => addCampaignSource(ad.utm_campaign, "google"));

  return {
    meta: selectedOrigin === "meta" ? data.meta : [],
    google: selectedOrigin === "google" ? data.google : [],
    opportunities: data.opportunities.filter(
      (opportunity) => normalizeOrigin(opportunity.utm_source) === selectedOrigin,
    ),
    updatedOpportunities: data.updatedOpportunities.filter(
      (opportunity) => normalizeOrigin(opportunity.utm_source) === selectedOrigin,
    ),
    reservations: data.reservations.filter((reservation) => {
      const campaign = reservation.utm_campaign?.trim();
      const sources = campaign ? campaignSources.get(campaign.toLowerCase()) : undefined;
      const partner = reservationOrigin(reservation);
      const source = sources?.size === 1 ? [...sources][0]! : (partner ?? "sem_origem");
      return normalizeOrigin(source) === selectedOrigin;
    }),
  };
}

export type DynamicFunnelStage = { label: string; count: number };
export type DynamicFunnel = {
  title: string;
  stages: DynamicFunnelStage[];
  metrics: { label: string; value: number | null }[];
};
const ratio = (a: number, b: number) => (b ? a / b : null);

/** Funil por filtro: geral (Meta+Google, 2 etapas), Meta (3 etapas com conversas), Google (2 etapas). */
export function buildDynamicFunnel(
  mode: "all" | "meta" | "google" | "other",
  input: { conversations: number; metaLeads: number; metaRes: number; googleLeads: number; googleRes: number; otherLeads?: number; otherRes?: number; otherLabel?: string },
): DynamicFunnel {
  if (mode === "meta") {
    const { conversations: c, metaLeads: l, metaRes: r } = input;
    return {
      title: "Meta Ads",
      stages: [
        { label: "Mídia · Conversas iniciadas no WhatsApp", count: c },
        { label: "CRM · Leads ClickMassa (Meta Ads)", count: l },
        { label: "Vendas · Reservas HQ (safra Meta)", count: r },
      ],
      metrics: [
        { label: "Conversas → Leads ClickMassa", value: ratio(l, c) },
        { label: "Leads ClickMassa → Reservas", value: ratio(r, l) },
        { label: "Conversão geral (Conversas → Reservas)", value: ratio(r, c) },
      ],
    };
  }
  if (mode === "google" || mode === "other") {
    const isG = mode === "google";
    const l = isG ? input.googleLeads : input.otherLeads ?? 0;
    const r = isG ? input.googleRes : input.otherRes ?? 0;
    const name = isG ? "Google Ads" : input.otherLabel ?? "Origem";
    return {
      title: name,
      stages: [
        { label: `CRM · Leads ClickMassa (${name})`, count: l },
        { label: `Vendas · Reservas HQ (safra ${name})`, count: r },
      ],
      metrics: [{ label: "Leads ClickMassa → Reservas", value: ratio(r, l) }],
    };
  }
  const l = input.metaLeads + input.googleLeads;
  const r = input.metaRes + input.googleRes;
  return {
    title: "Consolidado Meta + Google",
    stages: [
      { label: "Leads gerados no ClickMassa", count: l },
      { label: "Reservas fechadas no HQ (safra)", count: r },
    ],
    metrics: [{ label: "Conversão geral (Leads → Reservas)", value: ratio(r, l) }],
  };
}

export function computeYoYComparison(
  currentData: Record<string, string | number>[],
  priorYearData: Record<string, string | number>[],
  sourceKeys: string[],
) {
  const result: Record<string, string | number>[] = [];
  const currentByMonth = new Map<string, Record<string, string | number>>();
  const priorByMonth = new Map<string, Record<string, string | number>>();

  currentData.forEach((row) => {
    const month = String(row["month"]);
    currentByMonth.set(month, row);
  });

  priorYearData.forEach((row) => {
    const month = String(row["month"]);
    priorByMonth.set(month, row);
  });

  const monthsSet = new Set([...currentByMonth.keys(), ...priorByMonth.keys()]);
  const sortedMonths = Array.from(monthsSet).sort();

  sortedMonths.forEach((month) => {
    const current = currentByMonth.get(month) ?? { ["month"]: month };
    const prior = priorByMonth.get(month) ?? { ["month"]: month };

    const merged: Record<string, string | number> = { month };

    sourceKeys.forEach((key) => {
      const current_key = `${key}_current`;
      const prior_key = `${key}_prior`;
      merged[current_key] = (current[key] as number) ?? 0;
      merged[prior_key] = (prior[key] as number) ?? 0;
    });

    result.push(merged);
  });

  return result;
}
