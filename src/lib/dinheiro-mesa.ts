/**
 * "Dinheiro deixado na mesa": datas passadas que lotaram cedo, com captura muito acima da curva normal, e quanto poderia ter rendido
 * com preço maior. Usa o mesmo payload da Gestão de Ocupação (antecedência e preço de cada diária) e a mesma curva de captura da
 * Prioridades (categoria + mês, com fallback). Estimativas: com preço maior, parte das reservas poderia não acontecer.
 */
import {
  capturaEm,
  curvaCategoria,
  type Curva,
  type JanelaConfig,
  JANELA_PADRAO,
} from "./captura-categoria";
import { histFleet, soldAt, type PaceCal, type PaceRow } from "./occupancy-pace";

export type MesaConfig = {
  /** Ocupação que conta como "lotou". */
  ocupLotou: number;
  /** Lotou antes desta antecedência = cedo. */
  leadCedo: number;
  /** Captura acima da curva normal (p.p.) em alguma antecedência. */
  ppAcima: number;
  /** Datas parecidas que "fecharam bem": ocupação final mínima. */
  fechouBem: number;
  /** Janela das "últimas vendas" antes de lotar (dias). */
  diasUltimas: number;
  /** Primeira data analisada. */
  desde: string;
};
export const MESA_PADRAO: MesaConfig = {
  ocupLotou: 0.95,
  leadCedo: 14,
  ppAcima: 20,
  fechouBem: 0.85,
  diasUltimas: 14,
  desde: "2024-01-01",
};

/** Antecedências em que se compara a captura com a curva normal. */
export const LEADS_COMPARA = [180, 150, 120, 90, 75, 60, 45, 30, 21, 15, 7];

/** Maior antecedência em que a data atingiu `limiar` da frota; null se não atingiu. 0 = só no próprio dia. */
export function antecedenciaLotou(row: PaceRow, limiar = MESA_PADRAO.ocupLotou): number | null {
  const frota = histFleet(row);
  if (!frota) return null;
  const k = Math.ceil(limiar * frota - 1e-9);
  if (k <= 0 || row.a.length < k) return null;
  const desc = [...row.a].sort((x, y) => y - x);
  return Math.max(0, desc[k - 1]!);
}

/** Captura da própria data em D-L: diárias vendidas até D-L ÷ diárias finais. */
export const capturaDaData = (row: PaceRow, L: number) => {
  const fin = soldAt(row, 0);
  return fin ? soldAt(row, L) / fin : 0;
};

/** Diária média (US$) das diárias com preço criadas com antecedência em [de, ate] (ate inclusivo; ate = null sem limite). */
export function diariaEntre(
  row: PaceRow,
  de: number,
  ate: number | null,
): { media: number | null; n: number } {
  if (!row.m) return { media: null, n: 0 };
  let v = 0;
  let n = 0;
  for (let i = 0; i < row.a.length; i++) {
    const L = row.a[i]!;
    const x = row.m[i] ?? 0;
    if (x > 0 && L >= de && (ate == null || L <= ate)) {
      v += x;
      n++;
    }
  }
  return { media: n ? v / n : null, n };
}

export type Comparativo = { atual: number; normal: number };

export type DataLotou = {
  date: string;
  category: string;
  frota: number;
  /** Antecedência em que lotou. */
  lotouEm: number;
  /** Maior diferença de captura contra a curva normal (p.p.) e onde aconteceu. */
  ppMax: number;
  ppEm: number;
  vendido: { 90: Comparativo; 60: Comparativo; 30: Comparativo };
  /** Diária média final paga. */
  diariaPaga: number | null;
  curva: Curva;
};

/**
 * "Lotou cedo": atingiu `ocupLotou` antes de D-`leadCedo` E, em alguma antecedência, a captura ficou `ppAcima` p.p. acima da curva
 * normal. Vendido em D-90/60/30 em ocupação da frota (atual) contra a ocupação normal (curva × ocupação final da data).
 */
export function detectarLotouCedo(
  row: PaceRow,
  curva: Curva,
  cfg: MesaConfig = MESA_PADRAO,
): DataLotou | null {
  const L = antecedenciaLotou(row, cfg.ocupLotou);
  if (L == null || L < cfg.leadCedo) return null;
  let ppMax = -Infinity;
  let ppEm = 0;
  for (const l of LEADS_COMPARA) {
    const pp = (capturaDaData(row, l) - capturaEm(curva, l)) * 100;
    if (pp > ppMax) {
      ppMax = pp;
      ppEm = l;
    }
  }
  if (ppMax < cfg.ppAcima) return null;
  const frota = histFleet(row);
  const fin = soldAt(row, 0);
  const comp = (l: number): Comparativo => ({
    atual: frota ? soldAt(row, l) / frota : 0,
    normal: frota ? (capturaEm(curva, l) * fin) / frota : 0,
  });
  return {
    date: row.d,
    category: row.c,
    frota,
    lotouEm: L,
    ppMax,
    ppEm,
    vendido: { 90: comp(90), 60: comp(60), 30: comp(30) },
    diariaPaga: diariaEntre(row, 0, null).media,
    curva,
  };
}

