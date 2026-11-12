import { ritmoRecente } from "./occupancy-detail";
import { usd } from "./pricing-format";
import {
  addDays,
  histFleet,
  revenueRow,
  type DayPace,
  type JanelaRef,
  type PacePayload,
  type PaceRow,
} from "./occupancy-pace";

/**
 * Análise do NOSSO preço (diária média) cruzada com ocupação e antecedência. Só leitura: não entra na esperada nem no gap.
 * Fonte: o payload de ocupação (`PaceRow`): `a` = antecedência de criação de cada diária confirmada, `m` = preço pago de cada uma
 * (mesma ordem), `x` = diárias depois canceladas (sem preço). Unidade = diária (um carro em um dia).
 */

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : null);
const EPS = 1e-9;

/* ───────────────────────── 3.1 Quadrante ocupação × preço ───────────────────────── */

export type Tolerancias = {
  /** Gap de ocupação "no ritmo": ± p.p. ou ± carros, o que for maior. */
  ocupPp: number;
  ocupCarros: number;
  /** Preço "alinhado": ± % contra a diária do ano escolhido. */
  precoPct: number;
  /** Ritmo recente "igual": ± carros ou ± % do ritmo da referência, o que for maior. */
  ritmoCarros: number;
  ritmoPct: number;
  /** Aviso "Referência lotou em D-X" só aparece para X maior que isto (lotar perto da data não indica preço baixo). */
  lotacaoDias: number;
};
export const TOL_PADRAO: Tolerancias = { ocupPp: 5, ocupCarros: 1, precoPct: 5, ritmoCarros: 1, ritmoPct: 10, lotacaoDias: 14 };

export type SinalOcupacao = "abaixo" | "no-ritmo" | "acima";
export type SinalPreco = "mais-caro" | "alinhado" | "mais-barato";
export type SinalRitmo = "abaixo" | "igual" | "acima";
export type Diagnostico = "preco-alto" | "avaliar-preco" | "aguardar" | "demanda-fraca" | "no-ritmo" | "vendendo-barato" | "forte";

export const DIAGNOSTICO_LABEL: Record<Diagnostico, string> = {
  "preco-alto": "Preço alto",
  "avaliar-preco": "Avaliar preço",
  aguardar: "Aguardar",
  "demanda-fraca": "Demanda fraca",
  "no-ritmo": "No ritmo",
  "vendendo-barato": "Vendendo barato",
  forte: "Forte",
};
export const DIAGNOSTICO_ORDEM = Object.keys(DIAGNOSTICO_LABEL) as Diagnostico[];

/** Gap (p.p.) contra a esperada: dentro de ±ocupPp ou ±ocupCarros carros (o maior limite vale) = no ritmo; limites inclusivos. */
export function sinalOcupacao(gapPp: number, capCov: number, tol: Tolerancias = TOL_PADRAO): SinalOcupacao {
  const lim = Math.max(tol.ocupPp, capCov > 0 ? (tol.ocupCarros / capCov) * 100 : 0);
  return gapPp < -lim - EPS ? "abaixo" : gapPp > lim + EPS ? "acima" : "no-ritmo";
}

/** Diária já vendida contra a de referência: alinhado dentro de ±precoPct (inclusivo). Null sem os dois valores. */
export function sinalPreco(hoje: number | null, ref: number | null, tol: Tolerancias = TOL_PADRAO): SinalPreco | null {
  if (hoje == null || ref == null || !(ref > 0)) return null;
  const dif = (hoje / ref - 1) * 100;
  return dif > tol.precoPct + EPS ? "mais-caro" : dif < -tol.precoPct - EPS ? "mais-barato" : "alinhado";
}

/** Reservas criadas nos últimos 14 dias contra as da referência no mesmo estágio (já em carros da frota atual); igual = ±carros ou ±% (o maior). */
export function sinalRitmo(hoje: number | null, ref: number | null, tol: Tolerancias = TOL_PADRAO): SinalRitmo | null {
  if (hoje == null || ref == null) return null;
  const lim = Math.max(tol.ritmoCarros, (Math.abs(ref) * tol.ritmoPct) / 100);
  const dif = hoje - ref;
  return dif < -lim - EPS ? "abaixo" : dif > lim + EPS ? "acima" : "igual";
}

/**
 * Tabela de diagnósticos. Sem o sinal de ritmo (data encerrada ou sem histórico do estágio), "abaixo + alinhado" vira "Avaliar preço":
 * sem confirmar que a demanda segue entrando, não se recomenda esperar. Sem tarifa (sinal de preço nulo) o diagnóstico usa só ocupação
 * e ritmo: o preço entra como "alinhado", isto é, não pesa (nada de "Preço alto", "Demanda fraca" ou "Vendendo barato").
 */
