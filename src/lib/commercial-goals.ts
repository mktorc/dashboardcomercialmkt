import type { Goal } from "./comercial";

export const GLOBAL_GOAL = "__orc_global_goal__";
export const OCCUPANCY_GOAL = "__orc_occupancy_goal__";
export const isGeneralGoal = (g: Goal) => g.seller_name === GLOBAL_GOAL || g.seller_name === OCCUPANCY_GOAL;

export function nextGoalMonth(month: string) {
  const [year, m] = month.split("-").map(Number);
  if (year === undefined || m === undefined || !Number.isFinite(year) || !Number.isFinite(m)) return "";
  const date = new Date(Date.UTC(year, m, 1));
  return date.toISOString().slice(0, 7);
}

export function goalProgress(actual: number, target: number | undefined) {
  if (!target || target <= 0 || !Number.isFinite(target)) return null;
  const percent = Math.max(0, Math.round(actual / target * 10000) / 100);
  return { percent, bar: Math.min(100, percent) };
}

export function monthProgress(to: string) {
  const [year, month, day] = to.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined || month < 1 || month > 12) return 0;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) return 0;
  return day / daysInMonth;
}

export function expectedRevenueByDate(goals: Goal[], from: string, to: string) {
  const fromMonth = from.slice(0, 7);
  const toMonth = to.slice(0, 7);
  const currentMonthProgress = monthProgress(to);
  return goals.reduce((expected, goal) => {
    if (goal.seller_name !== GLOBAL_GOAL || goal.month < fromMonth || goal.month > toMonth) return expected;
    return expected + goal.revenue_goal * (goal.month === toMonth ? currentMonthProgress : 1);
  }, 0);
}

export function revenueAndTicketGoals(goals: Goal[], from: string, to: string, sellerNames?: string[]) {
  const selected = goals.filter((g) => g.month >= from.slice(0, 7) && g.month <= to.slice(0, 7) &&
    (sellerNames ? sellerNames.includes(g.seller_name) : g.seller_name === GLOBAL_GOAL));
  return {
    revenue: selected.reduce((sum, g) => sum + g.revenue_goal, 0),
    ticket: selected.length ? selected.reduce((sum, g) => sum + g.ticket_goal, 0) / selected.length : 0,
    discount: selected.length ? selected.reduce((sum, g) => sum + (g.discount_goal ?? 0), 0) / selected.length : 0,
    conversion: selected.length ? selected.reduce((sum, g) => sum + (g.conversion_goal ?? 0), 0) / selected.length : 0,
  };
}
export function previousYearDate(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  if (year === undefined || month === undefined || date === undefined) return "";
  const lastDay = new Date(Date.UTC(year - 1, month, 0)).getUTCDate();
  return `${year - 1}-${String(month).padStart(2, "0")}-${String(Math.min(date, lastDay)).padStart(2, "0")}`;
}

export function averageDiscount(rows: { total_amount: number; discount_amount: number }[]) {
  const discount = rows.reduce((sum, r) => sum + r.discount_amount, 0);
  const gross = rows.reduce((sum, r) => sum + r.total_amount + r.discount_amount, 0);
  return gross > 0 ? discount / gross : 0;
}

export function yearOverYearDiscount(current: number, previous: number, hasHistory: boolean) {
  return hasHistory ? (current - previous) * 100 : null;
}

export type CommissionTier = { rate: number; label: string };
/** Faixas de comissão sobre o valor vendido individual. */
export function commissionFor(sold: number, goal: number, teamAttainment: number) {
  const att = goal > 0 ? sold / goal : 0;
  const teamHit = teamAttainment >= 1;
  let rate = 0.0125;
  let label = "1,25% - abaixo de 75% da meta";
  if (att >= 1 && teamHit) { rate = 0.0175; label = "1,75% - 100% individual + meta geral"; }
  else if (att >= 1) { rate = 0.0155; label = "1,55% - 100% da meta"; }
  else if (att >= 0.85) { rate = 0.014; label = "1,40% - 85% da meta"; }
  else if (att >= 0.75) { rate = 0.0125; label = "1,25% - 75% da meta"; }
  const next = att < 0.85 ? { pct: 0.85, rate: 0.014 } : att < 1 ? { pct: 1, rate: teamHit ? 0.0175 : 0.0155 } : null;
  return {
    attainment: att,
    rate,
    label,
    commission: sold * rate,
    next: next && goal > 0 ? { missing: goal * next.pct - sold, pct: next.pct, rate: next.rate } : null,
  };
}
