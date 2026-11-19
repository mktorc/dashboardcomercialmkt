import { describe, expect, it } from "vitest";
import { computeFrota, type FrotaLocation, type FrotaSegment, type FrotaVehicle } from "./frota";

const LOCS: FrotaLocation[] = [
  { id: 1, name: "MCO", region: "Orlando" },
  { id: 7, name: "Hotel Orlando", region: "Orlando" },
  { id: 2, name: "MIA", region: "Miami" },
  { id: 3, name: "FLL", region: "FLL" },
];
const NOW = new Date("2026-11-19T12:00:00Z");
const car = (id: number, loc: number, cls = 2): FrotaVehicle => ({
  id,
  plate: `P${id}`,
  label: null,
  vehicle_class_id: cls,
  class_label: "Midsize Suv",
  current_location_id: loc,
  exit_date: null,
});
const seg = (
  id: string,
  vehicle: number | null,
  from: string,
  to: string,
  pick: number,
  ret: number,
  cls = 2,
): FrotaSegment => ({
  reservation_id: id,
  seq: 0,
  status: "confirmed",
  pick_up_at: from,
  return_at: to,
  vehicle_id: vehicle,
  vehicle_class_id: cls,
  pick_up_location_id: pick,
  return_location_id: ret,
});

describe("computeFrota", () => {
  it("carro escalado que devolve em Miami e sai de Orlando precisa subir", () => {
    const r = computeFrota(
      [car(1, 1)],
      [
        seg("A", 1, "2026-11-15T12:00:00Z", "2026-11-21T12:00:00Z", 1, 2),
        seg("B", 1, "2026-11-28T12:00:00Z", "2026-12-02T12:00:00Z", 1, 1),
      ],
      LOCS,
      NOW,
    );
    expect(r.transfers).toHaveLength(1);
    expect(r.transfers[0]).toMatchObject({
      kind: "escalado",
      fromRegion: "Miami",
      toRegion: "Orlando",
      urgency: "programar",
      fromReservation: "A",
      toReservation: "B",
    });
  });

  it("mesma região (aeroporto e hotel de Orlando) não gera transferência", () => {
    const r = computeFrota(
      [car(1, 1)],
      [
        seg("A", 1, "2026-11-15T12:00:00Z", "2026-11-21T12:00:00Z", 1, 7),
        seg("B", 1, "2026-11-22T12:00:00Z", "2026-11-25T12:00:00Z", 1, 1),
      ],
      LOCS,
      NOW,
    );
    expect(r.transfers).toEqual([]);
  });

  it("janela menor que 12h é conflito", () => {
    const r = computeFrota(
      [car(1, 1)],
      [
        seg("A", 1, "2026-11-15T12:00:00Z", "2026-11-21T12:00:00Z", 1, 2),
        seg("B", 1, "2026-11-21T20:00:00Z", "2026-11-25T12:00:00Z", 1, 1),
      ],
      LOCS,
      NOW,
    );
    expect(r.transfers[0]?.urgency).toBe("conflito");
  });

  it("carro parado já devolvido usa o local atual do HQ", () => {
    // Devolveu em Miami, mas já foi levado para Orlando (local atual = MCO).
    const r = computeFrota(
      [car(1, 1)],
      [
        seg("A", 1, "2026-11-10T12:00:00Z", "2026-11-15T12:00:00Z", 1, 2),
        seg("B", 1, "2026-11-28T12:00:00Z", "2026-12-02T12:00:00Z", 1, 1),
      ],
      LOCS,
      NOW,
    );
    expect(r.transfers).toEqual([]);
  });

  it("reserva sem carro prefere o carro livre que já está na região", () => {
    const r = computeFrota(
      [car(1, 2), car(2, 1)],
      [seg("X", null, "2026-11-25T12:00:00Z", "2026-11-30T12:00:00Z", 1, 1)],
      LOCS,
      NOW,
    );
    expect(r.transfers).toEqual([]);
    expect(r.shortages).toEqual([]);
  });

  it("reserva sem carro e só carro livre em Miami: sugere descer", () => {
    const r = computeFrota(
      [car(1, 2)],
      [seg("X", null, "2026-11-25T12:00:00Z", "2026-11-30T12:00:00Z", 1, 1)],
      LOCS,
      NOW,
    );
    expect(r.transfers[0]).toMatchObject({
      kind: "sugerido",
      fromRegion: "Miami",
      toRegion: "Orlando",
      toReservation: "X",
    });
  });

  it("sem carro livre da categoria: falta carro", () => {
    const r = computeFrota(
      [car(1, 1)],
      [
        seg("A", 1, "2026-11-20T12:00:00Z", "2026-12-05T12:00:00Z", 1, 1),
        seg("X", null, "2026-11-25T12:00:00Z", "2026-11-30T12:00:00Z", 1, 1),
        seg("Y", null, "2026-11-25T12:00:00Z", "2026-11-30T12:00:00Z", 1, 1, 9),
      ],
      LOCS,
      NOW,
    );
    expect(r.shortages.map((s) => s.reservation_id)).toEqual(["X", "Y"]);
  });

  it("ignora reservas não confirmadas", () => {
    const s = seg("B", 1, "2026-11-28T12:00:00Z", "2026-12-02T12:00:00Z", 2, 2);
    const r = computeFrota([car(1, 1)], [{ ...s, status: "pending" }], LOCS, NOW);
    expect(r.transfers).toEqual([]);
  });
});
