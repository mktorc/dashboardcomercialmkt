/**
 * Perfil de antecedência de compra por categoria: a mesma curva histórica de captura da Gestão de Ocupação (captureProfile, líquida),
 * agora por categoria + mês da retirada, com fallback por amostra, interpolação e a "janela de ação" de cada decisão.
 */
import { captureProfile } from "./capture";
import { addDays, type PaceCal, type PaceRow } from "./occupancy-pace";

export type BaseCurva = "categoria-mes" | "categoria-sazonalidade" | "todas-mes";
export const BASE_TXT: Record<BaseCurva, string> = {
  "categoria-mes": "categoria, mês",
  "categoria-sazonalidade": "categoria, sazonalidade",
  "todas-mes": "todas as categorias, mês",
};

export type PontoCurva = { L: number; share: number };
export type Curva = { base: BaseCurva; datas: number; pontos: PontoCurva[] };

export type JanelaConfig = {
  /** Mínimo de datas encerradas para aceitar uma base da curva. */
  minDatas: number;
  /** Agora: os próximos 14 dias capturam ao menos isto. */
  agora14: number;
  /** Cedo: os próximos 30 dias capturam menos que isto. */
  cedo30: number;
  /** Última chance: falta capturar menos que isto (e mais que `tarde`). */
  ultima: number;
  /** Tarde: falta capturar isto ou menos. */
  tarde: number;
};
export const JANELA_PADRAO: JanelaConfig = {
  minDatas: 15,
  agora14: 0.1,
  cedo30: 0.1,
  ultima: 0.25,
  tarde: 0.05,
};

/** Antecedência máxima das vendas no payload (PaceRow.a vai até D-400): âncora de captura 0 para interpolar além da curva. */
const L_MAX = 400;

const pontosDe = (
  rows: PaceRow[],
  base: string,
  de: string,
  cat: string | null,
  f: (r: PaceRow) => boolean,
) => {
  const p = captureProfile(rows, base, de, cat, f);
  const datas = p.find((x) => x.L === 0)?.n ?? 0;
  const pontos = p
    .filter((x): x is typeof x & { share: number } => x.share != null)
    .map((x) => ({ L: x.L, share: x.share }));
  return { datas, pontos };
};

/**
 * Curva da categoria para o mês (e sazonalidade) da retirada. Datas de evento ficam fora (perfil diferente).
 * Fallback: categoria + mês → categoria + sazonalidade → todas as categorias + mês; abaixo de `minDatas` em todas, null.
 */
export function curvaCategoria(
  rows: PaceRow[],
  base: string,
  historyStart: string,
  cal: PaceCal,
  category: string,
  mes: number,
  sazonalidade: string | null,
  cfg: JanelaConfig = JANELA_PADRAO,
): Curva | null {
  const comum = (r: PaceRow) => !cal[r.d]?.[1];
  const doMes = (r: PaceRow) => comum(r) && Number(r.d.slice(5, 7)) === mes;
  const tentativas: [BaseCurva, string | null, (r: PaceRow) => boolean][] = [
    ["categoria-mes", category, doMes],
    ...(sazonalidade
      ? [
          [
            "categoria-sazonalidade",
            category,
            (r: PaceRow) => comum(r) && cal[r.d]?.[0] === sazonalidade,
          ] as [BaseCurva, string | null, (r: PaceRow) => boolean],
        ]
      : []),
    ["todas-mes", null, doMes],
  ];
  for (const [b, cat, f] of tentativas) {
    const { datas, pontos } = pontosDe(rows, base, historyStart, cat, f);
    if (datas >= cfg.minDatas && pontos.length >= 2) return { base: b, datas, pontos };
  }
  return null;
}

/** Captura (0–1) na antecedência L, interpolada linearmente entre os pontos; L ≤ 0 = 1; além do último ponto, até 0 em D-400. */
export function capturaEm(c: Pick<Curva, "pontos">, L: number): number {
  if (L <= 0) return 1;
  const pts = [...c.pontos, ...(c.pontos.some((p) => p.L >= L_MAX) ? [] : [{ L: L_MAX, share: 0 }])]
    .concat(c.pontos.some((p) => p.L === 0) ? [] : [{ L: 0, share: 1 }])
    .sort((a, b) => a.L - b.L);
  if (L >= pts[pts.length - 1]!.L) return pts[pts.length - 1]!.share;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    if (L <= b.L) return a.share + ((b.share - a.share) * (L - a.L)) / (b.L - a.L);
  }
  return 0;
}

