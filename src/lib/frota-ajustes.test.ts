import { describe, expect, it } from "vitest";
import { parseAdjustments, pinsOf, toRow } from "./frota-ajustes";
import { planFrota } from "./frota-otimizador";
import type { FrotaLocation, FrotaSegment, FrotaVehicle } from "./frota";

const LOCS: FrotaLocation[] = [
  { id: 1, name: "MCO", region: "Orlando" },
  { id: 2, name: "MIA", region: "Miami" },
];
const NOW = new Date("2026-11-19T12:00:00Z");
const car = (id: number, loc: number, cls = 2, label = "Midsize Suv"): FrotaVehicle => ({
  id,
  plate: `P${id}`,
  label: `Carro ${id}`,
  vehicle_class_id: cls,
  class_label: label,
  current_location_id: loc,
  exit_date: null,
});
const seg = (
  id: string,
  v: number | null,
  from: string,
  to: string,
  loc: number,
): FrotaSegment => ({
  reservation_id: id,
  seq: 0,
  status: "confirmed",
  pick_up_at: from,
  return_at: to,
  vehicle_id: v,
  vehicle_class_id: 2,
  pick_up_location_id: loc,
  return_location_id: loc,
});

describe("ajustes", () => {
  it("grava e lê de volta (fora do plano e outro carro)", () => {
    const rows = [
      {
        ...toRow({
          reservationId: "7",
          kind: "outro_carro",
          vehicleId: 5,
          note: " ok ",
          suggested: "Trocar",
        }),
        done_at: "2026-11-19T10:00:00Z",
      },
      {
        ...toRow({ reservationId: "8", kind: "fora", vehicleId: 9, note: "", suggested: "" }),
        done_at: "2026-11-19T11:00:00Z",
      },
      { key: "1|9", done_at: "2026-11-19T09:00:00Z" }, // "Feito" comum: ignorado
    ];
    const adjs = parseAdjustments(rows);
    expect(adjs.map((a) => [a.reservationId, a.kind, a.vehicleId, a.note])).toEqual([
      ["8", "fora", null, ""],
      ["7", "outro_carro", 5, "ok"],
    ]);
    expect([...pinsOf(adjs)]).toEqual([
      ["8", "fora"],
      ["7", 5],
    ]);
  });

  it("trava a reserva no carro escolhido e replaneja as outras em volta", () => {
    // Dois carros em Miami, duas reservas sobrepostas em Miami. Sem ajuste: R1→1, R2→2 (HQ).
    // Ajuste: R2 foi com o carro 1. O plano deve mandar R1 para o carro 2.
    const vehicles = [car(1, 2), car(2, 2)];
    const segments = [
      seg("R1", 1, "2026-11-22T10:00:00Z", "2026-11-25T10:00:00Z", 2),
      seg("R2", 2, "2026-11-22T12:00:00Z", "2026-11-25T10:00:00Z", 2),
    ];
    const plan = planFrota({
      vehicles,
      segments,
      locations: LOCS,
      now: NOW,
      pins: new Map([["R2", 1]]),
    });
    expect(plan.assignment.get("R1")).toBe(2);
    expect(plan.assignment.has("R2")).toBe(false); // travada: não é mais decisão do plano
    expect(plan.suggestions.map((s) => [s.reservationId, s.kind, s.vehicle?.id])).toEqual([
      ["R1", "troca", 2],
    ]);
  });

  it("reserva resolvida fora do plano libera o carro para outra", () => {
    const vehicles = [car(1, 2)];
    const segments = [
      seg("R1", 1, "2026-11-22T10:00:00Z", "2026-11-25T10:00:00Z", 2),
      seg("R2", null, "2026-11-22T12:00:00Z", "2026-11-25T10:00:00Z", 2),
    ];
    const sem = planFrota({ vehicles, segments, locations: LOCS, now: NOW });
    expect(sem.shortages.map((s) => s.reservation_id)).toEqual(["R2"]);
    const com = planFrota({
      vehicles,
      segments,
      locations: LOCS,
      now: NOW,
      pins: new Map([["R1", "fora"]]),
    });
    expect(com.shortages).toHaveLength(0);
    expect(com.assignment.get("R2")).toBe(1);
  });
});
