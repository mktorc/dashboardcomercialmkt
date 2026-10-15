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

function mapReservation(r: HqReservation, users: Map<string, string>) {
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
    // "Rack Rate" do HQ = total_rack_rate (valor da diária sem taxas/extras).
    rack_rate: r["total_rack_rate"] != null
      ? Number(r["total_rack_rate"])
      : r["rack_rate"] == null ? null : Number(r["rack_rate"]),
    status: normalizeStatus(r["status"]),
    utm_campaign: (campaign["utm_campaign"] as string | null) ?? null,
    // "Commission Partner" do HQ = origem da reserva (Meta ADS, Google ADS, Indicação...)
    commission_partner:
      ((((r["commission"] ?? {}) as HqReservation)["tour_operator"] ?? {}) as HqReservation)["name"] != null
        ? String((((r["commission"] as HqReservation)["tour_operator"]) as HqReservation)["name"]).trim() || null
        : (r["referral"] as string | null) ?? null,
    seller_name: users.get(String(r["created_by"] ?? "")) ?? null,
    discount_amount: Number(r["discounts_amount"]) || 0,
    pick_up_at: (r["pick_up_date"] as string | null) ?? null,
    return_at: (r["return_date"] as string | null) ?? null,
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
        // ?days=N: modo incremental (a API devolve as mais recentes primeiro).
        // Sem o parâmetro: histórico completo (acionamento manual).
        const daysParam = Number(new URL(request.url).searchParams.get("days"));
        const cutoff = daysParam > 0 ? Date.now() - daysParam * 86400000 : null;

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
          const data = payload.data ?? [];
          lastPage = payload.last_page ?? 1;
          page += 1;
          if (cutoff !== null) {
            const recent = data.filter((r) => Date.parse(String(r["created_at"] ?? "")) >= cutoff);
            all.push(...recent);
            if (recent.length < data.length) break;
          } else {
            all.push(...data);
          }
        } while (page <= lastPage);

        const users = new Map<string, string>();
        for (let up = 1; up <= 20; up++) {
          const ur = await fetch(`${baseUrl.replace(/\/$/, "")}/users?page=${up}`, {
            headers: { Authorization: `Basic ${basic}`, Accept: "application/json" },
          });
          if (!ur.ok) break;
          const uj = (await ur.json()) as { data?: { data?: HqReservation[]; last_page?: number } };
          const pageUsers = uj.data?.data ?? [];
          pageUsers.forEach((u) =>
            users.set(String(u["id"]), String(u["full_name"] ?? u["first_name"] ?? "").trim()),
          );
          // HQ does not always return last_page: keep paging until an empty page.
          if (!pageUsers.length) break;
          if (uj.data?.last_page && up >= uj.data.last_page) break;
        }
        const rows = all.map((r) => mapReservation(r, users)).filter((r) => r.reservation_id !== "");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        // Tamanho da frota (para a taxa de ocupação)
        const vehicleIds = new Set<string>();
        for (let vp = 1; vp <= 50; vp++) {
          const vr = await fetch(`${baseUrl.replace(/\/$/, "")}/fleets/vehicles?page=${vp}`, {
            headers: { Authorization: `Basic ${basic}`, Accept: "application/json" },
          });
          if (!vr.ok) break;
          const vj = (await vr.json()) as { data?: HqReservation[]; last_page?: number };
          const before = vehicleIds.size;
          (vj.data ?? []).filter((v) => !v["deleted_at"]).forEach((v) => vehicleIds.add(String(v["id"])));
          if (vehicleIds.size === before || vp >= (vj.last_page ?? 1)) break;
        }
        const vehicles = vehicleIds.size;
        if (vehicles > 0) {
          await supabaseAdmin
            .from("fleet_stats")
            .upsert({ id: 1, vehicles, updated_at: new Date().toISOString() });
        }
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