/** Diárias vendidas acima da curva normal até a antecedência em que lotou, e a diária paga por elas. */
export function vendidasCedo(
  row: PaceRow,
  curva: Curva,
  lotouEm: number,
): { diarias: number; diariaPaga: number | null } {
  const fin = soldAt(row, 0);
  const excesso = Math.max(0, soldAt(row, lotouEm) - capturaEm(curva, lotouEm) * fin);
  return { diarias: excesso, diariaPaga: diariaEntre(row, lotouEm, null).media };
}

/** Diária média das reservas criadas nos `dias` dias antes de lotar. */
export const ultimasVendas = (row: PaceRow, lotouEm: number, dias = MESA_PADRAO.diasUltimas) =>
  diariaEntre(row, lotouEm, lotouEm + dias - 1).media;

/** Datas encerradas da mesma categoria e mês que fecharam bem sem lotar cedo (datas de evento fora). */
export function datasParecidas(
  rows: PaceRow[],
  cal: PaceCal,
  category: string,
  mes: number,
  hoje: string,
  cfg: MesaConfig = MESA_PADRAO,
  excluir?: string,
): PaceRow[] {
  return rows.filter((r) => {
    if (r.c !== category || r.d >= hoje || r.d === excluir) return false;
    if (Number(r.d.slice(5, 7)) !== mes || cal[r.d]?.[1]) return false;
    const frota = histFleet(r);
    if (!frota || soldAt(r, 0) / frota < cfg.fechouBem) return false;
    const L = antecedenciaLotou(r, cfg.ocupLotou);
    return L == null || L < cfg.leadCedo;
  });
}

/** Diária média final (ponderada pelas diárias) de um conjunto de datas, opcionalmente só das criadas em [de, ate] de antecedência. */
export function diariaMediaDatas(
  rows: PaceRow[],
  de = 0,
  ate: number | null = null,
): number | null {
  let v = 0;
  let n = 0;
  for (const r of rows) {
    const x = diariaEntre(r, de, ate);
    if (x.media != null) {
      v += x.media * x.n;
      n += x.n;
    }
  }
  return n ? v / n : null;
}

export type Referencias = {
  ultimas: number | null;
  parecidas: number | null;
  mercado: number | null;
};
export type PrecoPossivel = {
  conservador: number;
  otimista: number;
  usadas: (keyof Referencias)[];
};

/** Conservador = menor referência acima da diária paga; otimista = a maior. Nenhuma acima = sem perda (null). */
export function precoPossivel(paga: number | null, refs: Referencias): PrecoPossivel | null {
  if (paga == null) return null;
  const acima = (Object.keys(refs) as (keyof Referencias)[])
    .filter((k) => refs[k] != null && refs[k]! > paga)
    .map((k) => ({ k, v: refs[k]! }));
  if (!acima.length) return null;
  return {
    conservador: Math.min(...acima.map((x) => x.v)),
    otimista: Math.max(...acima.map((x) => x.v)),
    usadas: acima.map((x) => x.k),
  };
}

export type Faixa = { min: number; max: number };
/** Perda em faixa: diárias vendidas cedo × (preço possível − diária paga). */
export function perdaEstimada(
  diarias: number,
  paga: number | null,
  p: PrecoPossivel | null,
): Faixa | null {
  if (!p || paga == null || diarias <= 0) return null;
  return { min: diarias * (p.conservador - paga), max: diarias * (p.otimista - paga) };
}

/* ───────────────────────── análise completa ───────────────────────── */

export type Perda = DataLotou & {
  vendidasCedo: number;
  diariaPagaCedo: number | null;
  refs: Referencias;
  possivel: PrecoPossivel | null;
  perda: Faixa | null;
  /** Prêmio de fim de venda: diária dos últimos 14 dias antes de esgotar ÷ diária das reservas anteriores − 1. */
  premio: number | null;
};

/** Prêmio de fim de venda de uma data (fração): últimas `dias` dias antes de esgotar contra as reservas feitas antes delas. */
export function premioFimVenda(
  row: PaceRow,
  lotouEm: number,
  dias = MESA_PADRAO.diasUltimas,
): number | null {
  const ult = diariaEntre(row, lotouEm, lotouEm + dias - 1).media;
  const ant = diariaEntre(row, lotouEm + dias, null).media;
  return ult != null && ant != null && ant > 0 ? ult / ant - 1 : null;
}

