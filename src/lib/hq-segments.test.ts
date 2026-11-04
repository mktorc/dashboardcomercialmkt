import { describe, expect, it } from "vitest";
import { extractFleetVehicle, extractSegments } from "./hq-segments";

describe("extractSegments", () => {
  it("gera um trecho por veículo, em ordem de retirada", () => {
    const r = {
      pick_up_date: "2026-10-26T13:13:00.000000Z",
      return_date: "2026-10-31T03:55:00.000000Z",
      reservation_vehicle_information: [
        { vehicle_id: 105, pick_up_date: "2026-10-26T19:25:00.000000Z", return_date: "2026-10-31T03:55:00.000000Z" },
        { vehicle_id: 66, pick_up_date: "2026-10-26T13:13:00.000000Z", return_date: "2026-10-26T19:25:00.000000Z" },
      ],
    };
    const rows = extractSegments(r, "7730", "confirmed");
    expect(rows.map((s) => [s.seq, s.pick_up_at])).toEqual([
      [0, "2026-10-26T13:13:00.000000Z"],
      [1, "2026-10-26T19:25:00.000000Z"],
    ]);
    expect(rows.every((s) => s.reservation_id === "7730" && s.status === "confirmed")).toBe(true);
  });

  it("usa as datas da reserva quando não há trechos válidos", () => {
    const r = {
      pick_up_date: "2026-11-12T18:00:00.000000Z",
      return_date: "2026-11-21T18:30:00.000000Z",
      reservation_vehicle_information: [{ vehicle_id: null, pick_up_date: null, return_date: null }],
    };
    expect(extractSegments(r, "7790", "pending")).toEqual([
      { reservation_id: "7790", seq: 0, status: "pending", pick_up_at: "2026-11-12T18:00:00.000000Z", return_at: "2026-11-21T18:30:00.000000Z" },
    ]);
  });

  it("não gera trecho sem datas", () => {
    expect(extractSegments({}, "1", "confirmed")).toEqual([]);
  });
});

describe("extractFleetVehicle", () => {
  it("prefere a data de entrada à de disponibilidade", () => {
    expect(
      extractFleetVehicle({ id: 33, vehicle_entry_date: "2023-12-14T00:00:00.000000Z", available_date: "2023-12-16T00:00:00.000000Z" }),
    ).toEqual({ id: 33, entry_date: "2023-12-14T00:00:00.000000Z", exit_date: null });
  });

  it("cai para a disponibilidade e guarda a saída", () => {
    expect(
      extractFleetVehicle({ id: 27, vehicle_entry_date: null, available_date: "2023-10-05T00:00:00.000000Z", vehicle_exit_date: "2026-12-01T00:00:00.000000Z" }),
    ).toEqual({ id: 27, entry_date: "2023-10-05T00:00:00.000000Z", exit_date: "2026-12-01T00:00:00.000000Z" });
  });

  it("ignora veículo sem data", () => {
    expect(extractFleetVehicle({ id: 1 })).toBeNull();
  });
});
