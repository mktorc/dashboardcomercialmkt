import { describe, expect, it } from "vitest";
import { GLOBAL_GOAL, averageDiscount, previousYearDate, yearOverYearDiscount, goalProgress, nextGoalMonth, revenueAndTicketGoals } from "./commercial-goals";

describe("comparação com metas", () => {
  it("compara o realizado à meta sem limitar o percentual atingido", () => {
    expect(goalProgress(750, 1000)).toEqual({ percent: 75, bar: 75 });
    expect(goalProgress(1200, 1000)).toEqual({ percent: 120, bar: 100 });
  });
  it("não inventa progresso sem meta definida", () => {
    expect(goalProgress(500, 0)).toBeNull();
    expect(goalProgress(500, undefined)).toBeNull();
  });
  it("separa metas globais das individuais e respeita o período", () => {
    const goals = [
      { seller_name: GLOBAL_GOAL, month: "2026-10", revenue_goal: 50000, ticket_goal: 750 },
      { seller_name: "Naty", month: "2026-10", revenue_goal: 10000, ticket_goal: 600 },
      { seller_name: GLOBAL_GOAL, month: "2026-11", revenue_goal: 60000, ticket_goal: 850 },
    ];
    expect(revenueAndTicketGoals(goals, "2026-10-01", "2026-10-08")).toEqual({ revenue: 50000, ticket: 750, discount: 0, conversion: 0 });
    expect(revenueAndTicketGoals(goals, "2026-10-01", "2026-10-08", ["Naty"])).toEqual({ revenue: 10000, ticket: 600, discount: 0, conversion: 0 });
  });
  it("compara ocupação do mês seguinte mesmo na virada do ano", () => {
    expect(nextGoalMonth("2026-12")).toBe("2027-01");
    expect(goalProgress(0.6, 0.8)).toEqual({ percent: 75, bar: 75 });
  });
  it("usa metas gerais de desconto e conversão na visão global", () => {
    const goals = [
      { seller_name: GLOBAL_GOAL, month: "2026-10", revenue_goal: 0, ticket_goal: 0, discount_goal: 0.1, conversion_goal: 0.25 },
      { seller_name: "Naty", month: "2026-10", revenue_goal: 0, ticket_goal: 0, discount_goal: 0.05, conversion_goal: 0.3 },
    ];
    expect(revenueAndTicketGoals(goals, "2026-10-01", "2026-10-31")).toMatchObject({ discount: 0.1, conversion: 0.25 });
  });
  it("usa metas individuais de desconto e conversão ao filtrar vendedor", () => {
    const goals = [{ seller_name: "Naty", month: "2026-10", revenue_goal: 0, ticket_goal: 0, discount_goal: 0.05, conversion_goal: 0.3 }];
    expect(revenueAndTicketGoals(goals, "2026-10-01", "2026-10-31", ["Naty"])).toMatchObject({ discount: 0.05, conversion: 0.3 });
    expect(goalProgress(0.15, 0.3)).toEqual({ percent: 50, bar: 50 });
  });
  it("calcula desconto ponderado pelo valor das reservas", () => {
    expect(averageDiscount([{ total_amount: 90, discount_amount: 10 }, { total_amount: 720, discount_amount: 180 }])).toBe(0.19);
  });
  it("compara desconto com ano anterior em pontos percentuais sem inventar histórico", () => {
    expect(yearOverYearDiscount(0.15, 0.1, true)).toBeCloseTo(5);
    expect(yearOverYearDiscount(0.15, 0, false)).toBeNull();
  });
  it("usa o mesmo período do ano anterior inclusive em ano bissexto", () => {
    expect(previousYearDate("2026-10-08")).toBe("2025-10-08");
    expect(previousYearDate("2024-02-29")).toBe("2023-02-28");
  });
});