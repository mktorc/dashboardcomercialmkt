/**
 * Aba "Demanda & Preço" (Precificação): Orlando, com foco em preço.
 * Porta as regras de analise-demanda/ (Python, config.yaml) para rodar no navegador sobre as tabelas
 * `reservations` e `ntto_chegadas`. Mantenha as duas implementações com as mesmas regras.
 *
 * - Orlando = lojas da região Orlando no cadastro (inclui TPA). Reservas sem loja ficam fora.
 * - Demanda = confirmed + cancelled-paid. Locações pagas = total > 0 (cortesias contam no volume, não no preço).
 * - ADR = rack (locação já com desconto, sem taxas e extras) ÷ diárias, só nas pagas.
 * - Data da reserva = created_at do HQ, no horário de Orlando. Retirada: horário do HQ como está.
 */

export const CFG = {
  lojasOrlando: [1, 4, 5, 7, 8, 9, 11, 12],
  statusDemanda: ["confirmed", "cancelled-paid"],
  inicioConfiavel: "2023-08", // HQ em implantação antes disso (migração em 01/07/2023)
  anosExcluidos: [2020, 2021],
  faixas: [
    { rotulo: "0–7", de: 0, ate: 7 },
    { rotulo: "8–30", de: 8, ate: 30 },
    { rotulo: "31–60", de: 31, ate: 60 },
    { rotulo: "61–90", de: 61, ate: 90 },
    { rotulo: "90+", de: 91, ate: Infinity },
  ],
  horizonteMeses: 6,
  anosHistorico: 2,
  minBase: 10,
  gatilhos: {
    fecharEntrada: { indiceMin: 1.3, pickupMin: 1.0 },
    shareCaindo: { meses: 2 },
    pickupAbaixo: { dias: 30, tolerancia: 0.1 },
    subirPreco: { pickupMin: 1.0, adrMax: 0.98 },
    ultimaHora: { minReservas: 10 },
  },
} as const;

export const TODAS = "Todas";

export type ReservaRow = {
  reservation_id: string | null;
  created_at: string;
  pick_up_at: string | null;
  status: string;
  car_category: string | null;
  rental_days: number;
  total_amount: number;
  rack_rate: number | null;
  discount_amount: number;
  pick_up_location_id: number | null;
};

export type NttoRow = {
  mes: string; // AAAA-MM-01
  orlando: number | null;
  florida: number | null;
  preliminar: boolean;
};

export type Reserva = {
  id: string;
  categoria: string;
  mes: string; // AAAA-MM da retirada
  retirada: string; // AAAA-MM-DD
  criada: string; // AAAA-MM-DDTHH:mm no horário de Orlando
  antecedencia: number;
  dias: number;
  rack: number;
  desconto: number;
  paga: boolean;
  usarPickup: boolean;
};

const DIA = 86400000;
const fmtNY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Data/hora no horário de Orlando como "AAAA-MM-DDTHH:mm". */
export function horaNY(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const p = Object.fromEntries(fmtNY.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p["year"]}-${p["month"]}-${p["day"]}T${p["hour"]}:${p["minute"]}`;
}

const diaMs = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`);
export const somaMes = (mes: string, n: number) => {
  const [y, m] = mes.split("-").map(Number) as [number, number];
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};
/** Mesma data/hora um ano antes (29/02 vira 28/02). */
export const anoAntes = (dt: string, anos = 1) => {
  const y = Number(dt.slice(0, 4)) - anos;
  const resto = dt.slice(4);
  return resto.startsWith("-02-29") ? `${y}-02-28${resto.slice(6)}` : `${y}${resto}`;
};

