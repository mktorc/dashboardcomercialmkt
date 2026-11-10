import { describe, expect, it } from "vitest";
import { buildModel, referenceDates, type PacePayload, type PaceRow } from "./occupancy-pace";
import {
  DEFAULT_CRIT,
  NO_PRICE,
  byPriority,
  classify,
  confidenceOf,
  fatos,
  fleetWeight,
  priorityRows,
  recommend,
  resumir,
  urgency,
  type PriceCtx,
  type PriorityRow,
} from "./prioridades";

const BASE = "2026-11-09";
const mk = (o: Partial<PriorityRow>): PriorityRow => ({
  date: "2026-12-15",
  lead: 36,
  closed: false,
  capacity: 10,
  booked: 2,
  atual: 0.2,
  esperada: 0.5,
  gap: -30,
  n: 20,
  level: "dow",
  event: null,
  eventRel: null,
  season: "Média",
  category: "SUV",
  vacant: 8,
  score: 0,
  criticidade: "ok",
  confianca: "alta",
  ...o,
});
const price = (o: Partial<PriceCtx>): PriceCtx => ({
  ...NO_PRICE,
  level: "acima",
  pct: 15,
  n: 3,
  median: 100,
  min: 90,
  max: 120,
  reliable: true,
  ourRate: 115,
  ...o,
});

describe("criticidade", () => {
  it("o mesmo gap pesa mais na janela prioritária (D-60+) que no curto prazo", () => {
    const janela = classify(mk({ gap: -30, lead: 70 }), "alta", DEFAULT_CRIT);
    const curto = classify(mk({ gap: -30, lead: 7 }), "alta", DEFAULT_CRIT);
    expect(janela.score).toBeGreaterThan(curto.score);
    expect(janela.criticidade).toBe("atencao");
    expect(curto.criticidade).toBe("monitorar");
  });
  it("antecedência sozinha não classifica: sem gap negativo fica ok", () => {
    expect(classify(mk({ gap: 0, lead: 70 }), "alta", DEFAULT_CRIT).criticidade).toBe("ok");
  });
  it("gap pequeno ou positivo não é crítico; sem benchmark é sem dados", () => {
    expect(classify(mk({ gap: -3 }), "alta", DEFAULT_CRIT).criticidade).toBe("ok");
    expect(classify(mk({ gap: 12 }), "alta", DEFAULT_CRIT).criticidade).toBe("ok");
    expect(classify(mk({ gap: null, esperada: null }), "alta", DEFAULT_CRIT).criticidade).toBe(
      "sem-dados",
    );
  });
  it("referência pouco confiável não gera crítica sozinha", () => {
    const d = mk({ gap: -80, lead: 70, season: "Altíssima" });
    expect(classify(d, "alta", DEFAULT_CRIT).criticidade).toBe("critica");
    expect(classify(d, "baixa", DEFAULT_CRIT).criticidade).toBe("atencao");
  });
  it("período relevante e veículos livres aumentam o peso", () => {
    const base = classify(mk({ gap: -20, lead: 30 }), "alta", DEFAULT_CRIT).score;
    expect(
      classify(mk({ gap: -20, lead: 30, season: "Altíssima" }), "alta", DEFAULT_CRIT).score,
    ).toBeGreaterThan(base);
    expect(
      classify(mk({ gap: -20, lead: 30, booked: 9, capacity: 10 }), "alta", DEFAULT_CRIT).score,
    ).toBeLessThan(base);
  });
  it("pesos auxiliares", () => {
    expect(urgency(70, DEFAULT_CRIT)).toBeGreaterThan(urgency(40, DEFAULT_CRIT));
    expect(urgency(40, DEFAULT_CRIT)).toBeGreaterThan(urgency(3, DEFAULT_CRIT));
    expect(janelaOf(120, DEFAULT_CRIT)).toBe("plan");
    expect(janelaOf(119, DEFAULT_CRIT)).toBe("estrat");
    expect(janelaOf(89, DEFAULT_CRIT)).toBe("atenc");
    expect(janelaOf(75, DEFAULT_CRIT)).toBe("atenc");
    expect(janelaOf(74, DEFAULT_CRIT)).toBe("interv");
    expect(janelaOf(60, DEFAULT_CRIT)).toBe("interv");
    expect(janelaOf(59, DEFAULT_CRIT)).toBe("recup");
    expect(janelaOf(29, DEFAULT_CRIT)).toBe("curto");
    expect(fleetWeight(0)).toBe(0.3);
    expect(fleetWeight(50)).toBe(1);
  });
  it("confiança: frota pequena é baixa; saz é no máximo média", () => {
    const min = { evento: 2, dow: 8, saz: 15 };
    expect(confidenceOf(mk({ capacity: 2 }), min)).toBe("baixa");
    expect(confidenceOf(mk({ level: "saz", n: 100 }), min)).toBe("media");
    expect(confidenceOf(mk({ level: "dow", n: 16 }), min)).toBe("alta");
    expect(confidenceOf(mk({ level: null }), min)).toBe("baixa");
  });
  it("ordem do ranking: criticidade, depois score", () => {
    const a = mk({ criticidade: "atencao", score: 0.9 });
    const b = mk({ criticidade: "critica", score: 0.8 });
    expect([a, b].sort(byPriority)[0]).toBe(b);
  });
});