export function analisarMesa(
  payload: { linhas: PaceRow[]; cal: PaceCal; hoje: string; de: string },
  cfg: MesaConfig = MESA_PADRAO,
  janela: JanelaConfig = JANELA_PADRAO,
): Perda[] {
  const curvas = new Map<string, Curva | null>();
  const parecidasCache = new Map<string, PaceRow[]>();
  const out: Perda[] = [];
  for (const r of payload.linhas) {
    if (r.d < cfg.desde || r.d >= payload.hoje) continue;
    const mes = Number(r.d.slice(5, 7));
    const saz = payload.cal[r.d]?.[0] ?? null;
    const ck = `${r.c}|${mes}|${saz}`;
    let curva = curvas.get(ck);
    if (curva === undefined) {
      curva = curvaCategoria(
        payload.linhas,
        payload.hoje,
        payload.de,
        payload.cal,
        r.c,
        mes,
        saz,
        janela,
      );
      curvas.set(ck, curva);
    }
    if (!curva) continue;
    const det = detectarLotouCedo(r, curva, cfg);
    if (!det) continue;
    const vc = vendidasCedo(r, curva, det.lotouEm);
    const pk = `${r.c}|${mes}`;
    let par = parecidasCache.get(pk);
    if (!par) {
      par = datasParecidas(payload.linhas, payload.cal, r.c, mes, payload.hoje, cfg);
      parecidasCache.set(pk, par);
    }
    const refs: Referencias = {
      ultimas: ultimasVendas(r, det.lotouEm, cfg.diasUltimas),
      parecidas: diariaMediaDatas(par.filter((p) => p.d !== r.d)),
      mercado: null, // sem cotações de concorrentes para datas passadas (coleta começou em nov/2026)
    };
    const possivel = precoPossivel(vc.diariaPaga, refs);
    out.push({
      ...det,
      vendidasCedo: vc.diarias,
      diariaPagaCedo: vc.diariaPaga,
      refs,
      possivel,
      perda: perdaEstimada(vc.diarias, vc.diariaPaga, possivel),
      premio: premioFimVenda(r, det.lotouEm, cfg.diasUltimas),
    });
  }
  return out.sort((a, b) => (b.perda?.max ?? 0) - (a.perda?.max ?? 0));
}

/* ───────────────────────── preço mínimo por antecedência ───────────────────────── */

export const FAIXAS_LEAD = [
  { key: "61+", label: "acima de D-60", de: 61, ate: null },
  { key: "15-60", label: "D-60 a D-15", de: 15, ate: 60 },
  { key: "0-14", label: "D-14 a D-0", de: 0, ate: 14 },
] as const;
export type FaixaLeadKey = (typeof FAIXAS_LEAD)[number]["key"];

export const faixaLeadDe = (lead: number) =>
  FAIXAS_LEAD.find((f) => lead >= f.de && (f.ate == null || lead <= f.ate))!;

export type MinimoLinha = {
  category: string;
  mes: number;
  /** Datas que lotaram cedo e datas parecidas usadas. */
  lotaram: number;
  parecidas: number;
  minimo: Record<FaixaLeadKey, number | null>;
};

/** Para cada categoria × mês com histórico de lotar cedo: diária que as datas parecidas praticavam em cada faixa de antecedência. */
export function precoMinimo(
  perdas: Pick<Perda, "category" | "date">[],
  payload: { linhas: PaceRow[]; cal: PaceCal; hoje: string },
  cfg: MesaConfig = MESA_PADRAO,
): MinimoLinha[] {
  const grupos = new Map<string, { category: string; mes: number; n: number }>();
  for (const p of perdas) {
    const mes = Number(p.date.slice(5, 7));
    const k = `${p.category}|${mes}`;
    const g = grupos.get(k) ?? { category: p.category, mes, n: 0 };
    g.n++;
    grupos.set(k, g);
  }
  const out: MinimoLinha[] = [];
  for (const g of grupos.values()) {
    const par = datasParecidas(payload.linhas, payload.cal, g.category, g.mes, payload.hoje, cfg);
    const minimo = Object.fromEntries(
      FAIXAS_LEAD.map((f) => [f.key, diariaMediaDatas(par, f.de, f.ate)]),
    ) as Record<FaixaLeadKey, number | null>;
    out.push({ category: g.category, mes: g.mes, lotaram: g.n, parecidas: par.length, minimo });
  }
  return out.sort((a, b) =>
    a.category < b.category ? -1 : a.category > b.category ? 1 : a.mes - b.mes,
  );
}

/** Aviso da Prioridades: tarifa abaixo do mínimo histórico da faixa de antecedência numa categoria × mês que lotou cedo. */
export function avisoMinimo(
  tabela: MinimoLinha[],
  category: string,
  date: string,
  lead: number,
  tarifa: number | null,
): { minimo: number; texto: string } | null {
  if (tarifa == null) return null;
  const linha = tabela.find((t) => t.category === category && t.mes === Number(date.slice(5, 7)));
  if (!linha) return null;
  const f = faixaLeadDe(lead);
  const min = linha.minimo[f.key];
  if (min == null || tarifa >= Math.round(min)) return null;
  return {
    minimo: min,
    texto: `abaixo do mínimo histórico para ${f.label} (US$ ${Math.round(min)}): em anos anteriores esta época esgotou cedo`,
  };
}

/* ───────────────────────── resumo ───────────────────────── */

export type ResumoMesa = {
  total: Faixa;
  datas: number;
  comPerda: number;
  porCategoria: { category: string; max: number; min: number; datas: number }[];
  porMes: { mes: number; max: number; min: number; datas: number }[];
};

