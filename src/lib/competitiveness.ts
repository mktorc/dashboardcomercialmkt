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

/** Cotação vinda do DiscoverCars (taxas embutidas, sem cadeirinha nem motorista adicional). */
export const isDiscoverCars = (r: Pick<Snapshot, "notes" | "competitor">) =>
  /discovercars/i.test(r.notes ?? "") || /\(discovercars\)/i.test(r.competitor);

/** Cotação capturada na Rentcars (botão no navegador): comparador, com proteções e taxas da locadora no total. */
export const isRentcars = (r: Pick<Snapshot, "competitor">) => /\(rentcars\)/i.test(r.competitor);

/** Nome da locadora sem o sufixo da fonte ("Avis (DiscoverCars)" -> "Avis", "Hertz (Rentcars)" -> "Hertz"). */
export const baseCompetitor = (c: string) =>
  c.replace(/\s*\((discovercars|rentcars)\)\s*$/i, "").trim();

/**
 * Site direto primeiro: se a mesma locadora tem cotação do próprio site para a mesma categoria e período, as dos comparadores
 * saem (evita a mesma locadora duas vezes). Sem cotação direta, vale a do comparador: a Rentcars antes do DiscoverCars, porque
 * traz cadeirinha e motorista (decisão do usuário, 2026-11-22).
 */
export function preferDirect<T extends Snapshot>(rows: T[]): T[] {
  const key = (r: T) =>
    `${baseCompetitor(r.competitor).toLowerCase()}|${r.category}|${r.pickupAt.slice(0, 10)}|${r.returnAt.slice(0, 10)}`;
  const rank = (r: T) => (isDiscoverCars(r) ? 2 : isRentcars(r) ? 1 : 0);
  const best = new Map<string, number>();
  for (const r of rows) if (r.category) best.set(key(r), Math.min(best.get(key(r)) ?? 9, rank(r)));
  return rows.filter((r) => !r.category || rank(r) === best.get(key(r)));
}

/**
 * Correções de pareamento aplicadas na leitura (coletas antigas foram gravadas com o mapa anterior). Chave: concorrente e trecho
 * do modelo dele, em minúsculas; valor: nossa categoria (null = sem par, não entra na comparação).
 */
export const CATEGORY_OVERRIDES: { competitor: string; model: string; category: string | null }[] =
  [
    // Outlander (5+2 compacto) não bate com nenhum carro nosso.
    { competitor: "allycar", model: "outlander", category: null },
    // Yukon XL da Allycar: fora do comparativo por decisão do usuário (2026-11-15).
    { competitor: "allycar", model: "yukon", category: null },
  ];

/** Categoria nossa de uma coleta, com as correções de CATEGORY_OVERRIDES. */
export function overrideCategory(
  competitor: string,
  sourceCategory: string | null | undefined,
  category: string | null,
): string | null {
  const c = competitor.toLowerCase();
  const m = (sourceCategory ?? "").toLowerCase();
  const o = CATEGORY_OVERRIDES.find((x) => c.includes(x.competitor) && m.includes(x.model));
  return o ? o.category : category;
}

/**
 * Concorrente + categoria em que a referência é a MÉDIA dos modelos dele (não o mais barato).
 * Allycar Fullsize Suv: Palisade e Grand Highlander.
 */
export const AVERAGE_MODELS: { competitor: string; category: string }[] = [
  { competitor: "allycar", category: "Fullsize Suv" },
];
const averagesModels = (s: Snapshot) =>
  AVERAGE_MODELS.some(
    (a) => s.competitor.toLowerCase().includes(a.competitor) && s.category === a.category,
  );

/** Oferta que resume vários modelos do mesmo concorrente (média): mergedFrom traz as cotações usadas. */
export type MergedSnapshot = Snapshot & { mergedFrom?: Snapshot[] };

/**
 * Uma coleta por concorrente: a mais recente e, se vários modelos dele caem na mesma categoria nossa nessa coleta,
 * o de menor diária (a oferta mais barata comparável). Nunca preço antigo no lugar do atual.
 * Exceção (AVERAGE_MODELS): a média das diárias dos modelos dele da coleta mais recente (até 1 h antes da última, mesma rodada).
 */
