import { describe, expect, it } from "vitest";
import { commissionFor } from "./commercial-goals";
describe("commissionFor", () => {
  it("abaixo de 75% = 1,25%", () => expect(commissionFor(7400, 10000, 1).rate).toBe(0.0125));
  it("75% = 1,25%", () => expect(commissionFor(7500, 10000, 0).rate).toBe(0.0125));
  it("85% = 1,40%", () => expect(commissionFor(8500, 10000, 0).rate).toBe(0.014));
  it("100% sem meta geral = 1,55%", () =>
    expect(commissionFor(10000, 10000, 0.9).rate).toBe(0.0155));
  it("100% com meta geral = 1,75%", () =>
    expect(commissionFor(10000, 10000, 1).commission).toBeCloseTo(175));
  it("falta para próximo nível", () =>
    expect(commissionFor(8000, 10000, 0).next?.missing).toBe(500));
});
