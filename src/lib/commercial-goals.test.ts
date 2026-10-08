import { describe, expect, it } from "vitest";
import { GLOBAL_GOAL, goalProgress, nextGoalMonth, revenueAndTicketGoals } from "./commercial-goals";

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
    expect(revenueAndTicketGoals(goals, "2026-10-01", "2026-10-08")).toEqual({ revenue: 50000, ticket: 750 });
    expect(revenueAndTicketGoals(goals, "2026-10-01", "2026-10-08", ["Naty"])).toEqual({ revenue: 10000, ticket: 600 });
  });
  it("compara ocupação do mês seguinte mesmo na virada do ano", () => {
    expect(nextGoalMonth("2026-12")).toBe("2027-01");
    expect(goalProgress(0.6, 0.8)).toEqual({ percent: 75, bar: 75 });
  });
});