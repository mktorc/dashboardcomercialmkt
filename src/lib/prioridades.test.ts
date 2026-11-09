import { describe, expect, it } from "vitest";
import { buildModel, type PacePayload, type PaceRow } from "./occupancy-pace";
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
  it("o mesmo gap pesa mais com pouca antecedência", () => {
    const longe = classify(mk({ gap: -30, lead: 60 }), "alta", DEFAULT_CRIT);
    const perto = classify(mk({ gap: -30, lead: 7 }), "alta", DEFAULT_CRIT);
    expect(perto.score).toBeGreaterThan(longe.score);
    expect(perto.criticidade).toBe("atencao");
    expect(longe.criticidade).toBe("monitorar");
  });
  it("gap pequeno ou positivo não é crítico; sem benchmark é sem dados", () => {
    expect(classify(mk({ gap: -3 }), "alta", DEFAULT_CRIT).criticidade).toBe("ok");
    expect(classify(mk({ gap: 12 }), "alta", DEFAULT_CRIT).criticidade).toBe("ok");
    expect(classify(mk({ gap: null, esperada: null }), "alta", DEFAULT_CRIT).criticidade).toBe(
      "sem-dados",
    );
  });
  it("referência pouco confiável não gera crítica sozinha", () => {
    const d = mk({ gap: -80, lead: 5, season: "Altíssima" });
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
    expect(urgency(3, DEFAULT_CRIT)).toBe(1);
    expect(urgency(100, DEFAULT_CRIT)).toBeLessThan(urgency(40, DEFAULT_CRIT));
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
  it("pouca antecedência acrescenta a ação de curto prazo", () => {
    const rs = recommend(critica({ lead: 5 }), price({}), null, c);
    expect(rs.some((r) => /curto prazo/.test(r.acao))).toBe(true);
    expect(
      recommend(critica({ lead: 50 }), price({}), null, c).some((r) => /curto prazo/.test(r.acao)),
    ).toBe(false);
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
    de: "2026-10-01",
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
