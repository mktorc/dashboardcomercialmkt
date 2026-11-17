/**
 * Decisão de preço da aba Prioridades: cruza ocupação (Gestão de Ocupação), histórico de preço (Faixa de preço) e mercado
 * (Competitividade). Só funções puras; os sinais brutos vêm dos cálculos dessas abas (sinalOcupacao/quadranteDia,
 * pontosEpoca/faixasPreco, marketOf/positionOf/equivalenceAlert). Nada aqui altera tarifa.
 */
import { positionOf, equivalenceAlert } from "./competitiveness-view";
import { BASE_TXT, JANELA_TXT, type CapturaDecisao, type Janela } from "./captura-categoria";
import { faixasPreco, type PontoEpoca, type SinalOcupacao, type SinalRitmo } from "./preco-analise";

/** Versão da regra gravada com cada decisão (mude ao alterar a tabela de ações ou os parâmetros padrão). */
export const RULE_VERSION = "2026-11-17.1";

export type DecisaoConfig = {
  /** Mercado "alinhado": ± % contra a mediana. */
  mercadoPct: number;
  /** Histórico "dentro": faixa ótima ampliada em ± % nas bordas. */
  histMargemPct: number;
  /** Faixa de diária (US$) e mínimo de datas para a faixa ótima (iguais aos padrões da aba Faixa de preço). */
  histLargura: number;
  histMinDatas: number;
  /** Passo máximo por vez (% da tarifa atual) e firmeza por antecedência. */
  passoMaxPct: number;
  firmezaLonge: number;
  firmezaMedia: number;
  firmezaPerto: number;
  leadLonge: number;
  leadPerto: number;
  /** "Baixar até 5%". */
  baixarPoucoPct: number;
  /** Mudança mínima (US$) para Subir/Baixar; abaixo disso a decisão vira Manter. */
  minMudanca: number;
  /** Qualidade dos dados: abaixo disso a confiança é baixa. */
  minConcorrentes: number;
  idadeMaxDias: number;
  frotaMin: number;
  /** Com 1 ou 2 concorrentes, diferença (±%) a partir da qual pedimos para conferir a equivalência da oferta. */
  difPoucosPct: number;
  /** Urgência: antecedência e carros em jogo. */
  urgLeadAlta: number;
  urgLeadMedia: number;
  urgCarros: number;
};

export const DECISAO_PADRAO: DecisaoConfig = {
  mercadoPct: 5,
  histMargemPct: 5,
  histLargura: 5,
  histMinDatas: 5,
  passoMaxPct: 10,
  firmezaLonge: 0.5,
  firmezaMedia: 0.75,
  firmezaPerto: 1,
  leadLonge: 60,
  leadPerto: 15,
  baixarPoucoPct: 5,
  minMudanca: 2,
  minConcorrentes: 3,
  idadeMaxDias: 3,
  frotaMin: 30,
  difPoucosPct: 20,
  urgLeadAlta: 30,
  urgLeadMedia: 60,
  urgCarros: 3,
};

export type Nivel = "alta" | "media" | "baixa";
export const NIVEL_TXT: Record<Nivel, string> = { alta: "Alta", media: "Média", baixa: "Baixa" };
const NIVEIS: Nivel[] = ["baixa", "media", "alta"];
export const baixarNivel = (n: Nivel, vezes = 1): Nivel =>
  NIVEIS[Math.max(0, NIVEIS.indexOf(n) - vezes)]!;
export const maiorNivel = (...ns: Nivel[]): Nivel =>
  NIVEIS[Math.max(...ns.map((n) => NIVEIS.indexOf(n)))]!;
export const menorNivel = (...ns: Nivel[]): Nivel =>
  NIVEIS[Math.min(...ns.map((n) => NIVEIS.indexOf(n)))]!;

/* ───────────────────────── sinais ───────────────────────── */

export type SinalOcc = "abaixo" | "dentro" | "acima";
export const sinalOcc = (s: SinalOcupacao): SinalOcc => (s === "no-ritmo" ? "dentro" : s);

export type SinalHist = "acima" | "dentro" | "abaixo" | "sem-historico";
export type SinalMerc = "acima" | "alinhado" | "abaixo" | "sem-mercado";

export type FaixaOtima = { de: number; ate: number; datas: number; revVeic: number };
export type HistEscolha = {
  faixa: FaixaOtima | null;
  fonte: "mes" | "sazonalidade" | null;
  /** Época usada na frase ("janeiro", "sazonalidade Alta"). */
  rotulo?: string | undefined;
};

/** Faixa ótima (maior fat./veículo médio, com amostra mínima): primeiro no mês da retirada; senão, na sazonalidade. */
export function faixaOtima(
  pontosMes: PontoEpoca[],
  pontosSaz: PontoEpoca[],
  cfg: DecisaoConfig = DECISAO_PADRAO,
): HistEscolha {
  const pick = (pts: PontoEpoca[]): FaixaOtima | null => {
    const f = faixasPreco(pts, { largura: cfg.histLargura, minDatas: cfg.histMinDatas }).find(
      (x) => x.destaque,
    );
    return f ? { de: f.de, ate: f.ate, datas: f.datas, revVeic: f.revVeicMedio } : null;
  };
  const mes = pick(pontosMes);
  if (mes) return { faixa: mes, fonte: "mes" };
  const saz = pick(pontosSaz);
  if (saz) return { faixa: saz, fonte: "sazonalidade" };
  return { faixa: null, fonte: null };
}

/** Faixa "dentro" do histórico: da borda inferior −margem% à superior +margem%. */
export const faixaDentro = (
  f: { de: number; ate: number },
  cfg: DecisaoConfig = DECISAO_PADRAO,
) => ({
  de: f.de * (1 - cfg.histMargemPct / 100),
  ate: f.ate * (1 + cfg.histMargemPct / 100),
});

export function sinalHistorico(
  tarifa: number | null,
  faixa: { de: number; ate: number } | null,
  cfg: DecisaoConfig = DECISAO_PADRAO,
): SinalHist {
  if (tarifa == null || !faixa) return "sem-historico";
  const d = faixaDentro(faixa, cfg);
  return tarifa > d.ate ? "acima" : tarifa < d.de ? "abaixo" : "dentro";
}

/** Nossa tarifa contra a mediana (pct positivo = nós mais caros); ± mercadoPct = alinhado. */
export function sinalMercado(pct: number | null, cfg: DecisaoConfig = DECISAO_PADRAO): SinalMerc {
  return (
    positionOf(pct, { close: cfg.mercadoPct, significant: Math.max(cfg.mercadoPct, 10) }) ??
    "sem-mercado"
  );
}

export type MercadoQualidade = { n: number; idadeDias: number | null; pct: number | null };
/** Motivos de dados fracos no mercado (cada um torna a confiança baixa). */
export function problemasMercado(
  m: MercadoQualidade,
  cfg: DecisaoConfig = DECISAO_PADRAO,
): string[] {
  const out: string[] = [];
  if (m.n < cfg.minConcorrentes) out.push(`só ${m.n} concorrente${m.n === 1 ? "" : "s"}`);
  if (equivalenceAlert(m.pct, m.n)) out.push("alerta de equivalência no mercado");
  if (m.idadeDias != null && m.idadeDias > cfg.idadeMaxDias)
    out.push(`coleta de mercado de ${m.idadeDias} dias atrás`);
  return out;
}

/* ───────────────────────── regra de ação ───────────────────────── */

export type Acao =
  | "baixar"
  | "baixar-mediana"
  | "baixar-pouco"
  | "acao-comercial"
  | "manter"
  | "subir"
  | "subir-pouco"
  | "verificar";

export const ACAO_TXT: Record<Acao, string> = {
  baixar: "Baixar",
  "baixar-mediana": "Baixar até a mediana",
  "baixar-pouco": "Baixar até 5%",
  "acao-comercial": "Revisar canais e demanda",
  manter: "Manter",
  subir: "Subir",
  "subir-pouco": "Subir pouco",
  verificar: "Verificar dados",
};