/** Reservas de demanda em Orlando, prontas para as análises. */
export function prepararReservas(rows: ReservaRow[]): Reserva[] {
  const lojas = new Set<number>(CFG.lojasOrlando);
  const out: Reserva[] = [];
  for (const r of rows) {
    if (!r.pick_up_at || r.pick_up_location_id == null || !lojas.has(r.pick_up_location_id))
      continue;
    if (!(CFG.statusDemanda as readonly string[]).includes(r.status)) continue;
    const retirada = r.pick_up_at.slice(0, 10);
    const criada = horaNY(r.created_at);
    const antecedencia = Math.round((diaMs(retirada) - diaMs(criada)) / DIA);
    out.push({
      id: String(r.reservation_id ?? ""),
      categoria: r.car_category ?? "(sem categoria)",
      mes: retirada.slice(0, 7),
      retirada,
      criada,
      antecedencia,
      dias: Number(r.rental_days) || 0,
      rack: Number(r.rack_rate) || 0,
      desconto: Number(r.discount_amount) || 0,
      paga: Number(r.total_amount) > 0,
      usarPickup: antecedencia >= 0,
    });
  }
  return out;
}

export type Preco = {
  adr: number | null;
  reservas: number;
  pagas: number;
  diariasPagas: number;
  descontoPct: number | null;
};

export function preco(rs: Reserva[]): Preco {
  let dias = 0;
  let rack = 0;
  let desc = 0;
  let pagas = 0;
  for (const r of rs) {
    if (!r.paga) continue;
    pagas += 1;
    dias += r.dias;
    rack += r.rack;
    desc += r.desconto;
  }
  return {
    adr: dias ? rack / dias : null,
    reservas: rs.length,
    pagas,
    diariasPagas: dias,
    descontoPct: rack + desc ? desc / (rack + desc) : null,
  };
}

// ---------------------------------------------------------------- sazonalidade

/** Índice por mês do calendário = média, entre anos completos, de (mês ÷ média mensal do ano). */
export function indiceSazonal(pontos: { mes: string; valor: number | null }[]): (number | null)[] {
  const porAno = new Map<number, Map<number, number>>();
  for (const p of pontos) {
    if (p.valor == null || !Number.isFinite(p.valor)) continue;
    const ano = Number(p.mes.slice(0, 4));
    if ((CFG.anosExcluidos as readonly number[]).includes(ano)) continue;
    const m = porAno.get(ano) ?? new Map<number, number>();
    m.set(Number(p.mes.slice(5, 7)), p.valor);
    porAno.set(ano, m);
  }
  const soma = Array<number>(12).fill(0);
  let anos = 0;
  for (const meses of porAno.values()) {
    if (meses.size !== 12) continue;
    const media = [...meses.values()].reduce((a, b) => a + b, 0) / 12;
    if (!media) continue;
    anos += 1;
    for (const [m, v] of meses) soma[m - 1]! += v / media;
  }
  return soma.map((s) => (anos ? s / anos : null));
}

export type LinhaSazonal = {
  mes: number;
  mercado: number | null;
  florida: number | null;
  locacoes: number | null;
  diarias: number | null;
  adr: number | null;
  leitura: string;
};

/** Meses realizados e confiáveis (antes do mês corrente). */
const realizado = (mes: string, hoje: string) =>
  mes >= CFG.inicioConfiavel && mes < hoje.slice(0, 7);

function porMes(rs: Reserva[]) {
  const m = new Map<string, Reserva[]>();
  for (const r of rs) m.set(r.mes, [...(m.get(r.mes) ?? []), r]);
  return m;
}

export function sazonalidade(rs: Reserva[], ntto: NttoRow[], hoje: string): LinhaSazonal[] {
  const meses = [...porMes(rs).entries()].filter(([m]) => realizado(m, hoje));
  const mercado = indiceSazonal(ntto.map((n) => ({ mes: n.mes, valor: n.orlando })));
  const florida = indiceSazonal(ntto.map((n) => ({ mes: n.mes, valor: n.florida })));
  const loc = indiceSazonal(meses.map(([mes, x]) => ({ mes, valor: x.length })));
  const dia = indiceSazonal(
    meses.map(([mes, x]) => ({ mes, valor: x.reduce((a, r) => a + r.dias, 0) })),
  );
  const adr = indiceSazonal(meses.map(([mes, x]) => ({ mes, valor: preco(x).adr })));
  return mercado.map((mk, i) => {
    const demanda = Math.max(mk ?? 0, dia[i] ?? 0);
    const a = adr[i];
    const leitura =
      a == null || demanda <= 1.1
        ? ""
        : a < demanda - 0.05
          ? "pico com preço subindo menos que a demanda"
          : "pico com preço acompanhando a demanda";
    return {
      mes: i + 1,
      mercado: mk,
      florida: florida[i] ?? null,
      locacoes: loc[i] ?? null,
      diarias: dia[i] ?? null,
      adr: a ?? null,
      leitura,
    };
  });
}

