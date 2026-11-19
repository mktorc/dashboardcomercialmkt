import type { SupabaseClient } from "@supabase/supabase-js";
import {
  extractAdditionalChargesPrice,
  extractMiscellaneousPrice,
  normalizeStatus,
} from "@/lib/hq-charges";
import { extractFleetVehicle, extractSegments } from "@/lib/hq-segments";

// Mapeamento de uma reserva do HQ Rentals para as tabelas do dashboard.
// Compartilhado entre a sincronização em lote (sync/hqrentals) e o webhook em tempo real.

export type HqReservation = Record<string, unknown>;

/** O HQ devolve valores ora como número, ora como { amount }. */
export const money = (v: unknown): number => {
  const raw = v && typeof v === "object" ? (v as HqReservation)["amount"] : v;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
};

export function mapReservation(r: HqReservation, users: Map<string, string>) {
  const customer = (r["customer"] ?? {}) as HqReservation;
  const vehicleClass = (r["vehicle_class"] ?? {}) as HqReservation;
  const campaign = (r["campaign_parameters"] ?? {}) as HqReservation;
  return {
    reservation_id: String(r["prefixed_id"] ?? r["id"] ?? ""),
    customer_email: (customer["email"] as string | null) ?? null,
    customer_phone: (customer["phone_number"] as string | null) ?? null,
    car_category: (vehicleClass["name"] as string | null) ?? null,
    rental_days: Number(r["total_days"]) || 1,
    total_amount: money(r["total_price"]),
    // "Rack Rate" do HQ = total_rack_rate (valor da diária sem taxas/extras).
    rack_rate:
      r["total_rack_rate"] != null
        ? Number(r["total_rack_rate"])
        : r["rack_rate"] == null
          ? null
          : Number(r["rack_rate"]),
    miscellaneous_price: extractMiscellaneousPrice(r),
    additional_charges_price: extractAdditionalChargesPrice(r),
    status: normalizeStatus(r["status"]),
    utm_campaign: (campaign["utm_campaign"] as string | null) ?? null,
    // "Commission Partner" do HQ = origem da reserva (Meta ADS, Google ADS, Indicação...)
    commission_partner:
      ((((r["commission"] ?? {}) as HqReservation)["tour_operator"] ?? {}) as HqReservation)[
        "name"
      ] != null
        ? String(
            ((r["commission"] as HqReservation)["tour_operator"] as HqReservation)["name"],
          ).trim() || null
        : ((r["referral"] as string | null) ?? null),
    seller_name: users.get(String(r["created_by"] ?? "")) ?? null,
    discount_amount: Number(r["discounts_amount"]) || 0,
    pick_up_at: (r["pick_up_date"] as string | null) ?? null,
    return_at: (r["return_date"] as string | null) ?? null,
    created_at: (r["created_at"] as string | null) ?? new Date().toISOString(),
  };
}

// ---- Comissões de parceiros (tabela `reservas`) -------------------------------------------------

