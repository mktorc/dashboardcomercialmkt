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

export async function fetchKommoLeads(fromIso: string, toIso: string): Promise<KommoLead[]> {
  if (fromIso > toIso) return [];
  const { data, error } = await fetchAll((a, b) =>
    supabase
      .from("crm_leads")
      .select("lead_id, name, stage_name, seller_name, utm_source, lead_origin, utm_campaign, created_at, updated_at")
      .like("lead_id", `${KOMMO_PREFIX}%`)
      .gte("created_at", fromIso)
      .lte("created_at", toIso)
      .order("created_at")
      .range(a, b),
  );
  if (error) throw error;
  return (data ?? []) as KommoLead[];
}

/** Kommo leads como oportunidades encerradas (sem tarefas pendentes do ClickMassa). */
export const kommoAsOpportunity = (l: KommoLead) => ({
  opportunity_id: l.lead_id,
  lead_id: l.lead_id,
  name: l.name,
  stage_name: l.stage_name,
  status: "closed",
  seller_name: l.seller_name,
  pending_tasks: 0,
  pipeline_step_id: null as number | null,
  created_at: l.created_at,
  updated_at: l.updated_at,
});