export const DICA_REVISAR =
  "A ocupação está baixa, mas o preço já está igual ou abaixo do mercado e do nosso melhor histórico. Baixar mais tende a só perder receita. Verifique se o carro está visível e disponível nos canais (site, agências, parceiros), se há restrição travando a venda e se vale uma campanha.";

export type GrupoAcao = "baixar" | "subir" | "acao-comercial" | "verificar" | "manter";
export const GRUPOS: GrupoAcao[] = ["baixar", "subir", "acao-comercial", "verificar", "manter"];
export const GRUPO_TXT: Record<GrupoAcao, string> = {
  baixar: "Baixar",
  subir: "Subir",
  "acao-comercial": "Revisar canais e demanda",
  verificar: "Verificar dados",
  manter: "Manter",
};
export const grupoDe = (a: Acao): GrupoAcao =>
  a.startsWith("baixar") ? "baixar" : a.startsWith("subir") ? "subir" : (a as GrupoAcao);

export type Regra = { acao: Acao; forca: Nivel; umPilar: boolean };

/**
 * Tabela de ações. Sem mercado e sem histórico = Verificar dados (ocupação fora da esperada). Com só um dos dois, o que falta entra
 * como neutro (mercado alinhado / histórico dentro) e `umPilar` reduz a confiança. `forca` = teto de confiança da própria regra.
 */
export function regraAcao(o: SinalOcc, m: SinalMerc, h: SinalHist): Regra {
  if (o === "dentro") return { acao: "manter", forca: "alta", umPilar: false };
  const semM = m === "sem-mercado";
  const semH = h === "sem-historico";
  if (semM && semH) return { acao: "verificar", forca: "baixa", umPilar: false };
  const mm = semM ? "alinhado" : m;
  const hh = semH ? "dentro" : h;
  const umPilar = semM || semH;
  const r = (acao: Acao, forca: Nivel): Regra => ({ acao, forca, umPilar });
  if (o === "abaixo") {
    if (mm === "acima") {
      if (hh === "acima") return r("baixar", "alta");
      if (hh === "dentro") return r("baixar-mediana", "media");
      return r("baixar-pouco", "baixa");
    }
    if (mm === "alinhado")
      return hh === "acima" ? r("baixar-pouco", "media") : r("acao-comercial", "alta");
    return hh === "acima" ? r("acao-comercial", "baixa") : r("acao-comercial", "alta");
  }
  // acima da esperada
  if (mm === "acima") return r("manter", "alta");
  if (mm === "abaixo") return hh === "abaixo" ? r("subir", "alta") : r("subir-pouco", "media");
  return hh === "acima" ? r("manter", "alta") : r("subir-pouco", "media");
}

/** Ações em que ritmo recente igual/acima da referência reduz confiança e urgência (ainda está vendendo). */
const SENSIVEL_RITMO = (a: Acao) => grupoDe(a) === "baixar" || a === "acao-comercial";
export const ritmoSegura = (a: Acao, ritmo: SinalRitmo | null) =>
  SENSIVEL_RITMO(a) && (ritmo === "igual" || ritmo === "acima");

/* ───────────────────────── confiança ───────────────────────── */

export type Confianca = { nivel: Nivel; motivos: string[] };

const PILAR_TXT = {
  ocupacao: "a ocupação",
  mercado: "o mercado",
  historico: "o histórico",
} as const;

/**
 * Confiança = concordância dos sinais com a ação: alta quando os três sustentam; baixa quando algum contradiz; média quando algum é
 * neutro ou falta. Qualidade dos dados não entra aqui (vai para `avisos`). Verificar dados = baixa.
 */
export function confianca(d: Pick<Decisao, "acao" | "occ" | "sinalHist" | "sinalMerc">): Confianca {
  if (d.acao === "verificar")
    return { nivel: "baixa", motivos: ["faltam sinais de preço para decidir"] };
  const ev = evidencias(d);
  const falta = {
    ocupacao: d.occ == null,
    mercado: d.sinalMerc === "sem-mercado",
    historico: d.sinalHist === "sem-historico",
  };
  const pilares = ["ocupacao", "mercado", "historico"] as const;
  const contra = pilares.filter((p) => ev[p] === "contra");
  if (contra.length)
    return { nivel: "baixa", motivos: contra.map((p) => `${PILAR_TXT[p]} contradiz`) };
  const neutros = pilares.filter((p) => ev[p] !== "favor");
  if (neutros.length)
    return {
      nivel: "media",
      motivos: neutros.map((p) =>
        falta[p]
          ? p === "mercado"
            ? "sem mercado"
            : p === "historico"
              ? "sem histórico"
              : "sem ocupação"
          : `${PILAR_TXT[p]} é neutro`,
      ),
    };
  return { nivel: "alta", motivos: [] };
}

export type Avisos = { principais: string[]; permanentes: string[] };
/** Qualidade dos dados: avisos que mudam de data a data (linha âmbar) e os permanentes (só no tooltip). */
export function avisos(
  d: Pick<Decisao, "sinalMerc" | "mercado" | "hist" | "evento" | "frota" | "sinalHist">,
  cfg: DecisaoConfig = DECISAO_PADRAO,
): Avisos {
  const principais: string[] = [];
  const permanentes: string[] = [];
  const m = d.mercado;
  if (d.sinalMerc !== "sem-mercado") {
    if (m.idadeDias != null && m.idadeDias > cfg.idadeMaxDias)
      principais.push(`coleta de mercado há ${m.idadeDias} dias`);
    if (equivalenceAlert(m.pct, m.n)) principais.push("alerta de equivalência");
    if (m.n >= 1 && m.n <= 2 && m.pct != null && Math.abs(m.pct) > cfg.difPoucosPct)
      principais.push("confira se a oferta do concorrente é equivalente");
    if (m.n < cfg.minConcorrentes) permanentes.push(`só ${m.n} concorrente${m.n === 1 ? "" : "s"}`);
  }
  if (d.sinalHist !== "sem-historico" && d.hist.fonte === "sazonalidade")
    principais.push("histórico só pela sazonalidade");
  if (d.evento) principais.push("data de evento");
  if (d.frota < cfg.frotaMin) permanentes.push("frota pequena");
  return { principais, permanentes };
}

export const TEXTO_MUDANCA_PEQUENA = "mudança sugerida pequena demais";

export const TEXTO_VERIFICAR_EQUIV =
  "a recomendação depende de uma cotação possivelmente não equivalente; confira antes de decidir";

/* ───────────────────────── preço sugerido ───────────────────────── */

export const firmeza = (lead: number, cfg: DecisaoConfig = DECISAO_PADRAO) =>
  lead >= cfg.leadLonge
    ? cfg.firmezaLonge
    : lead >= cfg.leadPerto
      ? cfg.firmezaMedia
      : cfg.firmezaPerto;

export type Intervalo = { de: number; ate: number };
export type PrecoEntrada = {
  tarifa: number | null;
  acao: Acao;
  lead: number;
  mediana: number | null;
  faixa: { de: number; ate: number } | null;
  /** Confiança de cada pilar (para escolher sem interseção). */
  confMercado: Nivel;
  confHist: Nivel;
};
export type PrecoSugerido = {
  min: number;
  max: number;
  alvo: Intervalo;
  /** Ponto de chegada (centro do alvo, ou a mediana em "Baixar até a mediana"). */
  centro: number;
  passoPct: number;
};

/** Alvo = (mediana ± mercadoPct) ∩ (faixa ótima ampliada); sem interseção, o pilar de maior confiança (empate: mercado). */
export function alvoPreco(
  mediana: number | null,
  faixa: { de: number; ate: number } | null,
  confMercado: Nivel,
  confHist: Nivel,
  cfg: DecisaoConfig = DECISAO_PADRAO,
): Intervalo | null {
  const M =
    mediana != null
      ? { de: mediana * (1 - cfg.mercadoPct / 100), ate: mediana * (1 + cfg.mercadoPct / 100) }
      : null;
  const H = faixa ? faixaDentro(faixa, cfg) : null;
  if (M && H) {
    const de = Math.max(M.de, H.de);
    const ate = Math.min(M.ate, H.ate);
    if (de <= ate) return { de, ate };
    return NIVEIS.indexOf(confHist) > NIVEIS.indexOf(confMercado) ? H : M;
  }
  return M ?? H;
}

