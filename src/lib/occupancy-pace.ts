import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase as typedClient } from "@/integrations/supabase/client";
import { segmentDays } from "@/lib/occupancy";

// pricing_occupancy_pace ainda não está em types.ts (gerado): cliente sem tipos, como em pricing-forecast.ts.
const supabase = typedClient as unknown as SupabaseClient;

/** Uma data e categoria: carros disponíveis e a antecedência (dias entre a criação da reserva e a retirada) de cada diária vendida. */
/**
 * `x` (payload v3+): diárias de reservas hoje canceladas, [antecedência da criação, antecedência do cancelamento | null].
 * O cancelamento é a data da última atualização da reserva (proxy); null quando ela é posterior à retirada (não dá para saber).
 */
export type PaceRow = {
  d: string;
  c: string;
  f: number;
  /** payload v7+: frota do dia incluindo os veículos depois vendidos (capacidade das datas passadas usadas como referência). */
  g?: number;
  a: number[];
  x?: [number, number | null][];
  /** payload v6+: preço pago (US$) de cada diária, na mesma ordem de `a` (0 = reserva sem preço). */
  m?: number[];
  /** payload v4–v5: faturamento final da data e nº de diárias com preço (sem leitura por antecedência). */
  v?: number;
  p?: number;
};
export type PaceParams = {
  n_evento: number;
  n_dow: number;
  n_saz: number;
  estatistica: "media" | "mediana" | "maximo";
};
/** Calendário sazonal de cada data: [sazonalidade, evento móvel | null, posição relativa ao evento | null]. */
export type PaceCal = Record<string, [string, string | null, number | null]>;
export type PacePayload = {
  versao: number;
  gerado_em: string;
  hoje: string;
  de: string;
  ate: string;
  categorias: string[];
  params: PaceParams;
  cal: PaceCal;
  linhas: PaceRow[];
  /** payload v7+: trechos confirmados [índice em `categorias`, retirada, devolução] (minutos desde 1970, horário do HQ sem fuso). */
  t?: [number, number, number][];
};

/** Frota da linha como capacidade de referência histórica: a que existia na época (com os veículos depois vendidos). */
export const histFleet = (r: PaceRow) => r.g ?? r.f;

/** Faixas do gap (pontos percentuais) que separam as cores. Configuráveis na tela. */
export type GapBands = { strong: number; mild: number };
export const DEFAULT_BANDS: GapBands = { strong: 15, mild: 5 };
export type GapLevel = "muito-abaixo" | "abaixo" | "neutro" | "acima" | "muito-acima";

export function gapLevel(gapPp: number, b: GapBands = DEFAULT_BANDS): GapLevel {
  if (gapPp < -b.strong) return "muito-abaixo";
  if (gapPp < -b.mild) return "abaixo";
  if (gapPp <= b.mild) return "neutro";
  if (gapPp <= b.strong) return "acima";
  return "muito-acima";
}

export const EVENT_LABEL: Record<string, string> = {
  carnaval: "Carnaval",
  semana_santa: "Semana Santa",
  corpus_christi: "Corpus Christi",
};
export type BenchLevel = "evento" | "dow" | "saz" | "aniversario";
export const BENCH_LEVEL_LABEL: Record<BenchLevel, string> = {
  evento: "mesmo evento e mesma posição relativa",
  dow: "mesma sazonalidade e dia da semana",
  saz: "mesma sazonalidade (menor precisão: sem separar dia da semana)",
  aniversario: "mesmo dia da semana em períodos anteriores",
};

export function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
const weekday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();

/**
 * Antecedência da data de retirada na data-base: retirada − data-base. Data já encerrada (retirada antes da base)
 * não tem antecedência: é lida em D-0, a ocupação final.
 */
export function leadOf(date: string, base: string) {
  const diff = daysBetween(base, date);
  return { lead: Math.max(0, diff), closed: diff < 0 };
}

