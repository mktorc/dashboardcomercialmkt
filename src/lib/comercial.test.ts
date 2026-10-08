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

  it("agrupa oportunidades e faturamento por vendedor e dia dentro do período", () => {
    const data = {
      ...stackedData,
      opportunities: [
        { opportunity_id: "1", lead_id: "1", name: null, stage_name: null, status: "open", seller_name: "Ana", pending_tasks: 0, created_at: "2026-09-30T12:00:00Z" },
        { opportunity_id: "2", lead_id: "2", name: null, stage_name: null, status: "open", seller_name: "Ana", pending_tasks: 0, created_at: "2026-10-01T12:00:00Z" },
        { opportunity_id: "3", lead_id: "3", name: null, stage_name: null, status: "open", seller_name: "Ana", pending_tasks: 0, created_at: "2026-10-02T12:00:00Z" },
        { opportunity_id: "4", lead_id: "4", name: null, stage_name: null, status: "open", seller_name: "Bia", pending_tasks: 0, created_at: "2026-10-02T12:00:00Z" },
      ],
      reservations: [
        { created_at: "2026-10-01T12:00:00Z", total_amount: 100, discount_amount: 0, status: "confirmed", seller_name: "Ana" },
        { created_at: "2026-10-02T12:00:00Z", total_amount: 200, discount_amount: 0, status: "confirmed", seller_name: "Bia" },
        { created_at: "2026-10-03T12:00:00Z", total_amount: 300, discount_amount: 0, status: "confirmed", seller_name: "Ana" },
      ],
    } as unknown as ComercialData;

    const view = computeComercial(data, "2026-10-01", "2026-10-02", "all");
    expect(view.dailyOpportunityKeys).toEqual(["Ana", "Bia"]);
    expect(view.dailyOpportunitiesBySeller.map((day) => [day.dia, day.Ana ?? 0, day.Bia ?? 0])).toEqual([
      ["01/10", 1, 0],
      ["02/10", 1, 1],
    ]);
    expect(view.dailyRevenueBySeller.map((day) => [day.dia, day.Ana ?? 0, day.Bia ?? 0])).toEqual([
      ["01/10", 100, 0],
      ["02/10", 0, 200],
    ]);
    expect(view.kpis.conversao).toBe(0.5);
    expect(view.kpis.leadsNoTask).toBe(3);
  });
});