/**
 * Faixa sugerida: a tarifa movida até a borda mais próxima e até a mais distante do alvo, cada movimento limitado ao passo
 * (passoMax × firmeza da antecedência; "Baixar até 5%" nunca passa de 5%). Só no sentido da ação; null quando não há o que mover
 * ou a ação não tem preço (Manter, Ação comercial, Verificar dados).
 */
export function precoSugerido(
  e: PrecoEntrada,
  cfg: DecisaoConfig = DECISAO_PADRAO,
): PrecoSugerido | null {
  const g = grupoDe(e.acao);
  if ((g !== "baixar" && g !== "subir") || e.tarifa == null || !(e.tarifa > 0)) return null;
  let alvo = alvoPreco(e.mediana, e.faixa, e.confMercado, e.confHist, cfg);
  if (!alvo) return null;
  if (e.acao === "baixar-mediana" && e.mediana != null)
    alvo = { de: Math.min(alvo.de, e.mediana), ate: Math.min(alvo.ate, e.mediana) };
  const t = e.tarifa;
  // Ponto de chegada: centro do alvo; "Baixar até a mediana" = a mediana; "Baixar até 5%" = tarifa − 5%.
  const lado = (c: number) => (g === "baixar" ? t - c : c - t);
  let centro =
    e.acao === "baixar-mediana" && e.mediana != null
      ? e.mediana
      : e.acao === "baixar-pouco"
        ? t * (1 - cfg.baixarPoucoPct / 100)
        : (alvo.de + alvo.ate) / 2;
  if (lado(centro) <= 0) {
    // Sem interseção, o pilar escolhido pode apontar ao contrário da ação: usa o outro, se ele aponta no sentido certo.
    const M =
      e.mediana != null
        ? {
            de: e.mediana * (1 - cfg.mercadoPct / 100),
            ate: e.mediana * (1 + cfg.mercadoPct / 100),
          }
        : null;
    const H = e.faixa ? faixaDentro(e.faixa, cfg) : null;
    const alt = [M, H]
      .filter((x): x is Intervalo => x != null)
      .map((x) => (x.de + x.ate) / 2)
      .find((c) => lado(c) > 0);
    if (alt == null) return null;
    centro = alt;
  }
  // Só no sentido da ação: o que ficaria do outro lado da tarifa sai.
  if (g === "baixar") alvo = { de: Math.min(alvo.de, t), ate: Math.min(alvo.ate, t) };
  else alvo = { de: Math.max(alvo.de, t), ate: Math.max(alvo.ate, t) };
  let passoPct = cfg.passoMaxPct * firmeza(e.lead, cfg);
  if (e.acao === "baixar-pouco") passoPct = Math.min(passoPct, cfg.baixarPoucoPct);
  const passo = (t * passoPct) / 100;
  const mover = (x: number) => t + Math.max(-passo, Math.min(passo, x - t));
  const b = Math.round(mover(centro));
  if (b === Math.round(t)) return null;
  // Um número só: até onde mover agora, em direção ao centro do alvo, limitado ao passo (min = max).
  return { min: b, max: b, alvo, centro, passoPct };
}

/* ───────────────────────── urgência ───────────────────────── */

export type UrgEntrada = {
  lead: number;
  carros: number;
  receita: number;
  acao: Acao;
  ritmo: SinalRitmo | null;
};

export function urgencia(e: UrgEntrada, cfg: DecisaoConfig = DECISAO_PADRAO): Nivel {
  if (e.acao === "manter") return "baixa";
  const muitos = Math.abs(e.carros) >= cfg.urgCarros;
  let n: Nivel =
    e.lead < cfg.urgLeadAlta && muitos
      ? "alta"
      : e.lead < cfg.urgLeadMedia || muitos
        ? "media"
        : "baixa";
  if (ritmoSegura(e.acao, e.ritmo)) n = baixarNivel(n);
  return n;
}

/** Ordem da fila: urgência, antecedência (mais perto primeiro), carros em jogo e receita em jogo. */
export const porUrgencia = (
  a: { urgencia: Nivel; lead: number; carros: number; receita: number },
  b: { urgencia: Nivel; lead: number; carros: number; receita: number },
) =>
  NIVEIS.indexOf(b.urgencia) - NIVEIS.indexOf(a.urgencia) ||
  a.lead - b.lead ||
  Math.abs(b.carros) - Math.abs(a.carros) ||
  b.receita - a.receita;

/* ───────────────────────── decisão por data × categoria e blocos ───────────────────────── */

export type DecisaoEntrada = {
  date: string;
  category: string;
  lead: number;
  frota: number;
  vagos: number;
  tarifa: number | null;
  occ: SinalOcc | null;
  gapPp: number | null;
  gapCarros: number | null;
  ritmo: SinalRitmo | null;
  ritmoAtual: number | null;
  ritmoRef: number | null;
  /** Ano de referência do ritmo (ex.: "2025"). */
  ritmoAno?: string | null;
  hist: HistEscolha;
  evento: boolean;
  mercado: MercadoQualidade & { mediana: number | null };
  /** Perfil de captura da categoria na antecedência atual; null sem curva com amostra. */
  captura?: CapturaDecisao | null;
};

export type Decisao = DecisaoEntrada & {
  sinalHist: SinalHist;
  sinalMerc: SinalMerc;
  regra: Regra;
  acao: Acao;
  confianca: Confianca;
  /** Texto quando a ação virou Verificar dados pela exceção de equivalência. */
  verificarMotivo: string | null;
  /** Texto quando Subir/Baixar virou Manter porque a mudança sugerida era pequena demais. */
  manterMotivo: string | null;
  sugerido: PrecoSugerido | null;
  carros: number;
  /** Baixar/Ação comercial: carro-dias abaixo da esperada × tarifa atual. */
  receitaRisco: number;
  /** Subir: carro-dias acima da esperada × (tarifa sugerida mais conservadora − tarifa atual). */
  receitaPotencial: number;
  /** Risco + potencial (desempate da fila). */
  receita: number;
  urgencia: Nivel;
};

/** Ações que contam nos totais (carro-dias em jogo). */
export const COM_ACAO = (a: Acao) => {
  const g = grupoDe(a);
  return g === "baixar" || g === "subir" || g === "acao-comercial";
};

/** Receita em risco e potencial de uma data (ver Decisao). */
export function receitas(
  acao: Acao,
  gapCarros: number,
  tarifa: number | null,
  sugerido: Pick<PrecoSugerido, "min" | "max"> | null,
): { risco: number; potencial: number } {
  const g = grupoDe(acao);
  const t = tarifa ?? 0;
  if (g === "baixar" || g === "acao-comercial")
    return { risco: Math.max(0, -gapCarros) * t, potencial: 0 };
  if (g === "subir" && sugerido && tarifa != null)
    return { risco: 0, potencial: Math.max(0, gapCarros) * Math.max(0, sugerido.min - tarifa) };
  return { risco: 0, potencial: 0 };
}

