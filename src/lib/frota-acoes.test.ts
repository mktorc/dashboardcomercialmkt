import { describe, expect, it } from "vitest";
import {
  computeFrota,
  fleetPosition,
  type FrotaLocation,
  type FrotaSegment,
  type FrotaVehicle,
} from "./frota";
import {
  buildActions,
  bucketOf,
  cityStatus,
  isAvoidedTransferKey,
  projectStock,
} from "./frota-acoes";

const LOCS: FrotaLocation[] = [
  { id: 1, name: "MCO", region: "Orlando" },
  { id: 2, name: "MIA", region: "Miami" },
  { id: 3, name: "FLL", region: "FLL" },
];
const NOW = new Date("2026-11-19T12:00:00Z"); // 07:00 em Orlando
const CLS: Record<number, string> = {
  1: "Midsize Sedan",
  2: "Midsize Suv",
  5: "Fullsize Suv",
  4: "Mini Van 8 Seats",
  8: "SUV Executive 8 Seats",
  9: "SUV Executive 7 Seats",
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

function actions(vehicles: FrotaVehicle[], segments: FrotaSegment[]) {
  const frota = computeFrota(vehicles, segments, LOCS, NOW, 60);
  return buildActions({ vehicles, segments, locations: LOCS, ...frota, now: NOW });
}

// Carro 1 devolve em MIA dia 20 às 10h; próxima retirada em FLL.
const ate = (pickFll: string) => [
  seg("A", 1, "2026-11-15T10:00:00Z", "2026-11-20T10:00:00Z", 2, 2),
  seg("B", 1, pickFll, "2026-11-30T10:00:00Z", 3, 3),
];

describe("buildActions: prioridade", () => {
  it("troca na mesma categoria vence a transferência (mesmo com janela folgada)", () => {
    const a = actions([car(1, 2), car(2, 3), car(5, 3, 5)], ate("2026-11-25T10:00:00Z"));
    expect(a).toHaveLength(1);
    expect(a[0]!.type).toBe("trocar");
    expect(a[0]!.vehicle?.id).toBe(2);
    expect(a[0]!.avoidsTransfer).toBe(true);
    expect(isAvoidedTransferKey(a[0]!.key)).toBe(true);
    // Outras opções: upgrade e a transferência original.
    expect(a[0]!.alternatives.map((x) => x.type)).toEqual(["upgrade", "transferir"]);
  });

  it("mesmo nível da hierarquia (Exec 7 ↔ Exec 8) conta como troca", () => {
    const segs = [
      seg("A", 1, "2026-11-15T10:00:00Z", "2026-11-20T10:00:00Z", 2, 2, 9),
      seg("B", 1, "2026-11-20T15:00:00Z", "2026-11-30T10:00:00Z", 3, 3, 9),
    ];
    const a = actions([car(1, 2, 9), car(2, 3, 8)], segs);
    expect(a[0]!.type).toBe("trocar");
    expect(a[0]!.vehicle?.id).toBe(2);
  });

  it("upgrade de 1 nível vence o de 2 níveis e a transferência", () => {
    const a = actions([car(1, 2), car(5, 3, 5), car(4, 3, 4)], ate("2026-11-25T10:00:00Z"));
    expect(a[0]!.type).toBe("upgrade");
    expect(a[0]!.vehicle?.id).toBe(5);
    expect(a[0]!.levels).toBe(1);
    expect(a[0]!.alternatives.map((x) => x.type)).toEqual(["upgrade", "transferir"]);
  });

  it("upgrade de 2 níveis quando não há o de 1", () => {
    const a = actions([car(1, 2), car(4, 3, 4)], ate("2026-11-25T10:00:00Z"));
    expect(a[0]!.type).toBe("upgrade");
    expect(a[0]!.levels).toBe(2);
  });

  it("transferência quando não há troca nem upgrade e a janela ≥ 12h; prazo = retirada − 12h", () => {
    const a = actions([car(1, 2)], ate("2026-11-25T10:00:00Z"));
    expect(a[0]!.type).toBe("transferir");
    expect(a[0]!.key).toBe("1|B"); // mesma chave das transferências antigas
    expect(new Date(a[0]!.deadline).toISOString()).toBe("2026-11-24T22:00:00.000Z");
    expect(a[0]!.bucket).toBe("programado");
  });

  it("sem solução quando a janela é < 12h e não há carro na cidade", () => {
    const a = actions([car(1, 2), car(2, 1)], ate("2026-11-20T18:00:00Z"));
    expect(a[0]!.type).toBe("sem_solucao");
    expect(a[0]!.alternatives).toHaveLength(0);
    expect(a[0]!.text).toContain("renegociar");
    // Prazo para agir = quando o carro teria que sair (retirada − 12h), não a retirada.
    expect(new Date(a[0]!.deadline).toISOString()).toBe("2026-11-20T06:00:00.000Z");
    expect(a[0]!.bucket).toBe("hoje");
  });

  it("reserva sem carro nenhum: sem solução", () => {
    const segs = [
      seg("X", 1, "2026-11-20T10:00:00Z", "2026-11-26T10:00:00Z", 2, 2),
      seg("Y", null, "2026-11-21T10:00:00Z", "2026-11-24T10:00:00Z", 2, 2),
    ];
    const a = actions([car(1, 2)], segs);
    expect(a.map((x) => [x.reservationId, x.type, x.reason])).toEqual([
      ["Y", "sem_solucao", "sem_carro"],
    ]);
  });
});

describe("bucketOf", () => {
  it("hoje / amanhã / programado pelo dia de Orlando (vencido conta como hoje)", () => {
    const n = NOW.getTime();
    expect(bucketOf(Date.parse("2026-11-19T03:00:00Z"), n)).toBe("hoje"); // 18/11 22h Orlando
    expect(bucketOf(Date.parse("2026-11-20T04:30:00Z"), n)).toBe("hoje"); // 19/11 23:30 Orlando
    // Madrugada (antes das 6h) conta como véspera: retirada amanhã 01:55 é tarefa de hoje.
    expect(bucketOf(Date.parse("2026-11-20T06:55:00Z"), n)).toBe("hoje"); // 20/11 01:55 Orlando
    expect(bucketOf(Date.parse("2026-11-20T12:00:00Z"), n)).toBe("amanha"); // 20/11 07:00
    expect(bucketOf(Date.parse("2026-11-21T06:00:00Z"), n)).toBe("amanha"); // 21/11 01:00
    expect(bucketOf(Date.parse("2026-11-21T15:00:00Z"), n)).toBe("programado");
  });
});

describe("projectStock", () => {
  const days = ["2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"];

  function project(vehicles: FrotaVehicle[], segments: FrotaSegment[]) {
    const frota = computeFrota(vehicles, segments, LOCS, NOW, 60);
    const acts = buildActions({ vehicles, segments, locations: LOCS, ...frota, now: NOW });
    const position = fleetPosition(vehicles, segments, LOCS, NOW);
    const p = projectStock({
      vehicles,
      segments,
      locations: LOCS,
      position,
      actions: acts,
      days,
      now: NOW,
    });
    return { p, st: cityStatus(p, ["Orlando", "Miami", "FLL"], days, position) };
  }

  it("acumula pátio + devoluções − retiradas e aponta a primeira falta", () => {
    // 1 Midsize em MIA no pátio; retiradas em MIA dia 20 (carro 1) e dia 21 (sem carro = falta).
    const segs = [
      seg("R1", 1, "2026-11-20T15:00:00Z", "2026-11-25T15:00:00Z", 2, 2),
      seg("R2", null, "2026-11-21T15:00:00Z", "2026-11-23T15:00:00Z", 2, 2),
    ];
    const { p, st } = project([car(1, 2)], segs);
    expect(p.get("Miami")!.get("Midsize Suv")).toEqual([1, 0, -1, -1]);
    const mia = st.find((s) => s.region === "Miami")!;
    expect(mia.yard).toBe(1);
    expect(mia.shortage).toEqual({ classLabel: "Midsize Suv", missing: 1, day: "2026-11-21" });
    expect(st.find((s) => s.region === "Orlando")!.shortage).toBeNull();
  });

  it("considera a transferência a fazer (sai da origem, entra no destino)", () => {
    // Carro 1 parado em MIA, reserva em FLL dia 22 às 10h (Orlando): transferência sai dia 21.
    const segs = [seg("B", 1, "2026-11-22T15:00:00Z", "2026-11-28T15:00:00Z", 3, 3)];
    const { p } = project([car(1, 2)], segs);
    expect(p.get("Miami")!.get("Midsize Suv")).toEqual([1, 1, 0, 0]); // sai 21/11 22h Orlando (retirada − 12h)
    // Entra em FLL no dia 21 (prazo de saída) e sai na retirada do dia 22.
    expect(p.get("FLL")!.get("Midsize Suv")).toEqual([0, 0, 1, 0]);
  });

  it("upgrade sugerido consome a categoria superior", () => {
    const segs = [
      seg("X", 1, "2026-11-19T10:00:00Z", "2026-11-26T10:00:00Z", 2, 2),
      seg("Y", null, "2026-11-21T15:00:00Z", "2026-11-24T15:00:00Z", 2, 2),
    ];
    const { p } = project([car(1, 2), car(5, 2, 5)], segs);
    expect(p.get("Miami")!.get("Fullsize Suv")).toEqual([1, 1, 0, 0]);
    expect(p.get("Miami")!.get("Midsize Suv") ?? [0, 0, 0, 0]).toEqual([0, 0, 0, 0]);
  });
});