// ---------------------------------------------------------------- antecedência

export type LinhaFaixa = {
  faixa: string;
  reservas: number;
  adr: number | null;
  descontoPct: number | null;
  premio: number | null;
};

export function faixaDe(dias: number) {
  return CFG.faixas.find((f) => dias >= f.de && dias <= f.ate)?.rotulo ?? null;
}

/** ADR por faixa de antecedência nos últimos 12 meses realizados (só pagas, data de reserva válida). */
export function adrAntecedencia(rs: Reserva[], hoje: string, categoria = TODAS): LinhaFaixa[] {
  const fim = hoje.slice(0, 7);
  const ini = somaMes(fim, -12);
  const base = rs.filter(
    (r) =>
      r.usarPickup &&
      r.mes >= ini &&
      r.mes < fim &&
      r.mes >= CFG.inicioConfiavel &&
      (categoria === TODAS || r.categoria === categoria),
  );
  const linhas = CFG.faixas.map((f) => {
    const p = preco(base.filter((r) => faixaDe(r.antecedencia) === f.rotulo));
    return {
      faixa: f.rotulo,
      reservas: p.pagas,
      adr: p.adr,
      descontoPct: p.descontoPct,
      premio: null as number | null,
    };
  });
  const ref = linhas[0]?.adr;
  for (const l of linhas) l.premio = ref && l.adr != null ? l.adr / ref - 1 : null;
  return linhas;
}

// ---------------------------------------------------------------- pickup (on the books × ano anterior)

export type LinhaPickup = {
  mes: string;
  categoria: string;
  diasAteInicio: number;
  otb: number;
  otbAnoAnterior: number | null;
  finalAnoAnterior: number | null;
  otbHistorico: number | null;
  razao: number | null;
  razaoHistorico: number | null;
  adr: number | null;
  adrAnoAnterior: number | null;
  varAdr: number | null;
};

/**
 * Por mês de retirada (do corrente até `meses` à frente) e categoria (+ "Todas"):
 * reservas já criadas hoje × as do mesmo mês um ano antes criadas até a mesma data, com o ADR das duas.
 * Anos anteriores só contam se o sistema já registrava reservas 120 dias antes do mês (e após a implantação).
 * Status atual: cancelamentos posteriores não aparecem no passado (o ano anterior tende a ficar subestimado).
 */
export function pickup(
  rs: Reserva[],
  hoje: string,
  meses: number = CFG.horizonteMeses,
): LinhaPickup[] {
  const agora = `${hoje}T23:59`;
  const validas = rs.filter((r) => r.usarPickup);
  const confiavel = `${CFG.inicioConfiavel}-01T00:00`;
  const primeira = validas.reduce((a, r) => (r.criada < a ? r.criada : a), "9999");
  const inicio = primeira > confiavel ? primeira : confiavel;
  const categorias = [TODAS, ...[...new Set(validas.map((r) => r.categoria))].sort()];
  const mes0 = hoje.slice(0, 7);
  const out: LinhaPickup[] = [];
  for (const cat of categorias) {
    const doCat = cat === TODAS ? validas : validas.filter((r) => r.categoria === cat);
    for (let k = 0; k < meses; k++) {
      const mes = somaMes(mes0, k);
      const atual = doCat.filter((r) => r.mes === mes && r.criada <= agora);
      const hist: number[] = [];
      let otbLy: Reserva[] | null = null;
      let finalLy: number | null = null;
      for (let a = 1; a <= CFG.anosHistorico; a++) {
        const corte = anoAntes(agora, a);
        const mm = somaMes(mes, -12 * a);
        const janela = new Date(diaMs(`${mm}-01`) - 120 * DIA).toISOString().slice(0, 16);
        if (corte < inicio || janela < inicio) continue;
        const sel = doCat.filter((r) => r.mes === mm);
        const naData = sel.filter((r) => r.criada <= corte);
        hist.push(naData.length);
        if (a === 1) {
          otbLy = naData;
          finalLy = sel.length;
        }
      }
      const nLy = otbLy?.length ?? null;
      const okLy = nLy != null && nLy >= CFG.minBase;
      const media = hist.length ? hist.reduce((x, y) => x + y, 0) / hist.length : null;
      const adr = preco(atual).adr;
      const adrLy = okLy && otbLy ? preco(otbLy).adr : null;
      out.push({
        mes,
        categoria: cat,
        diasAteInicio: Math.round((diaMs(`${mes}-01`) - diaMs(hoje)) / DIA),
        otb: atual.length,
        otbAnoAnterior: nLy,
        finalAnoAnterior: finalLy,
        otbHistorico: media,
        razao: okLy ? atual.length / nLy! : null,
        razaoHistorico: media != null && media >= CFG.minBase ? atual.length / media : null,
        adr,
        adrAnoAnterior: adrLy,
        varAdr: adr != null && adrLy ? adr / adrLy - 1 : null,
      });
    }
  }
  return out;
}