/** Diárias da linha vendidas quando faltavam L dias: criadas até T−L (antecedência ≥ L); D-0 = todas. */
export const soldAt = (row: PaceRow, L: number) =>
  L <= 0 ? row.a.length : row.a.reduce((n, x) => n + (x >= L ? 1 : 0), 0);
/**
 * Diárias que estavam ATIVAS (na foto de então) quando faltavam L dias: as confirmadas hoje criadas até T−L, mais as hoje canceladas que
 * já existiam e ainda não tinham sido canceladas. É o equivalente histórico do que a tela vê hoje numa data aberta, que também
 * contém reservas que podem cancelar. Sem `x` (payload antigo), igual a soldAt.
 */
export const activeAt = (row: PaceRow, L: number) =>
  L <= 0 || !row.x
    ? soldAt(row, L)
    : soldAt(row, L) + row.x.reduce((n, [c, k]) => n + (k != null && c >= L && k < L ? 1 : 0), 0);
/** Todas as diárias criadas até T−L, inclusive as depois canceladas (captura bruta). */
export const grossAt = (row: PaceRow, L: number) =>
  soldAt(row, L) + (!row.x ? 0 : row.x.reduce((n, [c]) => n + (c >= L ? 1 : 0), 0));
/** Ocupação (0–1) da linha quando faltavam L dias. */
export const occupancyAt = (row: PaceRow, L: number) => (row.f ? soldAt(row, L) / row.f : 0);

/** Faturamento (US$) e diárias com preço de uma linha na antecedência L (diárias criadas até T−L; sem L ou L ≤ 0, a data fechada). */
function revenueRow(r: PaceRow, L?: number): { v: number; p: number } | null {
  if (r.m) {
    let v = 0;
    let p = 0;
    for (let i = 0; i < r.a.length; i++)
      if ((L ?? 0) <= 0 || r.a[i]! >= L!) {
        const x = r.m[i] ?? 0;
        if (x > 0) {
          v += x;
          p++;
        }
      }
    return { v, p };
  }
  // Payload antigo (v4–v5): só há o faturamento final.
  return r.v != null && r.p && (L ?? 0) <= 0 ? { v: r.v, p: r.p } : null;
}

/**
 * Diária média (faturamento ÷ diárias com preço) e faturamento por veículo (faturamento ÷ frota do dia) das linhas, lidos na
 * antecedência L (a mesma da ocupação mostrada); null sem dado. A frota é a do próprio dia de cada linha.
 */
export function revenueOf(rows: PaceRow[], L?: number) {
  let v = 0;
  let p = 0;
  let f = 0;
  for (const r of rows) {
    const x = revenueRow(r, L);
    if (!x) return { diaria: null as number | null, porVeiculo: null as number | null };
    v += x.v;
    p += x.p;
    f += r.f;
  }
  return { diaria: p ? v / p : null, porVeiculo: f ? v / f : null };
}

/** Índice dos grupos comparáveis: evento (categoria, evento, posição) ou data comum (categoria, sazonalidade[, dia da semana]). */
export type PaceModel = {
  payload: PacePayload;
  groups: Map<string, PaceRow[]>;
  byKey: Map<string, PaceRow>;
};
const kEvento = (c: string, ev: string, rel: number) => `ev|${c}|${ev}|${rel}`;
const kDow = (c: string, s: string, w: number) => `dow|${c}|${s}|${w}`;
const kSaz = (c: string, s: string) => `saz|${c}|${s}`;

/** Referência de "esperada" das telas de precificação: a melhor ocupação já registrada em datas comparáveis (na mesma antecedência). */
export const ESPERADA_ESTATISTICA: PaceParams["estatistica"] = "maximo";

