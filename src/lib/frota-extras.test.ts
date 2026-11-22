import { describe, expect, it } from "vitest";
import { buildActions } from "./frota-acoes";
import type { FrotaLocation, FrotaSegment, FrotaVehicle } from "./frota";
import {
  chainOf,
  diffEffects,
  diffPlan,
  hqIssues,
  snapshot,
  weekStats,
  whatsappText,
} from "./frota-extras";
import { toRow } from "./frota-ajustes";

const LOCS: FrotaLocation[] = [
  { id: 1, name: "MCO", region: "Orlando" },
  { id: 2, name: "MIA", region: "Miami" },
];
const NOW = new Date("2026-11-19T12:00:00Z");
const CLS: Record<number, string> = { 2: "Midsize Suv", 5: "Fullsize Suv", 4: "Mini Van 8 Seats" };
const car = (id: number, loc: number | null, cls = 2): FrotaVehicle => ({
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
  v: number | null,
  from: string,
  to: string,
  loc: number,
  cls = 2,
): FrotaSegment => ({
  reservation_id: id,
  seq: 0,
  status: "confirmed",
  pick_up_at: from,
  return_at: to,
  vehicle_id: v,
  vehicle_class_id: cls,
  pick_up_location_id: loc,
  return_location_id: loc,
});
const act = (v: FrotaVehicle[], s: FrotaSegment[]) =>
  buildActions({ vehicles: v, segments: s, locations: LOCS, now: NOW });

describe("extras", () => {
  it("diffPlan: primeira visita sem destaque; depois marca novo e alterado", () => {
    const a = act([car(1, 1)], [seg("T", 1, "2026-11-25T10:00:00Z", "2026-11-28T10:00:00Z", 2)]);
    expect(diffPlan(a, null).change.size).toBe(0);
    expect(diffPlan(a, {}).change.get("T")).toBe("novo");
    expect(diffPlan(a, { T: "upgrade:9" }).change.get("T")).toBe("alterado");
    expect(diffPlan(a, snapshot(a)).change.size).toBe(0);
    expect(diffPlan([], snapshot(a)).removed).toBe(1);
  });

  it("whatsapp: texto pronto só para transferência", () => {
    const [a] = act([car(1, 1)], [seg("T", 1, "2026-11-25T10:00:00Z", "2026-11-28T10:00:00Z", 2)]);
    const t = whatsappText(a!)!;
    expect(t).toContain("Orlando → Miami");
    expect(t).toContain("placa P1");
    expect(t).toContain("Reserva T");
  });

  it("cadeia: R libera o Fullsize para S", () => {
    const a = act(
      [car(1, 2), car(5, 2, 5)],
      [
        seg("R", 5, "2026-11-23T10:00:00Z", "2026-11-26T10:00:00Z", 2, 2),
        seg("S", null, "2026-11-23T12:00:00Z", "2026-11-26T10:00:00Z", 2, 5),
      ],
    );
    const r = a.find((x) => x.reservationId === "R")!;
    expect(chainOf(r, a).map((x) => x.reservationId)).toEqual(["R", "S"]);
  });

  it("pendências: feito não refletido, sem local, retirada sem carro", () => {
    const done = [
      { key: "acao|trocar|B|2", done_at: "2026-11-19T08:00:00Z" }, // 4h atrás, HQ ainda com o 1
      {
        ...toRow({
          reservationId: "B",
          kind: "outro_carro",
          vehicleId: 2,
          note: "",
          suggested: "",
        }),
        done_at: "2026-11-19T11:30:00Z",
      }, // 30 min: ainda não cobra
    ];
    const issues = hqIssues({
      vehicles: [car(1, 1), car(2, 1), car(3, null)],
      segments: [
        seg("B", 1, "2026-11-22T10:00:00Z", "2026-11-25T10:00:00Z", 1),
        seg("L", null, "2026-11-19T09:00:00Z", "2026-11-22T10:00:00Z", 1),
      ],
      locations: LOCS,
      done,
      now: NOW,
      horizonDays: 7,
    });
    expect(issues.map((i) => [i.kind, i.ref])).toEqual([
      ["feito_nao_refletido", "B"],
      ["retirada_sem_carro", "L"],
      ["sem_local", "P3"],
    ]);
  });

  it("semana e simulação", () => {
    const done = [
      { key: "1|T", done_at: "2026-11-18T10:00:00Z" },
      {
        ...toRow({ reservationId: "X", kind: "fora", vehicleId: null, note: "", suggested: "" }),
        done_at: "2026-11-18T11:00:00Z",
      },
      { key: "1|OLD", done_at: "2026-11-01T10:00:00Z" },
    ];
    expect(weekStats(done, Date.parse("2026-11-16T00:00:00Z"))).toEqual({
      asSuggested: 1,
      adjusted: 1,
      byKind: { outro_carro: 0, mantido: 0, fora: 1 },
    });
    const a = act([car(1, 1)], [seg("T", 1, "2026-11-25T10:00:00Z", "2026-11-28T10:00:00Z", 2)]);
    expect(diffEffects(a, [], "Z")).toEqual([
      expect.stringContaining("Reserva T deixa de precisar"),
    ]);
  });
});

describe("hqWallToInstant", () => {
  it("lê o horário do HQ como Orlando (inverno -5h, verão -4h)", async () => {
    const { hqWallToInstant } = await import("./frota-timeline");
    expect(hqWallToInstant("2026-11-23T23:30:00+00:00")).toBe("2026-11-24T04:30:00.000Z");
    expect(hqWallToInstant("2026-07-10T10:00:00+00:00")).toBe("2026-07-10T14:00:00.000Z");
  });
});
