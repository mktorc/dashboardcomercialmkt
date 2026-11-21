import { describe, expect, it } from "vitest";
import { computeFrota, type FrotaLocation, type FrotaSegment, type FrotaVehicle } from "./frota";
import { suggestAlternatives } from "./frota-sugestao";

const LOCS: FrotaLocation[] = [
  { id: 1, name: "MCO", region: "Orlando" },
  { id: 2, name: "MIA", region: "Miami" },
  { id: 3, name: "Hotel Orlando", region: "Orlando" },
];
const NOW = new Date("2026-11-19T12:00:00Z");
const CLS: Record<number, string> = {
  1: "Midsize Sedan",
  2: "Midsize Suv",
  5: "Fullsize Suv",
  4: "Mini Van 8 Seats",
};
const car = (id: number, loc: number, cls = 2): FrotaVehicle => ({
  id,
  plate: `P${id}`,
  label: `Carro ${id}`,
  vehicle_class_id: cls,
  class_label: CLS[cls]!,
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

function run(vehicles: FrotaVehicle[], segments: FrotaSegment[]) {
  const { transfers, shortages } = computeFrota(vehicles, segments, LOCS, NOW, 60);
  return suggestAlternatives({
    vehicles,
    segments,
    locations: LOCS,
    transfers,
    shortages,
    now: NOW,
  });
}

// Caso base: carro 1 devolve em MIA dia 20 às 10h e tem retirada no Hotel Orlando dia 20 às 13h (3h < 5h: conflito).
const CONFLITO = [
  seg("A", 1, "2026-11-15T10:00:00Z", "2026-11-20T10:00:00Z", 2, 2),
  seg("B", 1, "2026-11-20T13:00:00Z", "2026-11-25T10:00:00Z", 3, 3),
];

describe("suggestAlternatives", () => {
  it("troca: carro da mesma categoria livre na cidade de retirada", () => {
    const s = run([car(1, 2), car(2, 3)], CONFLITO);
    expect(s).toHaveLength(1);
    expect(s[0]!.reservationId).toBe("B");
    expect(s[0]!.reason).toBe("conflito");
    expect(s[0]!.kind).toBe("troca");
    expect(s[0]!.vehicle?.id).toBe(2);
    expect(s[0]!.text).toContain("Trocar para Carro 2");
    expect(s[0]!.instruction).toContain("Reserva B");
  });

  it("upgrade: sem carro da categoria, sugere o nível imediatamente acima", () => {
    // Fullsize (1 nível) e Minivan (2 níveis) livres em Orlando: deve escolher o Fullsize.
    const s = run([car(1, 2), car(5, 3, 5), car(4, 3, 4)], CONFLITO);
    expect(s[0]!.kind).toBe("upgrade");
    expect(s[0]!.vehicle?.id).toBe(5);
    expect(s[0]!.levels).toBe(1);
    expect(s[0]!.text).toContain("Midsize Suv → Fullsize Suv");
  });

  it("nunca sugere upgrade de 2 níveis", () => {
    const s = run([car(1, 2), car(4, 3, 4)], CONFLITO);
    expect(s[0]!.kind).toBe("nenhuma");
  });

  it("nunca sugere downgrade", () => {
    const s = run([car(1, 2), car(9, 3, 1)], CONFLITO);
    expect(s[0]!.kind).toBe("nenhuma");
  });

  it("sem solução: nenhum carro livre na cidade", () => {
    const s = run([car(1, 2), car(2, 2)], CONFLITO); // o outro também está em Miami
    expect(s[0]!.kind).toBe("nenhuma");
    expect(s[0]!.text).toContain("Sem alternativa");
  });

  it("descarta sugestão que criaria outro conflito na cadeia do carro sugerido", () => {
    // Carro 2 está em Orlando, mas tem retirada em MIA 4h depois da devolução de B: geraria conflito.
    // Carro 3 (mesma situação, porém com folga) deve ser o escolhido.
    const segs = [
      ...CONFLITO,
      seg("C", 2, "2026-11-25T14:00:00Z", "2026-11-28T10:00:00Z", 2, 2),
      seg("D", 3, "2026-11-27T10:00:00Z", "2026-11-29T10:00:00Z", 2, 2),
    ];
    const s = run([car(1, 2), car(2, 3), car(3, 3)], segs);
    const b = s.find((x) => x.reservationId === "B")!;
    expect(b.vehicle?.id).toBe(3);
    expect(b.transferAfter).toBe(true);

    // Só o carro 2 disponível: a sugestão é descartada.
    const s2 = run([car(1, 2), car(2, 3)], segs.slice(0, 3));
    expect(s2.find((x) => x.reservationId === "B")!.kind).toBe("nenhuma");
  });

  it("descarta carro com reserva sobreposta", () => {
    const segs = [...CONFLITO, seg("E", 2, "2026-11-22T10:00:00Z", "2026-11-23T10:00:00Z", 3, 3)];
    const s = run([car(1, 2), car(2, 3)], segs);
    expect(s.find((x) => x.reservationId === "B")!.kind).toBe("nenhuma");
  });

  it("reserva sem carro: sugere upgrade quando a categoria acabou", () => {
    const segs = [
      seg("X", 1, "2026-11-20T10:00:00Z", "2026-11-26T10:00:00Z", 2, 2),
      seg("Y", null, "2026-11-21T10:00:00Z", "2026-11-24T10:00:00Z", 2, 2),
    ];
    const s = run([car(1, 2), car(5, 2, 5)], segs);
    expect(s).toHaveLength(1);
    expect(s[0]!.reason).toBe("sem_carro");
    expect(s[0]!.kind).toBe("upgrade");
    expect(s[0]!.vehicle?.id).toBe(5);
  });

  it("não oferece o mesmo carro para dois casos que se sobrepõem", () => {
    const segs = [
      seg("X", 1, "2026-11-20T10:00:00Z", "2026-11-26T10:00:00Z", 2, 2),
      seg("Y1", null, "2026-11-21T10:00:00Z", "2026-11-24T10:00:00Z", 2, 2),
      seg("Y2", null, "2026-11-22T10:00:00Z", "2026-11-25T10:00:00Z", 2, 2),
    ];
    const s = run([car(1, 2), car(5, 2, 5)], segs);
    expect(s.map((x) => x.kind)).toEqual(["upgrade", "nenhuma"]);
  });
});
