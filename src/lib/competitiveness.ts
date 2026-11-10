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
  /** Observações da coleta (equivalence_notes): trazem os extras lidos no motor ("extras: motorista=29.99/uma_vez; bebe=5.99/dia"). */
  notes?: string | null;
  /** Extras preenchidos pelo último valor lido do mesmo concorrente (a coleta em si não os leu). */
  extrasEstimados?: boolean;
};

/** Extra cobrado por diária ("dia") ou uma vez só ("uma_vez"); grátis = valor 0. */
export type Extra = { valor: number; unidade: "dia" | "uma_vez" };
/** 1 motorista adicional e 1 bebê conforto (ou cadeirinha): alguns concorrentes cobram, outros não. */
export type Extras = { motorista: Extra; bebe: Extra; dias?: number };

const EXTRAS_RE =
  /extras:\s*motorista=([\d.]+)\/(dia|uma_vez);\s*bebe=([\d.]+)\/(dia|uma_vez)(?:;[^;]*)?(?:;\s*dias=(\d+))?/;
/** Extras gravados pelo coletor na nota da coleta; null quando não foram lidos (nada é presumido). */
export function parseExtras(notes: string | null | undefined): Extras | null {
  const m = notes ? EXTRAS_RE.exec(notes) : null;
  if (!m) return null;
  return {
    motorista: { valor: Number(m[1]), unidade: m[2] as Extra["unidade"] },
    bebe: { valor: Number(m[3]), unidade: m[4] as Extra["unidade"] },
    ...(m[5] ? { dias: Number(m[5]) } : {}),
  };
}
/**
 * Extras conhecidos de cada concorrente: os da coleta mais recente em que foram lidos. Usados para preencher coletas antigas, que não os
 * leram, partindo de que o concorrente cobra o mesmo valor (premissa explícita: sempre aparece como "estimado").
 */
export function latestExtrasByCompetitor(
  rows: Snapshot[],
): Map<string, { extras: Extras; collectedAt: string }> {
  const out = new Map<string, { extras: Extras; collectedAt: string }>();
  for (const r of rows) {
    const e = parseExtras(r.notes);
    if (!e) continue;
    const cur = out.get(r.competitor);
    if (!cur || r.collectedAt > cur.collectedAt)
      out.set(r.competitor, { extras: e, collectedAt: r.collectedAt });
  }
  return out;
}

/** Coletas sem extras lidos recebem o último valor lido do mesmo concorrente, marcadas como estimadas; sem valor conhecido, ficam como estão. */
export function withKnownExtras<T extends Snapshot>(
  rows: T[],
  known: Map<string, { extras: Extras }>,
): T[] {
  return rows.map((r) => {
    if (parseExtras(r.notes)) return r;
    const k = known.get(r.competitor);
    if (!k) return r;
    const f = (x: Extra) => `${x.valor.toFixed(2)}/${x.unidade}`;
    const nota = `extras: motorista=${f(k.extras.motorista)}; bebe=${f(k.extras.bebe)}`;
    return { ...r, notes: r.notes ? `${r.notes}; ${nota}` : nota, extrasEstimados: true };
  });
}

/** Custo dos extras em `dias` diárias. */
export const extrasCost = (e: Extras, dias: number) =>
  [e.motorista, e.bebe].reduce((s, x) => s + (x.unidade === "dia" ? x.valor * dias : x.valor), 0);

/** Referência nossa para a mesma data e categoria (tabela do HQ). */
export type OurRate = {
  pickupDate: string;
  category: string;
  dailyRate: number;
  currency: string;
  /** Extras lidos na cotação do nosso site (season); sem leitura, null: nosso site não cobra esses extras. */
  extras?: Extras | null;
};

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
export function dailyOf(s: Snapshot, comExtras = false): number | null {
  if (s.available === false) return null;
  const days = Math.max(1, Math.ceil((Date.parse(s.returnAt) - Date.parse(s.pickupAt)) / 86400000));
  const base =
    s.dailyPrice && s.dailyPrice > 0
      ? s.dailyPrice
      : s.totalPrice && s.totalPrice > 0
        ? s.totalPrice / days
        : null;
  if (base == null || !comExtras) return base;
  // Com extras: soma 1 motorista adicional e 1 bebê conforto (por diária), se foram lidos nesta coleta.
  const e = parseExtras(s.notes);
  return e ? base + extrasCost(e, days) / days : null;
}

/**
 * Só entram na referência de mercado coletas equivalentes ou parciais, na MESMA moeda da nossa tarifa (sem conversão cambial:
 * câmbio seria um dado inventado), com preço, e não obsoletas.
 */
export function comparable(
  s: Snapshot,
  now: string,
  currency: string,
  maxAgeDays = 7,
  comExtras = false,
): boolean {
  if (s.equivalence === "nao_equivalente" || s.equivalence === "nao_avaliada") return false;
  // Com extras, só entra a coleta cujos extras foram lidos: sem eles não dá para somar (e não se presume que sejam grátis).
  if (s.currency.toUpperCase() !== currency.toUpperCase() || dailyOf(s, comExtras) == null)
    return false;
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
export function marketOf(
  rows: Snapshot[],
  now: string,
  currency: string,
  comExtras = false,
): Market {
  const used = latestPerCompetitor(rows.filter((r) => comparable(r, now, currency, 7, comExtras)));
  const prices = used.map((r) => dailyOf(r, comExtras) as number);
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
