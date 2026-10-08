import { describe, expect, it } from "vitest";
import { computeOccupancy } from "./occupancy";

describe("computeOccupancy", () => {
  it("conta só os dias da reserva dentro de cada mês", () => {
    // 10 carros; reserva de 28/out a 05/nov (8 dias)
    const r = [{ pick_up_at: "2026-10-28T00:00:00Z", return_at: "2026-11-05T00:00:00Z" }];
    const m = computeOccupancy(r, 10, new Date("2026-10-07T12:00:00Z"));
    expect(m[0]!.carDays).toBe(4);
    expect(m[0]!.rate).toBeCloseTo(4 / 310);
    expect(m[1]!.carDays).toBe(4);
    expect(m[1]!.rate).toBeCloseTo(4 / 300);
    expect(m[2]!.carDays).toBe(0);
  });

  it("gera os cinco meses de mês -2 a mês +2 com nome e ano", () => {
    const months = computeOccupancy([], 10, new Date("2026-10-08T12:00:00Z"), 5, -2);
    expect(months.map((month) => month.label)).toEqual([
      "ago/2026",
      "set/2026",
      "out/2026",
      "nov/2026",
      "dez/2026",
    ]);
  });
});
