import {
  activeAt,
  addDays,
  histFleet,
  revenueOf,
  type PaceRow,
  type RefItem,
} from "./occupancy-pace";
import { ganhoAteData } from "./occupancy-pace";

/**
 * Leituras extras da tela de detalhe da data (carros, faixa, projeção, preço, ritmo, avisos e curvas das referências).
 * Só informação: não entram na regra da esperada nem do gap.
 */

/** Frota atual abaixo da qual a esperada oscila muito (cada carro pesa demais). */
export const FROTA_PEQUENA_LIMITE = 30;

/** Ocupação (0–1) em carros inteiros, na frota dada. */
export const carros = (occ: number, fleet: number) => Math.round(occ * fleet);

/** Gap em p.p. convertido para carros, na frota sobre a qual o gap foi medido. */
export const gapCarros = (gapPp: number, fleet: number) => Math.round((gapPp / 100) * fleet);

export type Faixa = {
  min: { date: string; occ: number };
  max: { date: string; occ: number };
  /** Posição da atual em relação à faixa; null sem atual. */
  status: "abaixo" | "dentro" | "acima" | null;
};

/** Faixa entre a menor e a maior ocupação das referências (na antecedência analisada). Com menos de duas referências, null. */
export function faixaReferencias(items: Pick<RefItem, "date" | "occ">[], atual: number | null): Faixa | null {
  const xs = items.filter((i): i is { date: string; occ: number } => i.occ != null);
  if (xs.length < 2) return null;
  const min = xs.reduce((a, b) => (b.occ < a.occ ? b : a));
  const max = xs.reduce((a, b) => (b.occ > a.occ ? b : a));
  const status = atual == null ? null : atual < min.occ ? "abaixo" : atual > max.occ ? "acima" : "dentro";
  return { min: { date: min.date, occ: min.occ }, max: { date: max.date, occ: max.occ }, status };
}

export const FAIXA_TXT = { abaixo: "abaixo da faixa", dentro: "dentro da faixa", acima: "acima da faixa" } as const;

export type Projecao = { ganhoCarros: number; fechaCarros: number; fechaOcc: number; revPorVeiculo: number | null };

/**
 * Projeção simples de fechamento: reservados hoje + o ganho que a referência teve até a data (em p.p. da frota, convertido para a
 * frota atual), limitado à frota atual. A ocupação projetada é derivada dos carros arredondados. Faturamento por veículo = ocupação projetada × diária média de hoje. Não é previsão.
 */
export function projecaoFechamento(
  it: Pick<RefItem, "occ" | "occFinal">,
  booked: number,
  capacity: number,
  diariaAtual: number | null,
): Projecao | null {
  const g = ganhoAteData(it);
  if (g == null || !capacity) return null;
  // Carros primeiro (inteiros, entre 0 e a frota); o % sai deles, para os dois sempre baterem.
  const fechaCarros = Math.max(0, Math.min(capacity, Math.round(booked + (g / 100) * capacity)));
  const fechaOcc = fechaCarros / capacity;
  return {
    ganhoCarros: Math.round((g / 100) * capacity),
    fechaCarros,
    fechaOcc,
    revPorVeiculo: diariaAtual != null ? fechaOcc * diariaAtual : null,
  };
}

/** Diferença % da diária média de hoje contra a da referência na mesma antecedência; null sem os dois valores. */
export function difDiariaPct(hoje: number | null, ref: number | null): number | null {
  return hoje != null && ref != null && ref > 0 ? (hoje / ref - 1) * 100 : null;
}

/** Diária média da referência nas diárias vendidas até a antecedência L (lê as linhas históricas). */
export const diariaEmL = (hist: PaceRow[], L: number): number | null => revenueOf(hist, L).diaria;

/**
 * Ritmo recente: diárias ativas que entraram nos últimos `dias` dias antes da antecedência L (ativas em L − ativas em L+dias).
 * Mesma regra da ocupação: as depois canceladas contam se ainda estavam ativas. Null quando L+dias cai antes do início da base `de`
 * (para uma data da referência `date`) ou quando L ≤ 0 (data encerrada).
 */
export function ritmoRecente(rows: PaceRow[], L: number, dias: number, opts?: { date: string; de: string }): number | null {
  if (L <= 0 || !rows.length) return null;
  if (opts && addDays(opts.date, -(L + dias)) < opts.de) return null;
  const at = (l: number) => rows.reduce((n, r) => n + activeAt(r, l), 0);
  return at(L) - at(L + dias);
}

/** Maior antecedência (≥ 1) em que a ocupação da referência chegou a 100%; null se não lotou antes de D-0. */
export function lotouEm(hist: PaceRow[]): number | null {
  const fleet = hist.reduce((n, h) => n + histFleet(h), 0);
  if (!fleet) return null;
  let max = 0;
  for (const h of hist) {
    for (const x of h.a) if (x > max) max = x;
    for (const [c] of h.x ?? []) if (c > max) max = c;
  }
  for (let L = max; L >= 1; L--) {
    if (hist.reduce((n, h) => n + activeAt(h, L), 0) / fleet >= 1) return L;
  }
  return null;
}