export function diagnostico(o: SinalOcupacao, p: SinalPreco | null, r: SinalRitmo | null): Diagnostico | null {
  if (o === "no-ritmo") return "no-ritmo";
  if (p == null) p = "alinhado";
  if (o === "abaixo") {
    if (p === "mais-caro") return "preco-alto";
    if (p === "mais-barato") return "demanda-fraca";
    return r === "igual" || r === "acima" ? "aguardar" : "avaliar-preco";
  }
  return p === "mais-barato" ? "vendendo-barato" : "forte";
}

/**
 * Preço do que FALTAVA vender: diária média das diárias que o ano escolhido vendeu da antecedência atual até D-0 (criadas com
 * antecedência menor que a lida em cada dia da janela), ponderada pelas diárias. Em data encerrada (antecedência 0) vale o total.
 */
export function diariaRestanteJanela(janela: Pick<JanelaRef, "itens">): number | null {
  let v = 0;
  let p = 0;
  for (const it of janela.itens)
    for (const h of it.hist)
      for (let i = 0; i < h.a.length; i++) {
        if (it.lead > 0 && h.a[i]! >= it.lead) continue;
        const x = h.m?.[i] ?? 0;
        if (x > 0) {
          v += x;
          p++;
        }
      }
  return p ? v / p : null;
}

/** Ritmo recente (reservas ativas criadas nos últimos `dias` dias) do ano escolhido no mesmo estágio, em carros da frota atual `capacity`. */
export function ritmoJanela(janela: Pick<JanelaRef, "itens">, de: string, capacity: number, dias = 14): number | null {
  const partes: number[] = [];
  for (const it of janela.itens) {
    const r = ritmoRecente(it.hist, it.lead, dias, { date: it.date, de });
    if (r != null && it.fleet > 0) partes.push(r / it.fleet);
  }
  const m = mean(partes);
  return m == null ? null : m * capacity;
}

/** O preço do diagnóstico é sempre a tarifa atual do site; sem ela, não há sinal de preço. */
export type FontePreco = "tarifa";

export type Quadrante = {
  ocupacao: SinalOcupacao;
  preco: SinalPreco | null;
  ritmo: SinalRitmo | null;
  diagnostico: Diagnostico | null;
  /** Gap em carros (frota coberta) e diferença de preço em % (hoje contra o ano escolhido). */
  gapCarros: number;
  precoPct: number | null;
  /** Nosso preço usado, de onde veio e a referência (o que o ano escolhido praticou do estágio atual até D-0). */
  diariaAtual: number | null;
  fontePreco: FontePreco | null;
  diariaRef: number | null;
  ritmoAtual: number | null;
  ritmoRef: number | null;
  ano: string | null;
  frase: string;
};

const plural = (n: number, s: string, p: string) => (n === 1 ? s : p);

export function fraseQuadrante(
  q: Pick<Quadrante, "ocupacao" | "gapCarros" | "precoPct" | "preco" | "ritmo" | "ano" | "fontePreco" | "diariaAtual" | "diariaRef">,
  lead: number,
  closed = false,
): string {
  const n = Math.abs(q.gapCarros);
  const o =
    q.ocupacao === "no-ritmo"
      ? "no ritmo da esperada"
      : `${n} ${plural(n, "carro", "carros")} ${q.ocupacao === "abaixo" ? "abaixo" : "acima"} da esperada`;
  const a = q.ano ?? "o ano escolhido";
  const trecho = lead > 0 ? `de D-${lead - 1} em diante` : "no total";
  const p =
    q.fontePreco == null
      ? closed
        ? "data encerrada, sem tarifa atual para comparar preço"
        : "sem tarifa atual para comparar preço"
      : q.preco == null
        ? `tarifa atual ${usd(q.diariaAtual)}; sem preço de referência de ${a} para comparar`
        : `tarifa atual ${usd(q.diariaAtual)} contra ${usd(q.diariaRef)} que ${a} praticou ${trecho} (${q.precoPct! > 0 ? "+" : ""}${Math.round(q.precoPct!)}%)`;
  const r = q.ritmo ? `; ritmo recente ${q.ritmo} ao de ${a}` : "";
  return `${o} em D-${lead}; ${p}${r}`;
}

