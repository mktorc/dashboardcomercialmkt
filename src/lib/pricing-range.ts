/** Período (retirada) compartilhado entre as abas de precificação: Gestão de Ocupação e Competitividade. */
export type Range = { from: string; to: string };

export const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;
export function monthEnd(iso: string) {
  const d = new Date(`${monthStart(iso)}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return d.toISOString().slice(0, 10);
}
export const addMonths = (iso: string, n: number) => {
  const d = new Date(`${monthStart(iso)}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n, 1);
  return d.toISOString().slice(0, 10);
};

/** Período padrão: o mês atual. */
export const defaultRange = (today: string): Range => ({
  from: monthStart(today),
  to: monthEnd(today),
});

/** Data de hoje (AAAA-MM-DD) no fuso do navegador. */
export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
