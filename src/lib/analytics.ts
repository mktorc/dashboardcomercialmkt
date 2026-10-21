import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { isOperationalSeller } from "@/lib/comercial";
import { fetchKommoLeads, fetchKommoWins, kommoAsOpportunity, KOMMO_PREFIX } from "@/lib/kommo-leads";

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
  leads?: number;
  /** Conversões geradas no Google Ads (metrics.conversions). */
  conversions?: number;
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
  phone8?: string | null;
  email_lc?: string | null;
  /** Origem do lead vinculado (telefone/e-mail); tem prioridade sobre o Commission Partner. */
  lead_origin?: string | null;
  /** Criação do lead da safra ao qual a reserva pertence. */
  lead_created_at?: string | null;
  /** Lead vinculado por telefone/e-mail (liga a reserva à oportunidade ganha). */
  lead_id?: string | null;
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
  seller_name?: string | null;
  created_at: string;
  updated_at: string;
  stage_name: string | null;
  status: string | null;
  pipeline_step_id: number | null;
  utm_source: string | null;
  utm_campaign?: string | null;
  /** Contato do lead (liga a oportunidade ganha à reserva do HQ). */
  phone8?: string | null;
  email_lc?: string | null;
};

export type AnalyticsData = {
  meta: AdRow[];
  google: AdRow[];
  reservations: ReservationRow[];
  opportunities: OpportunityOriginRow[];
  updatedOpportunities: OpportunityOriginRow[];
  /** Contatos do ClickMassa criados no período com firstConnectionName preenchido. */
  contactsReceived?: number;
  /** Total de crm_leads criados no período (fallback quando first_connection_name ainda não foi preenchido). */
  leadsCreated?: number;
  /** Contatos por origem, pelo nome da conexão (first_connection_name). */
  contactsByOrigin?: Record<string, number>;
};

// "Origem do Lead" do ClickMassa vem primeiro: utm_source quase sempre é só o canal ("whatsapp").
export const resolveLeadSource = (utmSource: string | null, leadOrigin: string | null) =>
  leadOrigin?.trim() || utmSource?.trim() || null;

type ContactRule = {
  id: string;
  /** Casa com a origem normalizada selecionada no dashboard. */
  match: RegExp;
  connection: string[];
  origin: string[];
  /** true: conexão OU origem numa só consulta; false: origem só entra se a conexão contar 0. */
  combined: boolean;
};
const CONTACT_RULES: ContactRule[] = [
  // Meta: só pela Origem do Lead. A conexão "Campanha Meta" recebe contatos de qualquer origem (recorrentes, indicações, sem origem).
  { id: "meta", match: /^meta$/, connection: [], origin: ["%meta%"], combined: true },
  { id: "google", match: /^google$/, connection: ["%Oficial AFS%", "%Google Ads%"], origin: ["%google%"], combined: false },
  { id: "turistorlando", match: /turist/, connection: ["%turist%"], origin: ["%turist%"], combined: true },
  { id: "agencias", match: /agenc|indica/, connection: ["%agenc%", "%indica%"], origin: ["%agenc%", "%indica%"], combined: true },
];

