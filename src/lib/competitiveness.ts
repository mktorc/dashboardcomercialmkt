/** Inteligência competitiva: posicionamento de preço contra o mercado e matriz de diagnóstico com a ocupação. */
import type { GapLevel } from "./occupancy-pace";

export type Equivalence = "equivalente" | "parcial" | "nao_equivalente" | "nao_avaliada";

/** Uma coleta de concorrente (campos de competitor_price_snapshots usados nos cálculos). */
export type Snapshot = {
  competitor: string;
  category: string | null;
  /** Modelo/categoria do concorrente como ele chama (ex.: "Hyundai Palisade"). */
  sourceCategory?: string | null;
  location: string;
  collectedAt: string; // ISO
  pickupAt: string;
  returnAt: string;
  totalPrice: number | null;
  dailyPrice: number | null;
  currency: string;
  available: boolean | null;
  equivalence: Equivalence;
};

/** Referência nossa para a mesma data e categoria (tabela do HQ). */
export type OurRate = { pickupDate: string; category: string; dailyRate: number; currency: string };

/** Faixas (em %) da diferença entre nossa tarifa e a mediana. Configuráveis na tela. */
export type PriceBands = { significant: number; close: number };
export const DEFAULT_PRICE_BANDS: PriceBands = { significant: 10, close: 3 };
/** Classifica com qualquer número de concorrentes comparáveis (mínimo 1); sem nenhum, "dados insuficientes". */
export const MIN_COMPETITORS = 1;
/** Com menos concorrentes que isto a referência é frágil: classifica, mas a comparação não é marcada como confiável. */
export const RELIABLE_MIN_COMPETITORS = 3;

export type PriceLevel =
  "muito-abaixo" | "abaixo" | "alinhado" | "acima" | "muito-acima" | "sem-dados";

export function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
}
export const mean = (v: number[]) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : null);

/** Diária de uma coleta: nunca zero nem vazia. Sem preço ou indisponível = null (ausência não é preço zero). */
export function dailyOf(s: Snapshot): number | null {
  if (s.available === false) return null;
  if (s.dailyPrice && s.dailyPrice > 0) return s.dailyPrice;
  if (s.totalPrice && s.totalPrice > 0) {
    const days = Math.max(
      1,
      Math.ceil((Date.parse(s.returnAt) - Date.parse(s.pickupAt)) / 86400000),
    );
    return s.totalPrice / days;
  }
  return null;
}

/**
 * Só entram na referência de mercado coletas equivalentes ou parciais, na MESMA moeda da nossa tarifa (sem conversão cambial:
 * câmbio seria um dado inventado), com preço, e não obsoletas.
 */
export function comparable(s: Snapshot, now: string, currency: string, maxAgeDays = 7): boolean {
  if (s.equivalence === "nao_equivalente" || s.equivalence === "nao_avaliada") return false;
  if (s.currency.toUpperCase() !== currency.toUpperCase() || dailyOf(s) == null) return false;
  return Date.parse(now) - Date.parse(s.collectedAt) <= maxAgeDays * 86400000;
}

/**
 * Só a coleta mais recente de cada oferta (concorrente + modelo dele + retirada + devolução): coletas repetidas do mesmo dia ou antigas
 * não aparecem como se fossem atuais. O histórico completo continua no banco.
 */
export function latestOffers<T extends Snapshot>(rows: T[]): T[] {
  const by = new Map<string, T>();
  for (const r of rows) {
    const k = `${r.competitor}|${r.sourceCategory ?? r.category}|${r.pickupAt}|${r.returnAt}`;
    const cur = by.get(k);
    if (!cur || r.collectedAt > cur.collectedAt) by.set(k, r);
  }
  return [...by.values()];
}

/**
 * Uma coleta por concorrente: a mais recente e, se vários modelos dele caem na mesma categoria nossa nessa coleta,
 * o de menor diária (a oferta mais barata comparável). Nunca preço antigo no lugar do atual.
 */
