import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { mcpDb } from "../supabase";
import { fetchAllFrom } from "./paginate";

const dateRe = /^\d{4}-\d{2}-\d{2}$/;

export default defineTool({
  name: "sales_by_seller",
  title: "Vendas por vendedor",
  description:
    "Reservas confirmadas, valor fechado e ticket médio por vendedor num período (data de criação).",
  inputSchema: {
    from: z.string().regex(dateRe).describe("Data inicial YYYY-MM-DD"),
    to: z.string().regex(dateRe).describe("Data final YYYY-MM-DD (inclusiva)"),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ from, to }, ctx) => {
    if (!ctx.isAuthenticated()) throw new ToolError("Não autenticado");
    const sb = mcpDb(ctx);
    const rows = await fetchAllFrom<{
      seller_name: string | null;
      total_amount: number;
      status: string;
    }>(sb, "mcp_reservations", "seller_name,total_amount,status", (q) =>
      q.gte("created_at", from).lte("created_at", `${to}T23:59:59.999Z`),
    );
    const map = new Map<string, { reservations: number; revenue: number }>();
    for (const r of rows) {
      if (/cancel/i.test(r.status)) continue;
      const k = r.seller_name?.trim() || "Venda Direta / Site";
      const e = map.get(k) ?? { reservations: 0, revenue: 0 };
      e.reservations++;
      e.revenue += Number(r.total_amount);
      map.set(k, e);
    }
    const sellers = [...map.entries()]
      .map(([seller, v]) => ({
        seller,
        reservations: v.reservations,
        revenue: Math.round(v.revenue * 100) / 100,
        avg_ticket: Math.round((v.revenue / v.reservations) * 100) / 100,
      }))
      .sort((a, b) => b.revenue - a.revenue);
    return {
      content: [{ type: "text", text: JSON.stringify(sellers) }],
      structuredContent: { sellers },
    };
  },
});
