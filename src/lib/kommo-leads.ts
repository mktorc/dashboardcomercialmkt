import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";

// Leads históricos do Kommo (antes da migração para o ClickMassa) ficam só em crm_leads.
// Eles entram como oportunidades nos períodos anteriores ao ClickMassa.
export const KOMMO_PREFIX = "kommo-";

export type KommoLead = {
  lead_id: string;
  name: string | null;
  stage_name: string | null;
  seller_name: string | null;
  utm_source: string | null;
  lead_origin: string | null;
  utm_campaign: string | null;
  created_at: string;
  updated_at: string;
};

export async function fetchKommoLeads(fromIso: string, toIso: string,
  dateColumn: "created_at" | "updated_at" = "created_at",
): Promise<KommoLead[]> {
  if (fromIso > toIso) return [];
  const { data, error } = await fetchAll((a, b) =>
    supabase
      .from("crm_leads")
      .select("lead_id, name, stage_name, seller_name, utm_source, lead_origin, utm_campaign, created_at, updated_at")
      .like("lead_id", `${KOMMO_PREFIX}%`)
      .gte(dateColumn, fromIso)
      .lte(dateColumn, toIso)
      .order(dateColumn)
      .range(a, b),
  );
  if (error) throw error;
  return (data ?? []) as KommoLead[];
}

/** Kommo leads como oportunidades encerradas (sem tarefas pendentes do ClickMassa). */
export const kommoAsOpportunity = (l: KommoLead, status = "closed") => ({
  opportunity_id: l.lead_id,
  lead_id: l.lead_id,
  name: l.name,
  stage_name: l.stage_name,
  status,
  seller_name: l.seller_name,
  pending_tasks: 0,
  pipeline_step_id: null as number | null,
  created_at: l.created_at,
  updated_at: l.updated_at,
});

export type KommoWin = { lead: KommoLead; wonAt: string };

const chunk = <T,>(items: T[], size: number) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

/**
 * Ganhos do Kommo datados pelo HQ: o updated_at do Kommo foi reescrito na importação, então a data
 * do ganho é a da reserva confirmada criada no HQ cruzada por telefone (últimos 8 dígitos) ou e-mail.
 * Cada lead "Ganho" conta uma vez, na primeira reserva do período posterior à criação do lead.
 */
export async function fetchKommoWins(fromIso: string, toIso: string): Promise<KommoWin[]> {
  if (fromIso > toIso) return [];
  const res = await fetchAll((a, b) =>
    supabase
      .from("reservations")
      .select("created_at, phone8, email_lc")
      .eq("status", "confirmed")
      .gte("created_at", fromIso)
      .lte("created_at", toIso)
      .order("created_at")
      .range(a, b),
  );
  if (res.error) throw res.error;
  const reservations = res.data as { created_at: string; phone8: string | null; email_lc: string | null }[];
  const phones = [...new Set(reservations.map((r) => r.phone8).filter((v): v is string => Boolean(v)))];
  const emails = [...new Set(reservations.map((r) => r.email_lc).filter((v): v is string => Boolean(v)))];

  const select =
    "lead_id, name, stage_name, seller_name, utm_source, lead_origin, utm_campaign, created_at, updated_at, phone8, email_lc";
  type Row = KommoLead & { phone8: string | null; email_lc: string | null };
  const pages = await Promise.all([
    ...chunk(phones, 200).map((ids) =>
      fetchAll((a, b) =>
        supabase.from("crm_leads").select(select).like("lead_id", `${KOMMO_PREFIX}%`)
          .ilike("stage_name", "ganho").in("phone8", ids).order("lead_id").range(a, b),
      ),
    ),
    ...chunk(emails, 100).map((ids) =>
      fetchAll((a, b) =>
        supabase.from("crm_leads").select(select).like("lead_id", `${KOMMO_PREFIX}%`)
          .ilike("stage_name", "ganho").in("email_lc", ids).order("lead_id").range(a, b),
      ),
    ),
  ]);
  const failed = pages.find((p) => p.error);
  if (failed?.error) throw failed.error;
  const leads = new Map<string, Row>();
  pages.forEach((p) => (p.data as Row[]).forEach((l) => leads.set(l.lead_id, l)));

  const wins: KommoWin[] = [];
  leads.forEach((lead) => {
    // reservations já vem ordenado por created_at: a primeira posterior à criação do lead vence.
    const match = reservations.find(
      (r) =>
        // Mesma tolerância de 1 dia da coorte do banco (0021_cohort_reservations_definer).
        Date.parse(r.created_at) >= Date.parse(lead.created_at) - 86_400_000 &&
        ((r.phone8 && r.phone8 === lead.phone8) || (r.email_lc && r.email_lc === lead.email_lc)),
    );
    if (match) wins.push({ lead, wonAt: match.created_at });
  });
  return wins;
}
