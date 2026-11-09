/** Rate Calendar do HQ: cada dia programado é uma "temporada" de um dia (início = fim) com a diária de cada categoria. */

export type OurRateRow = {
  pickup_date: string;
  category: string;
  daily_rate: number;
  season: string;
  currency: string;
  source: "hq_rate_calendar";
};

type Rec = Record<string, unknown>;

/**
 * Tarifas de uma temporada de um dia (GET car-rental/seasons/{id}, com `rates` aninhado).
 * Devolve [] para temporada que não é de um dia, inativa/apagada, ou tarifa sem diária positiva, de categoria fora das nossas
 * ou com tipo de tarifa específico: o que falta nunca vira zero.
 */
export function dailyRatesOf(season: unknown, categories: Map<number, string>): OurRateRow[] {
  const s = (season ?? {}) as Rec;
  const start = String(s["date_start"] ?? "").slice(0, 10);
  const end = String(s["date_end"] ?? "").slice(0, 10);
  if (!start || start !== end || s["active"] === false || s["deleted_at"]) return [];
  const rates = Array.isArray(s["rates"]) ? (s["rates"] as Rec[]) : [];
  const out = new Map<string, OurRateRow>();
  const dup = new Set<string>();
  for (const r of rates) {
    const category = categories.get(Number(r["vehicle_class_id"]));
    const rate = Number(r["daily_rate"]);
    if (!category || r["rate_type_id"] != null || !Number.isFinite(rate) || rate <= 0) continue;
    if (out.has(category)) dup.add(category);
    out.set(category, {
      pickup_date: start,
      category,
      daily_rate: Math.round(rate * 100) / 100, // o banco guarda 2 casas; sem arredondar, a comparação "mudou?" nunca bate
      season: String(s["name"] ?? ""),
      currency: String(r["currency"] ?? "").toUpperCase() || "USD",
      source: "hq_rate_calendar",
    });
  }
  for (const c of dup) out.delete(c); // duas tarifas para a mesma data e categoria: ambíguo, não publica
  return [...out.values()];
}

/** Só grava o que mudou desde a última tarifa guardada de cada data e categoria (preserva o histórico sem repetir linhas iguais). */
export function changedRates(
  fresh: OurRateRow[],
  latest: Map<string, { daily_rate: number; currency: string }>,
): OurRateRow[] {
  return fresh.filter((r) => {
    const cur = latest.get(`${r.pickup_date}|${r.category}`);
    return !cur || Number(cur.daily_rate) !== r.daily_rate || cur.currency !== r.currency;
  });
}
