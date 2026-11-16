/**
 * Validação contra o Supabase real, com o token do usuário técnico (role mcp_reader).
 * Só roda com MCP_LIVE_TOKEN definido no shell (nunca lido do .env):
 *   MCP_LIVE_TOKEN=eyJ... npx vitest run src/lib/mcp/mcp.live.test.ts
 * Usa a URL e a chave publicável do VITE_* (públicas); nenhuma credencial privilegiada.
 */
import { createClient } from "@supabase/supabase-js";
import type { AuthContext } from "@lovable.dev/mcp-js";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { MCP_VIEWS } from "./supabase";
import { TOOLS } from "./tools";

const token = process.env["MCP_LIVE_TOKEN"]?.trim();
const url = process.env["VITE_SUPABASE_URL"] ?? import.meta.env["VITE_SUPABASE_URL"];
const key =
  process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ?? import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"];

const claims = token
  ? (JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString()) as Record<
      string,
      unknown
    >)
  : {};
const ctx = {
  isAuthenticated: () => true,
  getToken: () => token,
  getUserId: () => claims["sub"],
  getClaims: () => claims,
} as unknown as AuthContext;

type T = {
  name: string;
  inputSchema?: Record<string, z.ZodType>;
  handler: (a: unknown, c: AuthContext) => Promise<{ structuredContent?: unknown }>;
};
async function call(name: string, args: Record<string, unknown> = {}) {
  const t = (TOOLS as unknown as T[]).find((x) => x.name === name)!;
  const r = await t.handler(
    z
      .object(t.inputSchema ?? {})
      .strict()
      .parse(args),
    ctx,
  );
  return r.structuredContent as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const sb = () =>
  createClient(url!, key!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Q = any;
async function count(view: string, f: (q: Q) => Q = (q) => q) {
  const { count: n, error } = await f(sb().from(view).select("*", { count: "exact", head: true }));
  if (error) throw new Error(`${view}: ${error.message}`);
  return n ?? 0;
}

const today = new Date().toISOString().slice(0, 10);
const monthStart = `${today.slice(0, 7)}-01`;
const from = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);

describe.skipIf(!token)("MCP contra o Supabase real", { timeout: 180_000 }, () => {
  beforeAll(() => {
    process.env["MCP_ALLOWED_USER_ID"] ??= String(claims["sub"]);
    process.env["SUPABASE_URL"] ??= url;
    process.env["SUPABASE_PUBLISHABLE_KEY"] ??= key;
  });

  it("o token é do usuário técnico com role mcp_reader", () => {
    expect(claims["role"]).toBe("mcp_reader");
  });

  it.each(MCP_VIEWS)("view %s responde ao mcp_reader", async (v) => {
    await expect(count(v)).resolves.toBeGreaterThanOrEqual(0);
  });

  // As views são security_invoker: o mcp_reader tem SELECT só nas colunas que elas expõem.
  // O que importa é que as colunas escondidas (pessoais/internas) e as tabelas sem view sigam bloqueadas.
  it("colunas escondidas pelas views e tabelas sem view continuam inacessíveis", async () => {
    const blocked: [string, string][] = [
      ["reservations", "customer_email"],
      ["reservations", "customer_phone"],
      ["reservations", "email_lc"],
      ["reservations", "phone8"],
      ["commission_partners", "internal_notes"],
      ["pricing_study_report", "html"],
      ["user_roles", "*"],
      ["webhook_logs", "*"],
    ];
    for (const [t, col] of blocked) {
      const { data, error } = await sb().from(t).select(col).limit(1);
      expect(error || (data ?? []).length === 0, `${t}.${col}`).toBeTruthy();
    }
  });

  it("todas as ferramentas executam com dados reais", async () => {
    const args: Record<string, Record<string, unknown>> = {
      describe_dataset: { dataset: "mcp_reservations" },
      marketing_summary: { from, to: today },
      ads_performance: { from, to: today, group_by: "utm_campaign", include_funnel: true },
      crm_leads: { from, to: today },
      crm_opportunities: { from, to: today, group_by: "status" },
      crm_tasks: { overdue_only: true },
      crm_funnel: { from, to: today },
      sales_by_seller: { from, to: today },
      reservations_report: { from, to: today, group_by: "car_category" },
      reservation_segments: { from: today, to: today },
      reservation_status_changes: { from, to: today },
      reservation_onboarding_report: { from: today, to: today },
      commissions_report: { from, to: today },
      our_rates: { from: today, to: today },
      fleet_overview: { from, to: today },
      competitor_prices: { collected_from: from, collected_to: today },
      sales_goals_progress: { from_month: today.slice(0, 7) },
    };
    const skip = new Set(["crm_lead_journey", "reservation_details"]);
    for (const t of TOOLS as unknown as T[]) {
      if (skip.has(t.name)) continue;
      await expect(call(t.name, args[t.name] ?? {}), t.name).resolves.toBeTruthy();
    }
  });

  it("totais batem com contagens diretas no banco", async () => {
    const r = await call("reservations_report", {
      from: monthStart,
      to: today,
      status_mode: "all",
    });
    expect(r["totals"].reservations).toBe(
      await count("mcp_reservations", (q) =>
        q.gte("created_at", monthStart).lte("created_at", `${today}T23:59:59.999Z`),
      ),
    );
    const { summary } = await call("marketing_summary", { from: monthStart, to: today });
    expect(summary.leads).toBe(
      await count("mcp_crm_leads", (q) =>
        q.gte("created_at", monthStart).lte("created_at", `${today}T23:59:59.999Z`),
      ),
    );
    const leads = await call("crm_leads", { from: monthStart, to: today, limit: 1 });
    expect(leads["total"]).toBe(summary.leads);
    const sync = await call("sync_status", {});
    expect(sync["total"]).toBe(await count("mcp_sync_runs"));
  });

  it("customers_summary funciona após aplicar sql-para-gravar/mcp_customer_key.sql", async () => {
    const r = await call("customers_summary", {});
    expect(r["unique_customers"]).toBeGreaterThan(0);
    expect(r["unique_customers"]).toBeLessThanOrEqual(r["reservations"]);
  });
});
