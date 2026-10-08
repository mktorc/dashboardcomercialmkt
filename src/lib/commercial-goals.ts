import type { Goal } from "./comercial";

export const GLOBAL_GOAL = "__orc_global_goal__";
export const OCCUPANCY_GOAL = "__orc_occupancy_goal__";
export const isGeneralGoal = (g: Goal) => g.seller_name === GLOBAL_GOAL || g.seller_name === OCCUPANCY_GOAL;

export function nextGoalMonth(month: string) {
  const [year, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, m, 1));
  return date.toISOString().slice(0, 7);
}

export function goalProgress(actual: number, target: number | undefined) {
  if (!target || target <= 0 || !Number.isFinite(target)) return null;
  const percent = Math.max(0, actual / target * 100);
  return { percent, bar: Math.min(100, percent) };
}

export function revenueAndTicketGoals(goals: Goal[], from: string, to: string, sellerNames?: string[]) {
  const selected = goals.filter((g) => g.month >= from.slice(0, 7) && g.month <= to.slice(0, 7) &&
    (sellerNames ? sellerNames.includes(g.seller_name) : g.seller_name === GLOBAL_GOAL));
  return {
    revenue: selected.reduce((sum, g) => sum + g.revenue_goal, 0),
    ticket: selected.length ? selected.reduce((sum, g) => sum + g.ticket_goal, 0) / selected.length : 0,
  };
}