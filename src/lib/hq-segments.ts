type HqRecord = Record<string, unknown>;

export type SegmentRow = {
  reservation_id: string;
  seq: number;
  status: string;
  pick_up_at: string;
  return_at: string;
  vehicle_id: number | null;
  vehicle_class_id: number | null;
  pick_up_location_id: number | null;
  return_location_id: number | null;
};

export type FleetVehicleRow = {
  id: number;
  entry_date: string;
  exit_date: string | null;
  plate: string | null;
  label: string | null;
  vehicle_class_id: number | null;
  class_label: string | null;
  current_location_id: number | null;
  hq_status: string | null;
};

/** Id positivo do HQ ou null. */
const idOf = (v: unknown): number | null => {
  const n = Number(v);
  return v != null && v !== "" && Number.isFinite(n) && n > 0 ? n : null;
};
const textOf = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;

const isDate = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));

/**
 * Trechos de veículo da reserva (reservation_vehicle_information do HQ): uma troca de carro no meio do
 * aluguel gera dois trechos, e o relatório de Utilização do HQ conta cada trecho. Sem trechos válidos,
 * a própria reserva vira o trecho único.
 */
export function extractSegments(
  r: HqRecord,
  reservationId: string,
  status: string,
  skipVehicles?: Set<number>,
): SegmentRow[] {
  const allInfo = Array.isArray(r["reservation_vehicle_information"])
    ? (r["reservation_vehicle_information"] as HqRecord[])
    : [];
  // Veículos de classe que o HQ não lista mais (ex.: "Extra") ficam fora da Utilização.
  const info = skipVehicles
    ? allInfo.filter((v) => !skipVehicles.has(Number(v["vehicle_id"])))
    : allInfo;
  if (allInfo.length > 0 && info.length === 0) return [];
  const valid = info
    .filter((v) => isDate(v["pick_up_date"]) && isDate(v["return_date"]))
    .map((v) => ({
      pick_up_at: v["pick_up_date"] as string,
      return_at: v["return_date"] as string,
      vehicle_id: idOf(v["vehicle_id"]),
      pick_up_location_id: idOf(v["pick_up_location_id"]) ?? idOf(r["pick_up_location_id"]),
      return_location_id: idOf(v["return_location_id"]) ?? idOf(r["return_location_id"]),
    }))
    .sort((a, b) => Date.parse(a.pick_up_at) - Date.parse(b.pick_up_at));
  const trechos =
    valid.length > 0
      ? valid
      : isDate(r["pick_up_date"]) && isDate(r["return_date"])
        ? [
            {
              pick_up_at: r["pick_up_date"] as string,
              return_at: r["return_date"] as string,
              vehicle_id: null,
              pick_up_location_id: idOf(r["pick_up_location_id"]),
              return_location_id: idOf(r["return_location_id"]),
            },
          ]
        : [];
  const vehicle_class_id = idOf(r["vehicle_class_id"]);
  return trechos.map((t, seq) => ({
    reservation_id: reservationId,
    seq,
    status,
    ...t,
    vehicle_class_id,
  }));
}

/** Veículo da frota: conta a partir da data de entrada (ou, na falta, a de disponibilidade) até a de saída. */
export function extractFleetVehicle(v: HqRecord): FleetVehicleRow | null {
  const id = Number(v["id"]);
  const entry = [v["vehicle_entry_date"], v["available_date"], v["created_at"]].find(isDate);
  if (!Number.isFinite(id) || !entry) return null;
  return {
    id,
    entry_date: entry,
    exit_date: isDate(v["vehicle_exit_date"]) ? v["vehicle_exit_date"] : null,
    plate: textOf(v["plate"]),
    label: textOf(v["label"]),
    vehicle_class_id: idOf(v["vehicle_class_id"]),
    class_label: textOf(v["vehicle_class_label"]),
    current_location_id: idOf(v["current_location_id"]),
    hq_status: textOf(v["status"]),
  };
}
