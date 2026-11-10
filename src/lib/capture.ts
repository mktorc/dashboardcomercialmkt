/**
 * Curva de captura de reservas: que parcela da ocupação FINAL de uma data já estava contratada em cada antecedência.
 * Não confundir com ocupação da frota: captura = diárias vendidas em D-L ÷ diárias finais (histórico), ou ÷ ocupação final típica (data aberta).
 *
 * Fonte e método (docs/central-prioridades-captura.md): cada diária vendida traz a antecedência da sua criação (PaceRow.a, até D-400),
 * então a posição em qualquer D-L é reconstruída contando as diárias criadas até T−L. Só reservas confirmadas hoje (open/rental/completed):
 * canceladas e alterações não aparecem nas fotos antigas. Fotos anteriores ao início da base são descartadas (vendas truncadas).
 */
import {
  activeAt,
  addDays,
  benchmarkFor,
  grossAt,
  leadOf,
  samplesFor,
  soldAt,
  type BenchLevel,
  type PaceCal,
  type PaceModel,
  type PaceRow,
} from "./occupancy-pace";

export const CAPTURE_LEADS = [180, 150, 120, 90, 75, 60, 45, 30, 15, 7, 0];
/** Datas históricas com menos diárias finais que isso geram razões instáveis e ficam fora. */
export const MIN_FINAL = 3;

export type CaptureShare = { share: number; n: number; level: BenchLevel };

/** Parcela da ocupação final que estava ATIVA em D-L nas datas comparáveis (mesma regra do benchmark; razão agregada). Com `x` no payload,
 * inclui as reservas que ainda não tinham cancelado (como a tela vê uma data aberta); sem `x`, só as confirmadas hoje. */
export function expectedShare(
  model: PaceModel,
  row: PaceRow,
  L: number,
  base: string,
): CaptureShare | null {
  const smp = samplesFor(model, row, L, base);
  if (!smp) return null;
  let at = 0;
  let fin = 0;
  let n = 0;
  for (const it of smp.items) {
    const h = model.byKey.get(`${it.date}|${row.c}`);
    if (!h) continue;
    const f = soldAt(h, 0);
    if (f < MIN_FINAL) continue;
    at += activeAt(h, L);
    fin += f;
    n++;
  }
  const min = smp.level === "evento" || smp.level === "aniversario" ? 2 : 5;
  if (n < min || fin === 0) return null;
  return { share: at / fin, n, level: smp.level };
}

export type CaptureInfo = {
  /** % histórico esperado de captura na antecedência atual (0–1). */
  histShare: number;
  /** % atual capturado sobre a ocupação final típica (0–1; pode passar de 1). */
  atualShare: number | null;
  /** Diferença em p.p. (atual − histórico). */
  diffPp: number | null;
  /** Diárias que faltam em relação ao padrão histórico (≥ 0). */
  faltam: number | null;
  /** Ocupação final típica das datas comparáveis (0–1). */
  finalTipica: number | null;
  n: number;
  level: BenchLevel;
};

/** Captura de uma data na antecedência atual. null = sem referência válida (nada é estimado). `model` deve usar a estatística "media". */
export function captureInfo(
  model: PaceModel,
  row: PaceRow,
  date: string,
  base: string,
): CaptureInfo | null {
  const { lead, closed } = leadOf(date, base);
  if (closed || lead <= 0) return null;
  const exp = expectedShare(model, row, lead, base);
  if (!exp) return null;
  const fin = benchmarkFor(model, row, 0, base);
  const finalTipica = fin && fin.value > 0 ? fin.value : null;
  const booked = soldAt(row, lead);
  const atualShare = finalTipica != null && row.f ? booked / (finalTipica * row.f) : null;
  return {
    histShare: exp.share,
    atualShare,
    diffPp: atualShare != null ? (atualShare - exp.share) * 100 : null,
    faltam:
      finalTipica != null && row.f ? Math.max(0, exp.share * finalTipica * row.f - booked) : null,
    finalTipica,
    n: exp.n,
    level: exp.level,
  };
}

export type CapturePoint = { L: number; label: string; hist: number | null; atual: number | null };

/** Curva da data: parcela histórica em cada D-L e a captura atual só onde a foto já existe (L ≥ antecedência atual). */
export function captureCurve(
  model: PaceModel,
  row: PaceRow,
  date: string,
  base: string,
): CapturePoint[] {
  const { lead } = leadOf(date, base);
  const fin = benchmarkFor(model, row, 0, base);
  const finalTipica = fin && fin.value > 0 ? fin.value : null;
  const leads = [...new Set([...CAPTURE_LEADS, ...(lead <= 400 ? [lead] : [])])].sort(
    (a, b) => b - a,
  );
  return leads.map((L) => {
    const e = L === 0 ? { share: 1 } : expectedShare(model, row, L, base);
    return {
      L,
      label: L === lead ? `D-${L} (hoje)` : `D-${L}`,
      hist: e ? Math.round(e.share * 1000) / 10 : null,
      atual:
        L >= lead && finalTipica != null && row.f
          ? Math.round((soldAt(row, L) / (finalTipica * row.f)) * 1000) / 10
          : null,
    };
  });
}

