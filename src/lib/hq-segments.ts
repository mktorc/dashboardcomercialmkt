type HqRecord = Record<string, unknown>;

export type SegmentRow = {
  reservation_id: string;
  seq: number;
  status: string;
  pick_up_at: string;
  return_at: string;
};

export type FleetVehicleRow = { id: number; entry_date: string; exit_date: string | null };

const isDate = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));

/**
 * Trechos de veículo da reserva (reservation_vehicle_information do HQ): uma troca de carro no meio do
 * aluguel gera dois trechos, e o relatório de Utilização do HQ conta cada trecho. Sem trechos válidos,
 * a própria reserva vira o trecho único.
 */
export function extractSegments(r: HqRecord, reservationId: string, status: string): SegmentRow[] {
  const info = Array.isArray(r["reservation_vehicle_information"]) ? (r["reservation_vehicle_information"] as HqRecord[]) : [];
  const valid = info
    .filter((v) => isDate(v["pick_up_date"]) && isDate(v["return_date"]))
    .map((v) => ({ pick_up_at: v["pick_up_date"] as string, return_at: v["return_date"] as string }))
    .sort((a, b) => Date.parse(a.pick_up_at) - Date.parse(b.pick_up_at));
  const trechos =
    valid.length > 0
      ? valid
      : isDate(r["pick_up_date"]) && isDate(r["return_date"])
        ? [{ pick_up_at: r["pick_up_date"] as string, return_at: r["return_date"] as string }]
        : [];
  return trechos.map((t, seq) => ({ reservation_id: reservationId, seq, status, ...t }));
}

/** Veículo da frota: conta a partir da data de entrada (ou, na falta, a de disponibilidade) até a de saída. */
export function extractFleetVehicle(v: HqRecord): FleetVehicleRow | null {
  const id = Number(v["id"]);
  const entry = [v["vehicle_entry_date"], v["available_date"], v["created_at"]].find(isDate);
  if (!Number.isFinite(id) || !entry) return null;
  return { id, entry_date: entry, exit_date: isDate(v["vehicle_exit_date"]) ? v["vehicle_exit_date"] : null };
}
