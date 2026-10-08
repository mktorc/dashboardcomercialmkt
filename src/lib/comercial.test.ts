import { describe, expect, it } from "vitest";
import { computeComercial, computeMonthlyCommercial, type ComercialData } from "./comercial";

describe("computeMonthlyCommercial", () => {
  it("calcula conversão, faturamento, reservas, ticket e desconto nos cinco meses", () => {
    const opportunities = [
      { created_at: "2026-10-02T12:00:00Z", seller_name: "Naty" },
      { created_at: "2026-10-03T12:00:00Z", seller_name: "Naty" },
      { created_at: "2026-10-04T12:00:00Z", seller_name: "Thay" },
    ];
    const reservations = [
      { created_at: "2026-10-05T12:00:00Z", seller_name: "Naty", status: "confirmed", total_amount: 900, discount_amount: 100 },
      { created_at: "2026-10-06T12:00:00Z", seller_name: "Naty", status: "confirmed", total_amount: 1100, discount_amount: 100 },
      { created_at: "2026-10-07T12:00:00Z", seller_name: "Naty", status: "cancelled", total_amount: 500, discount_amount: 500 },
    ];
    const months = computeMonthlyCommercial(opportunities, reservations, "nathalia", new Date("2026-10-08T12:00:00Z"));
    const october = months[4];
    expect(months.map((month) => month.mes)).toEqual(["jun/2026", "jul/2026", "ago/2026", "set/2026", "out/2026"]);
    expect(october).toMatchObject({ oportunidades: 2, reservas: 2, faturamento: 2000, conversao: 1, ticket: 1000, descontoPct: 200 / 2200 });
  });
});

const stackedData = {
  leads: [],
  opportunities: [],
  reservations: [
    { created_at: "2026-06-15T12:00:00Z", total_amount: 1000, discount_amount: 0, status: "confirmed", seller_name: "Naty" },
    { created_at: "2026-10-05T12:00:00Z", total_amount: 2000, discount_amount: 0, status: "confirmed", seller_name: "Naty" },
  ],
  tasks: [],
  goals: [],
  yearReservations: [],
  prevData: { leads: [], reservations: [], opportunities: [] },
} as unknown as ComercialData;

describe("computeComercial", () => {
  it("agrupa o valor fechado por vendedor em cinco meses", () => {
    const view = computeComercial(stackedData, "2026-10-01", "2026-10-08", "all");
    expect(view.monthly.map((month) => month["mes"])).toEqual(["2026/06", "2026/07", "2026/08", "2026/09", "2026/10"]);
    expect(view.monthly[4]?.["Naty"]).toBe(2000);
  });
});