const semAcento = (t: unknown) =>
  String(t ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

// Parceiros que não recebem comissão, mesmo que o HQ tenha percentual cadastrado.
// Manter igual a scripts/comissoes/importar-hq.mjs.
const SEM_COMISSAO = new Set(
  [
    "Google ADS",
    "Meta ADS",
    "Cliente Recorrente",
    "Camp.Hispana",
    "Influencer/Parceria",
    "Master Vacation",
    "Talu Concept",
    "Barbs Tour",
    "Theodoro",
  ].map(semAcento),
);

// "Pagamento antecipado" (novo nome no HQ) ou o antigo "Retenção de comissão"
export const ehRetencao = (tipo: unknown) => {
  const t = semAcento(tipo);
  return (
    (t.includes("pagamento") && t.includes("antecipad")) ||
    (t.includes("retencao") && t.includes("comiss"))
  );
};

export const pagamentoValido = (p: HqReservation) =>
  !/declin|fail|void|cancel/i.test(String(p["status"] ?? ""));

/** Linha de `reservas` (comissão) ou null se a reserva não tem parceiro com comissão > 0%. */
export function mapCommission(r: HqReservation, users: Map<string, string>) {
  const parceiro = (r["tour_operator"] ?? null) as HqReservation | null;
  const pct = Number(parceiro?.["commission_percentage"] ?? 0);
  const nome = parceiro?.["name"] ? String(parceiro["name"]) : "";
  if (!nome || pct <= 0 || SEM_COMISSAO.has(semAcento(nome).trim())) return null;
  return {
    hq_reservation_id: String(r["id"]),
    commission_partner: nome,
    created_at: r["created_at"] as string,
    total_price: money(r["total_price"]),
    total_paid: Number(r["total_paid"] ?? 0),
    rack_rate: Number(r["total_rack_rate"] ?? 0),
    desconto: Number(r["discounts_amount"] ?? 0),
    commission_rate: pct,
    currency: String(r["currency"] ?? "usd").toUpperCase(),
    hq_status: (r["status"] as string | null) ?? null,
    seller_name: users.get(String(r["created_by"] ?? "")) || null,
  };
}

/** Manual charge: valor cobrado pela agência acima do vendido (item id 6 / is_manual_charge). */
export function manualChargeOf(detail: HqReservation): number {
  const itens = Array.isArray(detail["selected_additional_charges"])
    ? (detail["selected_additional_charges"] as HqReservation[])
    : [];
  return itens
    .filter((c) => c["id"] === 6 || c["is_manual_charge"])
    .reduce((s, c) => s + money(c["total_price"]), 0);
}

// ---- Sincronização de UMA reserva (webhook) ------------------------------------------------------

let usersCache: { at: number; map: Map<string, string> } | null = null;
const USERS_TTL_MS = 10 * 60 * 1000;

function hqConfig() {
  const baseUrl = process.env["HQ_BASE_URL"];
  const tenant = process.env["HQ_TENANT_TOKEN"];
  const user = process.env["HQ_USER_TOKEN"];
  if (!baseUrl || !tenant || !user) throw new Error("credenciais do HQ não configuradas");
  return {
    base: baseUrl.replace(/\/$/, ""),
    headers: {
      Authorization: `Basic ${btoa(`${tenant.trim()}:${user.trim()}`)}`,
      Accept: "application/json",
    },
  };
}

async function hqGet<T>(path: string): Promise<T> {
  const { base, headers } = hqConfig();
  for (let tentativa = 1; ; tentativa++) {
    const res = await fetch(`${base}${path}`, { headers });
    if (res.ok) return (await res.json()) as T;
    if (res.status === 404 || tentativa >= 3)
      throw new Error(`HQ respondeu ${res.status} em ${path}`);
    await new Promise((ok) => setTimeout(ok, 500 * tentativa));
  }
}

async function loadUsers(): Promise<Map<string, string>> {
  if (usersCache && Date.now() - usersCache.at < USERS_TTL_MS) return usersCache.map;
  const map = new Map<string, string>();
  try {
    for (let p = 1; p <= 20; p++) {
      const j = await hqGet<{ data?: { data?: HqReservation[]; last_page?: number } }>(
        `/users?page=${p}`,
      );
      const lista = j.data?.data ?? [];
      lista.forEach((u) =>
        map.set(String(u["id"]), String(u["full_name"] ?? u["first_name"] ?? "").trim()),
      );
      if (!lista.length || (j.data?.last_page && p >= j.data.last_page)) break;
    }
  } catch (e) {
    console.error("[hq-reservation] usuários:", e);
    if (usersCache) return usersCache.map; // melhor um cache velho do que vendedor em branco
  }
  usersCache = { at: Date.now(), map };
  return map;
}

/**
 * Busca a reserva completa no HQ (o webhook não traz classe, parceiro nem trechos de veículo) e grava
 * em `reservations`, `reservation_segments` e, quando há parceiro com comissão, em `reservas`.
 * Sempre lê o estado atual no HQ, então rajadas/eventos fora de ordem convergem para o mesmo resultado.
 */
export async function syncReservationById(hqId: string | number) {
  const id = String(hqId);
  // A reserva vem da LISTAGEM filtrada pelo id: é o mesmo formato do sync em lote (cliente, classe, operador, comissão e
  // veículos na própria linha). O detalhe /reservations/:id tem outro formato (tudo em data.reservation, data.customer...)
  // e só é usado para os adicionais (manual charge), que a listagem não traz.
  const filtro = encodeURIComponent(
    JSON.stringify([{ type: "string", column: "id", operator: "equals", value: id }]),
  );
  const lista = await hqGet<{ data?: HqReservation[] }>(
    `/car-rental/reservations?filters=${filtro}`,
  );
  const linha = (lista.data ?? []).find((r) => String(r["id"]) === id);
  if (!linha) throw new Error(`reserva ${id} não encontrada no HQ`);
  const extra = await hqGet<{ data?: { selected_additional_charges?: HqReservation[] } }>(
    `/car-rental/reservations/${id}`,
  ).catch(() => null);
  const detail: HqReservation = {
    ...linha,
    selected_additional_charges: extra?.data?.selected_additional_charges ?? [],
  };

  const users = await loadUsers();
  const row = mapReservation(detail, users);
  if (!row.reservation_id) throw new Error(`reserva ${id} sem identificador`);

  // Veículos fora da Utilização (vendidos ou de classe removida) ficam sem trecho, como no sync em lote.
  const skip = new Set<number>();
  const vehicles: HqReservation[] = [];
  const info = Array.isArray(detail["reservation_vehicle_information"])
    ? (detail["reservation_vehicle_information"] as HqReservation[])
    : [];
  if (info.length > 0) {
    const classes = await hqGet<{ fleets_vehicle_classes?: HqReservation[] }>(
      "/car-rental/fleets/vehicle-classes",
    ).catch(() => null);
    const valid = new Set((classes?.fleets_vehicle_classes ?? []).map((c) => Number(c["id"])));
    for (const vid of new Set(info.map((v) => Number(v["vehicle_id"])))) {
      if (!Number.isFinite(vid) || vid <= 0) continue;
      const v = await hqGet<{ data?: HqReservation }>(`/car-rental/fleets/vehicles/${vid}`).catch(
        () => null,
      );
      const d = v?.data;
      if (!d || d["deleted_at"]) continue;
      vehicles.push(d);
      if (String(d["status"] ?? "").toLowerCase() === "sold") skip.add(vid);
      else if (valid.size > 0 && !valid.has(Number(d["vehicle_class_id"]))) skip.add(vid);
    }
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // Gestão de Frota: placa, categoria e local atual dos carros desta reserva, já no tempo real.
  for (const d of vehicles) await updateFleetVehicle(supabaseAdmin as unknown as SupabaseClient, d);
  const { error } = await supabaseAdmin
    .from("reservations")
    .upsert(row, { onConflict: "reservation_id" });
  if (error) throw new Error(`reservations: ${error.message}`);

  const segments = extractSegments(detail, row.reservation_id, row.status, skip);
  const del = await supabaseAdmin
    .from("reservation_segments")
    .delete()
    .eq("reservation_id", row.reservation_id);
  if (del.error) throw new Error(`reservation_segments: ${del.error.message}`);
  if (segments.length) {
    const ins = await supabaseAdmin.from("reservation_segments").insert(segments);
    if (ins.error) throw new Error(`reservation_segments: ${ins.error.message}`);
  }

  // Comissão: o upsert não toca em status_repasse/paga_em, então repasses já feitos são preservados.
  const commission = mapCommission(detail, users);
  if (commission) {
    const pays = await hqGet<{ data?: { payments?: HqReservation[] } }>(
      `/car-rental/reservations/${id}/payments`,
    );
    const methods = [
      ...new Set(
        (pays.data?.payments ?? [])
          .filter(pagamentoValido)
          .map((p) => p["payment_type"])
          .filter(Boolean) as string[],
      ),
    ];
    const { error: cErr } = await (supabaseAdmin as unknown as SupabaseClient)
      .from("reservas")
      .upsert(
        {
          ...commission,
          payment_methods: methods,
          retida_agencia: methods.some(ehRetencao),
          manual_charge: manualChargeOf(detail),
        },
        { onConflict: "hq_reservation_id" },
      );
    if (cErr) throw new Error(`reservas: ${cErr.message}`);
  }

  return { reservation_id: row.reservation_id, status: row.status, commission: !!commission };
}

/**
 * Atualiza na frota os dados que a Gestão de Frota usa (placa, categoria, local atual, status).
 * Só atualiza carro que já está em `fleet_vehicles` (a entrada na frota continua com o sync em lote).
 */
async function updateFleetVehicle(db: SupabaseClient, v: HqReservation) {
  const row = extractFleetVehicle(v);
  if (!row) return;
  const { id, plate, label, vehicle_class_id, class_label, current_location_id, hq_status } = row;
  const { error } = await db
    .from("fleet_vehicles")
    .update({ plate, label, vehicle_class_id, class_label, current_location_id, hq_status })
    .eq("id", id);
  if (error) console.error(`[hq] fleet_vehicles ${id}:`, error.message);
}

/** Evento de veículo do webhook do HQ (ex.: carro movido de local): relê o carro e atualiza a frota. */
export async function syncVehicleById(hqId: string | number) {
  const v = await hqGet<{ data?: HqReservation }>(`/car-rental/fleets/vehicles/${hqId}`);
  if (!v.data || v.data["deleted_at"]) return;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await updateFleetVehicle(supabaseAdmin as unknown as SupabaseClient, v.data);
}
