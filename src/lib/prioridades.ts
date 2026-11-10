/**
 * Central de prioridades: ranking de datas (retirada × categoria) abaixo do histórico esperado, com criticidade contextual,
 * posicionamento de preço e recomendações. Ferramenta de diagnóstico: nada aqui altera tarifa e nada afirma causalidade.
 * A ocupação segue a lógica de occupancy-pace.ts (benchmark na antecedência atual, sazonalidade e eventos móveis).
 */
import {
  addDays,
  daysBetween,
  dayPace,
  gapLevel,
  leadOf,
  samplesFor,
  soldAt,
  type DayPace,
  type GapLevel,
  type PaceModel,
  type PaceRow,
} from "./occupancy-pace";
import type { CaptureInfo } from "./capture";
import { diagnose, type Diagnosis, type PriceLevel } from "./competitiveness";

export type CritConfig = {
  /** Nível: percentil histórico (mesma categoria, época e antecedência) abaixo do qual o desvio é relevante; déficit de captura (p.p.) e diárias faltantes que contam como evidência; evidências exigidas para "Crítica". */
  pRel: number;
  capDef: number;
  faltamMin: number;
  evidMin: number;
  /** Pesos da pontuação de prioridade (normalizados entre os fatores disponíveis). */
  wGrav: number;
  wFalt: number;
  wRitmo: number;
  wJanela: number;
  wFrota: number;
  wPreco: number;
  /** Ritmo: dispersão (variância/média) das diárias novas, estimada no histórico; z mínimo para declarar tendência; datas vizinhas agregadas (±N). */
  ritmoDisp: number;
  ritmoZ: number;
  ritmoVizinhos: number;
  /** Gap (p.p. negativos) a partir do qual a data entra no radar. */
  gapMild: number;
  /** Gap (p.p. negativos) que representa intensidade máxima do desvio. */
  gapStrong: number;
  /** Início de cada janela de antecedência (dias): planejamento, estratégica, atenção prioritária, intervenção e recuperação. Abaixo da última = curto prazo. */
  leadPlan: number;
  leadStrat: number;
  leadAtenc: number;
  leadInterv: number;
  leadRecup: number;
  /** Nota (intensidade × urgência × relevância × veículos livres) a partir da qual a data é crítica / de atenção. */
  scoreCritica: number;
  scoreAtencao: number;
};
export const DEFAULT_CRIT: CritConfig = {
  pRel: 0.25,
  capDef: -15,
  faltamMin: 3,
  evidMin: 2,
  wGrav: 0.3,
  wFalt: 0.2,
  wRitmo: 0.15,
  wJanela: 0.15,
  wFrota: 0.1,
  wPreco: 0.1,
  ritmoDisp: 8,
  ritmoZ: 1.28,
  ritmoVizinhos: 3,
  gapMild: 5,
  gapStrong: 40,
  leadPlan: 120,
  leadStrat: 90,
  leadAtenc: 75,
  leadInterv: 60,
  leadRecup: 30,
  // Calibrado com a distribuição real de gaps contra a melhor ocupação do mesmo dia da semana em períodos anteriores
  // (mediana de 28 p.p. entre as datas abaixo do esperado): ~6% críticas e ~12% de atenção.
  scoreCritica: 1.2,
  scoreAtencao: 0.6,
};

export type Criticidade = "critica" | "atencao" | "monitorar" | "ok" | "sem-dados";
export type Confianca = "alta" | "media" | "baixa";

/** Relevância comercial do período: sazonalidade do calendário do projeto e eventos móveis. */
export const SEASON_WEIGHT: Record<string, number> = {
  Altíssima: 1.3,
  Alta: 1.15,
  Média: 1,
  Baixa: 0.85,
  Baixíssima: 0.7,
};
export const EVENT_WEIGHT = 1.2;
export const relevance = (season: string | null, event: string | null) =>
  event ? EVENT_WEIGHT : (SEASON_WEIGHT[season ?? ""] ?? 1);

export type Janela = "plan" | "estrat" | "atenc" | "interv" | "recup" | "curto";
export const JANELA_ORDEM: Janela[] = ["plan", "estrat", "atenc", "interv", "recup", "curto"];
export const JANELA_LABEL: Record<Janela, string> = {
  plan: "Planejamento antecipado",
  estrat: "Janela estratégica",
  atenc: "Atenção prioritária",
  interv: "Janela de intervenção",
  recup: "Recuperação",
  curto: "Acompanhamento final",
};
export function janelaOf(lead: number, c: CritConfig): Janela {
  if (lead >= c.leadPlan) return "plan";
  if (lead >= c.leadStrat) return "estrat";
  if (lead >= c.leadAtenc) return "atenc";
  if (lead >= c.leadInterv) return "interv";
  if (lead >= c.leadRecup) return "recup";
  return "curto";
}
/** Faixa em texto (D-90 a D-119) a partir da configuração. */
export function janelaRange(j: Janela, c: CritConfig): string {
  switch (j) {
    case "plan":
      return `D-${c.leadPlan}+`;
    case "estrat":
      return `D-${c.leadStrat} a D-${c.leadPlan - 1}`;
    case "atenc":
      return `D-${c.leadAtenc} a D-${c.leadStrat - 1}`;
    case "interv":
      return `D-${c.leadInterv} a D-${c.leadAtenc - 1}`;
    case "recup":
      return `D-${c.leadRecup} a D-${c.leadInterv - 1}`;
    default:
      return `D-0 a D-${c.leadRecup - 1}`;
  }
}
/** Peso da janela: D-60+ concentra a capacidade de influenciar a ocupação; o curto prazo converte pouco. A antecedência nunca classifica sozinha (só multiplica um gap já negativo). */
const JANELA_PESO: Record<Janela, number> = {
  plan: 0.9,
  estrat: 1.05,
  atenc: 1.1,
  interv: 1.1,
  recup: 0.7,
  curto: 0.4,
};
export const urgency = (lead: number, c: CritConfig) => JANELA_PESO[janelaOf(lead, c)];