describe("recomendações", () => {
  const c = DEFAULT_CRIT;
  const critica = (o: Partial<PriorityRow> = {}) => mk({ criticidade: "critica", score: 1, ...o });
  it("abaixo + preço acima: avaliar redução; os fatos (mediana etc.) ficam no diagnóstico", () => {
    const r = recommend(critica(), price({}), null, c)[0]!;
    expect(r.acao).toMatch(/redução de tarifa/);
    expect(fatos(critica(), price({}), null).join(" ")).toMatch(/mediana/);
    expect(r.prioridade).toBe("alta");
  });
  it("abaixo + preço abaixo: investigar demanda antes de reduzir", () => {
    const r = recommend(critica(), price({ level: "abaixo", pct: -15 }), null, c)[0]!;
    expect(r.acao).toMatch(/Investigar demanda/);
  });
  it("acima + preço abaixo: aumento gradual; acima + acima: monitorar", () => {
    const up = mk({ gap: 20, atual: 0.7, esperada: 0.5, criticidade: "ok" });
    expect(recommend(up, price({ level: "abaixo", pct: -12 }), null, c)[0]!.acao).toMatch(
      /aumento gradual/,
    );
    expect(recommend(up, price({}), null, c)[0]!.acao).toMatch(/Monitorar/);
  });
  it("sem concorrência não recomenda mexer na tarifa nem assume posicionamento", () => {
    const r = recommend(critica(), NO_PRICE, null, c)[0]!;
    expect(r.acao).toMatch(/Não alterar tarifa/);
    expect(r.confianca).toBe("baixa");
    expect(r.impacto).toBeNull();
  });
  it("a ação acompanha a janela de antecedência", () => {
    const acoes = (lead: number) =>
      recommend(critica({ lead }), price({}), null, c)
        .map((r) => r.acao)
        .join(" | ");
    expect(acoes(130)).toMatch(/preventivas/);
    expect(acoes(40)).toMatch(/recuperação/);
    expect(acoes(5)).toMatch(/riscos operacionais/);
  });
  it("D-60+ com gap negativo e preço acima do mercado prioriza competitividade", () => {
    const rs = recommend(critica({ lead: 70 }), price({ level: "acima", pct: 15 }), null, c);
    expect(rs.some((r) => /competitividade/.test(r.acao))).toBe(true);
  });
  it("nunca sugere reduzir preço com a tarifa já abaixo do mercado", () => {
    const rs = recommend(
      critica({ lead: 100 }),
      price({ level: "abaixo", pct: -15 }),
      { novas: 0, esperadas: 5, abaixo: true },
      c,
    );
    expect(rs.some((r) => /ajuste tarifário|reduç/.test(r.acao))).toBe(false);
  });
  it("impacto só com tarifa e confiança suficiente, e como teto", () => {
    const r = recommend(critica(), price({}), null, c)[0]!;
    expect(r.impacto).toMatch(/teto de referência/);
    expect(recommend(critica({ confianca: "baixa" }), price({}), null, c)[0]!.impacto).toBeNull();
    expect(recommend(critica(), price({ ourRate: null }), null, c)[0]!.impacto).toBeNull();
  });
  it("sem benchmark não recomenda", () => {
    expect(recommend(mk({ gap: null, criticidade: "sem-dados" }), price({}), null, c)).toEqual([]);
  });
});

