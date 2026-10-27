import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "crypto";
import type { Json } from "@/integrations/supabase/types";

// Webhook de reservas do HQ Rentals (etapa de descoberta): só registra o que chega em `webhook_logs`
// (source = 'hq_rentals') para conhecermos o formato real antes de gravar a comissão em `reservas`.
// Proteção: header Authorization: Bearer <HQ_WEBHOOK_SECRET> ou query ?token=<HQ_WEBHOOK_SECRET>
// (o HQ pode não permitir cabeçalhos personalizados). Responde 200 e grava em segundo plano.

const MAX_BODY = 256 * 1024;

function authorized(request: Request): boolean {
  const secret = process.env["HQ_WEBHOOK_SECRET"];
  if (!secret) return false;
  const candidates = [
    request.headers.get("authorization") ?? "",
    `Bearer ${new URL(request.url).searchParams.get("token") ?? ""}`,
  ];
  const expected = Buffer.from(`Bearer ${secret}`);
  return candidates.some((c) => {
    const a = Buffer.from(c);
    return a.length === expected.length && timingSafeEqual(a, expected);
  });
}

async function log(rawBody: string, ok: boolean): Promise<void> {
  let payload: Json;
  try {
    payload = JSON.parse(rawBody) as Json;
  } catch {
    payload = { raw: rawBody.slice(0, 20_000) };
  }
  const obj = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, Json>) : {};
  const eventType = [obj["event"], obj["event_type"], obj["type"], obj["action"]].find((v) => typeof v === "string") as string | undefined;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("webhook_logs").insert({
    source: "hq_rentals",
    event_type: eventType ?? null,
    payload,
    authorized: ok,
    processing_status: ok ? "logged" : "unauthorized",
  });
  if (error) console.error("[webhook-hqrentals] audit insert error:", error.message);
}

const received = () => Response.json({ status: "received" }, { status: 200 });

export const Route = createFileRoute("/api/public/webhooks/hqrentals")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const ok = authorized(request);
          const rawBody = (await request.text()).slice(0, MAX_BODY);
          const task = log(rawBody, ok);
          const waitUntil = (request as unknown as { waitUntil?: (p: Promise<unknown>) => void }).waitUntil;
          if (typeof waitUntil === "function") waitUntil(task);
          else task.catch((e) => console.error("[webhook-hqrentals] detached task error:", e));
        } catch (error) {
          console.error("[webhook-hqrentals] request error:", error);
        }
        return received();
      },
      GET: async ({ request }) =>
        authorized(request) ? Response.json({ ok: true, status: "active" }) : Response.json({ error: "Unauthorized" }, { status: 401 }),
    },
  },
});