export function latestPerCompetitor(rows: Snapshot[]): Snapshot[] {
  const latest = new Map<string, string>();
  for (const r of rows) {
    const cur = latest.get(r.competitor);
    if (!cur || r.collectedAt > cur) latest.set(r.competitor, r.collectedAt);
  }
  const by = new Map<string, Snapshot>();
  for (const r of rows) {
    if (r.collectedAt !== latest.get(r.competitor)) continue;
    const cur = by.get(r.competitor);
    if (!cur || (dailyOf(r) ?? Infinity) < (dailyOf(cur) ?? Infinity)) by.set(r.competitor, r);
  }
  return [...by.values()];
}

export type Market = {
  n: number;
  median: number | null;
  mean: number | null;
  min: number | null;
  max: number | null;
  /** Há concorrentes suficientes (RELIABLE_MIN_COMPETITORS) e todos equivalentes: confiança alta. */
  reliable: boolean;
  /** Alguma coleta usada é só parcialmente equivalente. */
  partial: boolean;
  lastCollectedAt: string | null;
};

/** Mercado de UMA data de retirada e categoria: rows já devem ser dessa combinação. */
export function marketOf(rows: Snapshot[], now: string, currency: string): Market {
  const used = latestPerCompetitor(rows.filter((r) => comparable(r, now, currency)));
  const prices = used.map((r) => dailyOf(r) as number);
  return {
    n: used.length,
    median: median(prices),
    mean: mean(prices),
    min: prices.length ? Math.min(...prices) : null,
    max: prices.length ? Math.max(...prices) : null,
    reliable:
      used.length >= RELIABLE_MIN_COMPETITORS && used.every((r) => r.equivalence === "equivalente"),
    partial: used.some((r) => r.equivalence === "parcial"),
    lastCollectedAt: used.length
      ? used
          .map((r) => r.collectedAt)
          .sort()
          .at(-1)!
      : null,
  };
}

/** Diferença percentual de nossa tarifa sobre a referência (positiva = acima do mercado). Sem referência = null. */
export const diffPct = (ours: number, ref: number | null) =>
  ref && ref > 0 && ours > 0 ? ((ours - ref) / ref) * 100 : null;

export function priceLevel(
  pct: number | null,
  n: number,
  b: PriceBands = DEFAULT_PRICE_BANDS,
): PriceLevel {
  if (pct == null || n < MIN_COMPETITORS) return "sem-dados";
  if (pct < -b.significant) return "muito-abaixo";
  if (pct < -b.close) return "abaixo";
  if (pct <= b.close) return "alinhado";
  if (pct <= b.significant) return "acima";
  return "muito-acima";
}

export type Diagnosis =
  | "perda-competitividade"
  | "investigar-demanda"
  | "oportunidade-aumento"
  | "monitorar-sustentabilidade"
  | "neutro"
  | "sem-posicionamento";

/**
 * Matriz de diagnóstico (ferramenta de análise, não decisão automática).
 * occ: gap de ocupação vs. benchmark NA ANTECEDÊNCIA ATUAL da data (nível de occupancy-pace, null = sem benchmark).
 * Sem dados de concorrência ou sem benchmark, não assume posicionamento.
 */
export function diagnose(occ: GapLevel | null, price: PriceLevel): Diagnosis {
  if (price === "sem-dados" || occ == null) return "sem-posicionamento";
  const o =
    occ === "muito-abaixo" || occ === "abaixo" ? "abaixo" : occ === "neutro" ? "neutro" : "acima";
  const p =
    price === "muito-abaixo" || price === "abaixo"
      ? "abaixo"
      : price === "alinhado"
        ? "neutro"
        : "acima";
  if (o === "neutro" || p === "neutro") return "neutro";
  if (o === "abaixo") return p === "acima" ? "perda-competitividade" : "investigar-demanda";
  return p === "abaixo" ? "oportunidade-aumento" : "monitorar-sustentabilidade";
}

export const DIAGNOSIS_LABEL: Record<Diagnosis, string> = {
  "perda-competitividade": "Possível perda de competitividade",
  "investigar-demanda": "Investigar demanda e canais",
  "oportunidade-aumento": "Possível oportunidade de aumento",
  "monitorar-sustentabilidade": "Monitorar sustentabilidade da demanda",
  neutro: "Dentro do esperado: sem sinal claro",
  "sem-posicionamento": "Sem dados suficientes para posicionamento",
};
