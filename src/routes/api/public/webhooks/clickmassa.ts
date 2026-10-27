import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "crypto";
import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";

// Webhook ClickMassa (Eventos PUSH) -> tabela `crm_leads`.
// Proteção: header Authorization: Bearer <CLICKMASSA_WEBHOOK_SECRET>.
// Responde 200 imediatamente e processa o salvamento em segundo plano,
// para evitar timeout no remetente (desativação por falhas consecutivas).

type ClickmassaPayload = Record<string, unknown>;

const payloadSchema = z.record(z.string(), z.unknown());

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

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const obj = (v: unknown) => (v && typeof v === "object" ? (v as ClickmassaPayload) : {});

async function processOpportunity(p: ClickmassaPayload): Promise<void> {
  const id = str(p["id"]);
  if (!id) return;
  const tc = obj(p["tasksCount"]);
  // Etapas 1–6 pertencem ao funil "Comercial"; 7+ ao "Sucesso do Cliente".
  const stepId = Number.isFinite(Number(p["pipelineStepId"])) && p["pipelineStepId"] != null ? Number(p["pipelineStepId"]) : null;
  const row = {
    opportunity_id: id,
    lead_id: p["contactId"] ? `cm-${p["contactId"]}` : null,
    name: str(p["name"]) ?? str(obj(p["contact"])["name"]),
    stage_name: str(obj(p["pipelineStep"])["name"]),
    pipeline_step_id: stepId,
    pipeline_name: stepId == null ? null : stepId <= 6 ? "Comercial" : "Sucesso do Cliente",
    status: str(p["status"]),
    seller_name: str(obj(p["responsible"])["name"]) ?? str(obj(p["user"])["name"]),
    value: num(p["value"]),
    pending_tasks: num(tc["countSchendule"]) + num(tc["countDelayed"]) + num(tc["countRequiredPending"]),
    total_tasks: num(tc["countSchendule"]) + num(tc["countDelayed"]) + num(tc["countRequiredPending"]) + num(tc["countComplete"]),
    created_at: str(p["createdAt"]) ?? new Date().toISOString(),
    updated_at: str(p["updatedAt"]) ?? new Date().toISOString(),
  };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("crm_opportunities").upsert(row, { onConflict: "opportunity_id" });
  if (error) throw error;
}

// Eventos de atendimento (tickets/mensagens) não alimentam o painel.
const TICKET_EVENTS = /ticket|message/i;

async function processPayload(payload: ClickmassaPayload): Promise<void> {
  const event = str(payload["event"]) ?? "";
  if (/^opportunity$/i.test(event)) return processOpportunity(payload);
  if (TICKET_EVENTS.test(event)) {
    // Atendimentos trazem o contato com a "Origem do Lead": guarda no lead.
    const contact = ((payload["ticket"] as Record<string, unknown> | undefined)?.["contact"] ??
      null) as Record<string, unknown> | null;
    const origin = str((contact?.["leadOrigin"] as Record<string, unknown> | null)?.["name"]);
    if (contact?.["id"] != null && origin) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("crm_leads").update({ lead_origin: origin }).eq("lead_id", `cm-${contact["id"]}`);
    }
    return;
  }
  const p = unwrap(payload);


  const rawId = pick(p, ["lead_id", "id", "leadId", "codigo", "code", "contact_id", "contactId"]);
  // Eventos de contato do ClickMassa usam o mesmo ID da sincronização (prefixo cm-)
  const leadId = rawId && /contact/i.test(event) && !rawId.startsWith("cm-") ? `cm-${rawId}` : rawId;
  const row = {
    lead_id: leadId,
    name: pick(p, ["name", "nome", "full_name", "contact_name"]),
    email: pick(p, ["email", "e_mail", "mail"]),
    phone: pick(p, ["phone", "telefone", "phone_number", "celular", "whatsapp"]),
    stage_name: pick(p, ["stage_name", "stage", "etapa", "funil_etapa", "status", "funnel_stage"]),
    lead_origin:
      str((p["leadOrigin"] as Record<string, unknown> | null | undefined)?.["name"]) ??
      pick(p, ["origem_do_lead", "Origem do Lead", "lead_origin"]),
    first_connection_name: pick(p, ["firstConnectionName", "first_connection_name"]),
    utm_source: pick(p, ["utm_source", "source", "origem"]),
    utm_medium: pick(p, ["utm_medium", "medium", "canal"]),
    utm_campaign: pick(p, ["utm_campaign", "campaign", "campanha"]),
    first_response_at: pick(p, ["first_response_at", "firstResponseAt", "first_attendance_at", "firstAttendanceAt", "answered_at", "answeredAt"]),
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
      if (error) throw error;
      return;
    }
  }

  if (!row.name && !row.email && !row.phone) {
    console.warn("[webhook-clickmassa] payload sem dados de contato; ignorado");
    return;
  }

  const { error } = await supabaseAdmin.from("crm_leads").insert(row);
  if (error) throw error;
}

