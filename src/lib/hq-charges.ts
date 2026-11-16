// O HQ Rentals devolve `miscellaneous` como array de { key, value }.
type HqReservation = Record<string, unknown>;

const num = (v: unknown) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function miscValue(r: HqReservation, key: string): unknown {
  const misc = r["miscellaneous"];
  if (Array.isArray(misc)) {
    return (misc as { key?: string; value?: unknown }[]).find((m) => m?.key === key)?.value;
  }
  return misc && typeof misc === "object" ? (misc as HqReservation)[key] : undefined;
}

/** Taxas Diversas = `miscellaneous_price` do HQ. */
export function extractMiscellaneousPrice(r: HqReservation): number {
  return num(miscValue(r, "miscellaneous_price") ?? r["miscellaneous_price"]) ?? 0;
}

/** Cobranças Adicionais: `total_extras` na raiz; senão `additional_charges_price`; senão `total_extras` do array; senão soma dos itens. */
export function extractAdditionalChargesPrice(r: HqReservation): number {
  const rootExtras = num(r["total_extras"]);
  if (rootExtras != null) return rootExtras;
  const direct = num(miscValue(r, "additional_charges_price") ?? r["additional_charges_price"]);
  if (direct != null) return direct;
  const extras = num(miscValue(r, "total_extras"));
  if (extras != null) return extras;
  const items = miscValue(r, "all_additional_charges");
  if (Array.isArray(items)) {
    return items.reduce(
      (s, i) =>
        s +
        (num(((i as HqReservation)?.["pivot"] as HqReservation | undefined)?.["total_price"]) ?? 0),
      0,
    );
  }
  return 0;
}

export function normalizeStatus(v: unknown): string {
  const s = String(v ?? "").toLowerCase();
  if (["open", "rental", "completed", "confirmed"].includes(s)) return "confirmed";
  if (["cancelled", "canceled", "no_show"].includes(s)) return "cancelled";
  return s || "pending";
}

/** Colunas financeiras e de status que podem mudar no HQ depois da criação da reserva. */
export function extractFinancials(r: HqReservation) {
  return {
    total_amount: Number(r["total_price"]) || 0,
    rack_rate:
      r["total_rack_rate"] != null
        ? Number(r["total_rack_rate"])
        : r["rack_rate"] == null
          ? null
          : Number(r["rack_rate"]),
    discount_amount: Number(r["discounts_amount"]) || 0,
    status: normalizeStatus(r["status"]),
    miscellaneous_price: extractMiscellaneousPrice(r),
    additional_charges_price: extractAdditionalChargesPrice(r),
  };
}
