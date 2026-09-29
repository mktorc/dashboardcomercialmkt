import { createFileRoute } from "@tanstack/react-router";

// Sincronização HQ Rentals -> tabela `reservations`.
// Autenticação HQ: Basic base64(`${HQ_TENANT_TOKEN}:${HQ_USER_TOKEN}`).
// Proteção do endpoint: header Authorization: Bearer <LOVABLE_CRON_SECRET>.

type HqReservation = Record<string, unknown>;

function pick<T>(obj: HqReservation, keys: string[]): T | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== "") return v as T;
  }
  return undefined;
}

function toNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeStatus(v: unknown): string {
  const s = String(v ?? "").toLowerCase();
  if (["confirmed", "confirmada", "active", "rented", "completed", "finalizada"].includes(s))
    return "confirmed";
  if (["cancelled", "canceled", "cancelada"].includes(s)) return "cancelled";
  return s || "confirmed";
}

function mapReservation(r: HqReservation) {
  const customer = (r.customer ?? r.client ?? {}) as HqReservation;
  return {
    reservation_id: String(
      pick(r, ["reservation_id", "reservationId", "id", "code", "number"]) ?? "",
    ),
    customer_email: pick<string>(customer, ["email"]) ?? pick<string>(r, ["customer_email", "email"]) ?? null,
    customer_phone: pick<string>(customer, ["phone", "mobile"]) ?? pick<string>(r, ["customer_phone", "phone"]) ?? null,
    car_category:
      pick<string>(r, ["car_category", "carCategory", "category", "vehicle_category", "group"]) ?? null,
    rental_days: toNumber(pick(r, ["rental_days", "rentalDays", "days"]) ?? 1) || 1,
    total_amount: toNumber(pick(r, ["total_amount", "totalAmount", "total", "amount", "price"])),
    status: normalizeStatus(pick(r, ["status"])),
    utm_campaign: pick<string>(r, ["utm_campaign", "utmCampaign"]) ?? null,
    created_at:
      pick<string>(r, ["created_at", "createdAt", "created", "date"]) ?? new Date().toISOString(),
  };
}

export const Route = createFileRoute("/api/public/sync/hqrentals")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const cronSecret = process.env["LOVABLE_CRON_SECRET"];
        const auth = request.headers.get("authorization") ?? "";
        if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const baseUrl = process.env["HQ_BASE_URL"];
        const tenant = process.env["HQ_TENANT_TOKEN"];
        const user = process.env["HQ_USER_TOKEN"];
        if (!baseUrl || !tenant || !user) {
          return Response.json({ error: "HQ Rentals credentials not configured" }, { status: 500 });
        }

        const basic = btoa(`${tenant}:${user}`);
        const url = `${baseUrl.replace(/\/$/, "")}/car-rental/reservations`;

        const hqRes = await fetch(url, {
          headers: { Authorization: `Basic ${basic}`, Accept: "application/json" },
        });
        if (!hqRes.ok) {
          const body = await hqRes.text();
          return Response.json(
            { error: `HQ Rentals respondeu ${hqRes.status}`, detail: body.slice(0, 500) },
            { status: 502 },
          );
        }

        const payload = (await hqRes.json()) as unknown;
        const list: HqReservation[] = Array.isArray(payload)
          ? (payload as HqReservation[])
          : ((payload as HqReservation)?.data ??
            (payload as HqReservation)?.reservations ??
            (payload as HqReservation)?.items ??
            []) as HqReservation[];

        const rows = list.map(mapReservation).filter((r) => r.reservation_id !== "");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin
          .from("reservations")
          .upsert(rows, { onConflict: "reservation_id" });
        if (error) {
          return Response.json({ error: error.message }, { status: 500 });
        }

        return Response.json({ ok: true, synced: rows.length });
      },
    },
  },
});