/** Veículos ainda sem reserva pesam: com poucos veículos livres há pouco em jogo. 5 ou mais = peso cheio; mínimo 0,3. */
export const fleetWeight = (vacant: number) => Math.min(1, Math.max(0.3, vacant / 5));

export type PriorityRow = DayPace & {
  category: string;
  vacant: number;
  score: number;
  criticidade: Criticidade;
  confianca: Confianca;
};

/** Confiança da referência histórica: nível do benchmark, nº de datas comparáveis e tamanho da frota. */
export function confidenceOf(
  d: DayPace,
  min: { evento: number; dow: number; saz: number },
): Confianca {
  if (d.level == null || d.capacity < 3) return "baixa";
  // Melhor registro do mesmo dia da semana em períodos anteriores: dois anos comparados = média; um só = baixa.
  if (d.level === "aniversario" || d.level === "evento") return d.n >= 2 ? "media" : "baixa";
  if (d.level !== "saz" && d.n >= 2 * min[d.level]) return "alta";
  return "media";
}

export function classify(d: DayPace, conf: Confianca, c: CritConfig) {
  if (d.gap == null || d.booked == null)
    return { score: 0, criticidade: "sem-dados" as Criticidade };
  if (d.gap >= -c.gapMild) return { score: 0, criticidade: "ok" as Criticidade };
  const intensity = Math.min(3, (-d.gap - c.gapMild) / Math.max(1, c.gapStrong - c.gapMild));
  const vacant = Math.max(0, d.capacity - d.booked);
  const score = intensity * urgency(d.lead, c) * relevance(d.season, d.event) * fleetWeight(vacant);
  let criticidade: Criticidade =
    score >= c.scoreCritica ? "critica" : score >= c.scoreAtencao ? "atencao" : "monitorar";
  // Referência pouco confiável nunca gera "crítica" sozinha.
  if (conf === "baixa" && criticidade === "critica") criticidade = "atencao";
  return { score, criticidade };
}

export type PriorityFilters = {
  from: string;
  to: string;
  category: string | null;
  minLead: number;
  maxLead: number;
};

/** Linhas (retirada × categoria) futuras do período, já com gap, criticidade e confiança; sem data-base passada nem datas encerradas. */
export function priorityRows(
  model: PaceModel,
  base: string,
  f: PriorityFilters,
  c: CritConfig = DEFAULT_CRIT,
): PriorityRow[] {
  const { params } = model.payload;
  const min = { evento: params.n_evento, dow: params.n_dow, saz: params.n_saz };
  const out: PriorityRow[] = [];
  for (const r of model.payload.linhas) {
    if (r.d < f.from || r.d > f.to || r.d < base) continue;
    if (f.category && r.c !== f.category) continue;
    const lead = daysBetween(base, r.d);
    if (lead < f.minLead || lead > f.maxLead) continue;
    const d = dayPace(model, [r], r.d, base);
    const confianca = confidenceOf(d, min);
    const { score, criticidade } = classify(d, confianca, c);
    out.push({
      ...d,
      category: r.c,
      vacant: d.booked == null ? 0 : Math.max(0, d.capacity - d.booked),
      score,
      criticidade,
      confianca,
    });
  }
  return out;
}

/** Ordem do ranking: criticidade, depois score, depois o menor gap. Só quem tem gap negativo relevante sobe. */
const ORDEM: Record<Criticidade, number> = {
  critica: 0,
  atencao: 1,
  monitorar: 2,
  ok: 3,
  "sem-dados": 4,
};
export const byPriority = (a: PriorityRow, b: PriorityRow) =>
  ORDEM[a.criticidade] - ORDEM[b.criticidade] || b.score - a.score || (a.gap ?? 0) - (b.gap ?? 0);

export type Resumo = {
  below: number;
  above: number;
  gapMedio: number | null;
  criticalCategories: number;
  opportunities: number;
  analisadas: number;
  total: number;
};

/** Indicadores de contexto do conjunto filtrado. Oportunidade = ocupação acima do esperado com preço abaixo do mercado. */
export function resumir(
  rows: PriorityRow[],
  c: CritConfig,
  oportunidades: (r: PriorityRow) => boolean,
): Resumo {
  const ok = rows.filter((r) => r.gap != null);
  const lv = (r: PriorityRow): GapLevel =>
    gapLevel(r.gap!, { strong: c.gapStrong, mild: c.gapMild });
  return {
    below: ok.filter((r) => ["abaixo", "muito-abaixo"].includes(lv(r))).length,
    above: ok.filter((r) => ["acima", "muito-acima"].includes(lv(r))).length,
    gapMedio: ok.length ? ok.reduce((s, r) => s + r.gap!, 0) / ok.length : null,
    criticalCategories: new Set(
      rows.filter((r) => r.criticidade === "critica").map((r) => r.category),
    ).size,
    opportunities: rows.filter(oportunidades).length,
    analisadas: ok.length,
    total: rows.length,
  };
}

/* ───────────────────────── posicionamento de preço, ritmo e recomendações ───────────────────────── */

