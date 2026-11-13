import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { mcpDb } from "../supabase";
import { fetchAllFrom } from "./paginate";

const dateRe = /^\d{4}-\d{2}-\d{2}$/;

export default defineTool({
  name: "marketing_summary",
  title: "Resumo de marketing",
  description:
    "Investimento (Meta + Google Ads), leads, faturamento de reservas confirmadas, CPL e ROAS num período.",
  inputSchema: {
    from: z.string().regex(dateRe).describe("Data inicial YYYY-MM-DD"),
    to: z.string().regex(dateRe).describe("Data final YYYY-MM-DD (inclusiva)"),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ from, to }, ctx) => {
    if (!ctx.isAuthenticated()) throw new ToolError("Não autenticado");
    const sb = mcpDb(ctx);
    const end = `${to}T23:59:59.999Z`;
    const [meta, google, leads, res] = await Promise.all([
      fetchAllFrom<{ spend: number }>(sb, "mcp_meta_ads_metrics", "spend", (q) =>
        q.gte("date", from).lte("date", to),
      ),
      fetchAllFrom<{ spend: number }>(sb, "mcp_google_ads_metrics", "spend", (q) =>
        q.gte("date", from).lte("date", to),
      ),
      sb
        .from("mcp_crm_leads")
        .select("id", { count: "exact", head: true })
        .gte("created_at", from)
        .lte("created_at", end),
      fetchAllFrom<{ total_amount: number; status: string }>(
        sb,
        "mcp_reservations",
        "total_amount,status",
        (q) => q.gte("created_at", from).lte("created_at", end),
      ),
    ]);
    const metaSpend = meta.reduce((s, r) => s + Number(r.spend), 0);
    const googleSpend = google.reduce((s, r) => s + Number(r.spend), 0);
    const spend = metaSpend + googleSpend;
    const leadCount = leads.count ?? 0;
    const confirmed = res.filter((r) => !/cancel/i.test(r.status));
    const revenue = confirmed.reduce((s, r) => s + Number(r.total_amount), 0);
    const summary = {
      from,
      to,
      meta_spend: Math.round(metaSpend * 100) / 100,
      google_spend: Math.round(googleSpend * 100) / 100,
      total_spend: Math.round(spend * 100) / 100,
      leads: leadCount,
      reservations: confirmed.length,
      revenue: Math.round(revenue * 100) / 100,
      cpl: leadCount ? Math.round((spend / leadCount) * 100) / 100 : null,
      roas: spend ? Math.round((revenue / spend) * 100) / 100 : null,
    };
    return {
      content: [{ type: "text", text: JSON.stringify(summary) }],
      structuredContent: { summary },
    };
  },
});