export async function fetchAnalytics(from: string, to: string): Promise<AnalyticsData> {
  const fromDate = new Date(`${from}T00:00:00`);
  const toDate = new Date(`${to}T23:59:59.999`);
  // Mesmos limites em UTC da aba Comercial, para as oportunidades baterem.
  const utcFrom = `${from}T00:00:00.000Z`;
  const utcTo = `${to}T23:59:59.999Z`;
  const [meta, google, reservations, createdOpportunities, updatedOpportunities, contacts, allLeads] = await Promise.all([
      fetchAll((a, b) =>
        supabase
          .from("meta_ads_metrics")
          .select("date, campaign_name, spend, clicks, impressions, utm_campaign, conversations, leads")
          .gte("date", from)
          .lte("date", to)
          .range(a, b),
      ),
      // `conversions` exige a migração 0033; sem ela, cai para a consulta antiga.
      fetchAll((a, b) =>
        supabase
          .from("google_ads_metrics")
          .select("date, campaign_name, spend, clicks, impressions, utm_campaign, conversions")
          .gte("date", from)
          .lte("date", to)
          .range(a, b),
      ).then((res) =>
        res.error
          ? fetchAll((a, b) =>
              supabase
                .from("google_ads_metrics")
                .select("date, campaign_name, spend, clicks, impressions, utm_campaign")
                .gte("date", from)
                .lte("date", to)
                .range(a, b),
            )
          : res,
      ),
      // Base global: todas as reservas confirmadas criadas no período, sem exigir UTM/origem/lead.
      fetchAll((a, b) =>
        supabase
          .from("reservations")
          .select(
            "reservation_id, created_at, pick_up_at, car_category, rental_days, total_amount, rack_rate, status, utm_campaign, commission_partner, phone8, email_lc",
          )
          .eq("status", "confirmed")
          .gte("created_at", iso(fromDate))
          .lte("created_at", iso(toDate))
          .order("reservation_id")
          .range(a, b),
      ),
      fetchAll((a, b) =>
        supabase
          .from("crm_opportunities")
          .select(
            "opportunity_id, lead_id, seller_name, created_at, updated_at, stage_name, status, pipeline_step_id",
          )
          .eq("pipeline_name", "Comercial")
          .gte("created_at", utcFrom)
          .lte("created_at", utcTo)
          .range(a, b),
      ),
      fetchAll((a, b) =>
        supabase
          .from("crm_opportunities")
          .select(
            "opportunity_id, lead_id, seller_name, created_at, updated_at, stage_name, status, pipeline_step_id",
          )
          .eq("pipeline_name", "Comercial")
          .gte("updated_at", iso(fromDate))
          .lte("updated_at", iso(toDate))
          .range(a, b),
      ),
      supabase
        .from("crm_leads")
        .select("id", { count: "exact", head: true })
        .not("first_connection_name", "is", null)
        .neq("first_connection_name", "")
        .gte("created_at", iso(fromDate))
        .lte("created_at", iso(toDate)),
      supabase
        .from("crm_leads")
        .select("id", { count: "exact", head: true })
        .gte("created_at", iso(fromDate))
        .lte("created_at", iso(toDate)),
    ]);
  // Contatos por origem vêm só de crm_leads (nunca de crm_opportunities).
  const countContacts = async (rule: ContactRule) => {
    const ilikes = (col: string, terms: string[]) => terms.map((t) => `${col}.ilike.${t}`);
    const count = async (filters: string[]) => {
      const { count, error } = await supabase
        .from("crm_leads")
        .select("id", { count: "exact", head: true })
        .or(filters.join(","))
        .gte("created_at", iso(fromDate))
        .lte("created_at", iso(toDate));
      if (error) throw error;
      return count ?? 0;
    };
    const conn = ilikes("first_connection_name", rule.connection);
    const origin = ilikes("lead_origin", rule.origin);
    if (rule.combined) return count([...conn, ...origin]);
    // Primário: nome da conexão; fallback: Origem do Lead (histórico sem first_connection_name).
    return (await count(conn)) || (await count(origin));
  };
  const contactCounts = await Promise.all(CONTACT_RULES.map(countContacts));
  const contactsByOrigin = Object.fromEntries(CONTACT_RULES.map((r, i) => [r.id, contactCounts[i]!]));
  const [kommoLeads, kommoWins] = await Promise.all([
    fetchKommoLeads(utcFrom, utcTo),
    fetchKommoWins(iso(fromDate), iso(toDate)),
  ]);

  const err =
    meta.error ||
    google.error ||
    reservations.error ||
    createdOpportunities.error ||
    updatedOpportunities.error ||
    contacts.error ||
    allLeads.error;
  if (err) throw err;

  // Mesma base da aba Comercial: só vendedores operacionais.
  const createdRows = [
    ...((createdOpportunities.data ?? []) as Omit<OpportunityOriginRow, "utm_source" | "utm_campaign">[]),
    ...kommoLeads.map((lead) => kommoAsOpportunity(lead)),
  ].filter((row) => isOperationalSeller(row.seller_name)) as Omit<OpportunityOriginRow, "utm_source" | "utm_campaign">[];
  // Kommo: o updated_at foi reescrito na importação; o ganho é datado pela reserva do HQ.
  const updatedRows = [
    ...((updatedOpportunities.data ?? []) as Omit<OpportunityOriginRow, "utm_source" | "utm_campaign">[]),
    ...kommoWins.map(({ lead, wonAt }) => ({ ...kommoAsOpportunity(lead, ""), updated_at: wonAt })),
  ] as Omit<OpportunityOriginRow, "utm_source" | "utm_campaign">[];
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
          .select("lead_id, utm_source, lead_origin, utm_campaign, first_connection_name, phone8, email_lc")
          .in("lead_id", leadIds.slice(index * 400, (index + 1) * 400))
          .range(a, b),
      ),
    ),
  );
  const originLeadError = originLeadPages.find((page) => page.error)?.error;
  if (originLeadError) throw originLeadError;
  const leadAttributionById = new Map<
    string,
    { source: string | null; campaign: string | null; phone8: string | null; email_lc: string | null }
  >();
  [...kommoLeads, ...kommoWins.map((win) => win.lead)].forEach((lead) =>
    leadAttributionById.set(lead.lead_id, {
      source: resolveLeadSource(lead.utm_source, lead.lead_origin),
      campaign: lead.utm_campaign,
      phone8: lead.phone8 ?? null,
      email_lc: lead.email_lc ?? null,
    }),
  );
  originLeadPages.forEach((page) => {
    (
      page.data as {
        lead_id: string | null;
        utm_source: string | null;
        lead_origin: string | null;
        utm_campaign: string | null;
        first_connection_name: string | null;
        phone8: string | null;
        email_lc: string | null;
      }[]
    ).forEach((lead) => {
      if (lead.lead_id)
        leadAttributionById.set(lead.lead_id, {
          // Só a Origem do Lead define o canal: a conexão "Google Ads e Oficial" também recebe recorrentes e indicações.
          source: resolveLeadSource(lead.utm_source, lead.lead_origin),
          campaign: lead.utm_campaign,
          phone8: lead.phone8,
          email_lc: lead.email_lc,
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
      phone8: opportunity.lead_id ? (leadAttributionById.get(opportunity.lead_id)?.phone8 ?? null) : null,
      email_lc: opportunity.lead_id ? (leadAttributionById.get(opportunity.lead_id)?.email_lc ?? null) : null,
    }));

  const num = <T extends { spend: unknown }>(rows: T[]) =>
    rows.map((r) => ({ ...r, spend: Number(r.spend) })) as unknown as AdRow[];
  const opportunities = attachOrigin(createdRows);
  const updated = attachOrigin(updatedRows);

  const rawReservations = ((reservations.data ?? []) as (ReservationRow & { rack_rate: number | null })[]).map(
    ({ rack_rate, ...reservation }) => ({
      ...reservation,
      total_amount: Number(rack_rate ?? reservation.total_amount),
    }),
  );

  const linkedReservations = await attachLeadOrigin(rawReservations);

  return {
    meta: num((meta.data ?? []) as never[]),
    google: num((google.data ?? []) as never[]),
    reservations: linkedReservations,
    opportunities,
    updatedOpportunities: updated,
    contactsReceived: contacts.count ?? 0,
    leadsCreated: allLeads.count ?? 0,
    contactsByOrigin,
  };
}

/**
 * Vincula cada reserva ao lead (telefone/e-mail) e herda a origem dele em `lead_origin`.
 * Sem isso só reservas com UTM ou Commission Partner entram na atribuição por canal.
 */
async function attachLeadOrigin<T extends ReservationRow>(rows: T[]): Promise<T[]> {
  const chunk = <V,>(items: V[], size: number) =>
    Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
  const phones = [...new Set(rows.map((r) => r.phone8).filter((v): v is string => Boolean(v) && v!.length === 8))];
  const emails = [...new Set(rows.map((r) => r.email_lc).filter((v): v is string => Boolean(v)))];
  const select = "lead_id, phone8, email_lc, created_at, utm_source, lead_origin, first_connection_name";
  type L = {
    lead_id: string | null;
    phone8: string | null;
    email_lc: string | null;
    created_at: string;
    utm_source: string | null;
    lead_origin: string | null;
    first_connection_name: string | null;
  };
  const pages = await Promise.all([
    ...chunk(phones, 200).map((ids) =>
      fetchAll((a, b) => supabase.from("crm_leads").select(select).in("phone8", ids).order("lead_id").range(a, b)),
    ),
    ...chunk(emails, 100).map((ids) =>
      fetchAll((a, b) => supabase.from("crm_leads").select(select).in("email_lc", ids).order("lead_id").range(a, b)),
    ),
  ]);
  const failed = pages.find((page) => page.error);
  if (failed?.error) throw failed.error;
  const byKey = new Map<string, L[]>();
  const add = (key: string, lead: L) => byKey.set(key, [...(byKey.get(key) ?? []), lead]);
  pages.forEach((page) =>
    (page.data as L[]).forEach((lead) => {
      if (lead.phone8) add(`p:${lead.phone8}`, lead);
      if (lead.email_lc) add(`e:${lead.email_lc}`, lead);
    }),
  );
  return rows.map((r) => {
    const limit = Date.parse(r.created_at) + 86_400_000;
    const candidates = [
      ...(r.phone8 ? (byKey.get(`p:${r.phone8}`) ?? []) : []),
      ...(r.email_lc ? (byKey.get(`e:${r.email_lc}`) ?? []) : []),
    ].filter((lead) => Date.parse(lead.created_at) <= limit);
    const lead = candidates.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
    if (!lead) return r;
    const source = resolveLeadSource(lead.utm_source, lead.lead_origin);
    return { ...r, lead_id: lead.lead_id, ...(source ? { lead_origin: source } : {}) };
  });
}

export const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
export const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

/** Custos mensais da equipe de marketing ("YYYY-MM" → valor). */
export async function fetchTeamCosts(): Promise<Record<string, number>> {
  const { data, error } = await supabase.from("marketing_team_costs").select("month, amount");
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((r) => [r.month, Number(r.amount)]));
}

/** Rateia o custo mensal pelos dias do período [from, to] (YYYY-MM-DD, inclusive). */
export function teamCostForRange(costs: Record<string, number>, from: string, to: string): number {
  let total = 0;
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= end; t += 86_400_000) {
    const day = new Date(t);
    const amount = costs[day.toISOString().slice(0, 7)];
    if (!amount) continue;
    total += amount / new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0)).getUTCDate();
  }
  return total;
}