/** Decisão de uma data × categoria. Sem sinal de ocupação, null (fica fora da fila). */
export function decidir(e: DecisaoEntrada, cfg: DecisaoConfig = DECISAO_PADRAO): Decisao | null {
  if (e.occ == null) return null;
  const sinalHist = sinalHistorico(e.tarifa, e.hist.faixa, cfg);
  const sinalMerc = e.tarifa == null ? "sem-mercado" : sinalMercado(e.mercado.pct, cfg);
  let regra = regraAcao(e.occ, sinalMerc, sinalHist);
  // Exceção: Baixar/Subir sustentado só pelo mercado (o histórico não sustenta) com alerta de equivalência → Verificar dados.
  let verificarMotivo: string | null = null;
  const gr = grupoDe(regra.acao);
  if (gr === "baixar" || gr === "subir") {
    const ev = evidencias({ acao: regra.acao, occ: e.occ, sinalHist, sinalMerc });
    if (
      ev.mercado === "favor" &&
      ev.historico !== "favor" &&
      equivalenceAlert(e.mercado.pct, e.mercado.n)
    ) {
      regra = { acao: "verificar", forca: "baixa", umPilar: regra.umPilar };
      verificarMotivo = TEXTO_VERIFICAR_EQUIV;
    }
  }

  const confMercado: Nivel =
    sinalMerc === "sem-mercado"
      ? "baixa"
      : problemasMercado(e.mercado, cfg).length
        ? "baixa"
        : "alta";
  const confHist: Nivel =
    sinalHist === "sem-historico"
      ? "baixa"
      : e.hist.fonte === "mes" && !e.evento
        ? "alta"
        : "media";
  let sugerido = precoSugerido(
    {
      tarifa: e.tarifa,
      acao: regra.acao,
      lead: e.lead,
      mediana: e.mercado.mediana,
      faixa: e.hist.faixa,
      confMercado,
      confHist,
    },
    cfg,
  );
  // Subir/Baixar sempre com preço: sem preço, ou mudança menor que minMudanca, vira Manter.
  let manterMotivo: string | null = null;
  const g2 = grupoDe(regra.acao);
  if (
    (g2 === "baixar" || g2 === "subir") &&
    e.tarifa != null &&
    (!sugerido || Math.abs(sugerido.min - e.tarifa) < cfg.minMudanca)
  ) {
    regra = { acao: "manter", forca: "media", umPilar: regra.umPilar };
    sugerido = null;
    manterMotivo = TEXTO_MUDANCA_PEQUENA;
  }
  const conf: Confianca = verificarMotivo
    ? { nivel: "baixa", motivos: [verificarMotivo] }
    : manterMotivo
      ? { nivel: "media", motivos: [manterMotivo] }
      : confianca({ acao: regra.acao, occ: e.occ, sinalHist, sinalMerc });
  const carros = e.gapCarros ?? 0;
  const rc = receitas(regra.acao, carros, e.tarifa, sugerido);
  const receita = rc.risco + rc.potencial;
  return {
    ...e,
    sinalHist,
    sinalMerc,
    regra,
    acao: regra.acao,
    confianca: conf,
    verificarMotivo,
    manterMotivo,
    sugerido,
    carros,
    receitaRisco: rc.risco,
    receitaPotencial: rc.potencial,
    receita,
    urgencia: urgencia({ lead: e.lead, carros, receita, acao: regra.acao, ritmo: e.ritmo }, cfg),
  };
}

export type Bloco = {
  key: string;
  category: string;
  acao: Acao;
  de: string;
  ate: string;
  itens: Decisao[];
  /** Data mais próxima (a que define antecedência e selos). */
  lead: number;
  /** Gap somado (carro-dias), média por dia e nº de dias. */
  carros: number;
  carrosDia: number;
  dias: number;
  receita: number;
  receitaRisco: number;
  receitaPotencial: number;
  /** Janela e captura do primeiro dia do bloco (blocos não atravessam janelas). */
  janela: Janela | null;
  captura: CapturaDecisao | null;
  /** Urgência e confiança: a mais alta e a mais baixa entre os dias do bloco. */
  urgencia: Nivel;
  urgenciaMin: Nivel;
  confianca: Nivel;
  confiancaMax: Nivel;
  tarifaMin: number | null;
  tarifaMax: number | null;
  sugMin: number | null;
  sugMax: number | null;
};

const proximoDia = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** Agrupa datas consecutivas da mesma categoria com a mesma ação num bloco; ordena pela urgência. */
export function agruparBlocos(ds: Decisao[]): Bloco[] {
  const ord = [...ds].sort((a, b) =>
    a.category < b.category
      ? -1
      : a.category > b.category
        ? 1
        : a.date < b.date
          ? -1
          : a.date > b.date
            ? 1
            : 0,
  );
  const grupos: Decisao[][] = [];
  for (const d of ord) {
    const g = grupos[grupos.length - 1];
    const ult = g?.[g.length - 1];
    if (
      g &&
      ult &&
      ult.category === d.category &&
      ult.acao === d.acao &&
      (ult.captura?.janela ?? null) === (d.captura?.janela ?? null) &&
      proximoDia(ult.date) === d.date
    )
      g.push(d);
    else grupos.push([d]);
  }
  const nums = (xs: (number | null | undefined)[]) => xs.filter((x): x is number => x != null);
  const out: Bloco[] = grupos.map((g) => {
    const t = nums(g.map((x) => x.tarifa));
    const sMin = nums(g.map((x) => x.sugerido?.min));
    const sMax = nums(g.map((x) => x.sugerido?.max));
    return {
      key: `${g[0]!.category}|${g[0]!.date}|${g[0]!.acao}`,
      category: g[0]!.category,
      acao: g[0]!.acao,
      de: g[0]!.date,
      ate: g[g.length - 1]!.date,
      itens: g,
      lead: Math.min(...g.map((x) => x.lead)),
      carros: g.reduce((s, x) => s + x.carros, 0),
      janela: g[0]!.captura?.janela ?? null,
      captura: g[0]!.captura ?? null,
      carrosDia: g.reduce((s, x) => s + x.carros, 0) / g.length,
      dias: g.length,
      receita: g.reduce((s, x) => s + x.receita, 0),
      receitaRisco: g.reduce((s, x) => s + x.receitaRisco, 0),
      receitaPotencial: g.reduce((s, x) => s + x.receitaPotencial, 0),
      urgencia: maiorNivel(...g.map((x) => x.urgencia)),
      urgenciaMin: menorNivel(...g.map((x) => x.urgencia)),
      confianca: menorNivel(...g.map((x) => x.confianca.nivel)),
      confiancaMax: maiorNivel(...g.map((x) => x.confianca.nivel)),
      tarifaMin: t.length ? Math.min(...t) : null,
      tarifaMax: t.length ? Math.max(...t) : null,
      sugMin: sMin.length ? Math.min(...sMin) : null,
      sugMax: sMax.length ? Math.max(...sMax) : null,
    };
  });
  return out.sort(porUrgencia);
}

export const NA_JANELA = (j: Janela | null) => j === "agora" || j === "ultima";
const GRUPOS_ACAO: GrupoAcao[] = ["baixar", "subir", "acao-comercial"];

export type ResumoDia = {
  porGrupo: Record<GrupoAcao, { blocos: number; datas: number }>;
  /** Decisões com ação (Baixar, Subir, Revisar canais) em Agora/Última chance, por ação, e as que ainda estão cedo. */
  paraDecidir: number;
  paraDecidirPor: Record<"baixar" | "subir" | "acao-comercial", number>;
  aindaCedo: number;
  /** Média de carros/dia abaixo da esperada nas datas com ação e nº dessas datas. */
  carrosAbaixoDia: number;
  datasAbaixo: number;
  carroDias: number;
  /** Só Agora/Última chance. */
  receitaRisco: number;
  receitaPotencial: number;
  /** Incluindo "ainda cedo". */
  receitaRiscoTotal: number;
  receitaPotencialTotal: number;
  /** Alguma sugestão de subida (na janela) parou antes do alvo por causa do passo e da antecedência. */
  potencialLimitado: boolean;
};

