/**
 * Apresentação da aba Competitividade: funções puras sobre os cálculos de competitiveness.ts (mediana, composição noite a noite e
 * regras de equivalência não mudam aqui; só são reaproveitados).
 */
import {
  comparable,
  dailyOf,
  diffPct,
  latestPerCompetitor,
  MAX_AGE_DAYS,
  marketOf,
  median,
  mean,
  ourStay,
  RELIABLE_MIN_COMPETITORS,
  stayNights,
  stayOffers,
  type Market,
  type Snapshot,
  type StayOffer,
} from "./competitiveness";

/** Faixas da tela: dentro de ±close = alinhado; a partir de ±significant a cor fica mais intensa. */
export type ViewBands = { close: number; significant: number };
export const VIEW_BANDS: ViewBands = { close: 5, significant: 10 };
/** Idade (dias) a partir da qual o selo da coleta fica âmbar. */
export const STALE_AFTER_DAYS = 3;

export type Position = "acima" | "alinhado" | "abaixo";

/** Acima / alinhado / abaixo de uma diferença percentual (positiva = nós mais caros). Sem diferença = null. */
export function positionOf(pct: number | null, b: ViewBands = VIEW_BANDS): Position | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  if (pct > b.close) return "acima";
  if (pct < -b.close) return "abaixo";
  return "alinhado";
}

/** Intensidade da cor: forte a partir de ±significant. */
export const isStrong = (pct: number | null, b: ViewBands = VIEW_BANDS) =>
  pct != null && Math.abs(pct) >= b.significant;

/** Dias inteiros desde a coleta (0 = hoje). */
export function ageDays(collectedAt: string, now: string): number {
  return Math.max(0, Math.floor((Date.parse(now) - Date.parse(collectedAt)) / 86400000));
}

export const ageLabel = (d: number) => (d === 0 ? "hoje" : d === 1 ? "há 1 dia" : `há ${d} dias`);

/** Confiança da referência: baixa com menos de RELIABLE_MIN_COMPETITORS concorrentes (regra atual). */
export const confidenceOf = (n: number): "alta" | "baixa" =>
  n >= RELIABLE_MIN_COMPETITORS ? "alta" : "baixa";

export type ExclusionReason =
  | "indisponível ou sem preço"
  | "moeda diferente"
  | "não equivalente"
  | "equivalência não avaliada"
  | "coleta com mais de 9 dias"
  | "outro modelo do mesmo concorrente, mais caro"
  | "coleta mais antiga do mesmo concorrente";

/**
 * Por que cada cotação de UM mercado (mesma categoria e período) entra ou não na mediana. Usa exatamente comparable +
 * latestPerCompetitor (as regras de marketOf): reason null = entra.
 */
export function classifyQuotes<T extends Snapshot>(
  rows: T[],
  now: string,
  currency: string,
): { row: T; reason: ExclusionReason | null }[] {
  const ok = rows.filter((r) => comparable(r, now, currency, MAX_AGE_DAYS));
  const picked = latestPerCompetitor(ok);
  // Oferta média (AVERAGE_MODELS): os modelos que a compõem entram na mediana.
  const used = new Set<Snapshot>(picked.flatMap((p) => p.mergedFrom ?? [p]));
  return rows.map((row) => {
    let reason: ExclusionReason | null = null;
    if (used.has(row)) reason = null;
    else if (dailyOf(row) == null) reason = "indisponível ou sem preço";
    else if (row.currency.toUpperCase() !== currency.toUpperCase()) reason = "moeda diferente";
    else if (row.equivalence === "nao_equivalente") reason = "não equivalente";
    else if (row.equivalence === "nao_avaliada") reason = "equivalência não avaliada";
    else if (!ok.includes(row)) reason = "coleta com mais de 9 dias";
    else {
      const chosen = [...used].find((u) => u.competitor === row.competitor);
      reason =
        chosen && chosen.collectedAt === row.collectedAt
          ? "outro modelo do mesmo concorrente, mais caro"
          : "coleta mais antiga do mesmo concorrente";
    }
    return { row, reason };
  });
}