/**
 * Quadrante da data: ocupação (gap contra a esperada), preço e ritmo recente (14 dias; não se aplica a data encerrada). Null sem esperada/gap.
 * Nosso preço = SÓ a tarifa atual do site para a data e categoria (`tarifa`, só data aberta); sem ela não há sinal de preço e o
 * diagnóstico usa ocupação e ritmo (a diária já vendida e a das vendas recentes não entram aqui: refletem vendas antigas). A referência é o preço do que faltava vender: diária
 * do ano escolhido da antecedência atual até D-0 nos dias da janela (ponderada pelas diárias). A tarifa é preço de tabela e a referência
 * é valor pago. Em "todas as categorias" a diária é soma do faturamento ÷ soma das diárias: o mix pode distorcer.
 */
export function quadranteDia(
  d: DayPace,
  rows: PaceRow[],
  janela: JanelaRef,
  de: string,
  tol: Tolerancias = TOL_PADRAO,
  tarifa: number | null = null,
): Quadrante | null {
  if (d.gap == null || d.esperada == null) return null;
  const capCov = (d.cobertura ?? 0) * d.capacity;
  const ocupacao = sinalOcupacao(d.gap, capCov, tol);
  const temTarifa = !d.closed && tarifa != null && tarifa > 0;
  const diariaAtual = temTarifa ? tarifa : null;
  const fontePreco: FontePreco | null = temTarifa ? "tarifa" : null;
  const diariaRef = diariaRestanteJanela(janela);
  const preco = sinalPreco(diariaAtual, diariaRef, tol);
  const precoPct = diariaAtual != null && diariaRef ? (diariaAtual / diariaRef - 1) * 100 : null;
  const ritmoAtual = d.closed ? null : ritmoRecente(rows, d.lead, 14);
  const ritmoRef = d.closed ? null : ritmoJanela(janela, de, d.capacity, 14);
  const ritmo = sinalRitmo(ritmoAtual, ritmoRef, tol);
  const gc = Math.round((d.gap / 100) * capCov);
  const base = { ocupacao, preco, ritmo, gapCarros: gc, precoPct, ano: janela.escolhido?.label ?? null, fontePreco, diariaAtual, diariaRef };
  return {
    ...base,
    diagnostico: diagnostico(ocupacao, preco, ritmo),
    ritmoAtual,
    ritmoRef,
    frase: fraseQuadrante(base, d.closed ? 0 : d.lead, d.closed),
  };
}

/* ───────────────────────── 3.2 Preço por faixa de antecedência ───────────────────────── */

export const FAIXAS_ANTECEDENCIA = [
  { label: "Mais de D-90", min: 91, max: Infinity },
  { label: "D-90 a D-61", min: 61, max: 90 },
  { label: "D-60 a D-31", min: 31, max: 60 },
  { label: "D-30 a D-16", min: 16, max: 30 },
  { label: "D-15 a D-8", min: 8, max: 15 },
  { label: "D-7 a D-0", min: 0, max: 7 },
] as const;

export type FaixaAntecedencia = { label: string; carros: number; pct: number; diaria: number | null };
export type QuebraAntecedencia = { faixas: FaixaAntecedencia[]; total: { carros: number; diaria: number | null } };

/**
 * Quebra das diárias da data pela antecedência de criação. Usa as diárias confirmadas (`a`/`m`): nas referências é a composição final
 * (sem canceladas); na data atual, as ativas hoje. `desdeLead` limita a diárias criadas até a data-base (antecedência ≥ desdeLead);
 * 0 = todas. Diária média da faixa = faturamento ÷ diárias com preço.
 */
export function quebraAntecedencia(rows: PaceRow[], desdeLead = 0): QuebraAntecedencia {
  const acc = FAIXAS_ANTECEDENCIA.map(() => ({ n: 0, v: 0, p: 0 }));
  for (const r of rows)
    for (let i = 0; i < r.a.length; i++) {
      const a = r.a[i]!;
      if (a < desdeLead) continue;
      const k = FAIXAS_ANTECEDENCIA.findIndex((f) => a >= f.min && a <= f.max);
      acc[k]!.n++;
      const x = r.m?.[i] ?? 0;
      if (x > 0) {
        acc[k]!.v += x;
        acc[k]!.p++;
      }
    }
  const n = sum(acc.map((x) => x.n));
  const p = sum(acc.map((x) => x.p));
  return {
    faixas: FAIXAS_ANTECEDENCIA.map((f, k) => ({
      label: f.label,
      carros: acc[k]!.n,
      pct: n ? acc[k]!.n / n : 0,
      diaria: acc[k]!.p ? acc[k]!.v / acc[k]!.p : null,
    })),
    total: { carros: n, diaria: p ? sum(acc.map((x) => x.v)) / p : null },
  };
}

export type VendasRecentes = { carros: number; diaria: number | null };