/** `estatistica` sobrescreve a do payload (que vem publicada como média); sem ele vale a do payload. */
export function buildModel(
  payload: PacePayload,
  estatistica?: PaceParams["estatistica"],
): PaceModel {
  if (estatistica) payload = { ...payload, params: { ...payload.params, estatistica } };
  const groups = new Map<string, PaceRow[]>();
  const push = (k: string, r: PaceRow) => {
    const l = groups.get(k);
    if (l) l.push(r);
    else groups.set(k, [r]);
  };
  for (const r of payload.linhas) {
    const cal = payload.cal[r.d];
    if (!cal) continue;
    const [s, ev, rel] = cal;
    if (ev && rel != null) push(kEvento(r.c, ev, rel), r);
    else {
      push(kDow(r.c, s, weekday(r.d)), r);
      push(kSaz(r.c, s), r);
    }
  }
  return { payload, groups, byKey: new Map(payload.linhas.map((r) => [`${r.d}|${r.c}`, r])) };
}

/** Períodos anteriores comparados no "melhor registro": o mesmo dia da semana 1 e 2 anos antes (364 e 728 dias). */
export const PERIODOS_ANTERIORES = [364, 728];

export type Benchmark = { value: number; n: number; level: BenchLevel };

const central = (xs: number[], how: PaceParams["estatistica"]) => {
  // Ocupação não passa de 100%: um dia histórico com mais diárias do que a frota registrada não vira meta acima disso.
  if (how === "maximo") return Math.min(1, Math.max(...xs));
  if (how === "media") return xs.reduce((s, x) => s + x, 0) / xs.length;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/**
 * Benchmark histórico da linha na antecedência L, na data-base `base`:
 *  1. data de evento móvel: mesmo evento e mesma posição relativa (só datas de evento; sem fallback para outro critério);
 *  2. data comum: mesma sazonalidade e dia da semana; 3. mesma sazonalidade (datas de evento ficam de fora).
 * Todos: mesma categoria, ocupação lida na mesma antecedência L, só datas encerradas antes da base (sem futuro) e
 * nunca a própria data. Abaixo do mínimo de amostras, null: não se completa com ocupação final nem com outro evento.
 */
export type BenchSample = { date: string; fleet: number; occ: number; rev?: number | undefined };

/**
 * Datas históricas que definem o benchmark na antecedência L.
 * Modo "maximo" (melhor registro): data comum = o mesmo dia da semana nos períodos anteriores (PERIODOS_ANTERIORES), ao menos um
 * disponível; data de evento móvel = as edições passadas do mesmo evento na mesma posição relativa (ao menos uma).
 * Demais modos (média/mediana): grupos de datas comparáveis por sazonalidade e dia da semana.
 */
export function samplesFor(
  model: PaceModel,
  row: PaceRow,
  L: number,
  base: string,
): { level: BenchLevel; items: BenchSample[] } | null {
  const { params, cal } = model.payload;
  const info = cal[row.d];
  if (!info) return null;
  const [s, ev, rel] = info;
  const isEvent = !!(ev && rel != null);
  // A foto em L só é confiável se a reserva poderia existir no histórico: antes do início da base, as vendas estariam truncadas.
  const truncated = (d: string) => L > 0 && addDays(d, -L) < model.payload.de;
  if (params.estatistica === "maximo" && !isEvent) {
    const items: BenchSample[] = [];
    for (const n of PERIODOS_ANTERIORES) {
      const h = model.byKey.get(`${addDays(row.d, -n)}|${row.c}`);
      if (h && histFleet(h) >= REF_FROTA_MIN * row.f && histFleet(h) > 0 && h.d < base && !truncated(h.d))
        items.push({
          date: h.d,
          fleet: histFleet(h),
          occ: activeAt(h, L) / histFleet(h),
          rev: revenueRow(h) ? revenueRow(h)!.v / histFleet(h) : undefined,
        });
    }
    return items.length ? { level: "aniversario", items } : null;
  }
  // Melhor registro: basta uma edição passada do mesmo evento (algumas categorias só existem desde 2026); média/mediana mantêm n_evento.
  const minEvento = params.estatistica === "maximo" ? 1 : params.n_evento;
  const steps: [string, number, BenchLevel][] = isEvent
    ? [[kEvento(row.c, ev!, rel!), minEvento, "evento"]]
    : [
        [kDow(row.c, s, weekday(row.d)), params.n_dow, "dow"],
        [kSaz(row.c, s), params.n_saz, "saz"],
      ];
  for (const [key, min, level] of steps) {
    const items: BenchSample[] = [];
    for (const h of model.groups.get(key) ?? [])
      if (histFleet(h) >= REF_FROTA_MIN * row.f && histFleet(h) > 0 && h.d < base && h.d !== row.d && !truncated(h.d))
        items.push({
          date: h.d,
          fleet: histFleet(h),
          occ: activeAt(h, L) / histFleet(h),
          rev: revenueRow(h) ? revenueRow(h)!.v / histFleet(h) : undefined,
        });
    if (items.length >= min) return { level, items };
  }
  return null;
}

export function benchmarkFor(
  model: PaceModel,
  row: PaceRow,
  L: number,
  base: string,
): Benchmark | null {
  const smp = samplesFor(model, row, L, base);
  if (!smp) return null;
  // Melhor registro: a ocupação esperada é a do período anterior que teve o MELHOR FATURAMENTO (por veículo), não a maior ocupação.
  // Sem faturamento nos períodos (payload antigo), cai na maior ocupação.
  const best =
    model.payload.params.estatistica === "maximo"
      ? smp.items.filter((i) => i.rev != null).sort((a, b) => b.rev! - a.rev!)[0]
      : undefined;
  return {
    value: best
      ? Math.min(1, best.occ)
      : central(
          smp.items.map((i) => i.occ),
          model.payload.params.estatistica,
        ),
    n: smp.items.length,
    level: smp.level,
  };
}

/**
 * Datas históricas que servem de referência para uma data, na ordem em que o painel as mostra:
 *  - data de evento móvel (Carnaval, Semana Santa, Corpus Christi): a MESMA posição relativa ao evento nas edições passadas
 *    (a mais recente primeiro), pois o mesmo dia do calendário ou da semana não cai no evento;
 *  - data comum: o mesmo dia da semana nos períodos anteriores (PERIODOS_ANTERIORES).
 */
export type RefDates = { evento: string | null; posicao: number | null; datas: string[] };
export function referenceDates(model: PaceModel, date: string, base: string): RefDates {
  const info = model.payload.cal[date];
  const ev = info?.[1] ?? null;
  const rel = info?.[2] ?? null;
  if (ev && rel != null) {
    const datas = Object.entries(model.payload.cal)
      .filter(([d, c]) => c[1] === ev && c[2] === rel && d < date && d < base)
      .map(([d]) => d)
      .sort()
      .reverse();
    return { evento: ev, posicao: rel, datas };
  }
  return { evento: null, posicao: null, datas: PERIODOS_ANTERIORES.map((n) => addDays(date, -n)) };
}

/** Uma data (somando as categorias escolhidas) na antecedência efetiva da data-base. atual/esperada em 0–1; gap em p.p. */
export type DayPace = {
  date: string;
  lead: number;
  closed: boolean;
  capacity: number;
  booked: number | null;
  atual: number | null;
  esperada: number | null;
  gap: number | null;
  n: number;
  level: BenchLevel | null;
  event: string | null;
  eventRel: number | null;
  season: string | null;
  /** Parcela da frota que tem benchmark (0–1) e as categorias sem benchmark, que ficam de fora da comparação. */
  cobertura?: number;
  semBenchmark?: string[];
};

/** Abaixo dessa parcela da frota com benchmark, a data fica sem esperada (não se afirma um esperado que cobre pouco da frota). */
export const COBERTURA_MIN = 0.9;
/** Cobertura mínima de uma data de referência (parcela da frota atual com linha nela): 2024 não tinha duas categorias novas e ainda vale. */
export const REF_COBERTURA_MIN = 0.85;
/** Uma referência com menos que essa parcela da frota atual da categoria não vale (1 carro alugado = 100% e vira meta para 10). */
export const REF_FROTA_MIN = 0.5;

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);