export type PriceCtx = {
  level: PriceLevel;
  pct: number | null;
  n: number;
  median: number | null;
  min: number | null;
  max: number | null;
  /** 3+ concorrentes, todos equivalentes. */
  reliable: boolean;
  partial: boolean;
  ourRate: number | null;
  currency: string;
  /** Coleta mais recente de concorrente usada no posicionamento (ISO). */
  lastCollectedAt?: string | null;
};

export const NO_PRICE: PriceCtx = {
  level: "sem-dados",
  pct: null,
  n: 0,
  median: null,
  min: null,
  max: null,
  reliable: false,
  partial: false,
  ourRate: null,
  currency: "USD",
};

/** Reservas novas na última semana contra o que o benchmark esperava captar na mesma semana (mesma antecedência). */
export type Tendencia = "acelerando" | "estavel" | "desacelerando";
export const TENDENCIA_LABEL: Record<Tendencia, string> = {
  acelerando: "Acelerando",
  estavel: "Estável",
  desacelerando: "Desacelerando",
};
export type Rhythm = {
  /** Janela do ritmo em dias: 7 (14 em D-60+, onde entra pouca coisa por semana). */
  dias?: number;
  /** Diárias novas na janela. */
  novas: number;
  /** Diárias novas na janela anterior de mesmo tamanho (null sem foto). */
  anteriores?: number | null;
  esperadas: number | null;
  abaixo: boolean | null;
  /** Novas ÷ esperadas pelo histórico na mesma semana; só com ao menos 1 diária esperada (amostra pequena = null). */
  tendencia?: Tendencia | null;
  /** Confiança da tendência (pela quantidade de diárias esperadas) e quantas datas foram agregadas. */
  confianca?: RitmoConf;
  datas?: number;
  z?: number | null;
};
export type RitmoConf = "alta" | "media" | "baixa" | "insuficiente";
export function tendenciaOf(novas: number, esperadas: number | null): Tendencia | null {
  if (esperadas == null || esperadas < 1) return null;
  const r = novas / esperadas;
  return r < 0.75 ? "desacelerando" : r > 1.25 ? "acelerando" : "estavel";
}
export function rhythm(
  model: PaceModel,
  row: PaceRow,
  date: string,
  base: string,
  lead: number,
  diasFixo?: number,
): Rhythm | null {
  // Longe da retirada entra pouco por semana: a janela de 14 dias evita comparar com menos de 1 diária esperada.
  const dias = diasFixo ?? (lead >= 60 ? 14 : 7);
  if (lead + dias > 400) return null;
  const antes = dayPace(model, [row], date, base, lead + dias);
  const agora = dayPace(model, [row], date, base);
  if (antes.booked == null || agora.booked == null) return null;
  const novas = agora.booked - antes.booked;
  const esperadas =
    agora.esperada != null && antes.esperada != null
      ? (agora.esperada - antes.esperada) * agora.capacity
      : null;
  const antes2 = lead + 2 * dias <= 400 ? dayPace(model, [row], date, base, lead + 2 * dias) : null;
  return {
    dias,
    novas,
    anteriores: antes2?.booked != null ? antes.booked - antes2.booked : null,
    esperadas,
    abaixo: esperadas != null && esperadas > 0 ? novas < 0.5 * esperadas : null,
    tendencia: tendenciaOf(novas, esperadas),
  };
}

/** Confiança da tendência pela quantidade de diárias esperadas na janela (erro relativo ≈ 1/√esperadas). */
export function ritmoConfianca(esperadas: number | null, datas: number): RitmoConf {
  if (esperadas == null || esperadas < 1 || datas < 3) return "insuficiente";
  return esperadas >= 10 ? "alta" : esperadas >= 4 ? "media" : "baixa";
}

/**
 * Ritmo agregado: soma as diárias novas e as esperadas da data e das vizinhas (mesma categoria, ±ritmoVizinhos dias) na mesma janela.
 * Uma data isolada espera menos de 1 diária por janela em D-60+, então a leitura individual é ruído; agregar vizinhas mantém a
 * consistência (mesma categoria, mesma época) e a estatística: z = (novas − esperadas) ÷ √(dispersão × esperadas).
 * Sem ao menos 1 diária esperada e 3 datas, a tendência é indisponível (nunca "estável").
 */
export function rhythmPooled(
  model: PaceModel,
  date: string,
  category: string,
  base: string,
  c: CritConfig,
): Rhythm | null {
  const lead = daysBetween(base, date);
  if (lead <= 0) return null;
  const dias = lead >= 60 ? 14 : 7;
  let novas = 0;
  let esp = 0;
  let ant = 0;
  let temAnt = true;
  let datas = 0;
  for (let k = -c.ritmoVizinhos; k <= c.ritmoVizinhos; k++) {
    const d = addDays(date, k);
    const dl = daysBetween(base, d);
    const row = model.byKey.get(`${d}|${category}`);
    if (dl <= 0 || !row) continue;
    const r = rhythm(model, row, d, base, dl, dias);
    if (!r || r.esperadas == null) continue;
    novas += r.novas;
    esp += r.esperadas;
    if (r.anteriores == null) temAnt = false;
    else ant += r.anteriores;
    datas++;
  }
  if (datas === 0) return null;
  const confianca = ritmoConfianca(esp, datas);
  const z = esp > 0 ? (novas - esp) / Math.sqrt(c.ritmoDisp * esp) : null;
  const tendencia: Tendencia | null =
    confianca === "insuficiente" || z == null
      ? null
      : z <= -c.ritmoZ
        ? "desacelerando"
        : z >= c.ritmoZ
          ? "acelerando"
          : "estavel";
  return {
    dias,
    novas,
    anteriores: temAnt ? ant : null,
    esperadas: esp,
    abaixo: tendencia == null ? null : tendencia === "desacelerando",
    tendencia,
    confianca,
    datas,
    z,
  };
}