export function resumoDia(blocos: Bloco[]): ResumoDia {
  const porGrupo = Object.fromEntries(
    GRUPOS.map((g) => [g, { blocos: 0, datas: 0 }]),
  ) as ResumoDia["porGrupo"];
  const paraDecidirPor = { baixar: 0, subir: 0, "acao-comercial": 0 };
  let paraDecidir = 0;
  let aindaCedo = 0;
  let carroDias = 0;
  let abaixo = 0;
  let datasAbaixo = 0;
  let receitaRisco = 0;
  let receitaPotencial = 0;
  let receitaRiscoTotal = 0;
  let receitaPotencialTotal = 0;
  let potencialLimitado = false;
  for (const b of blocos) {
    const g = grupoDe(b.acao);
    porGrupo[g].blocos++;
    porGrupo[g].datas += b.itens.length;
    if (GRUPOS_ACAO.includes(g)) {
      if (NA_JANELA(b.janela)) {
        paraDecidir++;
        paraDecidirPor[g as keyof typeof paraDecidirPor]++;
      } else if (b.janela === "cedo") aindaCedo++;
      if (NA_JANELA(b.janela))
        for (const x of b.itens) {
          carroDias += Math.abs(x.carros);
          if (x.carros < 0) {
            abaixo += -x.carros;
            datasAbaixo++;
          }
        }
    }
    if (NA_JANELA(b.janela)) {
      if (g === "subir")
        for (const x of b.itens)
          if (x.sugerido && x.sugerido.max < Math.round(x.sugerido.centro))
            potencialLimitado = true;
      receitaRisco += b.receitaRisco;
      receitaPotencial += b.receitaPotencial;
    }
    if (NA_JANELA(b.janela) || b.janela === "cedo") {
      receitaRiscoTotal += b.receitaRisco;
      receitaPotencialTotal += b.receitaPotencial;
    }
  }
  return {
    porGrupo,
    paraDecidir,
    paraDecidirPor,
    aindaCedo,
    carrosAbaixoDia: datasAbaixo ? abaixo / datasAbaixo : 0,
    datasAbaixo,
    carroDias,
    receitaRisco,
    receitaPotencial,
    receitaRiscoTotal,
    receitaPotencialTotal,
    potencialLimitado,
  };
}

/* ───────────────────────── "Decidir hoje" ───────────────────────── */

/** Impacto = |carros/dia| × captura dos próximos 14 dias (fração). O nº de dias do bloco não multiplica. */
export function impacto(b: Bloco): number {
  return Math.abs(b.carrosDia) * (b.captura?.prox14 ?? 0);
}
const tarifaMedia = (b: Bloco) =>
  b.tarifaMin != null && b.tarifaMax != null ? (b.tarifaMin + b.tarifaMax) / 2 : 0;

/** As `n` decisões de maior impacto em Agora/Última chance (sem Manter); desempate pela tarifa. */
export function decidirHoje(blocos: Bloco[], n = 10): Bloco[] {
  return blocos
    .filter((b) => b.acao !== "manter" && NA_JANELA(b.janela))
    .sort((a, b) => impacto(b) - impacto(a) || tarifaMedia(b) - tarifaMedia(a))
    .slice(0, Math.max(0, n));
}

/** Decisões ainda cedo (sem Manter), da janela que abre primeiro à última. */
export function aindaCedo(blocos: Bloco[]): Bloco[] {
  return blocos
    .filter((b) => b.acao !== "manter" && b.janela === "cedo")
    .sort((a, b) => ((a.captura?.abre ?? "9999") < (b.captura?.abre ?? "9999") ? -1 : 1));
}

/** Próxima data em que uma janela abre (entre as decisões ainda cedo). */
export function proximaAbertura(blocos: Bloco[]): string | null {
  const ds = aindaCedo(blocos)
    .map((b) => b.captura?.abre)
    .filter((x): x is string => !!x);
  return ds.length ? ds.reduce((a, b) => (a < b ? a : b)) : null;
}

/** Evidência de cada pilar a favor / contra / neutra em relação à ação. */
export type Evidencia = "favor" | "contra" | "neutro";
export function evidencias(d: Pick<Decisao, "acao" | "occ" | "sinalHist" | "sinalMerc">): {
  ocupacao: Evidencia;
  historico: Evidencia;
  mercado: Evidencia;
} {
  const g = grupoDe(d.acao);
  const lado = (s: string): Evidencia => {
    if (g === "baixar") return s === "acima" ? "favor" : s === "abaixo" ? "contra" : "neutro";
    if (g === "subir") return s === "abaixo" ? "favor" : s === "acima" ? "contra" : "neutro";
    if (g === "acao-comercial")
      return s === "acima"
        ? "contra"
        : s === "abaixo" || s === "dentro" || s === "alinhado"
          ? "favor"
          : "neutro";
    return "neutro";
  };
  const occ: Evidencia =
    d.occ == null
      ? "neutro"
      : g === "baixar" || g === "acao-comercial"
        ? d.occ === "abaixo"
          ? "favor"
          : "contra"
        : g === "subir"
          ? d.occ === "acima"
            ? "favor"
            : "contra"
          : g === "manter"
            ? d.occ === "dentro"
              ? "favor"
              : "neutro"
            : "neutro";
  return { ocupacao: occ, historico: lado(d.sinalHist), mercado: lado(d.sinalMerc) };
}

/* ───────────────────────── selos ───────────────────────── */

export type TomSelo = "sustenta" | "neutro" | "contradiz" | "sem-dado";
export const TOM_SELO: Record<Evidencia, TomSelo> = {
  favor: "sustenta",
  neutro: "neutro",
  contra: "contradiz",
};
/** Vermelho = sustenta a ação, cinza = neutro, âmbar = contradiz, tracejado = sem dado. */
export const COR_SELO: Record<TomSelo, string> = {
  sustenta: "border-red-500/70 bg-red-500/10 text-red-500",
  neutro: "border-border bg-muted text-muted-foreground",
  contradiz: "border-amber-500/70 bg-amber-500/10 text-amber-500",
  "sem-dado": "border-dashed border-muted-foreground/50 bg-transparent text-muted-foreground",
};

