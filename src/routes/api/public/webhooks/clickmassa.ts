import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "crypto";

// Webhook ClickMassa (Eventos PUSH) -> tabela `crm_leads`.
// Proteção: header Authorization: Bearer <CLICKMASSA_WEBHOOK_SECRET>.

type ClickmassaPayload = Record<string, unknown>;

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function pick(p: ClickmassaPayload, keys: string[]): string | null {
  for (const k of keys) {
    const v = str(p[k]);
    if (v) return v;
  }
  return null;
}

function checkAuth(request: Request): boolean {
  const secret = process.env["CLICKMASSA_WEBHOOK_SECRET"];
  if (!secret) return false;
  const auth = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(auth);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const Route = createFileRoute("/api/public/webhooks/clickmassa")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!checkAuth(request)) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        let payload: ClickmassaPayload;
        try {
          payload = (await request.json()) as ClickmassaPayload;
        } catch {
          return Response.json({ error: "JSON inválido" }, { status: 400 });
        }

        // Alguns webhooks aninham o lead em `data` ou `lead`
        const nested = (payload["data"] ?? payload["lead"] ?? payload) as ClickmassaPayload;
        const p = typeof nested === "object" && nested !== null ? nested : payload;

        const leadId = pick(p, ["lead_id", "id", "leadId", "codigo", "code"]);
        const row = {
          lead_id: leadId,
          name: pick(p, ["name", "nome", "full_name", "contact_name"]),
          email: pick(p, ["email", "e_mail", "mail"]),
          phone: pick(p, ["phone", "telefone", "phone_number", "celular", "whatsapp"]),
          stage_name: pick(p, ["stage_name", "stage", "etapa", "funil_etapa", "status", "funnel_stage"]),
          utm_source: pick(p, ["utm_source", "source", "origem"]),
          utm_campaign: pick(p, ["utm_campaign", "campaign", "campanha"]),
          updated_at: new Date().toISOString(),
        };

        if (!row.name && !row.email && !row.phone) {
          return Response.json(
            { error: "Payload sem dados de contato (nome, e-mail ou telefone)" },
            { status: 422 },
          );
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Se veio um identificador de lead, atualiza o existente; senão insere novo
        if (leadId) {
          const { data: existing } = await supabaseAdmin
            .from("crm_leads")
            .select("id")
            .eq("lead_id", leadId)
            .maybeSingle();

          if (existing) {
            const { error } = await supabaseAdmin
              .from("crm_leads")
              .update(row)
              .eq("id", existing.id);
            if (error) return Response.json({ error: error.message }, { status: 500 });
            return Response.json({ ok: true, action: "updated", lead_id: leadId });
          }
        }

        const { error } = await supabaseAdmin.from("crm_leads").insert(row);
        if (error) return Response.json({ error: error.message }, { status: 500 });
        return Response.json({ ok: true, action: "inserted", lead_id: leadId });
      },
    },
  },
});