export function resumoMesa(perdas: Perda[]): ResumoMesa {
  const total = { min: 0, max: 0 };
  const cat = new Map<string, { min: number; max: number; datas: number }>();
  const mes = new Map<number, { min: number; max: number; datas: number }>();
  let comPerda = 0;
  for (const p of perdas) {
    const m = Number(p.date.slice(5, 7));
    const c = cat.get(p.category) ?? { min: 0, max: 0, datas: 0 };
    const k = mes.get(m) ?? { min: 0, max: 0, datas: 0 };
    c.datas++;
    k.datas++;
    if (p.perda) {
      comPerda++;
      total.min += p.perda.min;
      total.max += p.perda.max;
      c.min += p.perda.min;
      c.max += p.perda.max;
      k.min += p.perda.min;
      k.max += p.perda.max;
    }
    cat.set(p.category, c);
    mes.set(m, k);
  }
  return {
    total,
    datas: perdas.length,
    comPerda,
    porCategoria: [...cat]
      .map(([category, v]) => ({ category, ...v }))
      .sort((a, b) => b.max - a.max),
    porMes: [...mes].map(([m, v]) => ({ mes: m, ...v })).sort((a, b) => b.max - a.max),
  };
}

/** Mapa mês × categoria: perda estimada (otimista e conservadora) de cada célula. */
export function mapaMesCategoria(perdas: Perda[]): Map<string, Faixa & { datas: number }> {
  const m = new Map<string, Faixa & { datas: number }>();
  for (const p of perdas) {
    const k = `${p.date.slice(0, 7)}|${p.category}`;
    const c = m.get(k) ?? { min: 0, max: 0, datas: 0 };
    c.datas++;
    if (p.perda) {
      c.min += p.perda.min;
      c.max += p.perda.max;
    }
    m.set(k, c);
  }
  return m;
}

/** Curva de vendas da data contra a normal, com a diária por faixa de antecedência (gráfico do detalhe). */
export function curvaVendas(row: PaceRow, curva: Curva) {
  const fin = soldAt(row, 0);
  const frota = histFleet(row);
  const leads = [180, 150, 120, 90, 75, 60, 45, 30, 21, 15, 7, 0];
  return {
    pontos: leads.map((L) => ({
      L,
      label: `D-${L}`,
      atual: frota ? Math.round((soldAt(row, L) / frota) * 1000) / 10 : null,
      normal: frota ? Math.round(((capturaEm(curva, L) * fin) / frota) * 1000) / 10 : null,
    })),
    diarias: FAIXAS_LEAD.map((f) => ({ ...f, ...diariaEntre(row, f.de, f.ate) })),
  };
}

/* ───────────────────────── padrões que se repetem ───────────────────────── */

const mediana = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Agrupa meses vizinhos (1–12), com a virada dez → jan: [1, 2, 5, 12] → [[12, 1, 2], [5]]. */
export function agruparMesesVizinhos(meses: number[]): number[][] {
  const set = new Set(meses);
  if (set.size === 12) return [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]];
  const prox = (m: number) => (m % 12) + 1;
  const ant = (m: number) => ((m + 10) % 12) + 1;
  const out: number[][] = [];
  const visto = new Set<number>();
  for (const m of [...set].sort((a, b) => a - b)) {
    if (visto.has(m)) continue;
    let ini = m;
    while (set.has(ant(ini)) && ant(ini) !== m) ini = ant(ini);
    const g: number[] = [];
    for (let x = ini; set.has(x) && !visto.has(x); x = prox(x)) {
      g.push(x);
      visto.add(x);
    }
    out.push(g);
  }
  return out;
}

const MESES_CURTOS = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];
export const rotuloMeses = (g: number[]) =>
  g.length === 1
    ? MESES_CURTOS[g[0]! - 1]!
    : `${MESES_CURTOS[g[0]! - 1]}–${MESES_CURTOS[g[g.length - 1]! - 1]}`;

export type Padrao = {
  key: string;
  category: string;
  meses: number[];
  anos: number[];
  datas: number;
  /** Medianas: antecedência em que esgota, diária paga e preço possível conservador. */
  esgotaEm: number | null;
  paga: number | null;
  possivel: number | null;
  perda: Faixa;
  itens: Perda[];
};

/** Categoria × mês que lotou cedo em `minAnos` anos ou mais, com meses vizinhos agrupados no mesmo padrão. */
export function padroesRecorrentes(perdas: Perda[], minAnos = 2): Padrao[] {
  const porCatMes = new Map<string, Perda[]>();
  for (const p of perdas) {
    const k = `${p.category}|${Number(p.date.slice(5, 7))}`;
    porCatMes.set(k, [...(porCatMes.get(k) ?? []), p]);
  }
  const recorrentes = new Map<string, number[]>();
  for (const [k, ps] of porCatMes) {
    if (new Set(ps.map((p) => p.date.slice(0, 4))).size < minAnos) continue;
    const [cat, mes] = k.split("|");
    recorrentes.set(cat!, [...(recorrentes.get(cat!) ?? []), Number(mes)]);
  }
  const out: Padrao[] = [];
  for (const [category, meses] of recorrentes)
    for (const g of agruparMesesVizinhos(meses)) {
      const itens = g.flatMap((m) => porCatMes.get(`${category}|${m}`) ?? []);
      const perda = itens.reduce(
        (a, p) => ({ min: a.min + (p.perda?.min ?? 0), max: a.max + (p.perda?.max ?? 0) }),
        { min: 0, max: 0 },
      );
      out.push({
        key: `${category}|${g.join("-")}`,
        category,
        meses: g,
        anos: [...new Set(itens.map((p) => Number(p.date.slice(0, 4))))].sort(),
        datas: itens.length,
        esgotaEm: mediana(itens.map((p) => p.lotouEm)),
        paga: mediana(itens.map((p) => p.diariaPaga).filter((x): x is number => x != null)),
        possivel: mediana(
          itens.map((p) => p.possivel?.conservador).filter((x): x is number => x != null),
        ),
        perda,
        itens,
      });
    }
  return out;
}