export function latestPerCompetitor(rows: Snapshot[]): MergedSnapshot[] {
  const latest = new Map<string, string>();
  for (const r of rows) {
    const cur = latest.get(r.competitor);
    if (!cur || r.collectedAt > cur) latest.set(r.competitor, r.collectedAt);
  }
  const by = new Map<string, Snapshot>();
  const avg = new Map<string, Snapshot[]>();
  for (const r of rows) {
    const last = latest.get(r.competitor)!;
    if (averagesModels(r)) {
      if (Date.parse(last) - Date.parse(r.collectedAt) > 3600000 || dailyOf(r) == null) continue;
      // Um por modelo (o mais recente).
      const g = (avg.get(r.competitor) ?? []).filter(
        (x) => x.sourceCategory !== r.sourceCategory || x.collectedAt > r.collectedAt,
      );
      if (!g.some((x) => x.sourceCategory === r.sourceCategory)) g.push(r);
      avg.set(r.competitor, g);
      continue;
    }
    if (r.collectedAt !== last) continue;
    const cur = by.get(r.competitor);
    if (!cur || (dailyOf(r) ?? Infinity) < (dailyOf(cur) ?? Infinity)) by.set(r.competitor, r);
  }
  const out: MergedSnapshot[] = [...by.values()];
  for (const g of avg.values()) {
    if (g.length === 1) {
      out.push(g[0]!);
      continue;
    }
    const days = Math.max(
      1,
      Math.round((Date.parse(g[0]!.returnAt) - Date.parse(g[0]!.pickupAt)) / 86400000),
    );
    const daily = g.reduce((s, x) => s + dailyOf(x)!, 0) / g.length;
    const newest = [...g].sort((a, b) => b.collectedAt.localeCompare(a.collectedAt))[0]!;
    out.push({
      ...newest,
      sourceCategory: `Média: ${g.map((x) => x.sourceCategory ?? "—").join(" + ")}`,
      dailyPrice: daily,
      totalPrice: daily * days,
      // Parcial se algum modelo for parcial.
      equivalence: g.every((x) => x.equivalence === "equivalente") ? "equivalente" : "parcial",
      mergedFrom: g,
    });
  }
  return out;
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

/** Noites de uma estadia: datas de retirada de `from` até a véspera de `to` (devolução). */
export function stayNights(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t < Date.parse(`${to}T00:00:00Z`); t += 86400000)
    out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/**
 * Nossa reserva para o período exato (retirada `from` → devolução `to`): soma da nossa diária de cada noite e a diária média.
 * Falta tarifa em alguma noite = null (nunca completa com zero nem com outra data).
 */
export function ourStay(
  rateOf: (date: string) => number | null | undefined,
  from: string,
  to: string,
): { total: number; daily: number; days: number } | null {
  const nights = stayNights(from, to);
  if (!nights.length) return null;
  let total = 0;
  for (const d of nights) {
    const r = rateOf(d);
    if (r == null || !(r > 0)) return null;
    total += r;
  }
  return { total, daily: total / nights.length, days: nights.length };
}

/** Total de uma coleta (reserva final): o total informado ou diária × dias. Sem preço ou indisponível = null. */
export function totalOf(s: Snapshot): number | null {
  if (s.available === false) return null;
  if (s.totalPrice && s.totalPrice > 0) return s.totalPrice;
  const d = dailyOf(s);
  const days = Math.max(
    1,
    Math.round((Date.parse(s.returnAt) - Date.parse(s.pickupAt)) / 86400000),
  );
  return d == null ? null : d * days;
}

/** Cotação do período exato: real (retirada e devolução iguais) ou composta noite a noite a partir de outras cotações. */
export type StayOffer<T extends Snapshot> = T & {
  /** Composta a partir de cotações de outra duração (ex.: 7 dias): a diária de cada noite vem da cotação que a cobre. */
  composta?: boolean;
  /** Cotações (retirada → devolução) usadas na composição. */
  base?: string[];
};

/**
 * Uma oferta por concorrente + modelo dele + categoria para o período `from` (retirada) → `to` (devolução).
 * Com cotação exata, usa ela. Sem ela, compõe noite a noite: para cada noite, a diária média de uma cotação que cobre a noite
 * (retirada ≤ noite < devolução), preferindo a que começa mais perto da noite e, empatando, a mais recente. Noite sem cobertura =
 * sem oferta (nunca completa com zero). Rows já devem ser só a coleta mais recente de cada oferta (latestOffers).
 */
export function stayOffers<T extends Snapshot>(
  rows: T[],
  from: string,
  to: string,
): StayOffer<T>[] {
  const nights = stayNights(from, to);
  if (!nights.length) return [];
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const k = `${r.competitor}|${r.sourceCategory ?? ""}|${r.category ?? ""}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
  const out: StayOffer<T>[] = [];
  for (const g of groups.values()) {
    const exact = g
      .filter((r) => r.pickupAt.slice(0, 10) === from && r.returnAt.slice(0, 10) === to)
      .sort((a, b) => b.collectedAt.localeCompare(a.collectedAt))[0];
    if (exact) {
      out.push(exact);
      continue;
    }
    const priced = g.filter((r) => dailyOf(r) != null);
    const used: T[] = [];
    let total = 0;
    let ok = true;
    for (const n of nights) {
      const t = dayMs(n);
      const best = priced
        .filter((r) => r.pickupAt.slice(0, 10) <= n && n < r.returnAt.slice(0, 10))
        .sort(
          (a, b) =>
            t - dayMs(a.pickupAt.slice(0, 10)) - (t - dayMs(b.pickupAt.slice(0, 10))) ||
            b.collectedAt.localeCompare(a.collectedAt),
        )[0];
      if (!best) {
        ok = false;
        break;
      }
      total += dailyOf(best)!;
      if (!used.includes(best)) used.push(best);
    }
    if (!ok) continue;
    const newest = [...used].sort((a, b) => b.collectedAt.localeCompare(a.collectedAt))[0]!;
    const oldest = [...used].sort((a, b) => a.collectedAt.localeCompare(b.collectedAt))[0]!;
    out.push({
      ...newest,
      pickupAt: `${from}T10:00:00`,
      returnAt: `${to}T10:00:00`,
      totalPrice: total,
      dailyPrice: total / nights.length,
      available: true,
      // A composição vale o quanto vale sua cotação mais antiga.
      collectedAt: oldest.collectedAt,
      // Uma oferta composta por concorrente/modelo: não confundir com a cotação real de onde veio.
      composta: true,
      base: used.map((r) => `${r.pickupAt.slice(0, 10)} → ${r.returnAt.slice(0, 10)}`),
    });
  }
  return out;
}