export type CaptureProfilePoint = {
  L: number;
  /** Líquida: só diárias confirmadas hoje, criadas até D-L ÷ finais (metodologia anterior). */
  share: number | null;
  /** Bruta: todas as diárias criadas até D-L, inclusive as depois canceladas ÷ finais confirmadas. */
  bruta: number | null;
  /** Ativa: o que existia e ainda não tinha sido cancelado em D-L ÷ finais (comparável a uma data aberta hoje). */
  ativa: number | null;
  /** Das diárias criadas até D-L, parcela que acabou cancelada. null sem dados de cancelamento. */
  cancelamento: number | null;
  n: number;
};

/** Há dados de cancelamento (payload v3+) em alguma linha. */
export const hasCancelData = (rows: PaceRow[]) => rows.some((r) => r.x && r.x.length > 0);

/** Perfil agregado de todas as datas encerradas (opcionalmente de uma categoria): captura líquida, bruta e ativa em cada D-L. */
export function captureProfile(
  rows: PaceRow[],
  base: string,
  historyStart: string,
  category: string | null = null,
  /** Restringe as datas históricas (ex.: mesma sazonalidade do período analisado). */
  filtro?: (r: PaceRow) => boolean,
): CaptureProfilePoint[] {
  const closed = rows.filter(
    (r) =>
      r.d < base &&
      (!category || r.c === category) &&
      soldAt(r, 0) >= MIN_FINAL &&
      (!filtro || filtro(r)),
  );
  const cancels = hasCancelData(rows);
  return CAPTURE_LEADS.map((L) => {
    if (L === 0) {
      let fin = 0;
      let gross = 0;
      for (const r of closed) {
        fin += soldAt(r, 0);
        gross += grossAt(r, 0);
      }
      return {
        L,
        share: 1,
        bruta: cancels && fin ? gross / fin : null,
        ativa: 1,
        cancelamento: cancels && gross ? (gross - fin) / gross : null,
        n: closed.length,
      };
    }
    let net = 0;
    let gross = 0;
    let act = 0;
    let fin = 0;
    let n = 0;
    for (const r of closed) {
      if (addDays(r.d, -L) < historyStart) continue;
      net += soldAt(r, L);
      gross += grossAt(r, L);
      act += activeAt(r, L);
      fin += soldAt(r, 0);
      n++;
    }
    return {
      L,
      share: fin ? net / fin : null,
      bruta: cancels && fin ? gross / fin : null,
      ativa: cancels && fin ? act / fin : null,
      cancelamento: cancels && gross ? (gross - net) / gross : null,
      n,
    };
  });
}

/** Taxa de cancelamento por categoria entre as diárias criadas com ao menos `minLead` dias de antecedência (datas encerradas). */
export function cancelByCategory(
  rows: PaceRow[],
  base: string,
  historyStart: string,
  minLead = 60,
): { category: string; rate: number; diarias: number }[] {
  const acc = new Map<string, { net: number; gross: number }>();
  for (const r of rows) {
    if (r.d >= base || addDays(r.d, -minLead) < historyStart) continue;
    const cur = acc.get(r.c) ?? { net: 0, gross: 0 };
    cur.net += soldAt(r, minLead);
    cur.gross += grossAt(r, minLead);
    acc.set(r.c, cur);
  }
  return [...acc.entries()]
    .filter(([, v]) => v.gross >= 30)
    .map(([category, v]) => ({ category, rate: (v.gross - v.net) / v.gross, diarias: v.gross }))
    .sort((a, b) => b.rate - a.rate);
}

/** Velocidade média de entrada (p.p. da ocupação final por dia) entre pontos consecutivos do perfil. */
export function captureSpeed(profile: CaptureProfilePoint[]) {
  const out: { from: number; to: number; ppPerDay: number }[] = [];
  for (let i = 0; i < profile.length - 1; i++) {
    const a = profile[i]!;
    const b = profile[i + 1]!;
    if (a.share == null || b.share == null) continue;
    out.push({ from: a.L, to: b.L, ppPerDay: ((b.share - a.share) * 100) / (a.L - b.L) });
  }
  return out;
}

export type Epoca = {
  /** Meses (1–12) das datas comuns do período. */
  meses: number[];
  /** Eventos móveis (Carnaval, Semana Santa…) do período, com as posições relativas ao evento que ele cobre. */
  eventos: Map<string, Set<number>>;
  /** Datas históricas comparáveis: mesmos meses (só datas comuns) e edições anteriores do mesmo evento na mesma posição. */
  filtro: (r: PaceRow) => boolean;
};

/**
 * Época do período selecionado. Datas comuns comparam com os MESMOS MESES de anos anteriores (datas de evento ficam de fora, pois
 * se comportam diferente). Datas de evento móvel comparam com as EDIÇÕES ANTERIORES do mesmo evento, na mesma posição relativa.
 */
export function mesmaEpoca(cal: PaceCal, from: string, to: string): Epoca {
  const meses = new Set<number>();
  const eventos = new Map<string, Set<number>>();
  for (const [d, c] of Object.entries(cal)) {
    if (d < from || d > to) continue;
    const [, ev, rel] = c;
    if (ev && rel != null) {
      const set = eventos.get(ev) ?? new Set<number>();
      set.add(rel);
      eventos.set(ev, set);
    } else meses.add(Number(d.slice(5, 7)));
  }
  return {
    meses: [...meses].sort((a, b) => a - b),
    eventos,
    filtro: (r) => {
      const c = cal[r.d];
      if (!c) return false;
      const [, ev, rel] = c;
      if (ev && rel != null) return eventos.get(ev)?.has(rel) ?? false;
      return meses.has(Number(r.d.slice(5, 7)));
    },
  };
}