describe("integração com o benchmark de ocupação", () => {
  const params = { n_evento: 2, n_dow: 2, n_saz: 3, estatistica: "media" as const };
  const row = (d: string, a: number[]): PaceRow => ({ d, c: "SUV", f: 10, a });
  // histórico: 4 segundas "Média" encerradas, todas 8 diárias vendidas há 30+ dias; alvo (15/12) com 1 só.
  const hist = ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"].map((d) =>
    row(d, Array(8).fill(60)),
  );
  const alvo = row("2026-12-14", [40]);
  const payload: PacePayload = {
    versao: 2,
    gerado_em: "",
    hoje: BASE,
    de: "2023-06-24",
    ate: "2026-12-31",
    categorias: ["SUV"],
    params,
    cal: Object.fromEntries([...hist, alvo].map((r) => [r.d, ["Média", null, null]])),
    linhas: [...hist, alvo],
  };
  const model = buildModel(payload);
  it("só lista datas futuras e calcula gap na antecedência atual", () => {
    const rows = priorityRows(model, BASE, {
      from: "2026-11-09",
      to: "2026-12-31",
      category: null,
      minLead: 0,
      maxLead: 400,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.lead).toBe(35);
    expect(rows[0]!.atual).toBeCloseTo(0.1);
    expect(rows[0]!.esperada).toBeCloseTo(0.8);
    expect(rows[0]!.gap).toBeCloseTo(-70);
    expect(rows[0]!.criticidade).not.toBe("sem-dados");
  });
  it("esperada = melhor ocupação do mesmo dia da semana em períodos anteriores (1 e 2 anos antes)", () => {
    const mkRow = (d: string, f: number, n: number): PaceRow => ({
      d,
      c: "SUV",
      f,
      a: Array(n).fill(60),
    });
    const h1 = mkRow("2025-12-15", 10, 6); // 364 dias antes de 14/12/2026: 60%
    const h2 = mkRow("2024-12-16", 10, 7); // 728 dias antes: 70%
    const ruido = mkRow("2026-10-05", 10, 10); // outra data comparável por sazonalidade, 100%: não entra no melhor registro
    const monta = (hs: PaceRow[]): PacePayload => ({
      ...payload,
      cal: Object.fromEntries([...hs, ruido, alvo].map((r) => [r.d, ["Média", null, null]])),
      linhas: [...hs, ruido, alvo],
    });
    const f = { from: "2026-11-09", to: "2026-12-31", category: null, minLead: 0, maxLead: 400 };
    const dois = buildModel(monta([h1, h2]), "maximo");
    const r = priorityRows(dois, BASE, f)[0]!;
    expect(r.esperada).toBeCloseTo(0.7);
    expect(r.level).toBe("aniversario");
    expect(r.n).toBe(2);
    expect(r.confianca).toBe("media");
    // só um período anterior disponível: vale ele, com confiança baixa
    const um = priorityRows(buildModel(monta([h1]), "maximo"), BASE, f)[0]!;
    expect(um.esperada).toBeCloseTo(0.6);
    expect(um.confianca).toBe("baixa");
    // nenhum período anterior: sem benchmark (não completa com outras datas)
    expect(priorityRows(buildModel(monta([]), "maximo"), BASE, f)[0]!.esperada).toBeNull();
    // sem override vale a estatística do payload (média por grupos de datas comparáveis)
    expect(priorityRows(buildModel(monta([h1, h2])), BASE, f)[0]!.level).not.toBe("aniversario");
  });
  it("data de evento: com o melhor registro basta uma edição passada; com a média continua exigindo n_evento", () => {
    const edicao = { d: "2026-02-17", c: "SUV", f: 10, a: Array(6).fill(100) } as PaceRow; // Carnaval 2026, posição 0; vendida com 100 dias (o alvo está a 92)
    const alvoEv = { d: "2027-02-09", c: "SUV", f: 10, a: [40] } as PaceRow; // Carnaval 2027, posição 0
    const p3: PacePayload = {
      ...payload,
      cal: { [edicao.d]: ["Altíssima", "carnaval", 0], [alvoEv.d]: ["Altíssima", "carnaval", 0] },
      linhas: [edicao, alvoEv],
    };
    const f = { from: "2027-02-01", to: "2027-02-28", category: null, minLead: 0, maxLead: 400 };
    const max = priorityRows(buildModel(p3, "maximo"), BASE, f)[0]!;
    expect(max.esperada).toBeCloseTo(0.6);
    expect(max.level).toBe("evento");
    expect(max.confianca).toBe("baixa"); // uma só edição
    expect(priorityRows(buildModel(p3, "media"), BASE, f)[0]!.esperada).toBeNull(); // n_evento = 2
  });
  it("datas de referência: mesmo dia da semana em datas comuns; mesma posição do evento nas edições passadas", () => {
    const ev = (d: string, rel: number): [string, string, number] => ["Alta", "carnaval", rel];
    const p4: PacePayload = {
      ...payload,
      cal: {
        "2024-02-14": ev("", 1), // Carnaval 2024 (terça 13/02), +1
        "2025-03-05": ev("", 1), // Carnaval 2025 (terça 04/03), +1
        "2026-02-18": ev("", 1), // Carnaval 2026 (terça 17/02), +1
        "2026-02-17": ev("", 0),
        "2027-02-10": ev("", 1), // Carnaval 2027 (terça 09/02), +1
        "2026-12-14": ["Média", null, null],
      },
      linhas: [],
    };
    const m = buildModel(p4);
    const e = referenceDates(m, "2027-02-10", BASE);
    expect(e.evento).toBe("carnaval");
    expect(e.posicao).toBe(1);
    expect(e.datas).toEqual(["2026-02-18", "2025-03-05", "2024-02-14"]); // da mais recente; nunca 364/728 dias antes
    const c = referenceDates(m, "2026-12-14", BASE);
    expect(c.evento).toBeNull();
    expect(c.datas).toEqual(["2025-12-15", "2024-12-16"]);
  });
  it("filtros de antecedência e categoria", () => {
    const f = { from: "2026-11-09", to: "2026-12-31", category: null, minLead: 0, maxLead: 400 };
    expect(priorityRows(model, BASE, { ...f, minLead: 40 })).toHaveLength(0);
    expect(priorityRows(model, BASE, { ...f, maxLead: 10 })).toHaveLength(0);
    expect(priorityRows(model, BASE, { ...f, category: "Outra" })).toHaveLength(0);
  });
  it("resumo conta datas abaixo, acima e dados suficientes", () => {
    const rows = [mk({ gap: -20 }), mk({ gap: 20 }), mk({ gap: null, criticidade: "sem-dados" })];
    const s = resumir(rows, DEFAULT_CRIT, () => false);
    expect(s).toMatchObject({ below: 1, above: 1, analisadas: 2, total: 3 });
    expect(s.gapMedio).toBe(0);
  });
});