export type CategoryPosition = {
  category: string;
  ours: number;
  median: number;
  pct: number;
  market: Market;
};

export type Banner =
  | { kind: "sem-dados" }
  | {
      kind: "uma";
      pct: number;
      position: Position;
      ours: number;
      median: number;
      category: string;
    }
  | { kind: "varias"; pct: number; position: Position; count: number };

/**
 * Frase do banner. Uma categoria: nossa diária contra a mediana dela. Várias: média das diferenças de cada categoria contra a
 * mediana da própria categoria.
 */
export function bannerOf(cats: CategoryPosition[], b: ViewBands = VIEW_BANDS): Banner {
  if (!cats.length) return { kind: "sem-dados" };
  if (cats.length === 1) {
    const c = cats[0]!;
    return {
      kind: "uma",
      pct: c.pct,
      position: positionOf(c.pct, b)!,
      ours: c.ours,
      median: c.median,
      category: c.category,
    };
  }
  const pct = mean(cats.map((c) => c.pct))!;
  return { kind: "varias", pct, position: positionOf(pct, b)!, count: cats.length };
}

/** Mediana geral: mediana das medianas das categorias (com número par, média dos dois do meio). */
export const medianOfMedians = (cats: CategoryPosition[]) => median(cats.map((c) => c.median));

/** Contagem acima/alinhado/abaixo das categorias. */
export function positionShare(cats: CategoryPosition[], b: ViewBands = VIEW_BANDS) {
  const out = { acima: 0, alinhado: 0, abaixo: 0 };
  for (const c of cats) {
    const p = positionOf(c.pct, b);
    if (p) out[p]++;
  }
  return out;
}

export const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** Durações rápidas da locação (diárias). */
export const DURATION_PRESETS = [3, 5, 7, 10, 14];
export const DEFAULT_DURATION = 7;

/**
 * Datas de retirada do intervalo (inclusive nas duas pontas). O intervalo é só o que se analisa; a reserva comparada em cada
 * data tem `duration` diárias (retirada → retirada + duration), nunca o intervalo inteiro.
 */