/** Aviso de frota pequena: cada carro vale 100/frota p.p. Null quando a frota atinge o limite. */
export function avisoFrotaPequena(capacity: number, limite = FROTA_PEQUENA_LIMITE): { ppPorCarro: number; texto: string } | null {
  if (!capacity || capacity >= limite) return null;
  const pp = 100 / capacity;
  return { ppPorCarro: pp, texto: `cada carro vale ${pp.toFixed(1).replace(".", ",")} p.p.; a esperada oscila muito` };
}

/** Ocupação (0–1, sem limite) de uma referência em cada antecedência da lista. */
export function curvaReferencia(hist: PaceRow[], leads: number[]): { L: number; occ: number }[] {
  const fleet = hist.reduce((n, h) => n + histFleet(h), 0);
  return leads.map((L) => ({ L, occ: fleet ? hist.reduce((n, h) => n + activeAt(h, L), 0) / fleet : 0 }));
}

/** Primeiro ponto da curva (maior antecedência) com ocupação de 100% ou mais; null se nenhum. */
export const primeiroCheio = (curva: { L: number; occ: number }[]) => curva.find((p) => p.occ >= 1) ?? null;

export type CurvaDetalhePonto = {
  label: string;
  L: number;
  capacidade: number;
  atual: number | null;
  atualCarros: number | null;
  esperada: number | null;
  esperadaCarros: number | null;
} & Record<string, number | string | null>;

/**
 * Curva de pickup da data com as referências desenhadas: a linha `esperada` (a usada) e uma linha por outra referência
 * (`ref0`, `ref1`, …, só ocupação ≤ 100%). Cada série leva também os carros na frota atual (`<chave>Carros`) para o tooltip.
 * `marcas` = primeiro ponto em que cada série chegou a 100%.
 */
export function curvaDetalhe(
  pontos: { label: string; L: number; atual: number | null; esperada: number | null }[],
  items: Pick<RefItem, "date" | "hist" | "occ" | "chosen">[],
  capacity: number,
) {
  const outras = items.filter((i) => !i.chosen && i.occ != null && i.hist.length);
  const usada = items.find((i) => i.chosen);
  const leads = pontos.map((p) => p.L);
  const curvas = outras.map((i) => curvaReferencia(i.hist, leads));
  const curvaUsada = usada ? curvaReferencia(usada.hist, leads) : null;
  const data: CurvaDetalhePonto[] = pontos.map((p, idx) => {
    const pt: CurvaDetalhePonto = {
      label: p.label,
      L: p.L,
      capacidade: capacity,
      atual: p.atual != null ? p.atual * 100 : null,
      atualCarros: p.atual != null ? carros(p.atual, capacity) : null,
      esperada: p.esperada != null ? p.esperada * 100 : null,
      esperadaCarros: p.esperada != null ? carros(p.esperada, capacity) : null,
    };
    curvas.forEach((c, k) => {
      const o = Math.min(1, c[idx]!.occ);
      pt[`ref${k}`] = o * 100;
      pt[`ref${k}Carros`] = carros(o, capacity);
    });
    return pt;
  });
  const marca = (c: { L: number; occ: number }[] | null, key: string) => {
    const f = c ? primeiroCheio(c) : null;
    return f ? { key, label: pontos.find((p) => p.L === f.L)!.label } : null;
  };
  return {
    data,
    extras: outras.map((i, k) => ({ key: `ref${k}`, date: i.date })),
    marcas: [marca(curvaUsada, "esperada"), ...curvas.map((c, k) => marca(c, `ref${k}`))].filter(
      (m): m is { key: string; label: string } => !!m,
    ),
  };
}

export type PrecoVenda = { valor: number; cobertas: number; total: number; faltam: string[] };

/**
 * Preço de venda atual (nossa tarifa para a data) das linhas analisadas: com uma categoria, o dela; com várias, a média ponderada
 * pela frota das que têm tarifa. `tarifas` vem de "data|categoria" → diária. Sem nenhuma tarifa, null.
 */
export function precoVendaAtual(rows: PaceRow[], tarifas: Map<string, number>, date: string): PrecoVenda | null {
  let v = 0;
  let f = 0;
  const faltam: string[] = [];
  for (const r of rows) {
    const t = tarifas.get(`${date}|${r.c}`);
    if (t == null || !r.f) {
      faltam.push(r.c);
      continue;
    }
    v += t * r.f;
    f += r.f;
  }
  return f ? { valor: v / f, cobertas: rows.length - faltam.length, total: rows.length, faltam } : null;
}
