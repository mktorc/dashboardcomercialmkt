import { describeDataset, listAvailableDatasets } from "./discovery";
import { adsPerformance, marketingSummary, marketingTeamCosts } from "./marketing";
import { crmFunnel, crmLeadJourney, crmLeads, crmOpportunities, crmTasks } from "./crm";
import {
  commissionPartners,
  commissionsReport,
  reservationDetails,
  reservationOnboardingReport,
  reservationSegments,
  reservationsReport,
  reservationStatusChanges,
  salesBySeller,
} from "./reservations";
import { occupancyForecast, occupancyPace, ourRates, pricingStudyReports } from "./pricing";
import {
  competitorPrices,
  competitors,
  fleetOverview,
  salesGoalsProgress,
  syncStatus,
} from "./operations";

/** Todas as ferramentas MCP, por domínio. Todas somente leitura, via mcpDb (whitelist das views mcp_*). */
export const TOOLS = [
  // Descoberta
  listAvailableDatasets,
  describeDataset,
  // Marketing
  marketingSummary,
  adsPerformance,
  marketingTeamCosts,
  // Comercial e CRM
  crmLeads,
  crmOpportunities,
  crmTasks,
  crmFunnel,
  crmLeadJourney,
  // Reservas
  salesBySeller,
  reservationsReport,
  reservationDetails,
  reservationSegments,
  reservationStatusChanges,
  reservationOnboardingReport,
  // Comissões
  commissionsReport,
  commissionPartners,
  // Precificação
  ourRates,
  occupancyForecast,
  occupancyPace,
  pricingStudyReports,
  // Frota
  fleetOverview,
  // Concorrência
  competitors,
  competitorPrices,
  // Gestão e metas
  salesGoalsProgress,
  // Integrações
  syncStatus,
];