const diasEntre = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const fimDoMes = (ano: number, mes: number) =>
  new Date(Date.UTC(ano, mes, 0)).toISOString().slice(0, 10);

export type Ocorrencia = {
  de: string;
  ate: string;
  /** Dias até a primeira data do padrão. */
  dias: number;
  /** "agora": hoje está nos meses do padrão (e as datas a partir de hoje estão entre D-120 e D-0); "janela": a primeira data já
   * está em até D-120; "longe": ainda não. */
  estado: "agora" | "janela" | "longe";
  /** Dias até a primeira data entrar em D-`horizonte` (0 se já entrou). */
  diasAteJanela: number;
  chegando: boolean;
};

/** Próxima ocorrência do padrão: do primeiro dia do bloco de meses (ou hoje, se já estamos nele) ao último dia do último mês. */
export function proximaOcorrencia(meses: number[], hoje: string, horizonte = 120): Ocorrencia {
  const ano = Number(hoje.slice(0, 4));
  const mesHoje = Number(hoje.slice(5, 7));
  const primeiro = meses[0]!;
  const ultimo = meses[meses.length - 1]!;
  if (meses.includes(mesHoje)) {
    const restantes = meses.slice(meses.indexOf(mesHoje));
    const viraAno = restantes.some((m, i) => i > 0 && m < restantes[i - 1]!);
    const ate = fimDoMes(viraAno ? ano + 1 : ano, ultimo);
    // Hoje (D-0) até D-horizonte: sempre há data do padrão nessa faixa enquanto o bloco não terminou.
    return { de: hoje, ate, dias: 0, estado: "agora", diasAteJanela: 0, chegando: true };
  }
  const anoIni = primeiro > mesHoje ? ano : ano + 1;
  const de = `${anoIni}-${String(primeiro).padStart(2, "0")}-01`;
  const ate = fimDoMes(ultimo < primeiro ? anoIni + 1 : anoIni, ultimo);
  const dias = diasEntre(hoje, de);
  const diasAteJanela = Math.max(0, dias - horizonte);
  const estado = dias <= horizonte ? "janela" : "longe";
  return { de, ate, dias, estado, diasAteJanela, chegando: estado === "janela" };
}

/** Separa os padrões com sinal de preço maior (mediana do possível ≥ cobrado × (1 + ganhoMinPct)) dos demais. */
export function separarPorGanho<T extends Pick<Padrao, "paga" | "possivel">>(
  ps: T[],
  ganhoMinPct = 5,
): { comSinal: T[]; semSinal: T[] } {
  const ok = (p: T) =>
    p.paga != null && p.possivel != null && p.possivel >= p.paga * (1 + ganhoMinPct / 100) - 1e-9;
  return { comSinal: ps.filter(ok), semSinal: ps.filter((p) => !ok(p)) };
}

/** Tarifa atual (mediana) das próximas datas de retirada daquele mês e a antecedência da data mediana. */
export function tarifaProximasDoMes(
  tarifas: { date: string; category: string; rate: number }[],
  category: string,
  mes: number,
  hoje: string,
): { valor: number; lead: number } | null {
  const xs = tarifas
    .filter((t) => t.category === category && t.date >= hoje && Number(t.date.slice(5, 7)) === mes)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!xs.length) return null;
  // Só a próxima ocorrência do mês (o mesmo ano da primeira data encontrada).
  const ano = xs[0]!.date.slice(0, 4);
  const doAno = xs.filter((t) => t.date.startsWith(ano));
  const meio = doAno[Math.floor(doAno.length / 2)]!;
  return { valor: mediana(doAno.map((t) => t.rate))!, lead: diasEntre(hoje, meio.date) };
}

/** Ordem dos cartões: chegando primeiro (mais perto antes), depois maior perda. */
export function ordenarPadroes(
  ps: Padrao[],
  hoje: string,
  horizonte = 120,
): (Padrao & { prox: Ocorrencia })[] {
  return ps
    .map((p) => ({ ...p, prox: proximaOcorrencia(p.meses, hoje, horizonte) }))
    .sort((a, b) =>
      a.prox.chegando !== b.prox.chegando
        ? a.prox.chegando
          ? -1
          : 1
        : a.prox.chegando
          ? a.prox.dias - b.prox.dias || b.perda.max - a.perda.max
          : b.perda.max - a.perda.max,
    );
}