export type Prioridade = "alta" | "media" | "baixa";
export type Recomendacao = {
  problema: string;
  acao: string;
  prioridade: Prioridade;
  confianca: Confianca;
  /** Só quando há dados para estimar; é um teto de referência, não previsão. */
  impacto: string | null;
};

const ORD: Confianca[] = ["baixa", "media", "alta"];
const menor = (a: Confianca, b: Confianca) => (ORD.indexOf(a) <= ORD.indexOf(b) ? a : b);
const fmtMoney = (v: number, cur: string) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: cur });
const pctTxt = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;

export function priceConfidence(p: PriceCtx): Confianca {
  if (p.level === "sem-dados") return "baixa";
  if (p.reliable) return "alta";
  // 3+ concorrentes, ou 2 sem comparação parcial, é média; 1 concorrente ou só ofertas parcialmente equivalentes, baixa.
  return p.n >= 3 || (p.n >= 2 && !p.partial) ? "media" : "baixa";
}

/** Fatos observados desta data (sem interpretação). */
export function fatos(
  row: PriorityRow,
  p: PriceCtx,
  r: Rhythm | null,
  cap: CaptureInfo | null = null,
): string[] {
  const out: string[] = [];
  if (row.atual != null && row.esperada != null && row.gap != null)
    out.push(
      `Ocupação ${(row.atual * 100).toFixed(0)}% contra ${(row.esperada * 100).toFixed(0)}% esperada (melhor registro histórico) em D-${row.lead} (${row.gap > 0 ? "+" : ""}${row.gap.toFixed(0)} p.p.).`,
    );
  out.push(
    `${row.booked ?? "—"} de ${row.capacity} veículos reservados; ${row.vacant} sem reserva.`,
  );
  if (cap && cap.atualShare != null)
    out.push(
      `Captura: ${(cap.atualShare * 100).toFixed(0)}% da ocupação final típica já contratada, contra ${(cap.histShare * 100).toFixed(0)}% historicamente em D-${row.lead} (${cap.diffPp! > 0 ? "+" : ""}${cap.diffPp!.toFixed(0)} p.p.; ${cap.n} datas comparáveis).`,
    );
  if (r)
    out.push(
      `${r.novas} reservas novas nos últimos ${r.dias ?? 7} dias${r.anteriores != null ? ` (${r.dias ?? 7} dias antes: ${r.anteriores})` : ""}${r.esperadas != null ? ` (esperado pela média histórica: ${r.esperadas.toFixed(1)})` : ""}.`,
    );
  if (p.median != null && p.pct != null && p.ourRate != null)
    out.push(
      `Nossa tarifa ${fmtMoney(p.ourRate, p.currency)} contra mediana ${fmtMoney(p.median, p.currency)} (${pctTxt(p.pct)}), com ${p.n} concorrentes${p.partial ? ", comparação parcialmente equivalente" : ""}.`,
    );
  else
    out.push(
      "Sem dados de concorrência comparáveis para esta data e categoria: nenhum posicionamento é assumido.",
    );
  return out;
}

/** Hipóteses que o quadro permite levantar; são hipóteses, não causas. */
export function hipoteses(
  row: PriorityRow,
  p: PriceCtx,
  r: Rhythm | null,
  crit: CritConfig,
): string[] {
  const out: string[] = [];
  const baixa = row.gap != null && row.gap < -crit.gapMild;
  if (!baixa) return out;
  if (p.level === "acima" || p.level === "muito-acima")
    out.push("A tarifa acima da mediana pode estar reduzindo a conversão.");
  if (p.level === "abaixo" || p.level === "muito-abaixo" || p.level === "alinhado")
    out.push(
      "O preço não parece ser o principal fator: vale checar canais de venda, disponibilidade nos canais e comportamento de reservas.",
    );
  if (r?.abaixo) out.push("O ritmo recente de novas reservas está abaixo do histórico.");
  if (row.vacant >= 5 && row.lead < crit.leadRecup)
    out.push("Há muita disponibilidade para pouca antecedência.");
  if (row.season === "Baixa" || row.season === "Baixíssima")
    out.push("Período de demanda historicamente mais fraca.");
  return out;
}