const sinalNum = (v: number, casas = 0) => {
  const r = Number(v.toFixed(casas));
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r).toFixed(casas)}`;
};

/** Diferença da tarifa para a faixa ótima (bruta): 0 dentro dela; senão % contra a borda mais próxima. */
export function difFaixaPct(tarifa: number, f: { de: number; ate: number }): number {
  if (tarifa > f.ate) return (tarifa / f.ate - 1) * 100;
  if (tarifa < f.de) return (tarifa / f.de - 1) * 100;
  return 0;
}

export type Selo = { texto: string; tom: TomSelo };

/** Selos de um bloco: ocupação pela média diária do bloco; ritmo, histórico e mercado pela data mais próxima. */
export function selos(b: Bloco): { ocupacao: Selo; historico: Selo; mercado: Selo } {
  const d = b.itens.reduce((a, x) => (x.lead < a.lead ? x : a));
  const ev = evidencias(d);
  const ritmo =
    d.ritmoAtual != null && d.ritmoRef != null
      ? ` · ritmo ${Math.round(d.ritmoAtual)} vs ${Math.round(d.ritmoRef)}`
      : "";
  const ocupacao: Selo =
    d.occ == null
      ? { texto: "sem ocupação", tom: "sem-dado" }
      : { texto: `Ocup. ${sinalNum(b.carrosDia)} carros/dia${ritmo}`, tom: TOM_SELO[ev.ocupacao] };
  const historico: Selo =
    d.sinalHist === "sem-historico" || !d.hist.faixa || d.tarifa == null
      ? { texto: "sem histórico", tom: "sem-dado" }
      : (() => {
          const p = difFaixaPct(d.tarifa, d.hist.faixa);
          return {
            texto: p === 0 ? "Hist. na faixa ótima" : `Hist. ${sinalNum(p)}% da faixa ótima`,
            tom: TOM_SELO[ev.historico],
          };
        })();
  const mercado: Selo =
    d.sinalMerc === "sem-mercado" || d.mercado.pct == null
      ? { texto: "sem mercado", tom: "sem-dado" }
      : {
          texto: `Merc. ${sinalNum(d.mercado.pct)}% (${d.mercado.n} conc.)`,
          tom: TOM_SELO[ev.mercado],
        };
  return { ocupacao, historico, mercado };
}

/* ───────────────────────── calendário por ação ───────────────────────── */

export const COR_ACAO: Record<GrupoAcao, string> = {
  baixar: "bg-sky-500/25 border-sky-500/60",
  subir: "bg-emerald-500/25 border-emerald-500/60",
  "acao-comercial": "bg-amber-500/25 border-amber-500/60",
  verificar: "bg-muted border-dashed border-muted-foreground/50",
  manter: "bg-background border-border",
};

/** Ação do dia: a mais urgente entre as categorias (Manter só se todas mantêm; Verificar perde para ações de preço/comerciais). */
export function acaoDoDia(ds: Decisao[]): { grupo: GrupoAcao; decisao: Decisao } | null {
  if (!ds.length) return null;
  const peso = (d: Decisao) => {
    const g = grupoDe(d.acao);
    return g === "manter" ? 0 : g === "verificar" ? 1 : 2;
  };
  const best = [...ds].sort((a, b) => peso(b) - peso(a) || porUrgencia(a, b))[0]!;
  return { grupo: grupoDe(best.acao), decisao: best };
}

/** Por data: ação do dia (para colorir o calendário). */
export function calendarioAcoes(
  ds: Decisao[],
): Map<string, { grupo: GrupoAcao; decisao: Decisao; count: number }> {
  const por = new Map<string, Decisao[]>();
  for (const d of ds) por.set(d.date, [...(por.get(d.date) ?? []), d]);
  const out = new Map<string, { grupo: GrupoAcao; decisao: Decisao; count: number }>();
  for (const [date, l] of por) out.set(date, { ...acaoDoDia(l)!, count: l.length });
  return out;
}

/* ───────────────────────── frases ───────────────────────── */

export function dinheiro(v: number, cur = "USD"): string {
  const p =
    cur.toUpperCase() === "USD" ? "US$" : cur.toUpperCase() === "BRL" ? "R$" : cur.toUpperCase();
  const a = Math.abs(v);
  const num =
    a >= 1e6
      ? `${(v / 1e6).toFixed(1).replace(".", ",")} mi`
      : a >= 1e4
        ? `${(v / 1e3).toFixed(1).replace(".", ",")} mil`
        : Math.round(v).toLocaleString("pt-BR");
  return `${p} ${num}`;
}
const faixaDin = (a: number, b: number, cur: string) =>
  a === b ? dinheiro(a, cur) : `${dinheiro(a, cur)}–${Math.round(b)}`;
const pct0 = (v: number) => `${Math.round(v * 100)}%`;
const datasBR = (b: Pick<Bloco, "de" | "ate">) => {
  const f = (iso: string) => iso.slice(8, 10) + "/" + iso.slice(5, 7);
  return b.de === b.ate ? f(b.de) : `${f(b.de)} a ${f(b.ate)}`;
};
export const dataCurta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export function carrosDiaTxt(cd: number): string {
  const a = Math.abs(cd);
  return a === 0 ? "0" : a < 1 ? "<1" : `~${Math.round(a)}`;
}

export type Frases = { titulo: string; sinais: string; captura: string; confianca: string };

/** As quatro linhas do cartão de uma decisão, a partir dos sinais da data mais próxima do bloco. */
export function frases(b: Bloco, cur = "USD"): Frases {
  const d = b.itens.reduce((a, x) => (x.lead < a.lead ? x : a));
  const g = grupoDe(b.acao);
  const hoje = b.tarifaMin != null ? ` (hoje ${faixaDin(b.tarifaMin, b.tarifaMax!, cur)})` : "";
  const acao =
    (g === "baixar" || g === "subir") && b.sugMin != null
      ? `${GRUPO_TXT[g]} para ${faixaDin(b.sugMin, b.sugMax!, cur)}`
      : ACAO_TXT[b.acao];
  const titulo = `${b.category} · ${datasBR(b)} (${b.dias} ${b.dias === 1 ? "dia" : "dias"}) · faltam ${b.lead} dias → ${acao}${hoje}`;

  const partes: string[] = [];
  if (d.occ === "dentro") partes.push("ocupação dentro do esperado");
  else if (d.occ)
    partes.push(
      `${carrosDiaTxt(b.carrosDia)} carros/dia ${b.carrosDia < 0 ? "abaixo" : "acima"} do esperado`,
    );
  if (d.ritmoAtual != null) {
    const n = Math.round(d.ritmoAtual);
    const atual =
      n <= 0
        ? "nenhuma reserva nova em 14 dias"
        : `${n} reserva${n === 1 ? "" : "s"} nova${n === 1 ? "" : "s"} em 14 dias`;
    const ref =
      d.ritmoRef != null
        ? `; ${d.ritmoAno ?? "a referência"} teve ${Math.round(d.ritmoRef)} no mesmo período`
        : "";
    partes.push(atual + ref);
  }
  const m = d.mercado;
  if (d.sinalMerc === "sem-mercado" || m.pct == null) partes.push("sem cotação de mercado");
  else {
    const pos =
      d.sinalMerc === "alinhado"
        ? `tarifa alinhada ao mercado (${m.pct > 0 ? "+" : ""}${Math.round(m.pct)}%)`
        : `tarifa ${Math.abs(Math.round(m.pct))}% ${m.pct > 0 ? "acima" : "abaixo"} do mercado`;
    partes.push(
      `${pos}, mediana ${m.mediana != null ? dinheiro(m.mediana, cur) : "—"}, ${m.n} concorrente${m.n === 1 ? "" : "s"}`,
    );
  }
  const f = d.hist.faixa;
  if (d.sinalHist === "sem-historico" || !f || d.tarifa == null)
    partes.push("sem histórico suficiente");
  else {
    const dif = difFaixaPct(d.tarifa, f);
    const ep = d.hist.rotulo ? ` em ${d.hist.rotulo}` : "";
    const faixa = `${dinheiro(f.de, cur)}–${Math.round(f.ate)}`;
    partes.push(
      dif === 0
        ? `dentro da faixa que mais rendeu${ep}, ${faixa}`
        : `${Math.abs(Math.round(dif))}% ${dif > 0 ? "acima" : "abaixo"} da faixa que mais rendeu${ep}, ${faixa}`,
    );
  }
  const sinais = partes.join(" · ");

  const c = b.captura;
  const captura = c
    ? `Nos próximos 14 dias costuma entrar ${pct0(c.prox14)} das reservas desta data (base: ${BASE_TXT[c.base]}). Ainda faltam ${pct0(c.falta)}. Janela: ${JANELA_TXT[c.janela].toLowerCase()}${c.janela === "cedo" && c.abre ? `, rever a partir de ${dataCurta(c.abre)}` : ""}.`
    : "Sem curva de captura com amostra suficiente para esta categoria.";

  const conf = d.confianca;
  const motivo = conf.motivos.length ? juntar(conf.motivos) : "os três sinais concordam";
  const confianca = `Confiança ${NIVEL_TXT[b.confianca].toLowerCase()}: ${motivo}`;
  return { titulo, sinais, captura, confianca };
}

const juntar = (xs: string[]) =>
  xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} e ${xs[xs.length - 1]}`;

/* ───────────────────────── separação da fila por janela ───────────────────────── */

export type FilaSeparada = {
  /** Grupos de ação: só Agora/Última chance (e blocos sem curva de captura, que não têm janela); Manter, todos. */
  porGrupo: Record<GrupoAcao, Bloco[]>;
  /** Cedo: tendência, não decisão. */
  cedo: Bloco[];
  /** Tarde: a janela passou. */
  passou: Bloco[];
};

export function separarFila(blocos: Bloco[]): FilaSeparada {
  const porGrupo = Object.fromEntries(GRUPOS.map((g) => [g, [] as Bloco[]])) as Record<
    GrupoAcao,
    Bloco[]
  >;
  const cedo: Bloco[] = [];
  const passou: Bloco[] = [];
  for (const b of blocos) {
    const g = grupoDe(b.acao);
    if (g !== "manter" && b.janela === "cedo") cedo.push(b);
    else if (g !== "manter" && b.janela === "tarde") passou.push(b);
    else porGrupo[g].push(b);
  }
  return { porGrupo, cedo: aindaCedo(cedo), passou };
}

export const TENDENCIA_TXT: Record<GrupoAcao, string> = {
  baixar: "baixar",
  subir: "subir",
  "acao-comercial": "revisar canais",
  verificar: "verificar dados",
  manter: "manter",
};