/** Uma data de referência da esperada, com os números que a escolha usa (os mesmos que o painel mostra). */
export type RefItem = {
  date: string;
  /** Ocupação da referência na antecedência L: diárias ativas ÷ frota que existia na época. */
  occ: number | null;
  /** Faturamento por veículo da referência (diárias da antecedência L ÷ frota da época). */
  rev: number | null;
  fleet: number;
  /** Parcela da frota atual que a referência cobre. */
  cobertura: number;
  eligible: boolean;
  motivo: string | null;
  chosen: boolean;
  cov: PaceRow[];
  capCov: number;
};

/**
 * Datas de referência do dia no modo "melhor registro", escolhidas pelo DIA TODO: cada data soma as categorias das linhas, com a frota
 * que existia na época (com os veículos depois vendidos) e as diárias vendidas na mesma antecedência L. Vale a de maior faturamento por
 * veículo (sem faturamento, a de maior ocupação) entre as elegíveis: cobrem ao menos REF_COBERTURA_MIN da frota atual e a frota da
 * época de cada categoria é ao menos REF_FROTA_MIN da atual. Categorias sem linha na referência ficam de fora dos dois lados (`cov`).
 */
export function referenceItems(model: PaceModel, rows: PaceRow[], date: string, base: string, L: number): RefItem[] {
  const capacity = sum(rows.map((r) => r.f));
  const truncated = (d: string) => L > 0 && addDays(d, -L) < model.payload.de;
  const items: RefItem[] = [];
  for (const d of referenceDates(model, date, base).datas) {
    if (d >= base || d === date) continue;
    const base0 = { date: d, occ: null, rev: null, fleet: 0, cobertura: 0, eligible: false, chosen: false, cov: [] as PaceRow[], capCov: 0 };
    if (truncated(d)) {
      items.push({ ...base0, motivo: "sem registro de vendas nessa antecedência" });
      continue;
    }
    const all = rows
      .map((r) => ({ r, h: model.byKey.get(`${d}|${r.c}`) }))
      .filter((x): x is { r: PaceRow; h: PaceRow } => !!x.h && histFleet(x.h) > 0);
    if (!all.length) {
      items.push({ ...base0, motivo: "sem dados" });
      continue;
    }
    const ok = all.filter((x) => histFleet(x.h) >= REF_FROTA_MIN * x.r.f);
    const pairs = ok.length ? ok : all;
    const capCov = sum(ok.map((x) => x.r.f));
    const cobertura = capacity ? capCov / capacity : 0;
    const fh = sum(pairs.map((x) => histFleet(x.h)));
    const revs = pairs.map((x) => revenueRow(x.h, L));
    const rev = revs.every((x) => x) ? sum(revs.map((x) => x!.v)) / fh : null;
    const eligible = ok.length > 0 && cobertura >= REF_COBERTURA_MIN;
    items.push({
      date: d,
      occ: sum(pairs.map((x) => activeAt(x.h, L))) / fh,
      rev,
      fleet: fh,
      cobertura,
      eligible,
      motivo: !ok.length
        ? "frota da época menor que a metade da atual"
        : cobertura < REF_COBERTURA_MIN
          ? `cobre só ${Math.round(cobertura * 100)}% da frota atual`
          : null,
      chosen: false,
      cov: ok.map((x) => x.r),
      capCov,
    });
  }
  let best: RefItem | null = null;
  for (const it of items) {
    if (!it.eligible) continue;
    if (!best || (it.rev != null && best.rev != null ? it.rev > best.rev : it.rev != null ? true : best.rev != null ? false : it.occ! > best.occ!)) best = it;
  }
  if (best) best.chosen = true;
  return items;
}