export function recommend(
  row: PriorityRow,
  p: PriceCtx,
  r: Rhythm | null,
  crit: CritConfig,
): Recomendacao[] {
  if (row.gap == null || row.criticidade === "sem-dados") return [];
  const occ: GapLevel = gapLevel(row.gap, { strong: crit.gapStrong, mild: crit.gapMild });
  const dg: Diagnosis = diagnose(occ, p.level);
  const conf = menor(row.confianca, priceConfidence(p));
  const pr: Prioridade =
    row.criticidade === "critica" ? "alta" : row.criticidade === "atencao" ? "media" : "baixa";
  // Impacto: diárias abaixo do esperado × nossa tarifa, só com tarifa e benchmark; é o teto se a lacuna fechasse.
  const lacuna =
    row.esperada != null && row.atual != null
      ? Math.round((row.esperada - row.atual) * row.capacity)
      : 0;
  const impacto =
    lacuna > 0 && p.ourRate != null && row.confianca !== "baixa"
      ? `${lacuna} diárias abaixo do esperado (teto de referência: ${fmtMoney(lacuna * p.ourRate, p.currency)} na tarifa de tabela; não é previsão).`
      : null;
  const out: Recomendacao[] = [];
  const base = { confianca: conf, impacto };
  const abaixo = occ === "abaixo" || occ === "muito-abaixo";
  if (dg === "perda-competitividade")
    out.push({
      ...base,
      prioridade: pr,
      problema: "Ocupação abaixo do esperado e tarifa acima do mercado.",
      acao: "Avaliar redução de tarifa como hipótese para recuperar competitividade (sem garantia de que eleve a ocupação), conferindo antes a equivalência das ofertas dos concorrentes.",
    });
  else if (dg === "investigar-demanda")
    out.push({
      ...base,
      prioridade: pr,
      problema: "Ocupação abaixo do esperado com tarifa abaixo do mercado.",
      acao: "Investigar demanda, canais de venda e comportamento de reservas antes de reduzir ainda mais o preço.",
    });
  else if (dg === "oportunidade-aumento")
    out.push({
      ...base,
      prioridade: "media",
      problema: "Ocupação acima do esperado com tarifa abaixo do mercado.",
      acao: "Avaliar aumento gradual de tarifa para capturar maior receita.",
      impacto: null,
    });
  else if (dg === "monitorar-sustentabilidade")
    out.push({
      ...base,
      prioridade: "baixa",
      problema: "Ocupação e tarifa acima do esperado e do mercado.",
      acao: "Monitorar o comportamento da demanda e preservar o posicionamento, evitando aumentos desnecessários.",
      impacto: null,
    });
  else if (abaixo && p.level === "sem-dados")
    out.push({
      ...base,
      prioridade: pr,
      problema: "Ocupação abaixo do esperado, sem posicionamento de preço disponível.",
      acao: "Não alterar tarifa sem comparar com o mercado: levantar preços dos concorrentes para esta data e investigar o ritmo de reservas e os canais.",
    });
  else if (abaixo)
    out.push({
      ...base,
      prioridade: pr,
      problema: "Ocupação abaixo do esperado com tarifa alinhada ao mercado.",
      acao: "Investigar demanda, canais e ritmo de reservas; o preço, por si só, não explica a diferença.",
    });
  // Ação conforme a janela de antecedência: a empresa precisa agir cedo; perto da retirada a conversão é menor.
  const j = janelaOf(row.lead, crit);
  const mk = marketBucket(p.level);
  const desacelerando = r?.abaixo === true || r?.tendencia === "desacelerando";
  const precoOk = mk === "abaixo"; // tarifa já abaixo do mercado: nunca sugerir reduzir
  let win: { problema: string; acao: string; prioridade: Prioridade } | null = null;
  if (abaixo) {
    if (j === "plan")
      win = {
        problema: `D-${row.lead} (planejamento antecipado) com ocupação abaixo do esperado.`,
        acao: "Analisar antecipadamente preço, sazonalidade, concorrência e o comportamento histórico de captura; iniciar ações preventivas.",
        prioridade: "media",
      };
    else if (j === "estrat")
      win = {
        problema: `D-${row.lead} com captura abaixo do histórico${desacelerando ? " e ritmo desacelerando" : ""}.`,
        acao: precoOk
          ? "Tarifa já abaixo do mercado: investigar demanda e canais antes de qualquer ajuste de preço."
          : "Identificar o desvio de captura e avaliar o posicionamento de preço frente ao mercado.",
        prioridade: desacelerando ? "alta" : "media",
      };
    else if (j === "atenc")
      win = {
        problema: `D-${row.lead} com gap negativo${desacelerando ? " e ritmo de reservas abaixo do histórico" : ""}.`,
        acao: desacelerando
          ? "Priorizar esta data: gap negativo com ritmo abaixo do histórico, ainda dentro da janela de atuação."
          : "Acompanhar de perto o ritmo de reservas e o posicionamento de mercado; ainda há janela para agir.",
        prioridade: desacelerando ? "alta" : "media",
      };
    else if (j === "interv")
      win = {
        problema: `D-${row.lead} (janela de intervenção) com ocupação abaixo do esperado.`,
        acao:
          mk === "acima"
            ? "Maior potencial de intervenção: priorizar a análise de competitividade, pois a tarifa está acima do mercado."
            : "Maior potencial de intervenção: concentrar a atenção aqui; checar canais, disponibilidade e posicionamento de mercado.",
        prioridade: "alta",
      };
    else if (j === "recup")
      win = {
        problema: `D-${row.lead} com gap negativo.`,
        acao: "Avaliar medidas de recuperação, considerando a menor janela de conversão restante.",
        prioridade: "media",
      };
    else
      win = {
        problema: `D-${row.lead} com gap negativo.`,
        acao: "Acompanhar ocupação, disponibilidade e riscos operacionais; poucas diárias entram nesta janela.",
        prioridade: "baixa",
      };
  }
  if (win) out.push({ ...base, ...win });
  return out;
}

/** Oportunidade de preço: ocupação acima do esperado e tarifa abaixo da mediana. */
export function isOportunidade(row: PriorityRow, p: PriceCtx, crit: CritConfig) {
  if (row.gap == null) return false;
  const occ = gapLevel(row.gap, { strong: crit.gapStrong, mild: crit.gapMild });
  return diagnose(occ, p.level) === "oportunidade-aumento";
}

/* ───────────────────────── central de prioridades: nível, ordem, matriz e calendário ───────────────────────── */

