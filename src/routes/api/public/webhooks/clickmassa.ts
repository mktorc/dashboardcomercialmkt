import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "crypto";

// Webhook ClickMassa (Eventos PUSH) -> tabela `crm_leads`.
// Proteção: header Authorization: Bearer <CLICKMASSA_WEBHOOK_SECRET>.
// Responde 200 imediatamente e processa o salvamento em segundo plano,
// para evitar timeout no remetente (desativação por falhas consecutivas).

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

// Desembrulha o lead: aceita payload plano ou aninhado em
// `data`, `lead`, `contact`, `opportunity`, `card` ou `ticket`.
function unwrap(payload: ClickmassaPayload): ClickmassaPayload {
  let p = payload;
  for (let i = 0; i < 3; i++) {
    const nested = (p["data"] ?? p["lead"] ?? p["contact"] ?? p["opportunity"] ?? p["card"] ?? p["ticket"]) as unknown;
    if (typeof nested === "object" && nested !== null && !Array.isArray(nested)) {
      p = nested as ClickmassaPayload;
    } else {
      break;
    }
  }
  return p;
}

async function processPayload(payload: ClickmassaPayload): Promise<void> {
  const p = unwrap(payload);

  const leadId = pick(p, ["lead_id", "id", "leadId", "codigo", "code", "contact_id", "contactId"]);
  const row = {
    lead_id: leadId,
    name: pick(p, ["name", "nome", "full_name", "contact_name"]),
    email: pick(p, ["email", "e_mail", "mail"]),
    phone: pick(p, ["phone", "telefone", "phone_number", "celular", "whatsapp"]),
    stage_name: pick(p, ["stage_name", "stage", "etapa", "funil_etapa", "status", "funnel_stage"]),
    utm_source: pick(p, ["utm_source", "source", "origem"]),
    utm_medium: pick(p, ["utm_medium", "medium", "canal"]),
    utm_campaign: pick(p, ["utm_campaign", "campaign", "campanha"]),
    updated_at: new Date().toISOString(),
  };
  // Atualização parcial: campos que não vieram no payload preservam o valor salvo.
  const partial = Object.fromEntries(
    Object.entries(row).filter(([, v]) => v !== null),
  ) as typeof row;

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
        .update(partial)
        .eq("id", existing.id);
      if (error) console.error("[webhook-clickmassa] update error:", error.message);
      return;
    }
  }

  if (!row.name && !row.email && !row.phone) {
    console.warn("[webhook-clickmassa] payload sem dados de contato; ignorado");
    return;
  }

  const { error } = await supabaseAdmin.from("crm_leads").insert(row);
  if (error) console.error("[webhook-clickmassa] insert error:", error.message);
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

        // Responde 200 imediatamente; o processamento segue em segundo plano.
        const task = processPayload(payload);
        const waitUntil = (request as unknown as { waitUntil?: (p: Promise<unknown>) => void }).waitUntil;
        if (typeof waitUntil === "function") {
          waitUntil.call(request, task);
        } else {
          task.catch((e) => console.error("[webhook-clickmassa] background error:", e));
        }

        return Response.json({ ok: true, received: true });
      },
      // Health check simples para o ClickMassa validar o endpoint.
      GET: async ({ request }) => {
        if (!checkAuth(request)) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }
        return Response.json({ ok: true, status: "active" });
      },
    },
  },
});