import {
  janelaOf,
  byRank,
  enrich,
  matrix,
  worstByDate,
  scoreOf,
  ritmoConfianca,
  rhythmPooled,
  type HistCtx,
} from "./prioridades";
import type { CaptureInfo } from "./capture";

describe("central de prioridades", () => {
  const price = (level: PriceCtx["level"], pct = 0): PriceCtx => ({
    ...NO_PRICE,
    level,
    pct,
    n: 3,
    median: 100,
    min: 90,
    max: 120,
    reliable: true,
    ourRate: 100,
  });
  const crit = DEFAULT_CRIT;

  it("oportunidade só com ocupação acima e tarifa abaixo do mercado", () => {
    const up = mk({ gap: 20, criticidade: "ok" });
    expect(enrich(up, price("abaixo", -15), crit).nivel).toBe("oportunidade");
    expect(enrich(up, price("alinhado"), crit).nivel).toBe("ok");
    expect(enrich(up, NO_PRICE, crit).nivel).toBe("ok");
  });

  const hist = (pctl: number): HistCtx => ({ n: 20, mean: 0.6, sd: 0.15, pctl, z: null });
  const cap = (diffPp: number, faltam: number): CaptureInfo => ({
    histShare: 0.5,
    atualShare: 0.5 + diffPp / 100,
    diffPp,
    faltam,
    finalTipica: 0.8,
    n: 20,
    level: "dow",
  });
  const lento = {
    novas: 0,
    esperadas: 8,
    abaixo: true,
    tendencia: "desacelerando" as const,
    confianca: "media" as const,
    datas: 7,
  };
  const dev = (o: Partial<PriorityRow> = {}) => mk({ gap: -40, lead: 70, ...o });

  it("crítica exige desvio relevante, ≥2 evidências (captura ou ritmo) e referência não frágil", () => {
    expect(enrich(dev(), price("acima", 15), crit, lento, cap(-20, 4), hist(0.1)).nivel).toBe(
      "critica",
    );
    // sem evidências suficientes: atenção, não crítica
    expect(enrich(dev(), NO_PRICE, crit, null, cap(-20, 1), hist(0.1)).nivel).toBe("atencao");
    // referência frágil nunca vira crítica
    expect(
      enrich(dev({ confianca: "baixa" }), price("acima", 15), crit, lento, cap(-20, 4), hist(0.1))
        .nivel,
    ).toBe("atencao");
    // acompanhamento final (D-29) não é crítica
    expect(
      enrich(dev({ lead: 20 }), price("acima", 15), crit, lento, cap(-20, 4), hist(0.1)).nivel,
    ).toBe("atencao");
  });
  it("gap negativo contra o melhor registro, mas típico no histórico, fica dentro do esperado", () => {
    expect(enrich(dev(), NO_PRICE, crit, null, null, hist(0.7)).nivel).toBe("ok");
    expect(enrich(dev(), NO_PRICE, crit, null, null, hist(0.4)).nivel).toBe("monitorar");
  });
  it("sem benchmark é sem-dados; sem histórico suficiente usa só o gap e não vira crítica sem evidência", () => {
    expect(enrich(mk({ gap: null, booked: null }), NO_PRICE, crit).nivel).toBe("sem-dados");
    expect(enrich(dev(), NO_PRICE, crit).nivel).toBe("atencao");
  });
  it("pontuação explicável: soma dos fatores, nenhum domina e fatores indisponíveis saem", () => {
    const sc = scoreOf(dev(), price("acima", 15), crit, lento, cap(-20, 4), hist(0.1));
    expect(sc.fatores.reduce((a, f) => a + f.pontos, 0)).toBeCloseTo(sc.rank);
    expect(Math.max(...sc.fatores.map((f) => f.pontos))).toBeLessThanOrEqual(0.3 * 100 + 1e-9);
    const sem = scoreOf(dev(), NO_PRICE, crit, null, null, null);
    expect(
      sem.fatores
        .filter((f) => f.valor == null)
        .map((f) => f.chave)
        .sort(),
    ).toEqual(["falt", "preco", "ritmo"]);
    expect(sem.fatores.every((f) => f.valor != null || f.pontos === 0)).toBe(true);
  });
  it("ranking: mais diárias faltantes e ritmo ruim sobem; preço abaixo do mercado não sobe", () => {
    const a = enrich(
      dev({ date: "2026-12-01" }),
      price("acima", 15),
      crit,
      lento,
      cap(-25, 6),
      hist(0.05),
    );
    const b = enrich(
      dev({ date: "2026-12-02" }),
      price("abaixo", -15),
      crit,
      null,
      cap(-16, 1),
      hist(0.2),
    );
    const c = enrich(dev({ date: "2026-12-03" }), NO_PRICE, crit, null, null, null);
    const lista = [c, b, a].sort(byRank);
    expect(lista[0]!.date).toBe("2026-12-01");
    expect(a.rank).toBeGreaterThan(b.rank);
  });
  it("tendência: confiança por diárias esperadas; poucas = indisponível, nunca estável", () => {
    expect(ritmoConfianca(0.4, 7)).toBe("insuficiente");
    expect(ritmoConfianca(5, 2)).toBe("insuficiente");
    expect(ritmoConfianca(2, 7)).toBe("baixa");
    expect(ritmoConfianca(6, 7)).toBe("media");
    expect(ritmoConfianca(12, 7)).toBe("alta");
    expect(
      rhythmPooled(
        buildModel({
          versao: 3,
          gerado_em: "",
          hoje: BASE,
          de: "2023-06-24",
          ate: BASE,
          categorias: [],
          params: { n_evento: 2, n_dow: 8, n_saz: 15, estatistica: "media" },
          cal: {},
          linhas: [],
        }),
        "2026-12-01",
        "SUV",
        BASE,
        crit,
      ),
    ).toBeNull();
  });

  it("matriz e calendário usam as mesmas linhas; sem benchmark não vira zero", () => {
    const rows = [
      enrich(dev(), price("acima", 15), crit, lento, cap(-20, 4), hist(0.1)),
      enrich(
        mk({ date: "2026-12-16", gap: null, booked: null, criticidade: "sem-dados" }),
        NO_PRICE,
        crit,
      ),
    ];
    const m = matrix(rows, crit);
    expect(m.cells.find((c) => c.occ === "abaixo" && c.market === "acima")).toMatchObject({
      count: 1,
      critical: 1,
    });
    expect(m.semBenchmark).toBe(1);
    expect(m.cells.reduce((s, c) => s + c.count, 0) + m.semBenchmark).toBe(rows.length);
    const w = worstByDate(rows);
    expect(w.size).toBe(2);
    expect(w.get("2026-12-15")!.nivel).toBe("critica");
  });
});

