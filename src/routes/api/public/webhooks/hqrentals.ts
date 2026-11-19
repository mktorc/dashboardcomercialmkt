import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "crypto";
import type { Json } from "@/integrations/supabase/types";
import { syncReservationById, syncVehicleById } from "@/lib/hq-reservation";
import { notifyReservationsOpened } from "@/lib/push.server";

// Webhook de reservas do HQ Rentals (tempo real). Registra cada evento em `webhook_logs`
// (source = 'hq_rentals') e, se autorizado, rele a reserva completa no HQ e grava em `reservations`,
// `reservation_segments` e `reservas` (comissão). O payload do webhook não traz classe, parceiro nem
// trechos de veículo, por isso a reserva é buscada de novo (e o sync diário segue como conferência).
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

async function handle(rawBody: string, ok: boolean): Promise<void> {
  let payload: Json;
  try {
    payload = JSON.parse(rawBody) as Json;
  } catch {
    payload = { raw: rawBody.slice(0, 20_000) };
  }
  const obj =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, Json>)
      : {};
  const eventType = [obj["event"], obj["event_type"], obj["type"], obj["action"]].find(
    (v) => typeof v === "string",
  ) as string | undefined;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: inserted, error } = await supabaseAdmin
    .from("webhook_logs")
    .insert({
      source: "hq_rentals",
      event_type: eventType ?? null,
      payload,
      authorized: ok,
      processing_status: ok ? "logged" : "unauthorized",
    })
    .select("id")
    .single();
  if (error) console.error("[webhook-hqrentals] audit insert error:", error.message);
  if (!ok) return;

  // Só eventos de reserva (o HQ pode mandar outros modelos para o mesmo endpoint).
  const item = typeof obj["item"] === "string" ? obj["item"] : "";
  const data = obj["data"];
  const hqId =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, Json>)["id"]
      : null;
  if (typeof hqId !== "number" && typeof hqId !== "string") return;
  // Evento de veículo (carro movido, status): atualiza a frota (Gestão de Frota).
  if (/\\Vehicle$/.test(item)) {
    let vStatus = "processed";
    try {
      await syncVehicleById(hqId);
    } catch (e) {
      vStatus = `error: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500);
    }
    if (inserted?.id)
      await supabaseAdmin
        .from("webhook_logs")
        .update({ processing_status: vStatus })
        .eq("id", inserted.id);
    return;
  }
  if (!/Reservation$/.test(item)) return;

  let status = "processed";
  try {
    await syncReservationById(hqId);
    await notifyReservationsOpened();
  } catch (e) {
    status = `error: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500);
    console.error("[webhook-hqrentals] processamento:", e);
  }
  if (inserted?.id)
    await supabaseAdmin
      .from("webhook_logs")
      .update({ processing_status: status })
      .eq("id", inserted.id);
}

const received = () => Response.json({ status: "received" }, { status: 200 });

export const Route = createFileRoute("/api/public/webhooks/hqrentals")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const ok = authorized(request);
          const rawBody = (await request.text()).slice(0, MAX_BODY);
          const task = handle(rawBody, ok);
          const waitUntil = (request as unknown as { waitUntil?: (p: Promise<unknown>) => void })
            .waitUntil;
          if (typeof waitUntil === "function") waitUntil(task);
          else task.catch((e) => console.error("[webhook-hqrentals] detached task error:", e));
        } catch (error) {
          console.error("[webhook-hqrentals] request error:", error);
        }
        return received();
      },
      GET: async ({ request }) =>
        authorized(request)
          ? Response.json({ ok: true, status: "active" })
          : Response.json({ error: "Unauthorized" }, { status: 401 }),
    },
  },
});