/**
 * Diária média das reservas criadas nos últimos `dias` dias antes da antecedência L (antecedência de criação em [L, L+dias)).
 * Conta as confirmadas hoje (as depois canceladas não têm preço). Null em data encerrada (L ≤ 0) ou quando L+dias cai antes do
 * início da base `de` (para uma referência `date`).
 */
export function vendasRecentes(rows: PaceRow[], L: number, dias: number, opts?: { date: string; de: string }): VendasRecentes | null {
  if (L <= 0 || !rows.length) return null;
  if (opts && addDays(opts.date, -(L + dias)) < opts.de) return null;
  let n = 0;
  let v = 0;
  let p = 0;
  for (const r of rows)
    for (let i = 0; i < r.a.length; i++) {
      const a = r.a[i]!;
      if (a < L || a >= L + dias) continue;
      n++;
      const x = r.m?.[i] ?? 0;
      if (x > 0) {
        v += x;
        p++;
      }
    }
  return { carros: n, diaria: p ? v / p : null };
}

/* ───────────────────────── 3.3 Faixa de preço por época ───────────────────────── */

export type PontoEpoca = { date: string; ano: string; diaria: number; revVeic: number; occ: number };
export type FiltroEpoca = { categoria: string | null; mes: number | null; sazonalidade: string | null; desde?: string };

/**
 * Datas passadas (encerradas antes de `hoje`, de `desde` em diante, padrão 2024) da época escolhida, com diária média final,
 * faturamento/veículo final e ocupação final (frota da época). Fora: datas de evento e datas sem preço.
 */
export function pontosEpoca(payload: Pick<PacePayload, "linhas" | "cal" | "hoje">, f: FiltroEpoca): PontoEpoca[] {
  const desde = f.desde ?? "2024-01-01";
  const porData = new Map<string, PaceRow[]>();
  for (const r of payload.linhas) {
    if (r.d < desde || r.d >= payload.hoje) continue;
    if (f.categoria && r.c !== f.categoria) continue;
    const cal = payload.cal[r.d];
    if (cal?.[1]) continue; // evento fica fora da época comum
    if (f.mes != null && Number(r.d.slice(5, 7)) !== f.mes) continue;
    if (f.sazonalidade != null && cal?.[0] !== f.sazonalidade) continue;
    const l = porData.get(r.d);
    if (l) l.push(r);
    else porData.set(r.d, [r]);
  }
  const out: PontoEpoca[] = [];
  for (const [date, rows] of [...porData].sort(([a], [b]) => (a < b ? -1 : 1))) {
    let v = 0;
    let p = 0;
    let fPreco = 0;
    let fTotal = 0;
    let carros = 0;
    for (const r of rows) {
      const h = histFleet(r);
      if (h <= 0) continue;
      fTotal += h;
      carros += r.a.length;
      const x = revenueRow(r);
      if (x && x.p) {
        v += x.v;
        p += x.p;
        fPreco += h;
      }
    }
    if (!p || !fPreco || !fTotal) continue;
    out.push({ date, ano: date.slice(0, 4), diaria: v / p, revVeic: v / fPreco, occ: carros / fTotal });
  }
  return out;
}

export type FaixaPreco = { de: number; ate: number; datas: number; occMedia: number; revVeicMedio: number; pequena: boolean; destaque: boolean };

/**
 * Agrupa as datas por faixa de diária final (largura em US$, padrão 5). Destaque = faixa de maior faturamento/veículo médio entre as
 * que têm ao menos `minDatas` datas (padrão 5); abaixo disso a faixa é "amostra pequena" e nunca é destacada. Empate: a faixa mais barata.
 */
export function faixasPreco(pontos: PontoEpoca[], opts?: { largura?: number; minDatas?: number }): FaixaPreco[] {
  const largura = opts?.largura && opts.largura > 0 ? opts.largura : 5;
  const minDatas = opts?.minDatas ?? 5;
  const grupos = new Map<number, PontoEpoca[]>();
  for (const p of pontos) {
    const k = Math.floor(p.diaria / largura + EPS) * largura;
    const l = grupos.get(k);
    if (l) l.push(p);
    else grupos.set(k, [p]);
  }
  const faixas: FaixaPreco[] = [...grupos]
    .sort(([a], [b]) => a - b)
    .map(([de, ps]) => ({
      de,
      ate: de + largura,
      datas: ps.length,
      occMedia: sum(ps.map((x) => x.occ)) / ps.length,
      revVeicMedio: sum(ps.map((x) => x.revVeic)) / ps.length,
      pequena: ps.length < minDatas,
      destaque: false,
    }));
  let best: FaixaPreco | null = null;
  for (const f of faixas) if (!f.pequena && (!best || f.revVeicMedio > best.revVeicMedio)) best = f;
  if (best) best.destaque = true;
  return faixas;
}