async function auditAndProcess(rawBody: string, authHeader: string): Promise<void> {
  const receivedAt = new Date().toISOString();
  let payload: ClickmassaPayload | null = null;
  let authorized = false;
  let logId: string | null = null;

  try {
    const secret = process.env["CLICKMASSA_WEBHOOK_SECRET"];
    if (secret) {
      const expected = `Bearer ${secret}`;
      const a = Buffer.from(authHeader);
      const b = Buffer.from(expected);
      authorized = a.length === b.length && timingSafeEqual(a, b);
    }

    try {
      payload = payloadSchema.parse(JSON.parse(rawBody));
    } catch {
      payload = null;
    }

    const eventType = payload
      ? pick(payload, ["event", "event_type", "type", "action"])
      : null;
    const auditPayload = (payload ?? { raw: rawBody }) as Json;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: log, error: logError } = await supabaseAdmin
      .from("webhook_logs")
      .insert({
        source: "clickmassa",
        event_type: eventType,
        payload: auditPayload,
        authorized,
        processing_status: authorized && payload ? "processing" : authorized ? "invalid_payload" : "unauthorized",
        received_at: receivedAt,
      })
      .select("id")
      .single();
    if (logError) console.error("[webhook-clickmassa] audit insert error:", logError.message);
    logId = log?.id ?? null;

    if (!authorized || !payload) return;
    await processPayload(payload);

    if (logId) {
      const { error } = await supabaseAdmin
        .from("webhook_logs")
        .update({ processing_status: "processed", processed_at: new Date().toISOString() })
        .eq("id", logId);
      if (error) console.error("[webhook-clickmassa] audit update error:", error.message);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[webhook-clickmassa] background error:", message);
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      if (logId) {
        await supabaseAdmin
          .from("webhook_logs")
          .update({ processing_status: "failed", error_message: message, processed_at: new Date().toISOString() })
          .eq("id", logId);
      } else {
        await supabaseAdmin.from("webhook_logs").insert({
          source: "clickmassa",
          payload: (payload ?? { raw: rawBody }) as Json,
          authorized,
          processing_status: "failed",
          error_message: message,
          received_at: receivedAt,
          processed_at: new Date().toISOString(),
        });
      }
    } catch (auditError) {
      console.error("[webhook-clickmassa] audit fallback error:", auditError);
    }
  }
}

const received = () => Response.json({ status: "received" }, { status: 200 });

export const Route = createFileRoute("/api/public/webhooks/clickmassa")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const rawBody = await request.text();
          const authHeader = request.headers.get("authorization") ?? "";
          const task = auditAndProcess(rawBody, authHeader);
          const waitUntil = (request as unknown as { waitUntil?: (p: Promise<unknown>) => void }).waitUntil;
          if (typeof waitUntil === "function") {
            waitUntil(task);
          } else {
            task.catch((error) => console.error("[webhook-clickmassa] detached task error:", error));
          }
          return received();
        } catch (error) {
          console.error("[webhook-clickmassa] request error:", error);
          return received();
        }
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