export type CelulaAno = { anos: number[]; datas: number; min: number; max: number };
/** Mapa do ano: categoria × mês (todos os anos juntos). */
export function mapaAno(perdas: Perda[]): Map<string, CelulaAno> {
  const m = new Map<string, CelulaAno>();
  for (const p of perdas) {
    const k = `${p.category}|${Number(p.date.slice(5, 7))}`;
    const c = m.get(k) ?? { anos: [], datas: 0, min: 0, max: 0 };
    const ano = Number(p.date.slice(0, 4));
    if (!c.anos.includes(ano)) c.anos = [...c.anos, ano].sort();
    c.datas++;
    c.min += p.perda?.min ?? 0;
    c.max += p.perda?.max ?? 0;
    m.set(k, c);
  }
  return m;
}

/** Cor da célula pela recorrência (1, 2, 3+ anos). */
export const corRecorrencia = (anos: number) =>
  anos >= 3
    ? "bg-red-600/70 text-white"
    : anos === 2
      ? "bg-red-500/40"
      : anos === 1
        ? "bg-red-500/15"
        : "";

/* ───────────────────────── lição do passado × situação atual ───────────────────────── */

export type Licao = {
  category: string;
  mes: number;
  anos: number[];
  datas: number;
  /** Medianas: maior adiantamento (p.p.) e onde aconteceu; antecedência em que esgotou; prêmio de fim de venda (fração). */
  adiantamentoPp: number | null;
  adiantamentoEm: number | null;
  esgotaEm: number | null;
  premio: number | null;
  perda: Faixa;
  /** Medianas absolutas (só para tooltip). */
  paga: number | null;
  ultimas: number | null;
  itens: Perda[];
};

/** Lição por categoria × mês, juntando os anos. */
export function licoes(perdas: Perda[]): Licao[] {
  const g = new Map<string, Perda[]>();
  for (const p of perdas) {
    const k = `${p.category}|${Number(p.date.slice(5, 7))}`;
    g.set(k, [...(g.get(k) ?? []), p]);
  }
  const num = (xs: (number | null | undefined)[]) => xs.filter((x): x is number => x != null);
  return [...g].map(([k, itens]) => {
    const [category, mes] = k.split("|");
    return {
      category: category!,
      mes: Number(mes),
      anos: [...new Set(itens.map((p) => Number(p.date.slice(0, 4))))].sort(),
      datas: itens.length,
      adiantamentoPp: mediana(itens.map((p) => p.ppMax)),
      adiantamentoEm: mediana(itens.map((p) => p.ppEm)),
      esgotaEm: mediana(itens.map((p) => p.lotouEm)),
      premio: mediana(num(itens.map((p) => p.premio))),
      perda: itens.reduce(
        (a, p) => ({ min: a.min + (p.perda?.min ?? 0), max: a.max + (p.perda?.max ?? 0) }),
        { min: 0, max: 0 },
      ),
      paga: mediana(num(itens.map((p) => p.diariaPaga))),
      ultimas: mediana(num(itens.map((p) => p.refs.ultimas))),
      itens,
    };
  });
}

/** Ocupação final típica (mediana) das datas encerradas da categoria × mês (datas de evento fora). */
export function finalTipico(
  rows: PaceRow[],
  cal: PaceCal,
  category: string,
  mes: number,
  hoje: string,
): number | null {
  return mediana(
    rows
      .filter(
        (r) =>
          r.c === category &&
          r.d < hoje &&
          Number(r.d.slice(5, 7)) === mes &&
          !cal[r.d]?.[1] &&
          histFleet(r) > 0,
      )
      .map((r) => soldAt(r, 0) / histFleet(r)),
  );
}

export type Situacao = {
  category: string;
  mes: number;
  datas: string[];
  /** Antecedência média das datas e o que ainda falta capturar (curva). */
  lead: number;
  falta: number;
  /** Ocupação atual contra a normal na mesma antecedência (p.p., média das datas). */
  pp: number;
  /** Reservas dos últimos 14 dias contra o normal no mesmo trecho (diárias). */
  ritmo: { atual: number; normal: number };
  /** Todas as datas já com falta ≤ 5%. */
  passou: boolean;
  /** Cada data: ocupação de hoje contra a normal na mesma antecedência (p.p.). */
  porData: { date: string; pp: number }[];
};

/**
 * Situação atual das próximas datas (ainda não encerradas) de uma categoria × mês: ocupação de hoje contra a normal na mesma
 * antecedência (curva × ocupação final típica), ritmo dos últimos 14 dias e quanto falta capturar.
 */
