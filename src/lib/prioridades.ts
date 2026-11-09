/**
 * Central de prioridades: ranking de datas (retirada × categoria) abaixo do histórico esperado, com criticidade contextual,
 * posicionamento de preço e recomendações. Ferramenta de diagnóstico: nada aqui altera tarifa e nada afirma causalidade.
 * A ocupação segue a lógica de occupancy-pace.ts (benchmark na antecedência atual, sazonalidade e eventos móveis).
 */
import {
  daysBetween,
  dayPace,
  gapLevel,
  type DayPace,
  type GapLevel,
  type PaceModel,
  type PaceRow,
} from "./occupancy-pace";
import { diagnose, type Diagnosis, type PriceLevel } from "./competitiveness";

export type CritConfig = {
  /** Gap (p.p. negativos) a partir do qual a data entra no radar. */
  gapMild: number;
  /** Gap (p.p. negativos) que representa intensidade máxima do desvio. */
  gapStrong: number;
  /** Retiradas a até N dias são urgentes; até leadNear próximas; até leadFar intermediárias; acima disso, distantes. */
  leadUrgent: number;
  leadNear: number;
  leadFar: number;
  /** Nota (intensidade × urgência × relevância × veículos livres) a partir da qual a data é crítica / de atenção. */
  scoreCritica: number;
  scoreAtencao: number;
};
export const DEFAULT_CRIT: CritConfig = {
  gapMild: 5,
  gapStrong: 40,
  leadUrgent: 14,
  leadNear: 30,
  leadFar: 60,
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

/** Quanto mais perto a retirada, menos tempo para reagir: peso maior. */
export function urgency(lead: number, c: CritConfig) {
  if (lead <= c.leadUrgent) return 1;
  if (lead <= c.leadNear) return 0.8;
  if (lead <= c.leadFar) return 0.55;
  return 0.35;
}

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
  if (d.level === "aniversario") return d.n >= 2 ? "media" : "baixa";
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
export type Rhythm = { novas: number; esperadas: number | null; abaixo: boolean | null };
export function rhythm(
  model: PaceModel,
  row: PaceRow,
  date: string,
  base: string,
  lead: number,
): Rhythm | null {
  if (lead + 7 > 400) return null;
  const antes = dayPace(model, [row], date, base, lead + 7);
  const agora = dayPace(model, [row], date, base);
  if (antes.booked == null || agora.booked == null) return null;
  const novas = agora.booked - antes.booked;
  const esperadas =
    agora.esperada != null && antes.esperada != null
      ? (agora.esperada - antes.esperada) * agora.capacity
      : null;
  return {
    novas,
    esperadas,
    abaixo: esperadas != null && esperadas > 0 ? novas < 0.5 * esperadas : null,
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
  return p.reliable ? "alta" : "media";
}

/** Fatos observados desta data (sem interpretação). */
export function fatos(row: PriorityRow, p: PriceCtx, r: Rhythm | null): string[] {
  const out: string[] = [];
  if (row.atual != null && row.esperada != null && row.gap != null)
    out.push(
      `Ocupação ${(row.atual * 100).toFixed(0)}% contra ${(row.esperada * 100).toFixed(0)}% esperada (melhor registro histórico) em D-${row.lead} (${row.gap > 0 ? "+" : ""}${row.gap.toFixed(0)} p.p.).`,
    );
  out.push(
    `${row.booked ?? "—"} de ${row.capacity} veículos reservados; ${row.vacant} sem reserva.`,
  );
  if (r)
    out.push(
      `${r.novas} reservas novas nos últimos 7 dias${r.esperadas != null ? ` (esperado pela média histórica: ${r.esperadas.toFixed(1)})` : ""}.`,
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
  if (row.vacant >= 5 && row.lead <= crit.leadNear)
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
      acao: "Avaliar redução de tarifa para recuperar competitividade, conferindo antes a equivalência das ofertas dos concorrentes.",
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
  // Cenário 5: pouca antecedência.
  if (abaixo && row.lead <= crit.leadUrgent)
    out.push({
      ...base,
      prioridade: "alta",
      problema: `Retirada em D-${row.lead} com ocupação abaixo do esperado.`,
      acao: "Avaliar ações comerciais de curto prazo, considerando disponibilidade, preço de mercado e viabilidade operacional.",
    });
  return out;
}

/** Oportunidade de preço: ocupação acima do esperado e tarifa abaixo da mediana. */
export function isOportunidade(row: PriorityRow, p: PriceCtx, crit: CritConfig) {
  if (row.gap == null) return false;
  const occ = gapLevel(row.gap, { strong: crit.gapStrong, mild: crit.gapMild });
  return diagnose(occ, p.level) === "oportunidade-aumento";
}