/** Níveis exibidos: os de criticidade (déficit de ocupação) mais a oportunidade (acima do esperado com tarifa abaixo do mercado). */
export type Nivel = Criticidade | "oportunidade";
export const NIVEL_ORDEM: Nivel[] = [
  "critica",
  "atencao",
  "monitorar",
  "oportunidade",
  "ok",
  "sem-dados",
];
export const NIVEL_LABEL: Record<Nivel, string> = {
  critica: "Crítica",
  atencao: "Atenção",
  monitorar: "Monitoramento",
  oportunidade: "Oportunidade",
  ok: "Dentro do esperado",
  "sem-dados": "Sem benchmark",
};
/** Níveis que entram no ranking. */
export const NIVEIS_RANKING: Nivel[] = ["critica", "atencao", "monitorar", "oportunidade"];

export type MarketBucket = "acima" | "alinhado" | "abaixo" | "sem-dados";
export const MARKET_LABEL: Record<MarketBucket, string> = {
  acima: "Acima do mercado",
  alinhado: "Alinhada ao mercado",
  abaixo: "Abaixo do mercado",
  "sem-dados": "Sem dados de mercado",
};
export const marketBucket = (l: PriceLevel): MarketBucket =>
  l === "acima" || l === "muito-acima"
    ? "acima"
    : l === "abaixo" || l === "muito-abaixo"
      ? "abaixo"
      : l;

export type OccBucket = "abaixo" | "neutro" | "acima";
export const occBucket = (row: { gap: number | null }, c: CritConfig): OccBucket | null => {
  if (row.gap == null) return null;
  if (row.gap < -c.gapMild) return "abaixo";
  return row.gap > c.gapMild ? "acima" : "neutro";
};

/** Posição da ocupação atual na distribuição histórica de datas comparáveis (mesma categoria, época e antecedência). */
export type HistCtx = { n: number; mean: number; sd: number; pctl: number; z: number | null };
export const HIST_MIN = 8;

export function histContext(
  model: PaceModel,
  row: PaceRow,
  date: string,
  base: string,
): HistCtx | null {
  const { lead, closed } = leadOf(date, base);
  if (closed || lead <= 0 || !row.f) return null;
  const smp = samplesFor(model, row, lead, base);
  if (!smp || smp.items.length < HIST_MIN) return null;
  const xs = smp.items.map((i) => i.occ);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1));
  const atual = soldAt(row, lead) / row.f;
  const pctl =
    (xs.filter((x) => x < atual).length + 0.5 * xs.filter((x) => x === atual).length) / xs.length;
  return { n: xs.length, mean, sd, pctl, z: sd > 0 ? (atual - mean) / sd : null };
}

export type Fator = {
  chave: "grav" | "falt" | "ritmo" | "janela" | "frota" | "preco";
  label: string;
  /** 0–1; null = indisponível (o fator sai e os pesos são renormalizados). */
  valor: number | null;
  peso: number;
  /** Contribuição em pontos (0–100) para a pontuação. */
  pontos: number;
  detalhe: string;
};