/** Linha compacta de "Ainda cedo" / "Janela passou". */
export function linhaCompacta(b: Bloco): string {
  const datas = b.de === b.ate ? dataCurta(b.de) : `${dataCurta(b.de)} a ${dataCurta(b.ate)}`;
  const base = `${b.category} · ${datas} · faltam ${b.lead} dias · tendência: ${TENDENCIA_TXT[grupoDe(b.acao)]}`;
  return b.janela === "cedo" && b.captura?.abre
    ? `${base} · rever a partir de ${dataCurta(b.captura.abre)}`
    : base;
}

export type TomEtiqueta = Evidencia | "sem-dado";
export type Etiqueta = { nome: "Ocupação" | "Mercado" | "Histórico"; tom: TomEtiqueta };
/** Verde = a favor, cinza = neutro, âmbar = contra, tracejada = sem dado. */
export const COR_ETIQUETA: Record<TomEtiqueta, string> = {
  favor: "border-emerald-500/70 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  neutro: "border-border bg-muted text-muted-foreground",
  contra: "border-amber-500/70 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  "sem-dado": "border-dashed border-muted-foreground/50 text-muted-foreground",
};

export function etiquetas(
  d: Pick<Decisao, "acao" | "occ" | "sinalHist" | "sinalMerc">,
): [Etiqueta, Etiqueta, Etiqueta] {
  const ev = evidencias(d);
  return [
    { nome: "Ocupação", tom: d.occ == null ? "sem-dado" : ev.ocupacao },
    { nome: "Mercado", tom: d.sinalMerc === "sem-mercado" ? "sem-dado" : ev.mercado },
    { nome: "Histórico", tom: d.sinalHist === "sem-historico" ? "sem-dado" : ev.historico },
  ];
}

/* ───────────────────────── cartão de leitura rápida ───────────────────────── */

/** problema = ocupação abaixo motivando a ação (vermelho); motivo-alta = ocupação acima motivando Subir (azul). */
export type TomBloco = "favor" | "neutro" | "problema" | "motivo-alta" | "contra" | "sem-dado";
/** Barra no topo de cada bloco: verde a favor, cinza neutro, vermelho = problema que motivou a ação, âmbar = contradiz. */
export const COR_BARRA: Record<TomBloco, string> = {
  favor: "bg-emerald-500",
  neutro: "bg-muted-foreground/30",
  problema: "bg-red-500",
  "motivo-alta": "bg-sky-500",
  contra: "bg-amber-500",
  "sem-dado": "bg-muted-foreground/20",
};
export const COR_CONCLUSAO: Record<TomBloco, string> = {
  favor: "text-emerald-600 dark:text-emerald-400",
  neutro: "text-muted-foreground",
  problema: "text-red-600 dark:text-red-400",
  "motivo-alta": "text-sky-600 dark:text-sky-400",
  contra: "text-amber-600 dark:text-amber-400",
  "sem-dado": "text-muted-foreground",
};

export type BlocoPilar = {
  nome: "Ocupação" | "Mercado" | "Nosso histórico";
  valor: string;
  conclusao: string;
  detalhe: string;
  tom: TomBloco;
};

const tomDe = (e: Evidencia): TomBloco =>
  e === "favor" ? "favor" : e === "contra" ? "contra" : "neutro";

/** Os três blocos do cartão (ocupação, mercado, histórico), pela média do bloco e pela data mais próxima. */
export function blocosPilares(b: Bloco, cur = "USD"): [BlocoPilar, BlocoPilar, BlocoPilar] {
  const d = b.itens.reduce((a, x) => (x.lead < a.lead ? x : a));
  const ev = evidencias(d);
  const g = grupoDe(b.acao);

  let ocupacao: BlocoPilar;
  if (d.occ == null)
    ocupacao = {
      nome: "Ocupação",
      valor: "—",
      conclusao: "sem ocupação",
      detalhe: "",
      tom: "sem-dado",
    };
  else {
    const ritmo =
      d.ritmoAtual != null
        ? `${Math.round(d.ritmoAtual)} reserva${Math.round(d.ritmoAtual) === 1 ? "" : "s"} em 14 dias${d.ritmoRef != null ? ` (${d.ritmoAno ?? "ref."}: ${Math.round(d.ritmoRef)})` : ""}`
        : "sem ritmo de referência";
    const motivou = d.occ !== "dentro" && g !== "manter" && g !== "verificar";
    ocupacao = {
      nome: "Ocupação",
      valor: d.occ === "dentro" ? "0 carros/dia" : `${sinalNum(b.carrosDia)} carros/dia`,
      conclusao:
        d.occ === "abaixo"
          ? "abaixo do esperado"
          : d.occ === "acima"
            ? "acima do esperado"
            : "no esperado",
      detalhe: ritmo,
      tom: motivou ? (d.occ === "acima" ? "motivo-alta" : "problema") : tomDe(ev.ocupacao),
    };
  }

  const m = d.mercado;
  const mercado: BlocoPilar =
    d.sinalMerc === "sem-mercado" || m.pct == null
      ? { nome: "Mercado", valor: "—", conclusao: "sem cotação", detalhe: "", tom: "sem-dado" }
      : {
          nome: "Mercado",
          valor: `${sinalNum(m.pct)}%`,
          conclusao:
            d.sinalMerc === "acima"
              ? "mais caro"
              : d.sinalMerc === "abaixo"
                ? "já mais barato"
                : "alinhado",
          detalhe: `mediana ${m.mediana != null ? dinheiro(m.mediana, cur) : "—"} · ${m.n} concorrente${m.n === 1 ? "" : "s"}`,
          tom: tomDe(ev.mercado),
        };

  const f = d.hist.faixa;
  const historico: BlocoPilar =
    d.sinalHist === "sem-historico" || !f || d.tarifa == null
      ? {
          nome: "Nosso histórico",
          valor: "—",
          conclusao: "sem histórico",
          detalhe: "",
          tom: "sem-dado",
        }
      : {
          nome: "Nosso histórico",
          valor: `${sinalNum(difFaixaPct(d.tarifa, f))}%`,
          conclusao:
            d.sinalHist === "acima"
              ? "acima da faixa que mais rende"
              : d.sinalHist === "abaixo"
                ? "abaixo da faixa que mais rende"
                : "dentro da faixa que mais rende",
          detalhe: `mais rendeu: ${dinheiro(f.de, cur)}–${Math.round(f.ate)} (${d.hist.rotulo ?? "época"})`,
          tom: tomDe(ev.historico),
        };
  return [ocupacao, mercado, historico];
}

export type IconeAcao = "baixar" | "subir" | "canais" | "verificar" | "manter";
export type EtiquetaAcao = { texto: string; icone: IconeAcao; cor: string };
export const COR_ACAO_ETIQUETA: Record<IconeAcao, string> = {
  baixar: "border-sky-500/60 bg-sky-500/10 text-sky-600 dark:text-sky-400",
  subir: "border-emerald-500/60 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  canais: "border-amber-500/60 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  verificar: "border-dashed border-muted-foreground/60 text-muted-foreground",
  manter: "border-border bg-muted text-muted-foreground",
};

/** Variação média sugerida no bloco (% sobre a tarifa de cada dia); null sem sugestão. */
export function movimentoPct(b: Bloco): number | null {
  const xs = b.itens
    .filter((x) => x.sugerido && x.tarifa)
    .map((x) => (x.sugerido!.min / x.tarifa! - 1) * 100);
  return xs.length ? xs.reduce((a, v) => a + v, 0) / xs.length : null;
}

/** Texto do preço sugerido: um valor; num bloco com tarifas diferentes, o % e a faixa "conforme o dia". */
export function sugestaoTxt(b: Bloco, cur = "USD"): string | null {
  if (b.sugMin == null) return null;
  if (b.sugMin === b.sugMax) return dinheiro(b.sugMin, cur);
  const p = movimentoPct(b);
  return `${p != null ? `~${Math.abs(Math.round(p))}% · ` : ""}${dinheiro(b.sugMin, cur)}–${b.sugMax} conforme o dia`;
}

