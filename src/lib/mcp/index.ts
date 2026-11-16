import { auth, defineMcp } from "@lovable.dev/mcp-js";
import { TOOLS } from "./tools";

const projectRef = import.meta.env["VITE_SUPABASE_PROJECT_ID"] ?? "project-ref-unset";

export default defineMcp({
  name: "pixel-perfect-pixel",
  title: "Pixel Perfect Pixel",
  version: "0.2.0",
  instructions:
    "Dados da Orlando Rent Car, somente leitura. Comece por `list_available_datasets`/`describe_dataset` para ver conjuntos, colunas e relacionamentos. Domínios: marketing (marketing_summary, ads_performance, marketing_team_costs), CRM (crm_leads, crm_opportunities, crm_tasks, crm_funnel, crm_lead_journey), reservas (reservations_report, sales_by_seller, reservation_details, reservation_segments, reservation_status_changes, reservation_onboarding_report), comissões (commissions_report, commission_partners), precificação (our_rates, occupancy_forecast, occupancy_pace, pricing_study_reports), frota (fleet_overview), concorrência (competitors, competitor_prices), metas (sales_goals_progress) e integrações (sync_status). Datas YYYY-MM-DD em UTC, intervalos inclusivos. Valores em USD, salvo o campo currency nas coletas de concorrentes. Listas são paginadas: use offset = next_offset enquanto has_more.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: TOOLS,
});
