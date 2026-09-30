import { createFileRoute } from "@tanstack/react-router";
import { isSyncAuthorized } from "@/lib/sync-auth";

// Sincronização HQ Rentals -> tabela `reservations`.
// Autenticação HQ: Basic base64(`${HQ_TENANT_TOKEN}:${HQ_USER_TOKEN}`).
// Proteção do endpoint: header Authorization: Bearer <LOVABLE_CRON_SECRET>.

type HqReservation = Record<string, unknown>;

function normalizeStatus(v: unknown): string {
  const s = String(v ?? "").toLowerCase();
  if (["open", "rental", "completed", "confirmed"].includes(s)) return "confirmed";
  if (["cancelled", "canceled", "no_show"].includes(s)) return "cancelled";
  return s || "pending";
}

function mapReservation(r: HqReservation) {
  const customer = (r["customer"] ?? {}) as HqReservation;
  const vehicleClass = (r["vehicle_class"] ?? {}) as HqReservation;
  const campaign = (r["campaign_parameters"] ?? {}) as HqReservation;
  return {
    reservation_id: String(r["prefixed_id"] ?? r["id"] ?? ""),
    customer_email: (customer["email"] as string | null) ?? null,
    customer_phone: (customer["phone_number"] as string | null) ?? null,
    car_category: (vehicleClass["name"] as string | null) ?? null,
    rental_days: Number(r["total_days"]) || 1,
    total_amount: Number(r["total_price"]) || 0,
    status: normalizeStatus(r["status"]),
    utm_campaign: (campaign["utm_campaign"] as string | null) ?? null,
    created_at: (r["created_at"] as string | null) ?? new Date().toISOString(),
  };
}

export const Route = createFileRoute("/api/public/sync/hqrentals")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isSyncAuthorized(request)) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const baseUrl = process.env["HQ_BASE_URL"];
        const tenant = process.env["HQ_TENANT_TOKEN"];
        const user = process.env["HQ_USER_TOKEN"];
        if (!baseUrl || !tenant || !user) {
          return Response.json({ error: "HQ Rentals credentials not configured" }, { status: 500 });
        }

        const basic = btoa(`${tenant}:${user}`);
        const base = `${baseUrl.replace(/\/$/, "")}/car-rental/reservations`;

        const all: HqReservation[] = [];
        let page = 1;
        let lastPage = 1;
        do {
          const hqRes = await fetch(`${base}?page=${page}`, {
            headers: { Authorization: `Basic ${basic}`, Accept: "application/json" },
          });
          if (!hqRes.ok) {
            const body = await hqRes.text();
            return Response.json(
              { error: `HQ Rentals respondeu ${hqRes.status}`, detail: body.slice(0, 500) },
              { status: 502 },
            );
          }
          const payload = (await hqRes.json()) as {
            data?: HqReservation[];
            last_page?: number;
          };
          all.push(...(payload.data ?? []));
          lastPage = payload.last_page ?? 1;
          page += 1;
        } while (page <= lastPage);

        const rows = all.map(mapReservation).filter((r) => r.reservation_id !== "");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        // Upsert em lotes para não estourar o limite de payload
        const BATCH = 500;
        for (let i = 0; i < rows.length; i += BATCH) {
          const { error } = await supabaseAdmin
            .from("reservations")
            .upsert(rows.slice(i, i + BATCH), { onConflict: "reservation_id" });
          if (error) {
            return Response.json({ error: error.message }, { status: 500 });
          }
        }

        return Response.json({ ok: true, synced: rows.length });
      },
    },
  },
});