export function pickupDates(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export const cellKey = (date: string, category: string) => `${date}|${category}`;

/** Uma cotação no contexto de uma data de retirada: motivo de exclusão e diferença % dela contra a nossa diária. */
export type QuoteView<T extends Snapshot> = {
  row: StayOffer<T>;
  reason: ExclusionReason | null;
  /** Diferença do concorrente contra a nossa diária (positiva = ele mais caro). null sem nossa tarifa. */
  vsUs: number | null;
};

/** Comparação de UMA data de retirada e categoria, com reserva de `duration` diárias. */
export type Comparison<T extends Snapshot> = {
  date: string;
  category: string;
  returnDate: string;
  quotes: QuoteView<T>[];
  market: Market;
  ours: number | null;
  oursTotal: number | null;
  /** Nossa diária contra a mediana (positiva = nós mais caros). */
  pct: number | null;
};

/** Diferença do concorrente contra a nossa diária (eixo da régua: nossa diária = 0%). */
export const vsOurs = (theirs: number | null, ours: number | null) =>
  theirs != null && ours != null && ours > 0 ? ((theirs - ours) / ours) * 100 : null;

/**
 * Comparações de cada data de retirada (from … to) × categoria, todas com a mesma duração: ofertas do período exato ou compostas
 * noite a noite (stayOffers), mercado (marketOf), motivos (classifyQuotes) e nossa reserva (ourStay). Regras inalteradas.
 */
export function buildComparisons<T extends Snapshot>(opts: {
  rows: T[];
  categories: string[];
  from: string;
  to: string;
  duration: number;
  rateOf: (date: string, category: string) => number | null | undefined;
  now: string;
  currency: string;
}): Comparison<T>[] {
  const { rows, categories, from, to, duration, rateOf, now, currency } = opts;
  if (!(duration > 0)) return [];
  const out: Comparison<T>[] = [];
  for (const date of pickupDates(from, to)) {
    const ret = addDays(date, duration);
    const byCat = new Map<string, StayOffer<T>[]>();
    for (const o of stayOffers(rows, date, ret)) {
      if (!o.category) continue;
      byCat.set(o.category, [...(byCat.get(o.category) ?? []), o]);
    }
    for (const category of categories) {
      const g = byCat.get(category) ?? [];
      const market = marketOf(g, now, currency);
      const stay = ourStay((d) => rateOf(d, category), date, ret);
      const ours = stay?.daily ?? null;
      out.push({
        date,
        category,
        returnDate: ret,
        quotes: classifyQuotes(g, now, currency).map(({ row, reason }) => ({
          row,
          reason,
          vsUs: vsOurs(dailyOf(row), ours),
        })),
        market,
        ours,
        oursTotal: stay?.total ?? null,
        pct: ours != null ? diffPct(ours, market.median) : null,
      });
    }
  }
  return out;
}

export type CalendarCell = {
  date: string;
  category: string;
  /** Sem cotação válida ou sem nossa tarifa: célula tracejada. */
  empty: boolean;
  ours: number | null;
  median: number | null;
  pct: number | null;
  position: Position | null;
  strong: boolean;
  n: number;
  confidence: "alta" | "baixa" | null;
  ageDays: number | null;
};

export function calendarCell<T extends Snapshot>(
  c: Comparison<T>,
  now: string,
  b: ViewBands = VIEW_BANDS,
): CalendarCell {
  const m = c.market;
  return {
    date: c.date,
    category: c.category,
    empty: m.n === 0 || c.pct == null,
    ours: c.ours,
    median: m.median,
    pct: c.pct,
    position: positionOf(c.pct, b),
    strong: isStrong(c.pct, b),
    n: m.n,
    confidence: m.n ? confidenceOf(m.n) : null,
    ageDays: m.lastCollectedAt ? ageDays(m.lastCollectedAt, now) : null,
  };
}

/** Grade do calendário a partir das comparações. */
export function buildCalendar<T extends Snapshot>(
  comps: Comparison<T>[],
  now: string,
  b: ViewBands = VIEW_BANDS,
): Map<string, CalendarCell> {
  return new Map(comps.map((c) => [cellKey(c.date, c.category), calendarCell(c, now, b)]));
}

/** Datas em que nenhuma categoria tem cotação válida (colunas escondidas no calendário). */
export function datesWithoutQuotes(dates: string[], cells: Map<string, CalendarCell>): string[] {
  const has = new Set<string>();
  for (const c of cells.values()) if (c.n > 0) has.add(c.date);
  return dates.filter((d) => !has.has(d));
}

/** Alerta "verificar equivalência": mediana de um único concorrente ou diferença além de ±limit%. */
export const EQUIVALENCE_ALERT_PCT = 30;
/** Desligado: o pareamento é feito pelo nome do modelo, então a equivalência já é garantida. */
export function equivalenceAlert(_pct: number | null, _n: number, _limit = EQUIVALENCE_ALERT_PCT) {
  return false;
}

/** Resumo de uma categoria no escopo (uma data ou o intervalo inteiro). */
export type CategorySummary = {
  category: string;
  /** Média, entre as datas com comparação, da nossa diária contra a mediana. */
  pct: number;
  ours: number;
  median: number;
  /** Datas com comparação. */
  dates: number;
  /** Maior número de concorrentes numa data (1 = a mediana depende de um só). */
  maxN: number;
  /** Menor número de concorrentes numa data. */
  minN: number;
  /** Diferença do mercado (mediana) contra a nossa diária, no eixo da régua. */
  medianVsUs: number;
  alert: boolean;
};

/** Resumo por categoria, ordenado pela diferença contra a mediana (mais acima primeiro). */
export function summarizeCategories<T extends Snapshot>(comps: Comparison<T>[]): CategorySummary[] {
  const by = new Map<string, Comparison<T>[]>();
  for (const c of comps) {
    if (c.pct == null || c.market.median == null || c.ours == null) continue;
    by.set(c.category, [...(by.get(c.category) ?? []), c]);
  }
  const out: CategorySummary[] = [];
  for (const [category, g] of by) {
    const pct = mean(g.map((c) => c.pct!))!;
    const maxN = Math.max(...g.map((c) => c.market.n));
    out.push({
      category,
      pct,
      ours: mean(g.map((c) => c.ours!))!,
      median: mean(g.map((c) => c.market.median!))!,
      dates: g.length,
      maxN,
      minN: Math.min(...g.map((c) => c.market.n)),
      medianVsUs: mean(g.map((c) => vsOurs(c.market.median, c.ours)!))!,
      alert: equivalenceAlert(pct, maxN),
    });
  }
  return out.sort((a, b) => b.pct - a.pct);
}

export type Distribution = {
  acima: number;
  alinhado: number;
  abaixo: number;
  /** Até 2 maiores diferenças para cada lado (fora do alinhado). */
  topAcima: CategorySummary[];
  topAbaixo: CategorySummary[];
  /** Média geral das diferenças (para o ícone de informação). */
  mean: number | null;
};

/** Distribuição do banner: quantas categorias acima / alinhadas / abaixo e as maiores diferenças de cada lado. */
export function distributionOf(cats: CategorySummary[], b: ViewBands = VIEW_BANDS): Distribution {
  const out: Distribution = {
    acima: 0,
    alinhado: 0,
    abaixo: 0,
    topAcima: [],
    topAbaixo: [],
    mean: null,
  };
  for (const c of cats) out[positionOf(c.pct, b)!]++;
  out.topAcima = cats
    .filter((c) => positionOf(c.pct, b) === "acima")
    .sort((x, y) => y.pct - x.pct)
    .slice(0, 2);
  out.topAbaixo = cats
    .filter((c) => positionOf(c.pct, b) === "abaixo")
    .sort((x, y) => x.pct - y.pct)
    .slice(0, 2);
  out.mean = mean(cats.map((c) => c.pct));
  return out;
}

/** Eixo simétrico da régua (%): cobre o maior |valor| com folga, em múltiplos de 10, mínimo ±10%. */
export function symmetricAxis(values: (number | null)[]): number {
  const m = Math.max(
    0,
    ...values.filter((v): v is number => v != null && Number.isFinite(v)).map(Math.abs),
  );
  return Math.max(10, Math.ceil((m * 1.05) / 10) * 10);
}

/** Posição (0–1) de um valor % no eixo simétrico ±extent (nossa diária = 0,5). */
export const axisPos = (v: number, extent: number) =>
  Math.min(1, Math.max(0, (v + extent) / (2 * extent)));

/** Idades da coleta entre as cotações usadas na mediana: a mais antiga (selo) e a mais recente. */
export function collectionAges(collectedAts: string[], now: string) {
  if (!collectedAts.length) return null;
  const s = [...collectedAts].sort();
  return { oldest: ageDays(s[0]!, now), newest: ageDays(s.at(-1)!, now) };
}

/** Nós contra uma cotação, em texto explícito. */
export function usVsThem(
  pct: number | null,
  b: ViewBands = VIEW_BANDS,
): { text: string; position: Position | null } {
  const p = positionOf(pct, b);
  if (pct == null || p == null) return { text: "—", position: null };
  const v = Math.round(Math.abs(pct));
  if (p === "alinhado")
    return { text: `alinhados (${pct > 0 ? "+" : ""}${pct.toFixed(0)}%)`, position: p };
  return { text: `nós ${v}% mais ${p === "acima" ? "caros" : "baratos"}`, position: p };
}

export { stayNights };