export function situacaoAtual(
  rows: PaceRow[],
  curva: Pick<Curva, "pontos">,
  fin: number,
  category: string,
  mes: number,
  hoje: string,
  limiteTarde = JANELA_PADRAO.tarde,
): Situacao | null {
  const proximas = rows
    .filter((r) => r.c === category && r.d >= hoje && Number(r.d.slice(5, 7)) === mes && r.f > 0)
    .sort((a, b) => (a.d < b.d ? -1 : 1));
  if (!proximas.length) return null;
  // Só a próxima ocorrência do mês (mesmo ano da primeira data).
  const ano = proximas[0]!.d.slice(0, 4);
  const xs = proximas.filter((r) => r.d.startsWith(ano));
  const dias = (d: string) => Math.round((Date.parse(d) - Date.parse(hoje)) / 86400000);
  let pp = 0;
  let ra = 0;
  let rn = 0;
  let L = 0;
  let falta = 0;
  const porData: { date: string; pp: number }[] = [];
  for (const r of xs) {
    const l = dias(r.d);
    const atual = soldAt(r, l) / r.f;
    const normal = capturaEm(curva, l) * fin;
    pp += (atual - normal) * 100;
    porData.push({ date: r.d, pp: (atual - normal) * 100 });
    ra += soldAt(r, l) - soldAt(r, l + 14);
    rn += (capturaEm(curva, l) - capturaEm(curva, l + 14)) * fin * r.f;
    L += l;
    falta += 1 - capturaEm(curva, l);
  }
  const n = xs.length;
  return {
    category,
    mes,
    datas: xs.map((r) => r.d),
    lead: L / n,
    falta: falta / n,
    pp: pp / n,
    ritmo: { atual: ra, normal: rn },
    passou: xs.every((r) => 1 - capturaEm(curva, dias(r.d)) <= limiteTarde + 1e-9),
    porData,
  };
}

export type AcaoMesaConfig = {
  minAnos: number;
  ppRepetindo: number;
  passoMaxPct: number;
  /** Abaixo deste prêmio (%) não se sugere subir: subir 1% ou 2% não muda nada. */
  premioMinPct: number;
  /** Ritmo dos últimos 14 dias "igual ou acima" do normal: pelo menos esta fração do normal. */
  ritmoMin: number;
};
export const ACAO_MESA_PADRAO: AcaoMesaConfig = {
  minAnos: 2,
  ppRepetindo: 10,
  passoMaxPct: 10,
  premioMinPct: 3,
  ritmoMin: 0.9,
};

export type AcaoMesa =
  | { tipo: "repetindo"; subirPct: number }
  /** Vendendo rápido como nos anos que esgotaram, mas sem prêmio de fim de venda que justifique subir. */
  | { tipo: "acelerado" }
  | { tipo: "risco" }
  /** Vendeu cedo, mas o ritmo dos últimos 14 dias está abaixo do normal: segurar, não subir. */
  | { tipo: "desacelerou" }
  | { tipo: "passou" }
  | { tipo: "sem-padrao" };

/** Classificação: sem recorrência → sem padrão; janela passou; captura ≥ ppRepetindo acima do normal → subir o prêmio (limitado). */
export function acaoMesa(
  licao: Pick<Licao, "anos" | "premio">,
  sit: (Pick<Situacao, "pp" | "passou"> & Partial<Pick<Situacao, "ritmo">>) | null,
  cfg: AcaoMesaConfig = ACAO_MESA_PADRAO,
): AcaoMesa {
  if (licao.anos.length < cfg.minAnos || !sit) return { tipo: "sem-padrao" };
  if (sit.passou) return { tipo: "passou" };
  if (sit.pp >= cfg.ppRepetindo) {
    // Freio: vendeu cedo, mas as reservas dos últimos 14 dias estão abaixo do normal.
    if (sit.ritmo && sit.ritmo.normal > 0 && sit.ritmo.atual < sit.ritmo.normal * cfg.ritmoMin)
      return { tipo: "desacelerou" };
    const pct = Math.min(cfg.passoMaxPct, Math.round((licao.premio ?? 0) * 100));
    return pct >= cfg.premioMinPct ? { tipo: "repetindo", subirPct: pct } : { tipo: "acelerado" };
  }
  return { tipo: "risco" };
}

/** Curvas para comparar: típica dos anos com perda, normal e a atual (média das próximas datas, só até hoje). */
export function curvasComparacao(
  rows: PaceRow[],
  licao: Pick<Licao, "itens">,
  curva: Pick<Curva, "pontos">,
  fin: number,
  sit: Pick<Situacao, "datas"> | null,
  hoje: string,
) {
  const leads = [180, 150, 120, 90, 75, 60, 45, 30, 21, 15, 7, 0];
  const porData = new Map(rows.map((r) => [`${r.d}|${r.c}`, r]));
  const passadas = licao.itens
    .map((p) => porData.get(`${p.date}|${p.category}`))
    .filter((r): r is PaceRow => !!r && histFleet(r) > 0);
  const atuais = (sit?.datas ?? [])
    .map((d) => rows.find((r) => r.d === d && r.c === licao.itens[0]?.category))
    .filter((r): r is PaceRow => !!r && r.f > 0);
  const dias = (d: string) => Math.round((Date.parse(d) - Date.parse(hoje)) / 86400000);
  const media = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return leads.map((L) => {
    const tip = media(passadas.map((r) => soldAt(r, L) / histFleet(r)));
    const at = media(atuais.filter((r) => dias(r.d) <= L).map((r) => soldAt(r, L) / r.f));
    return {
      label: `D-${L}`,
      tipica: tip != null ? Math.round(tip * 100) : null,
      normal: Math.round(capturaEm(curva, L) * fin * 100),
      atual: at != null ? Math.round(at * 100) : null,
    };
  });
}