function wholeDayBenchmark(model: PaceModel, rows: PaceRow[], date: string, base: string, L: number) {
  if (!rows.length) return null;
  const info = model.payload.cal[date];
  const isEvent = !!(info?.[1] && info[2] != null);
  const items = referenceItems(model, rows, date, base, L);
  const best = items.find((i) => i.chosen);
  if (!best) return null;
  return {
    value: Math.min(1, best.occ!),
    cov: best.cov,
    capCov: best.capCov,
    n: items.filter((i) => i.eligible).length,
    level: (isEvent ? "evento" : "aniversario") as BenchLevel,
  };
}

/**
 * Atual e esperada vêm da mesma data de retirada, das mesmas categorias e da mesma antecedência (a da data-base, ou `L`
 * na curva de pickup). Só há ocupação atual se a foto em L já existe na data-base (L ≥ antecedência efetiva).
 * Esperada = benchmark ponderado pela frota; sem benchmark em alguma categoria, fica null (nada é completado).
 */
export function dayPace(
  model: PaceModel,
  rows: PaceRow[],
  date: string,
  base: string,
  L?: number,
): DayPace {
  const { lead, closed } = leadOf(date, base);
  const at = L ?? lead;
  const info = model.payload.cal[date];
  const capacity = sum(rows.map((r) => r.f));
  const booked = rows.length > 0 && at >= lead ? sum(rows.map((r) => soldAt(r, at))) : null;
  if (model.payload.params.estatistica === "maximo") {
    const w = wholeDayBenchmark(model, rows, date, base, at);
    const atualB = booked != null && capacity ? booked / capacity : null;
    const atualCobB = w && at >= lead ? sum(w.cov.map((r) => soldAt(r, at))) / w.capCov : null;
    return {
      date,
      lead,
      closed,
      capacity,
      booked,
      atual: atualB,
      esperada: w ? w.value : null,
      gap: atualCobB != null && w ? (atualCobB - w.value) * 100 : null,
      n: w ? w.n : 0,
      level: w ? w.level : null,
      event: info?.[1] ?? null,
      eventRel: info?.[2] ?? null,
      season: info?.[0] ?? null,
      cobertura: w ? w.capCov / capacity : 0,
      semBenchmark: rows.filter((r) => !w || !w.cov.includes(r)).map((r) => r.c),
    };
  }
  const bench = rows.map((r) => benchmarkFor(model, r, at, base));
  // Categoria sem histórico (ex.: criada há menos de 1 ano) não anula a data: sai da comparação, nos dois lados, e a cobertura da
  // frota fica registrada. Com menos de COBERTURA_MIN da frota coberta, não há esperada.
  const cov = rows.map((r, i) => ({ r, b: bench[i] })).filter((x) => x.b != null);
  const capCov = sum(cov.map((x) => x.r.f));
  const cobertura = capacity ? capCov / capacity : 0;
  const complete = rows.length > 0 && capCov > 0 && cobertura >= COBERTURA_MIN;
  const atual = booked != null && capacity ? booked / capacity : null;
  const atualCob = complete && at >= lead ? sum(cov.map((x) => soldAt(x.r, at))) / capCov : null;
  const esperada = complete ? sum(cov.map((x) => x.b!.value * x.r.f)) / capCov : null;
  return {
    date,
    lead,
    closed,
    capacity,
    booked,
    atual,
    esperada,
    gap: atualCob != null && esperada != null ? (atualCob - esperada) * 100 : null,
    n: complete ? Math.min(...cov.map((x) => x.b!.n)) : 0,
    level: complete ? cov[0]!.b!.level : null,
    event: info?.[1] ?? null,
    eventRel: info?.[2] ?? null,
    season: info?.[0] ?? null,
    cobertura,
    semBenchmark: rows.filter((_, i) => bench[i] == null).map((r) => r.c),
  };
}