/** Totais de um conjunto de meses à frente (ex.: próximos 3): on the books e ADR vs mesma data do ano anterior. */
export function resumoProximos(rs: Reserva[], hoje: string, meses = 3) {
  const agora = `${hoje}T23:59`;
  const corte = anoAntes(agora);
  const alvo = new Set(Array.from({ length: meses }, (_, k) => somaMes(hoje.slice(0, 7), k)));
  const alvoLy = new Set([...alvo].map((m) => somaMes(m, -12)));
  const atual = rs.filter((r) => r.usarPickup && alvo.has(r.mes) && r.criada <= agora);
  const ly = rs.filter((r) => r.usarPickup && alvoLy.has(r.mes) && r.criada <= corte);
  const pa = preco(atual);
  const pl = preco(ly);
  return {
    meses: [...alvo],
    otb: atual.length,
    otbAnoAnterior: ly.length,
    adr: pa.adr,
    adrAnoAnterior: pl.adr,
    varAdr: pa.adr != null && pl.adr ? pa.adr / pl.adr - 1 : null,
    varPickup: ly.length ? atual.length / ly.length - 1 : null,
  };
}

// ---------------------------------------------------------------- market share

export type LinhaShare = {
  mes: string;
  locacoes: number;
  chegadas: number;
  share: number;
  shareAnoAnterior: number | null;
  preliminar: boolean;
};

export function marketShare(rs: Reserva[], ntto: NttoRow[], hoje: string): LinhaShare[] {
  const loc = porMes(rs);
  const porMesShare = new Map<string, LinhaShare>();
  for (const n of [...ntto].sort((a, b) => a.mes.localeCompare(b.mes))) {
    const mes = n.mes.slice(0, 7);
    if (!realizado(mes, hoje) || !n.orlando) continue;
    const l = loc.get(mes)?.length ?? 0;
    porMesShare.set(mes, {
      mes,
      locacoes: l,
      chegadas: n.orlando,
      share: l / n.orlando,
      shareAnoAnterior: null,
      preliminar: n.preliminar,
    });
  }
  for (const s of porMesShare.values())
    s.shareAnoAnterior = porMesShare.get(somaMes(s.mes, -12))?.share ?? null;
  return [...porMesShare.values()];
}

// ---------------------------------------------------------------- alertas

export type Alerta = {
  mes: string;
  categoria: string;
  acao: string;
  motivo: string;
  valor: number;
};