/** Aviso da Prioridades para uma categoria × mês "repetindo o padrão". */
export const avisoRepetindo = (anos: number, pp: number, premio: number | null) =>
  `Este mês esgotou cedo em ${anos} anos; hoje está +${Math.round(pp)} p.p. acima do ritmo normal.${premio != null ? ` No passado, os últimos clientes pagaram ${premio >= 0 ? "+" : ""}${Math.round(premio * 100)}%.` : ""}`;

export type Previsao = {
  licao: Licao;
  sit: Situacao | null;
  acao: AcaoMesa;
  curva: Curva | null;
  fin: number | null;
};

/** Junta lição, situação e ação para as próximas datas de cada categoria × mês com histórico. */
export function previsoes(
  perdas: Perda[],
  payload: { linhas: PaceRow[]; cal: PaceCal; hoje: string; de: string },
  cfg: AcaoMesaConfig = ACAO_MESA_PADRAO,
): Previsao[] {
  return licoes(perdas).map((licao) => {
    const curva = curvaCategoria(
      payload.linhas,
      payload.hoje,
      payload.de,
      payload.cal,
      licao.category,
      licao.mes,
      null,
    );
    const fin = finalTipico(payload.linhas, payload.cal, licao.category, licao.mes, payload.hoje);
    const sit =
      curva && fin != null
        ? situacaoAtual(payload.linhas, curva, fin, licao.category, licao.mes, payload.hoje)
        : null;
    return { licao, sit, acao: acaoMesa(licao, sit, cfg), curva, fin };
  });
}

/** Frase do porquê da ação, em linguagem simples. */
export function porqueMesa(
  licao: Pick<Licao, "anos" | "premio">,
  sit: Pick<Situacao, "pp"> | null,
  acao: AcaoMesa,
): string {
  const pp = sit ? Math.round(sit.pp) : 0;
  const premio = licao.premio != null ? Math.round(licao.premio * 100) : null;
  const n = licao.anos.length;
  switch (acao.tipo) {
    case "repetindo":
      return `Está vendendo ${pp} p.p. acima do normal, como nos ${n} anos em que esgotou cedo. Naqueles anos, quem reservou por último pagou ${premio}% a mais: dá para subir agora.`;
    case "acelerado":
      return `Está vendendo ${pp} p.p. acima do normal, como nos anos em que esgotou cedo, mas naqueles anos quem reservou por último pagou só ${premio ?? 0}% a mais. Não há sinal de que aceitem preço maior: não baixe e acompanhe.`;
    case "desacelerou":
      return `Vendeu cedo (${pp} p.p. acima do normal), mas as reservas dos últimos 14 dias estão abaixo do ritmo normal. Segure o preço: não suba agora, e não baixe.`;
    case "risco":
      return `Hoje está no ritmo normal (${pp >= 0 ? "+" : ""}${pp} p.p.). Como este mês já esgotou cedo em ${n} anos, não vale baixar o preço. Se o ritmo acelerar, a recomendação passa a ser subir.`;
    case "passou":
      return "Quase todas as reservas destas datas já entraram: mudar o preço agora quase não altera o resultado.";
    default:
      return "";
  }
}

/** Datas do mês que estão pelo menos `ppMin` p.p. acima do ritmo normal. */
export const datasAcima = (
  sit: Pick<Situacao, "porData"> | null,
  ppMin = ACAO_MESA_PADRAO.ppRepetindo,
) => (sit?.porData ?? []).filter((d) => d.pp >= ppMin).map((d) => d.date);

/**
 * Lição aplicada a UMA data na Prioridades: Subir pelo prêmio só se o mês está "repetindo" (ritmo recente sem desacelerar) e a
 * própria data está ppMin acima do normal; nos demais meses com recorrência (e nas datas que não estão acima), só "não baixar".
 */
export function padraoParaData(
  prev: Pick<Previsao, "acao" | "sit"> | undefined,
  date: string,
  ppMin = ACAO_MESA_PADRAO.ppRepetindo,
): { tipo: "repetindo"; subirPct: number } | { tipo: "nao-baixar" } | null {
  if (!prev || prev.acao.tipo === "sem-padrao" || prev.acao.tipo === "passou") return null;
  if (prev.acao.tipo === "repetindo" && datasAcima(prev.sit, ppMin).includes(date))
    return { tipo: "repetindo", subirPct: prev.acao.subirPct };
  return { tipo: "nao-baixar" };
}

/** Célula do mapa do ano: cor só com perda real; esgotou cedo sem sinal de preço maior = neutra, tracejada, sem valor. */
export function celulaMapa(c: CelulaAno): {
  tipo: "perda" | "sem-sinal";
  classe: string;
  valor: number | null;
  dica: string;
} {
  const n = c.anos.length;
  const anos = `${n} ano${n === 1 ? "" : "s"}`;
  if (Math.round(c.min) > 0)
    return {
      tipo: "perda",
      classe: corRecorrencia(n),
      valor: c.min,
      dica: `Esgotou cedo em ${anos} (${c.anos.join(", ")}), ${c.datas} datas`,
    };
  return {
    tipo: "sem-sinal",
    classe: "border border-dashed border-muted-foreground/50 bg-muted/30",
    valor: null,
    dica: `Esgotou cedo em ${anos}, mas os últimos clientes pagaram o mesmo preço: sem sinal de que dava para cobrar mais`,
  };
}
