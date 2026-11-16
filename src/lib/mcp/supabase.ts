import { createClient } from "@supabase/supabase-js";
import { ToolError, type AuthContext } from "@lovable.dev/mcp-js";

type RuntimeGlobals = typeof globalThis & {
  process?: { env?: Record<string, string | undefined> };
};

function env(names: string[]): string | undefined {
  const p = (globalThis as RuntimeGlobals).process?.env;
  for (const n of names) {
    const v = p?.[n]?.trim();
    if (v) return v;
  }
  return undefined;
}

/** Papel que o token do usuário técnico deve carregar (claim `role`, definida pelo custom_access_token_hook). */
export const MCP_ROLE = "mcp_reader";

/**
 * Únicas relações que o MCP pode consultar. As 23 views mcp_* liberadas no banco;
 * qualquer nome fora da lista é recusado antes de chegar ao banco.
 */
export const MCP_VIEWS = [
  "mcp_commission_partners",
  "mcp_competitor_category_map",
  "mcp_competitor_price_snapshots",
  "mcp_competitors",
  "mcp_crm_leads",
  "mcp_crm_opportunities",
  "mcp_crm_tasks",
  "mcp_fleet_stats",
  "mcp_fleet_vehicles",
  "mcp_google_ads_metrics",
  "mcp_marketing_team_costs",
  "mcp_meta_ads_metrics",
  "mcp_our_rate_snapshots",
  "mcp_pricing_occupancy_forecast",
  "mcp_pricing_occupancy_pace",
  "mcp_pricing_study_report",
  "mcp_reservas",
  "mcp_reservation_onboarding",
  "mcp_reservation_segments",
  "mcp_reservation_status_history",
  "mcp_reservations",
  "mcp_sales_goals",
  "mcp_sync_runs",
] as const;
export type McpView = (typeof MCP_VIEWS)[number];

export function assertMcpView(view: string): asserts view is McpView {
  if (!(MCP_VIEWS as readonly string[]).includes(view))
    throw new ToolError("Consulta não permitida");
}

/**
 * Erros como ToolError: o mcp-js troca qualquer outro erro por "tool execution failed",
 * escondendo do cliente o motivo da recusa. As mensagens não contêm segredos.
 */
/** Confere usuário técnico (UUID em MCP_ALLOWED_USER_ID, fail-closed) e role no JWT já verificado. */
export function assertMcpAccess(ctx: AuthContext) {
  if (!ctx.isAuthenticated()) throw new ToolError("Usuário não autenticado");
  const allowed = env(["MCP_ALLOWED_USER_ID"]);
  if (!allowed) throw new ToolError("Acesso MCP não configurado");
  if (ctx.getUserId() !== allowed) throw new ToolError("Usuário sem permissão para o MCP");
  if (ctx.getClaims()?.["role"] !== MCP_ROLE) throw new ToolError("Token sem o papel exigido");
}

/** Cliente somente leitura: só expõe `from` sobre as views permitidas, com o Bearer do usuário. */
export function mcpDb(ctx: AuthContext) {
  assertMcpAccess(ctx);
  const sb = supabaseForUser(ctx);
  return {
    from: (view: McpView) => {
      assertMcpView(view);
      return sb.from(view);
    },
  };
}

export type McpDb = ReturnType<typeof mcpDb>;

function supabaseForUser(ctx: AuthContext) {
  const token = ctx.getToken();
  if (!token) throw new ToolError("Usuário não autenticado");
  const url = env(["SUPABASE_URL", "VITE_SUPABASE_URL"]) ?? import.meta.env["VITE_SUPABASE_URL"];
  const key =
    env(["SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY"]) ??
    import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) throw new ToolError("Configuração do backend ausente");
  return createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