export function rowsByDate(payload: PacePayload, categoria: string | null): Map<string, PaceRow[]> {
  const m = new Map<string, PaceRow[]>();
  for (const r of payload.linhas) {
    if (categoria && r.c !== categoria) continue;
    const list = m.get(r.d);
    if (list) list.push(r);
    else m.set(r.d, [r]);
  }
  return m;
}

export function dailySeries(
  model: PaceModel,
  byDate: Map<string, PaceRow[]>,
  from: string,
  to: string,
  base: string,
): DayPace[] {
  const out: DayPace[] = [];
  for (let d = from; d <= to; d = addDays(d, 1))
    out.push(dayPace(model, byDate.get(d) ?? [], d, base));
  return out;
}

export type PaceSummary = {
  atual: number | null;
  esperada: number | null;
  gap: number | null;
  below: number;
  above: number;
  compared: number;
};

/** KPIs do período: médias só das datas com atual E esperada, para que atual, esperada, gap e contagens descrevam as mesmas datas do calendário. */
export function summarize(days: DayPace[], bands: GapBands = DEFAULT_BANDS): PaceSummary {
  const ok = days.filter((d) => d.atual != null && d.esperada != null);
  if (!ok.length)
    return { atual: null, esperada: null, gap: null, below: 0, above: 0, compared: 0 };
  const atual = sum(ok.map((d) => d.atual!)) / ok.length;
  const esperada = sum(ok.map((d) => d.esperada!)) / ok.length;
  const lv = ok.map((d) => gapLevel(d.gap!, bands));
  return {
    atual,
    esperada,
    gap: (atual - esperada) * 100,
    below: lv.filter((l) => l === "muito-abaixo" || l === "abaixo").length,
    above: lv.filter((l) => l === "acima" || l === "muito-acima").length,
    compared: ok.length,
  };
}