export function computeKpis(d: AnalyticsData, teamSpend = 0) {
  const metaSpend = d.meta.reduce((s, r) => s + r.spend, 0);
  const googleSpend = d.google.reduce((s, r) => s + r.spend, 0);
  const spend = metaSpend + googleSpend + teamSpend;
  const leads = d.opportunities.length;
  const confirmed = d.reservations.filter((r) => r.status === "confirmed");
  const revenue = confirmed.reduce((s, r) => s + r.total_amount, 0);
  return {
    metaSpend,
    googleSpend,
    teamSpend,
    spend,
    leads,
    cpl: leads ? spend / leads : 0,
    conversion: leads ? confirmed.length / leads : 0,
    reservations: confirmed.length,
    revenue,
    ticket: confirmed.length ? revenue / confirmed.length : 0,
    cac: confirmed.length ? spend / confirmed.length : null,
    /** CAC percentual: investimento ÷ faturamento em rack rate. */
    cacPct: revenue > 0 ? spend / revenue : null,
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
  // Faturamento alocado pela data real de fechamento (created_at), não pela data de pick_up_at.
  d.reservations.forEach(
    (r) => {
      const day = r.created_at.slice(0, 10);
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
  // "Ganho" é a etapa de vitória do Kommo (histórico 2025).
  if (/^\s*ganho\s*$/.test(value)) return true;
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
    ...(data.contactsReceived !== undefined ? { contactsReceived: data.contactsReceived } : {}),
    ...(data.leadsCreated !== undefined ? { leadsCreated: data.leadsCreated } : {}),
    ...(data.contactsByOrigin ? { contactsByOrigin: data.contactsByOrigin } : {}),
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

export const ALL_ORIGINS_KEY = "__all";

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

    let totalCurrent = 0;
    let totalPrior = 0;
    sourceKeys.forEach((key) => {
      const current_key = `${key}_current`;
      const prior_key = `${key}_prior`;
      merged[current_key] = (current[key] as number) ?? 0;
      merged[prior_key] = (prior[key] as number) ?? 0;
      totalCurrent += Number(merged[current_key]);
      totalPrior += Number(merged[prior_key]);
    });
    // Soma de todas as origens: usada quando o filtro é "Todas as Origens".
    merged[`${ALL_ORIGINS_KEY}_current`] = totalCurrent;
    merged[`${ALL_ORIGINS_KEY}_prior`] = totalPrior;

    result.push(merged);
  });

  return result;
}

export type MarketingFunnel = {
  stages: { label: string; count: number; hint?: string | undefined }[];
  metrics: { label: string; value: number | null }[];
};

/**
 * Funil de marketing. Meta Ads: 4 etapas (Leads Meta → Contatos → Oportunidades → Ganhas).
 * Demais filtros: começa nos Contatos (sem etapa de mídia). `d` já vem filtrado pela origem;
 * `origin` é a origem selecionada (null = todas).
 */
export function buildMarketingFunnel(d: AnalyticsData, origin: string | null = null): MarketingFunnel {
  const key = origin ? normalizeOrigin(origin) : null;
  const opportunities = d.opportunities.length;
  const won = d.reservations.filter((r) => r.status === "confirmed");
  const revenue = won.reduce((s, r) => s + r.total_amount, 0);

  // Contatos por origem (nome da conexão). Só "todas" tem fallback para o total de leads criados.
  let contacts: number | null;
  let contactsHint: string | undefined;
  if (key === null) {
    // "Todas as origens": todos os leads criados no período. first_connection_name só vem preenchido
    // em parte dos leads (ex.: Oficial AFS), então contá-lo sozinho subconta o topo do funil.
    contacts = Math.max(d.leadsCreated ?? 0, d.contactsReceived ?? 0);
  } else {
    const rule = CONTACT_RULES.find((r) => r.match.test(key));
    contacts = rule ? (d.contactsByOrigin?.[rule.id] ?? 0) : null; // origem sem regra de contatos
  }

  const stages: MarketingFunnel["stages"] = [];
  const metrics: MarketingFunnel["metrics"] = [];
  const oppStage = { label: "Oportunidades criadas", count: opportunities };
  const wonStage = { label: "Oportunidades ganhas (reservas)", count: won.length, hint: brl(revenue) };

  if (key === "google") {
    const conversions = Math.round(d.google.reduce((s, r) => s + (Number(r.conversions) || 0), 0));
    const spend = d.google.reduce((s, r) => s + r.spend, 0);
    stages.push({
      label: "Conversões geradas no Google Ads",
      count: conversions,
      hint: conversions ? `CPA ${brl(spend / conversions)}` : undefined,
    });
    metrics.push({ label: "Taxa de Recepção (Mídia → Contato)", value: ratio(contacts ?? 0, conversions) });
  }
  if (key === "meta") {
    const nativeLeads = d.meta.reduce((s, r) => s + (Number(r.leads) || 0), 0);
    const conversations = d.meta.reduce((s, r) => s + (Number(r.conversations) || 0), 0);
    const clicks = d.meta.reduce((s, r) => s + (Number(r.clicks) || 0), 0);
    const metaLeads = nativeLeads || conversations || clicks;
    const spend = d.meta.reduce((s, r) => s + r.spend, 0);
    const fallback = nativeLeads ? undefined : conversations ? "conversas (fallback)" : clicks ? "cliques (fallback)" : undefined;
    stages.push({
      label: "Leads gerados no Meta Ads",
      count: metaLeads,
      hint: metaLeads ? [`CPL ${brl(spend / metaLeads)}`, fallback].filter(Boolean).join(" · ") : undefined,
    });
    metrics.push({ label: "Taxa de Recepção (Mídia → Contato)", value: ratio(contacts ?? 0, metaLeads) });
  }
  if (contacts !== null) stages.push({ label: "Contatos recebidos no ClickMassa", count: contacts, hint: contactsHint });
  stages.push(oppStage, wonStage);

  if (contacts !== null) metrics.push({ label: "Taxa de Qualificação (Contato → Oportunidade)", value: ratio(opportunities, contacts) });
  metrics.push({ label: "Taxa de Fechamento (Oportunidade → Ganha)", value: ratio(won.length, opportunities) });
  if (contacts !== null) {
    const denom = key === "meta" || key === "google" ? stages[0]!.count : contacts;
    metrics.push({
      label: key === "meta" ? "Conversão Global (Lead Meta → Ganha)" : key === "google" ? "Conversão Global (Conversão Google → Ganha)" : "Conversão Global (Contato → Ganha)",
      value: ratio(won.length, denom),
    });
  }
  return { stages: stages.map((st, i) => ({ ...st, label: `${i + 1} · ${st.label}` })), metrics };
}

export interface OpportunityComparisonPoint {
  monthLabel: string;
  currentYear: number;
  previousYear: number;
}

// Alinha os meses do período atual com os do período espelho (-1 ano) pela posição.
// As chaves de origem (origin_N) são por conjunto de dados, então a soma é feita por
// rótulo de origem em cada lado; originLabelFilter limita a uma origem (null = todas).
export function buildOpportunityComparison(
  current: Record<string, string | number>[],
  currentSources: { key: string; label: string }[],
  previous: Record<string, string | number>[],
  previousSources: { key: string; label: string }[],
  originLabelFilter: string | null,
): OpportunityComparisonPoint[] {
  const keysOf = (sources: { key: string; label: string }[]) =>
    sources
      .filter((source) => originLabelFilter === null || source.label === originLabelFilter)
      .map((source) => source.key);
  const currentKeys = keysOf(currentSources);
  const previousKeys = keysOf(previousSources);
  const total = (row: Record<string, string | number> | undefined, keys: string[]) =>
    row ? keys.reduce((sum, key) => sum + Number(row[key] ?? 0), 0) : 0;
  return current.map((row, index) => ({
    monthLabel: String(row["month"]),
    currentYear: total(row, currentKeys),
    previousYear: total(previous[index], previousKeys),
  }));
}

export type ChannelComparisonMode = "meta" | "google" | "both";
/** `null` = sem dados suficientes no mês (o canal tem poucas oportunidades/reservas atribuídas). */
export type ChannelMonthlyPoint = {
  month: string;
  conversao: number | null;
  cac: number | null;
  /** Componentes do cálculo, mostrados no tooltip para conferência. */
  detail: { created: number; won: number; reservations: number; revenue: number; media: number; team: number };
};
// Mínimos para exibir os indicadores: abaixo disso a origem do lead não foi registrada o bastante
// e a razão fica distorcida (ex.: CAC % de 120% com 1 reserva atribuída).
export const MIN_CHANNEL_OPPORTUNITIES = 10;
export const MIN_CHANNEL_RESERVATIONS = 5;

const MONTH_LABEL = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** Por mês: taxa de conversão (ganhas ÷ criadas) e CAC % (investimento ÷ rack rate), em %, por canal. */
export function computeChannelMonthly(
  data: AnalyticsData,
  mode: ChannelComparisonMode,
  months: string[],
  teamCosts: Record<string, number> = {},
): ChannelMonthlyPoint[] {
  // A atribuição usa o período todo (campanha → canal); só depois divide por mês.
  const scopedAll: AnalyticsData =
    mode === "both"
      ? {
          ...data,
          opportunities: data.opportunities.filter((o) => ["meta", "google"].includes(normalizeOrigin(o.utm_source))),
          reservations: [
            ...filterAnalyticsByOrigin(data, "meta").reservations,
            ...filterAnalyticsByOrigin(data, "google").reservations,
          ],
        }
      : filterAnalyticsByOrigin(data, mode);
  return months.map((key) => {
    const inMonth = (value: string) => value.slice(0, 7) === key;
    const monthOpportunities = scopedAll.opportunities.filter((o) => inMonth(o.created_at));
    // Paridade com as ganhas: faturamento e reservas são só os das oportunidades ganhas da safra do mês.
    // O vínculo é pelo contato (telefone/e-mail): a mesma pessoa pode ter mais de um lead no CRM.
    const wonPhones = new Set<string>();
    const wonEmails = new Set<string>();
    monthOpportunities.filter(isWonOpportunity).forEach((o) => {
      if (o.phone8) wonPhones.add(o.phone8);
      if (o.email_lc) wonEmails.add(o.email_lc);
    });
    const scoped: AnalyticsData = {
      ...scopedAll,
      meta: scopedAll.meta.filter((r) => inMonth(r.date)),
      google: scopedAll.google.filter((r) => inMonth(r.date)),
      opportunities: monthOpportunities,
      updatedOpportunities: [],
      reservations: data.reservations.filter(
        (r) =>
          r.status === "confirmed" &&
          ((r.phone8 != null && wonPhones.has(r.phone8)) || (r.email_lc != null && wonEmails.has(r.email_lc))),
      ),
    };
    // Consolidado inclui a equipe de marketing; o mês corrente vai só até hoje (como o faturamento).
    const monthEnd = new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 0)).toISOString().slice(0, 10);
    const lastDay = monthEnd < isoDay(new Date()) ? monthEnd : isoDay(new Date());
    const teamSpend = mode === "both" ? teamCostForRange(teamCosts, `${key}-01`, lastDay) : 0;
    const kpis = computeKpis(scoped, teamSpend);
    const created = scoped.opportunities.length;
    const won = scoped.opportunities.filter(isWonOpportunity).length;
    return {
      month: `${MONTH_LABEL[Number(key.slice(5, 7)) - 1]}/${key.slice(2, 4)}`,
      conversao: created >= MIN_CHANNEL_OPPORTUNITIES ? (won / created) * 100 : null,
      cac: kpis.reservations >= MIN_CHANNEL_RESERVATIONS && kpis.spend > 0 && kpis.cacPct != null ? kpis.cacPct * 100 : null,
      detail: {
        created,
        won,
        reservations: kpis.reservations,
        revenue: kpis.revenue,
        media: kpis.metaSpend + kpis.googleSpend,
        team: teamSpend,
      },
    };
  });
}
