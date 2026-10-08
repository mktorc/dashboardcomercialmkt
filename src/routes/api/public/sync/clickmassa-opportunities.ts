import { createFileRoute } from "@tanstack/react-router";
import { isSyncAuthorized } from "@/lib/sync-auth";

// Sincroniza oportunidades do ClickMassa buscando GET /opportunity/:id
// (a API não tem listagem). Varre uma faixa de IDs e faz upsert em crm_opportunities.
// Query opcional: ?from=<id>&to=<id>. Padrão: (maior ID salvo - 1500) até +400.

type Obj = Record<string, unknown>;
const s = (v: unknown) => (v == null || String(v).trim() === "" ? null : String(v).trim());
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const obj = (v: unknown) => (v && typeof v === "object" ? (v as Obj) : {});

function toRow(p: Obj) {
  const tc = obj(p["tasksCount"]);
  const stepId = p["pipelineStepId"] != null && Number.isFinite(Number(p["pipelineStepId"])) ? Number(p["pipelineStepId"]) : null;
  return {
    opportunity_id: String(p["id"]),
    lead_id: p["contactId"] ? `cm-${p["contactId"]}` : null,
    name: s(p["name"]) ?? s(obj(p["contact"])["name"]),
    stage_name: s(obj(p["pipelineStep"])["name"]),
    pipeline_step_id: stepId,
    pipeline_name: stepId == null ? null : stepId <= 6 ? "Comercial" : "Sucesso do Cliente",
    status: s(p["status"]),
    seller_name: s(obj(p["responsible"])["name"]) ?? s(obj(p["user"])["name"]),
    value: num(p["value"]),
    pending_tasks: num(tc["countSchendule"]) + num(tc["countDelayed"]) + num(tc["countRequiredPending"]),
    created_at: s(p["createdAt"]) ?? new Date().toISOString(),
    updated_at: s(p["updatedAt"]) ?? new Date().toISOString(),
  };
}

export const Route = createFileRoute("/api/public/sync/clickmassa-opportunities")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isSyncAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
        const base = (process.env["CLICKMASSA_BASE_URL"] ?? "").replace(/\/$/, "");
        const token = process.env["CLICKMASSA_API_KEY"];
        if (!base || !token) return Response.json({ error: "ClickMassa não configurado" }, { status: 500 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const url = new URL(request.url);
        let from = Number(url.searchParams.get("from")) || 0;
        let to = Number(url.searchParams.get("to")) || 0;
        if (!from || !to) {
          const { data } = await supabaseAdmin
            .from("crm_opportunities")
            .select("opportunity_id")
            .order("created_at", { ascending: false })
            .limit(50);
          const max = Math.max(0, ...(data ?? []).map((r) => Number(r.opportunity_id) || 0));
          from = from || Math.max(1, max - 1500);
          to = to || max + 400;
        }
        if (to - from > 5000) return Response.json({ error: "Faixa máxima: 5000 IDs" }, { status: 400 });

        const rows: ReturnType<typeof toRow>[] = [];
        let errors = 0;
        const ids = Array.from({ length: to - from + 1 }, (_, i) => from + i);
        const worker = async () => {
          while (ids.length) {
            const id = ids.shift()!;
            // Retenta falhas temporárias (limite de requisições / erro do servidor)
            let ok = false;
            for (let attempt = 0; attempt < 4 && !ok; attempt++) {
              try {
                const r = await fetch(`${base}/opportunity/${id}`, {
                  headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
                });
                if (r.status === 404 || r.status === 400) { ok = true; break; }
                if (!r.ok) { await new Promise((res) => setTimeout(res, 500 * 2 ** attempt)); continue; }
                const p = (await r.json()) as Obj;
                if (p["id"] != null) rows.push(toRow(p));
                ok = true;
              } catch { await new Promise((res) => setTimeout(res, 500 * 2 ** attempt)); }
            }
            if (!ok) errors++;
          }
        };
        await Promise.all(Array.from({ length: 8 }, worker));

        for (let i = 0; i < rows.length; i += 500) {
          const { error } = await supabaseAdmin
            .from("crm_opportunities")
            .upsert(rows.slice(i, i + 500), { onConflict: "opportunity_id" });
          if (error) return Response.json({ error: error.message }, { status: 500 });
        }
        return Response.json({ ok: true, from, to, found: rows.length, errors });
      },
    },
  },
});