/** Antecedências do eixo X da curva de pickup (a antecedência efetiva da data entra sempre). */
export const CURVE_LEADS = [90, 60, 45, 30, 21, 15, 7, 3, 1, 0];

/**
 * Curva de pickup da data: benchmark em cada antecedência e ocupação observada só onde a foto já existe
 * (antecedência ≥ a efetiva). Antecedências ainda não alcançadas ficam sem dado, sem interpolar nem prever.
 */
export function pickupCurve(model: PaceModel, rows: PaceRow[], date: string, base: string) {
  const { lead } = leadOf(date, base);
  const leads = [...new Set([...CURVE_LEADS, lead])].sort((a, b) => b - a);
  return leads.map((L) => ({ ...dayPace(model, rows, date, base, L), L, effective: L === lead }));
}

export function usePace() {
  return useQuery({
    queryKey: ["pricing-occupancy-pace"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pricing_occupancy_pace")
        .select("generated_at,payload")
        .order("generated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as { generated_at: string; payload: PacePayload } | null;
    },
  });
}

/**
 * Ocupação de um intervalo [from, to] (datas ISO, inclusive) igual à Utilização do HQ filtrada nesse intervalo: dias de cada trecho
 * na janela inteira (max(1, ceil((horas − 5 h) / 24))) ÷ frota somada dos dias da janela. null sem trechos publicados (payload < v7).
 */
export function windowOccupancy(payload: PacePayload, categoria: string | null, from: string, to: string) {
  if (!payload.t) return null;
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${addDays(to, 1)}T00:00:00Z`);
  const only = categoria == null ? null : payload.categorias.indexOf(categoria);
  let carDays = 0;
  for (const [c, p, r] of payload.t) {
    if (only != null && c !== only) continue;
    carDays += segmentDays(new Date(p * 60000).toISOString(), new Date(r * 60000).toISOString(), start, end);
  }
  let capacity = 0;
  for (const l of payload.linhas) if (l.d >= from && l.d <= to && (categoria == null || l.c === categoria)) capacity += l.f;
  return capacity ? { rate: carDays / capacity, carDays, capacity } : null;
}