export function etiquetaAcao(b: Bloco, cur = "USD"): EtiquetaAcao {
  const g = grupoDe(b.acao);
  const faixa = sugestaoTxt(b, cur);
  const e = (texto: string, icone: IconeAcao): EtiquetaAcao => ({
    texto,
    icone,
    cor: COR_ACAO_ETIQUETA[icone],
  });
  const varia = b.sugMin != null && b.sugMin !== b.sugMax;
  const p = movimentoPct(b);
  const txt = (verbo: string) =>
    !faixa
      ? verbo
      : varia
        ? `${verbo} ~${Math.abs(Math.round(p ?? 0))}% (${dinheiro(b.sugMin!, cur)}–${b.sugMax} conforme o dia)`
        : `${verbo} para ${faixa}`;
  if (g === "baixar") return e(txt("Baixar"), "baixar");
  if (g === "subir") return e(txt("Subir"), "subir");
  if (g === "acao-comercial") return e("Não baixar preço · revisar canais e demanda", "canais");
  if (g === "verificar") return e(`Verificar: ${motivoVerificar(b).curto}`, "verificar");
  const dm = b.itens.find((x) => x.manterMotivo);
  return e(dm ? "Manter · mudança sugerida pequena demais" : "Manter", "manter");
}

export function cabecalho(b: Bloco): { titulo: string; sub: string } {
  return {
    titulo: `${b.category} · ${datasBR(b)}`,
    sub: `${b.dias} ${b.dias === 1 ? "dia" : "dias"} · faltam ${b.lead}`,
  };
}

/** Linha de contexto: tarifa de hoje e captura. */
export function contexto(b: Bloco, cur = "USD"): string {
  const partes = [
    b.tarifaMin != null
      ? `Tarifa hoje ${faixaDin(b.tarifaMin, b.tarifaMax!, cur)}`
      : "Sem tarifa hoje",
  ];
  if (b.captura)
    partes.push(
      `nos próximos 14 dias entram ~${pct0(b.captura.prox14)} das reservas`,
      `faltam ${pct0(b.captura.falta)}`,
    );
  else partes.push("sem curva de captura");
  return partes.join(" · ");
}

/** Explicação da confiança, pilar a pilar, em linguagem simples (tooltip do cartão). */
export function explicarConfianca(
  d: Pick<Decisao, "acao" | "occ" | "sinalHist" | "sinalMerc" | "verificarMotivo" | "confianca">,
): { resumo: string; linhas: string[] } {
  const nivel = NIVEL_TXT[d.confianca.nivel].toLowerCase();
  if (d.acao === "verificar")
    return {
      resumo: `Confiança ${nivel}: não há sinais de preço suficientes para recomendar mexer.`,
      linhas: [d.verificarMotivo ?? "Sem mercado e sem histórico para esta data."],
    };
  const g = grupoDe(d.acao);
  const pede =
    g === "baixar"
      ? "baixar"
      : g === "subir"
        ? "subir"
        : g === "acao-comercial"
          ? "não baixar"
          : "manter";
  const ev = evidencias(d);
  const occTxt =
    d.occ === "abaixo"
      ? "vendendo menos que o esperado"
      : d.occ === "acima"
        ? "vendendo mais que o esperado"
        : "no esperado";
  const mercTxt =
    d.sinalMerc === "acima"
      ? "estamos mais caros que o mercado"
      : d.sinalMerc === "abaixo"
        ? "estamos mais baratos que o mercado"
        : "estamos alinhados ao mercado";
  const histTxt =
    d.sinalHist === "acima"
      ? "tarifa acima da faixa que mais rendeu"
      : d.sinalHist === "abaixo"
        ? "tarifa abaixo da faixa que mais rendeu"
        : "tarifa dentro da faixa que mais rendeu";
  const linha = (nome: string, e: Evidencia, txt: string, falta: boolean) =>
    falta
      ? `— ${nome}: sem dado, não opina.`
      : e === "favor"
        ? `✓ ${nome}: ${txt} → também pede ${pede}.`
        : e === "contra"
          ? `✗ ${nome}: ${txt} → aponta para o lado contrário.`
          : `— ${nome}: ${txt} → não pede nem subir nem baixar.`;
  const linhas = [
    linha("Ocupação", ev.ocupacao, occTxt, d.occ == null),
    linha("Mercado", ev.mercado, mercTxt, d.sinalMerc === "sem-mercado"),
    linha("Histórico", ev.historico, histTxt, d.sinalHist === "sem-historico"),
  ];
  const n = d.confianca.nivel;
  const resumo =
    n === "alta"
      ? `Confiança alta: os três sinais pedem ${pede}.`
      : n === "media"
        ? `Confiança média: dois sinais pedem ${pede} e um não opina. A sugestão vale, mas com um apoio a menos.`
        : `Confiança baixa: um dos sinais aponta para o lado contrário. Confira antes de seguir.`;
  return { resumo, linhas };
}

/* ───────────────────────── matriz ocupação × mercado ───────────────────────── */

export type CelulaMatriz = {
  occ: "abaixo" | "neutro" | "acima";
  market: "acima" | "alinhado" | "abaixo" | "sem-dados";
  count: number;
};
/** Contagem de data × categoria por ocupação (tolerância da Gestão) × mercado (±5%); sem ocupação fica fora. */
export function matrizOcupacaoMercado(itens: { occ: SinalOcc | null; merc: SinalMerc }[]): {
  cells: CelulaMatriz[];
  semBenchmark: number;
} {
  const OCC = ["abaixo", "neutro", "acima"] as const;
  const MERC = ["acima", "alinhado", "abaixo", "sem-dados"] as const;
  const cells: CelulaMatriz[] = OCC.flatMap((occ) =>
    MERC.map((market) => ({ occ, market, count: 0 })),
  );
  let semBenchmark = 0;
  for (const it of itens) {
    if (it.occ == null) {
      semBenchmark++;
      continue;
    }
    const o = it.occ === "dentro" ? "neutro" : it.occ;
    const m = it.merc === "sem-mercado" ? "sem-dados" : it.merc;
    cells.find((c) => c.occ === o && c.market === m)!.count++;
  }
  return { cells, semBenchmark };
}

/** Etiqueta abaixo do nome do pilar: papel do sinal na ação. */
export const ETIQUETA_BLOCO: Record<TomBloco, { texto: string; cor: string }> = {
  favor: {
    texto: "sustenta a ação",
    cor: "border-emerald-500/60 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  neutro: { texto: "neutro", cor: "border-border bg-muted text-muted-foreground" },
  contra: {
    texto: "contra",
    cor: "border-amber-500/60 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  problema: {
    texto: "motivo da ação",
    cor: "border-red-500/60 bg-red-500/10 text-red-600 dark:text-red-400",
  },
  "motivo-alta": {
    texto: "motivo da ação",
    cor: "border-sky-500/60 bg-sky-500/10 text-sky-600 dark:text-sky-400",
  },
  "sem-dado": {
    texto: "sem dado",
    cor: "border-dashed border-muted-foreground/50 text-muted-foreground",
  },
};

/** Por que a decisão é "Verificar dados": texto curto da etiqueta e o que conferir. */
export function motivoVerificar(b: Bloco): { curto: string; oQueFazer: string } {
  const d = b.itens.reduce((a, x) => (x.lead < a.lead ? x : a));
  if (d.verificarMotivo)
    return {
      curto: "cotação do concorrente pode não ser equivalente",
      oQueFazer: `A sugestão de preço dependia só do mercado, e a cotação parece estranha (${d.mercado.n === 1 ? "só 1 concorrente" : `diferença de ${Math.abs(Math.round(d.mercado.pct ?? 0))}%`}). Abra a Competitividade nesta data e confira se a oferta é o mesmo carro, categoria e pacote.`,
    };
  if (d.tarifa == null)
    return {
      curto: "sem tarifa nossa nesta data",
      oQueFazer:
        "Não há tarifa nossa lida para esta data e categoria, então não dá para comparar com o mercado nem com o histórico. Confira se a tarifa foi carregada.",
    };
  return {
    curto: "sem mercado e sem histórico",
    oQueFazer:
      "Não há cotação de concorrente para esta data e o histórico da época tem amostra pequena demais. Sem referência de preço, não dá para dizer se subir ou baixar. Confira a coleta de concorrentes desta data.",
  };
}