const pctTxt = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(0)}%`;
const usd0 = (v: number) => `US$ ${v.toFixed(0)}`;

export function alertas(
  rs: Reserva[],
  ntto: NttoRow[],
  hoje: string,
  saz: LinhaSazonal[],
  pk: LinhaPickup[],
): Alerta[] {
  const g = CFG.gatilhos;
  const out: Alerta[] = [];
  const todas = pk.filter((p) => p.categoria === TODAS);

  for (const p of todas) {
    const idx = saz[Number(p.mes.slice(5, 7)) - 1]?.mercado;
    if (
      idx != null &&
      p.razao != null &&
      idx > g.fecharEntrada.indiceMin &&
      p.razao > g.fecharEntrada.pickupMin
    )
      out.push({
        mes: p.mes,
        categoria: TODAS,
        acao: "Fechar categoria de entrada",
        valor: p.razao,
        motivo: `Alta temporada (índice ${idx.toFixed(2)}) e ${p.otb} reservas vs ${p.otbAnoAnterior} na mesma data do ano anterior`,
      });
    if (
      p.diasAteInicio <= g.pickupAbaixo.dias &&
      p.razaoHistorico != null &&
      p.razaoHistorico < 1 - g.pickupAbaixo.tolerancia
    )
      out.push({
        mes: p.mes,
        categoria: TODAS,
        acao: "Abrir categorias / promoção",
        valor: p.razaoHistorico,
        motivo: `${p.otb} reservas vs média de ${p.otbHistorico?.toFixed(0)} na mesma data dos anos anteriores`,
      });
  }

  const share = marketShare(rs, ntto, hoje);
  const ultimo = share.at(-1);
  if (ultimo) {
    let seq = 0;
    for (let i = share.length - 1; i >= 0; i--) {
      const s = share[i]!;
      if (s.shareAnoAnterior == null || s.share >= s.shareAnoAnterior) break;
      if (i < share.length - 1 && somaMes(s.mes, 1) !== share[i + 1]!.mes) break;
      seq += 1;
    }
    if (seq >= g.shareCaindo.meses)
      out.push({
        mes: ultimo.mes,
        categoria: TODAS,
        acao: "Revisar preço / testar redução",
        valor: ultimo.share - (ultimo.shareAnoAnterior ?? 0),
        motivo: `Share abaixo do mesmo mês do ano anterior há ${seq} meses (${(ultimo.share * 100).toFixed(2)}% vs ${((ultimo.shareAnoAnterior ?? 0) * 100).toFixed(2)}%)${ultimo.preliminar ? " · NTTO preliminar" : ""}`,
      });
  }

  for (const p of pk) {
    if (p.categoria === TODAS || p.razao == null || p.adr == null || p.adrAnoAnterior == null)
      continue;
    if (p.razao > g.subirPreco.pickupMin && p.adr / p.adrAnoAnterior < g.subirPreco.adrMax)
      out.push({
        mes: p.mes,
        categoria: p.categoria,
        acao: "Subir preço da categoria",
        valor: p.adr / p.adrAnoAnterior - 1,
        motivo: `${p.otb} reservas vs ${p.otbAnoAnterior} e ADR ${usd0(p.adr)} vs ${usd0(p.adrAnoAnterior)} (${pctTxt(p.adr / p.adrAnoAnterior - 1)}) na mesma data do ano anterior`,
      });
  }

  for (const cat of [TODAS, ...new Set(rs.map((r) => r.categoria))]) {
    const f = adrAntecedencia(rs, hoje, cat);
    const ult = f[0];
    const outras = f
      .slice(1)
      .filter((x) => x.adr != null && x.reservas >= g.ultimaHora.minReservas);
    if (!ult || ult.adr == null || ult.reservas < g.ultimaHora.minReservas || !outras.length)
      continue;
    const media = outras.reduce((a, x) => a + x.adr!, 0) / outras.length;
    if (ult.adr < media)
      out.push({
        mes: "últimos 12 meses",
        categoria: cat,
        acao: "Revisar desconto de última hora",
        valor: ult.adr / media - 1,
        motivo: `Quem reserva com 0–7 dias paga ${usd0(ult.adr)}/dia vs média de ${usd0(media)} nas outras faixas (${pctTxt(ult.adr / media - 1)})`,
      });
  }
  return out;
}

/** Nome da categoria para exibir ("Midsize Suv" → "Midsize SUV"). Só exibição: comparações seguem pelo nome original. */
export const nomeCategoria = (c: string) => c.replace(/\bsuv\b/gi, "SUV");