export const faltaCapturar = (c: Pick<Curva, "pontos">, L: number) =>
  Math.max(0, 1 - capturaEm(c, L));
/** O que costuma entrar nos próximos `dias` dias (de D-L até D-(L−dias)). */
export const capturaProximos = (c: Pick<Curva, "pontos">, L: number, dias = 14) =>
  Math.max(0, capturaEm(c, L - dias) - capturaEm(c, L));

/**
 * Primeira data (a partir de hoje) em que a captura dos 14 dias seguintes passa de `limiar`. Hoje mesmo, se já passou;
 * null se nunca passa até a retirada.
 */
export function aberturaJanela(
  c: Pick<Curva, "pontos">,
  lead: number,
  hoje: string,
  limiar = JANELA_PADRAO.agora14,
): string | null {
  for (let k = 0; k <= lead; k++)
    if (capturaProximos(c, lead - k) > limiar) return addDays(hoje, k);
  return null;
}

export type Janela = "cedo" | "agora" | "ultima" | "tarde";
export const JANELAS: Janela[] = ["agora", "ultima", "cedo", "tarde"];
export const JANELA_TXT: Record<Janela, string> = {
  cedo: "Cedo",
  agora: "Agora",
  ultima: "Última chance",
  tarde: "Tarde",
};
export const JANELA_DICA: Record<Janela, string> = {
  agora:
    "Os próximos 14 dias costumam trazer 10% ou mais das reservas desta data: o preço tem mais efeito agora.",
  ultima: "Falta entrar menos de 25% das reservas: última chance de o preço mudar o resultado.",
  cedo: "Os próximos dias trazem pouco das reservas desta data: ainda é cedo para mexer.",
  tarde: "Falta entrar 5% ou menos das reservas: mudar o preço quase não altera o resultado.",
};
/** Cor da borda do cartão por janela. */
export const JANELA_BORDA: Record<Janela, string> = {
  agora: "border-red-500/70",
  ultima: "border-amber-500/70",
  cedo: "border-border",
  tarde: "border-border",
};

/**
 * Janela de ação. Ordem: Tarde (falta ≤ 5%) → Última chance (falta < 25%) → Agora (14 dias ≥ 10%) → Cedo. Uma data em que os
 * próximos 30 dias passam de 10% mas os próximos 14 não chegam lá também é Cedo: a janela abre em poucos dias.
 */
export function janelaDe(
  c: Pick<Curva, "pontos">,
  L: number,
  cfg: JanelaConfig = JANELA_PADRAO,
): Janela {
  const falta = faltaCapturar(c, L);
  if (falta <= cfg.tarde + 1e-9) return "tarde";
  if (falta < cfg.ultima) return "ultima";
  if (capturaProximos(c, L, 14) >= cfg.agora14) return "agora";
  return "cedo";
}

export type CapturaDecisao = {
  base: BaseCurva;
  datas: number;
  pontos: PontoCurva[];
  /** Captura já típica na antecedência atual, o que falta e o que entra nos próximos 14 e 30 dias (0–1). */
  atual: number;
  falta: number;
  prox14: number;
  prox30: number;
  janela: Janela;
  abre: string | null;
};

export function capturaDecisao(
  c: Curva,
  lead: number,
  hoje: string,
  cfg: JanelaConfig = JANELA_PADRAO,
): CapturaDecisao {
  return {
    base: c.base,
    datas: c.datas,
    pontos: c.pontos,
    atual: capturaEm(c, lead),
    falta: faltaCapturar(c, lead),
    prox14: capturaProximos(c, lead, 14),
    prox30: capturaProximos(c, lead, 30),
    janela: janelaDe(c, lead, cfg),
    abre: aberturaJanela(c, lead, hoje, cfg.agora14),
  };
}
