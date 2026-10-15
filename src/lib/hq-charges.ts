// O HQ Rentals devolve `miscellaneous` como array de { key, value }.
type HqReservation = Record<string, unknown>;

const num = (v: unknown) => {
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

/** Cobranças Adicionais: `additional_charges_price`; senão `total_extras`; senão soma dos itens. */
export function extractAdditionalChargesPrice(r: HqReservation): number {
  const direct = num(miscValue(r, "additional_charges_price") ?? r["additional_charges_price"]);
  if (direct != null) return direct;
  const extras = num(miscValue(r, "total_extras"));
  if (extras != null) return extras;
  const items = miscValue(r, "all_additional_charges");
  if (Array.isArray(items)) {
    return items.reduce(
      (s, i) => s + (num(((i as HqReservation)?.["pivot"] as HqReservation | undefined)?.["total_price"]) ?? 0),
      0,
    );
  }
  return 0;
}