export type EnrichedRow = PriorityRow & {
  janela: Janela;
  /** Ritmo recente claramente abaixo do histórico (null = tendência indisponível). */
  pickupAbaixo: boolean | null;
  tendencia: Tendencia | null;
  ritmo: Rhythm | null;
  capture: CaptureInfo | null;
  hist: HistCtx | null;
  nivel: Nivel;
  price: PriceCtx;
  market: MarketBucket;
  /** Pontuação de prioridade de ação (0–100), soma dos fatores em `fatores`. */
  rank: number;
  fatores: Fator[];
  /** Evidências consistentes encontradas (texto) e se o desvio é relevante frente ao histórico. */
  evidencias: string[];
  desvioRelevante: boolean;
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const CONF_MULT: Record<Confianca, number> = { alta: 1, media: 0.9, baixa: 0.75 };

/**
 * Pontuação explicável (0–100) = Σ peso × fator ÷ Σ pesos disponíveis × confiança. Nenhum fator passa de 30% do total por padrão.
 * Fatores: gravidade do desvio (gap e posição no histórico), diárias faltantes, ritmo, janela de intervenção, frota livre e preço.
 */
export function scoreOf(
  row: PriorityRow,
  p: PriceCtx,
  c: CritConfig,
  r: Rhythm | null,
  cap: CaptureInfo | null,
  hist: HistCtx | null,
): { rank: number; fatores: Fator[] } {
  const gGap =
    row.gap == null ? null : clamp01((-row.gap - c.gapMild) / Math.max(1, c.gapStrong - c.gapMild));
  const gHist = hist ? clamp01((0.5 - hist.pctl) / 0.5) : null;
  const grav = gGap == null ? null : gHist == null ? gGap * 0.8 : (gGap + gHist) / 2;
  const falt = cap?.faltam == null ? null : clamp01(cap.faltam / 10);
  const ritmo =
    r?.tendencia == null || r.esperadas == null || r.esperadas <= 0
      ? null
      : clamp01(1 - r.novas / r.esperadas);
  const janela = urgency(row.lead, c) / 1.1;
  const frota = clamp01(row.vacant / 5);
  const mk = marketBucket(p.level);
  const precoBase =
    p.level === "sem-dados" ? null : mk === "acima" ? 1 : mk === "alinhado" ? 0.4 : 0.1;
  // Comparação de baixa confiança (1 concorrente ou só parcial) vale metade.
  const preco =
    precoBase == null ? null : priceConfidence(p) === "baixa" ? precoBase * 0.5 : precoBase;
  const defs: [Fator["chave"], string, number | null, number, string][] = [
    [
      "grav",
      "Gravidade do desvio",
      grav,
      c.wGrav,
      gGap == null
        ? "sem benchmark"
        : `gap ${row.gap!.toFixed(0)} p.p.${hist ? `, percentil ${(hist.pctl * 100).toFixed(0)} do histórico (n=${hist.n})` : ", sem distribuição histórica suficiente"}`,
    ],
    [
      "falt",
      "Diárias faltantes",
      falt,
      c.wFalt,
      cap?.faltam == null
        ? "sem referência de captura"
        : `${cap.faltam.toFixed(1)} diárias abaixo do padrão histórico`,
    ],
    [
      "ritmo",
      "Ritmo de reservas",
      ritmo,
      c.wRitmo,
      r?.tendencia == null
        ? "tendência indisponível"
        : `${r.novas} novas contra ${r.esperadas!.toFixed(1)} esperadas`,
    ],
    [
      "janela",
      "Janela de intervenção",
      janela,
      c.wJanela,
      `D-${row.lead}: ${JANELA_LABEL[janelaOf(row.lead, c)]}`,
    ],
    [
      "frota",
      "Frota livre",
      frota,
      c.wFrota,
      `${row.vacant} de ${row.capacity} veículos sem reserva`,
    ],
    [
      "preco",
      "Competitividade de preço",
      preco,
      c.wPreco,
      p.level === "sem-dados" ? "sem comparação de mercado" : MARKET_LABEL[mk],
    ],
  ];
  const disp = defs.filter((d) => d[2] != null);
  const total = disp.reduce((s, d) => s + d[3], 0) || 1;
  const mult = CONF_MULT[row.confianca];
  const fatores: Fator[] = defs.map(([chave, label, valor, peso, detalhe]) => ({
    chave,
    label,
    valor,
    peso,
    pontos: valor == null ? 0 : ((peso * valor) / total) * 100 * mult,
    detalhe,
  }));
  return { rank: fatores.reduce((s, f) => s + f.pontos, 0), fatores };
}

/**
 * Nível a partir de evidências, sem quantidade predeterminada por classe:
 *  - desvio relevante = gap negativo E ocupação no quartil inferior (pRel) das datas comparáveis na mesma antecedência;
 *  - evidências: déficit de captura, ritmo desacelerando (confiança média+), diárias faltantes, preço acima do mercado;
 *  - Crítica: desvio relevante, ≥ evidMin evidências incluindo captura ou ritmo, referência não frágil e fora do acompanhamento final;
 *  - Atenção: desvio relevante sem esses requisitos; Monitoramento: gap negativo com ocupação abaixo da mediana histórica, ou sinal isolado de captura/ritmo; gap negativo contra o melhor registro mas típico no histórico fica Dentro do esperado.
 */
export function enrich(
  row: PriorityRow,
  p: PriceCtx,
  c: CritConfig,
  r: Rhythm | null = null,
  cap: CaptureInfo | null = null,
  hist: HistCtx | null = null,
): EnrichedRow {
  const abaixo = row.gap != null && row.gap < -c.gapMild;
  const desvioRelevante =
    abaixo && (hist ? hist.pctl <= c.pRel : row.gap! <= -(c.gapMild + c.gapStrong) / 2);
  const ritmoFirme =
    r?.tendencia === "desacelerando" && (r.confianca === "media" || r.confianca === "alta");
  const evid: string[] = [];
  const eCap = cap?.diffPp != null && cap.diffPp <= c.capDef;
  if (eCap) evid.push(`captura ${cap!.diffPp!.toFixed(0)} p.p. abaixo do histórico`);
  if (ritmoFirme) evid.push("ritmo de reservas desacelerando");
  if (cap?.faltam != null && cap.faltam >= c.faltamMin)
    evid.push(`${Math.round(cap.faltam)} diárias abaixo do padrão histórico`);
  if (marketBucket(p.level) === "acima" && priceConfidence(p) !== "baixa")
    evid.push("tarifa acima do mercado");
  let nivel: Nivel;
  if (row.gap == null || row.booked == null) nivel = "sem-dados";
  else if (desvioRelevante) {
    nivel =
      evid.length >= c.evidMin &&
      (eCap || ritmoFirme) &&
      row.confianca !== "baixa" &&
      row.lead >= c.leadRecup
        ? "critica"
        : "atencao";
  } else if ((abaixo && (hist ? hist.pctl <= 0.5 : true)) || eCap || ritmoFirme)
    nivel = "monitorar";
  else nivel = isOportunidade(row, p, c) ? "oportunidade" : "ok";

  let rank: number;
  let fatores: Fator[];
  if (nivel === "oportunidade" && row.gap != null) {
    const intensity = clamp01((row.gap - c.gapMild) / Math.max(1, c.gapStrong - c.gapMild));
    rank = 50 * intensity * (urgency(row.lead, c) / 1.1) * CONF_MULT[row.confianca];
    fatores = [];
  } else ({ rank, fatores } = scoreOf(row, p, c, r, cap, hist));
  return {
    ...row,
    nivel,
    janela: janelaOf(row.lead, c),
    pickupAbaixo: r?.tendencia == null ? null : r.tendencia === "desacelerando",
    tendencia: r?.tendencia ?? null,
    ritmo: r,
    capture: cap,
    hist,
    price: p,
    market: marketBucket(p.level),
    rank: nivel === "ok" || nivel === "sem-dados" ? 0 : rank,
    fatores,
    evidencias: evid,
    desvioRelevante,
  };
}

/** Ordem do ranking: nível, depois nota de prioridade de ação; empate pelo menor gap. */
export const byRank = (a: EnrichedRow, b: EnrichedRow) =>
  NIVEL_ORDEM.indexOf(a.nivel) - NIVEL_ORDEM.indexOf(b.nivel) ||
  b.rank - a.rank ||
  (a.gap ?? 0) - (b.gap ?? 0);

export type MatrixCell = { occ: OccBucket; market: MarketBucket; count: number; critical: number };
export type Matrix = { cells: MatrixCell[]; semBenchmark: number };
export const OCC_BUCKETS: OccBucket[] = ["abaixo", "neutro", "acima"];
export const MARKET_BUCKETS: MarketBucket[] = ["acima", "alinhado", "abaixo", "sem-dados"];

/** Contagem de datas por (ocupação × preço). Datas sem benchmark não entram nas células (ficam em semBenchmark). */
export function matrix(rows: EnrichedRow[], c: CritConfig): Matrix {
  const cells = OCC_BUCKETS.flatMap((occ) =>
    MARKET_BUCKETS.map((market) => ({ occ, market, count: 0, critical: 0 })),
  );
  let semBenchmark = 0;
  for (const r of rows) {
    const o = occBucket(r, c);
    if (!o) {
      semBenchmark++;
      continue;
    }
    const cell = cells.find((x) => x.occ === o && x.market === r.market)!;
    cell.count++;
    if (r.nivel === "critica") cell.critical++;
  }
  return { cells, semBenchmark };
}

/** Leitura e pontos de investigação de cada célula; são hipóteses, nunca causas confirmadas. */
export const MATRIX_TEXT: Record<
  OccBucket,
  Record<MarketBucket, { leitura: string; investigar: string }>
> = {
  abaixo: {
    acima: {
      leitura:
        "Ocupação baixa com tarifa acima do mercado: o preço pode estar afetando a conversão.",
      investigar: "Conferir equivalência das ofertas dos concorrentes e avaliar a tarifa.",
    },
    alinhado: {
      leitura: "Ocupação baixa com tarifa alinhada: o preço, sozinho, não parece explicar.",
      investigar: "Canais de venda, disponibilidade nos canais e ritmo de reservas.",
    },
    abaixo: {
      leitura:
        "Ocupação baixa mesmo com tarifa abaixo do mercado: sinal de demanda ou canal, não de preço.",
      investigar:
        "Demanda do período, visibilidade nos canais e restrições de venda. Evitar reduzir mais.",
    },
    "sem-dados": {
      leitura: "Ocupação baixa sem posicionamento de preço disponível.",
      investigar: "Coletar preços dos concorrentes antes de qualquer decisão tarifária.",
    },
  },
  neutro: {
    acima: {
      leitura: "Dentro do esperado, tarifa acima do mercado.",
      investigar: "Acompanhar o ritmo de reservas.",
    },
    alinhado: {
      leitura: "Dentro do esperado e alinhado: sem sinal de ação.",
      investigar: "Manter monitoramento.",
    },
    abaixo: {
      leitura: "Dentro do esperado com tarifa abaixo do mercado.",
      investigar: "Observar se a ocupação acelera antes de rever o preço.",
    },
    "sem-dados": {
      leitura: "Dentro do esperado, sem dados de mercado.",
      investigar: "Manter monitoramento.",
    },
  },
  acima: {
    acima: {
      leitura: "Ocupação alta mesmo com tarifa acima do mercado: demanda forte.",
      investigar: "Sustentabilidade da demanda; evitar aumentos sem evidência.",
    },
    alinhado: {
      leitura: "Ocupação alta com tarifa alinhada.",
      investigar: "Acompanhar disponibilidade restante.",
    },
    abaixo: {
      leitura: "Ocupação alta com tarifa abaixo do mercado: possível espaço para aumento gradual.",
      investigar: "Disponibilidade restante, ritmo de reservas e equivalência dos concorrentes.",
    },
    "sem-dados": {
      leitura:
        "Ocupação alta sem posicionamento de preço: ocupação alta, por si só, não justifica aumento.",
      investigar: "Coletar preços dos concorrentes.",
    },
  },
};

/** Pior nível de cada data (todas as categorias do recorte), com a linha mais prioritária. */
export function worstByDate(
  rows: EnrichedRow[],
): Map<string, { nivel: Nivel; row: EnrichedRow; count: number }> {
  const out = new Map<string, { nivel: Nivel; row: EnrichedRow; count: number }>();
  for (const r of rows) {
    const cur = out.get(r.date);
    if (!cur) out.set(r.date, { nivel: r.nivel, row: r, count: 1 });
    else {
      cur.count++;
      if (byRank(r, cur.row) < 0) {
        cur.row = r;
        cur.nivel = r.nivel;
      }
    }
  }
  return out;
}

/** Acompanhamento sugerido conforme a antecedência. */
export function acompanhamento(lead: number, c: CritConfig): string {
  const j = janelaOf(lead, c);
  if (j === "curto") return "Reavaliar diariamente até a retirada.";
  if (j === "recup") return "Reavaliar em 2 a 3 dias.";
  return "Reavaliar semanalmente; ainda há tempo de influenciar a demanda.";
}

/** Distribuição histórica da antecedência de compra (diárias vendidas), para validar as faixas de janela. */
export function leadDistribution(
  linhas: { a: number[] }[],
  c: CritConfig,
): { janela: Janela; share: number }[] | null {
  const n: Record<Janela, number> = { plan: 0, estrat: 0, atenc: 0, interv: 0, recup: 0, curto: 0 };
  let total = 0;
  for (const l of linhas)
    for (const a of l.a) {
      n[janelaOf(a, c)]++;
      total++;
    }
  return total ? JANELA_ORDEM.map((janela) => ({ janela, share: n[janela] / total })) : null;
}