describe("sensibilidade dos parâmetros (dados sintéticos)", () => {
  const crit = DEFAULT_CRIT;
  const mkp = (o: Partial<PriorityRow>) => mk({ gap: -40, lead: 70, ...o });
  const lento = {
    novas: 0,
    esperadas: 8,
    abaixo: true,
    tendencia: "desacelerando" as const,
    confianca: "media" as const,
    datas: 7,
  };
  const cpt = (d: number, f: number): CaptureInfo => ({
    histShare: 0.5,
    atualShare: 0.5 + d / 100,
    diffPp: d,
    faltam: f,
    finalTipica: 0.8,
    n: 20,
    level: "dow",
  });
  // percentis históricos de 0,02 a 0,70; déficits de captura de -30 a 0; faltantes de 0 a 6
  const grid = Array.from({ length: 36 }, (_, i) => ({
    h: { n: 20, mean: 0.6, sd: 0.15, pctl: 0.02 + (i % 12) * 0.06, z: null } as HistCtx,
    c: cpt(-30 + (i % 6) * 6, (i % 7) * 1),
    r: i % 3 === 0 ? lento : null,
  }));
  const conta = (c: typeof crit) => {
    const n: Record<string, number> = {};
    for (const g of grid) {
      const v = enrich(mkp({}), NO_PRICE, c, g.r, g.c, g.h).nivel;
      n[v] = (n[v] ?? 0) + 1;
    }
    return n;
  };
  it("pRel maior amplia o desvio relevante (atenção+crítica nunca diminui)", () => {
    const f = (c: typeof crit) => {
      const n = conta(c);
      return (n["atencao"] ?? 0) + (n["critica"] ?? 0);
    };
    expect(f({ ...crit, pRel: 0.1 })).toBeLessThanOrEqual(f({ ...crit, pRel: 0.25 }));
    expect(f({ ...crit, pRel: 0.25 })).toBeLessThanOrEqual(f({ ...crit, pRel: 0.5 }));
  });
  it("mais evidências exigidas nunca aumentam as críticas", () => {
    const k = (n: number) => conta({ ...crit, evidMin: n })["critica"] ?? 0;
    expect(k(1)).toBeGreaterThanOrEqual(k(2));
    expect(k(2)).toBeGreaterThanOrEqual(k(3));
    expect(k(3)).toBeGreaterThanOrEqual(k(4));
  });
  it("os pesos mudam a ordem sem mudar o nível", () => {
    const h = grid[0]!.h;
    const muitaFrota = mkp({ vacant: 10 });
    const poucaFrota = mkp({ vacant: 1 });
    const a = enrich(muitaFrota, NO_PRICE, crit, null, cpt(-20, 4), h);
    const b = enrich(poucaFrota, NO_PRICE, crit, null, cpt(-20, 9), h);
    expect(a.nivel).toBe("critica");
    expect(b.nivel).toBe("critica");
    expect(b.rank).toBeGreaterThan(a.rank); // pesos padrão: mais diárias faltantes sobem
    const porFrota = { ...crit, wFrota: 0.9, wFalt: 0.01 };
    const ea = enrich(muitaFrota, NO_PRICE, porFrota, null, cpt(-20, 4), h);
    const eb = enrich(poucaFrota, NO_PRICE, porFrota, null, cpt(-20, 9), h);
    expect(ea.rank).toBeGreaterThan(eb.rank); // peso alto em frota: mais frota livre sobe
    expect(ea.nivel).toBe(a.nivel);
  });
  it("preço de baixa confiança (1 concorrente / só parcial) não conta como evidência", () => {
    const parcial: PriceCtx = {
      ...NO_PRICE,
      level: "acima",
      pct: 15,
      n: 2,
      partial: true,
      median: 100,
      ourRate: 115,
    };
    const firme: PriceCtx = { ...parcial, n: 3, partial: false, reliable: true };
    const h = { n: 20, mean: 0.6, sd: 0.15, pctl: 0.05, z: null } as HistCtx;
    expect(enrich(mkp({}), parcial, crit, null, cpt(-20, 1), h).evidencias).not.toContain(
      "tarifa acima do mercado",
    );
    expect(enrich(mkp({}), firme, crit, null, cpt(-20, 1), h).evidencias).toContain(
      "tarifa acima do mercado",
    );
  });
});
