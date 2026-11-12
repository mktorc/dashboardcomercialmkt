import { describe, expect, it } from "vitest";
import { addDays, buildModel, dayPace, windowAnalysis, type PacePayload, type PaceRow } from "./occupancy-pace";
import {
  TOL_PADRAO,
  diagnostico,
  diariaRestanteJanela,
  faixasPreco,
  pontosEpoca,
  quadranteDia,
  quebraAntecedencia,
  sinalOcupacao,
  sinalPreco,
  sinalRitmo,
  vendasRecentes,
  type PontoEpoca,
} from "./preco-analise";

describe("sinais do quadrante: limites de tolerância", () => {
  it("ocupação: ±5 p.p. ou ±1 carro, o que for maior; limites inclusivos", () => {
    expect(sinalOcupacao(-5, 100)).toBe("no-ritmo");
    expect(sinalOcupacao(-5.01, 100)).toBe("abaixo");
    expect(sinalOcupacao(5, 100)).toBe("no-ritmo");
    expect(sinalOcupacao(5.01, 100)).toBe("acima");
    // frota de 10: 1 carro = 10 p.p., maior que 5 p.p.
    expect(sinalOcupacao(-10, 10)).toBe("no-ritmo");
    expect(sinalOcupacao(-10.5, 10)).toBe("abaixo");
    // configurável
    expect(sinalOcupacao(-8, 100, { ...TOL_PADRAO, ocupPp: 8 })).toBe("no-ritmo");
    expect(sinalOcupacao(-20, 10, { ...TOL_PADRAO, ocupCarros: 2 })).toBe("no-ritmo");
  });
  it("preço: alinhado em ±5% contra a referência", () => {
    expect(sinalPreco(105, 100)).toBe("alinhado");
    expect(sinalPreco(95, 100)).toBe("alinhado");
    expect(sinalPreco(105.1, 100)).toBe("mais-caro");
    expect(sinalPreco(94.9, 100)).toBe("mais-barato");
    expect(sinalPreco(110, 100, { ...TOL_PADRAO, precoPct: 10 })).toBe("alinhado");
    expect(sinalPreco(null, 100)).toBeNull();
    expect(sinalPreco(100, 0)).toBeNull();
  });
  it("ritmo: igual dentro de ±1 carro ou ±10% do ritmo da referência (o maior)", () => {
    expect(sinalRitmo(9, 10)).toBe("igual");
    expect(sinalRitmo(8.9, 10)).toBe("abaixo");
    expect(sinalRitmo(11, 10)).toBe("igual");
    expect(sinalRitmo(11.1, 10)).toBe("acima");
    expect(sinalRitmo(27, 30)).toBe("igual"); // 10% de 30 = 3
    expect(sinalRitmo(26.9, 30)).toBe("abaixo");
    expect(sinalRitmo(null, 10)).toBeNull();
  });
});

describe("diagnóstico", () => {
  it("segue a tabela de decisão", () => {
    expect(diagnostico("abaixo", "mais-caro", "abaixo")).toBe("preco-alto");
    expect(diagnostico("abaixo", "mais-caro", null)).toBe("preco-alto");
    expect(diagnostico("abaixo", "alinhado", "abaixo")).toBe("avaliar-preco");
    expect(diagnostico("abaixo", "alinhado", "igual")).toBe("aguardar");
    expect(diagnostico("abaixo", "alinhado", "acima")).toBe("aguardar");
    expect(diagnostico("abaixo", "mais-barato", "acima")).toBe("demanda-fraca");
    expect(diagnostico("no-ritmo", "mais-caro", "abaixo")).toBe("no-ritmo");
    expect(diagnostico("no-ritmo", null, null)).toBe("no-ritmo");
    expect(diagnostico("acima", "mais-barato", "igual")).toBe("vendendo-barato");
    expect(diagnostico("acima", "alinhado", "igual")).toBe("forte");
    expect(diagnostico("acima", "mais-caro", "abaixo")).toBe("forte");
  });
  it("sem ritmo (data encerrada) abaixo + alinhado vira Avaliar preço; sem preço só 'no ritmo' diagnostica", () => {
    expect(diagnostico("abaixo", "alinhado", null)).toBe("avaliar-preco");
    expect(diagnostico("abaixo", null, "abaixo")).toBeNull();
    expect(diagnostico("acima", null, null)).toBeNull();
  });
});

describe("quadrante de uma data", () => {
  const B = "2026-12-20"; // data-base depois do alvo: data encerrada
  const BA = "2026-11-10"; // data-base aberta: alvo em D-36
  const D = "2026-12-16";
  // Referência 2025: 4 carros vendidos cedo (D-60, US$ 50) e 2 tarde (D-10, US$ 50 e US$ 70): o que faltava vender de D-35 em diante vale US$ 60.
  const ref = (k: number): PaceRow => ({ d: addDays(D, k - 364), c: "A", f: 10, a: [60, 60, 60, 60, 10, 10], m: [50, 50, 50, 50, 50, 70] });
  const monta = (alvo: PaceRow, base: string) => {
    const linhas = [alvo, ...[-3, -2, -1, 0, 1, 2, 3].map(ref)];
    const p = { versao: 7, gerado_em: "", hoje: base, de: "2023-01-01", ate: "2027-05-01", categorias: ["A"], params: { n_evento: 1, n_dow: 1, n_saz: 1, estatistica: "maximo" }, cal: {}, linhas } as unknown as PacePayload;
    const model = buildModel(p, "maximo");
    const rows = [alvo];
    return { d: dayPace(model, rows, D, base), rows, janela: windowAnalysis(model, rows, D, base).janela };
  };
  const quad = (alvo: PaceRow, base: string, tarifa: number | null) => {
    const { d, rows, janela } = monta(alvo, base);
    return quadranteDia(d, rows, janela, "2023-01-01", TOL_PADRAO, tarifa)!;
  };
  // 2 carros vendidos há mais de 14 dias antes de D-36 (D-100) a US$ 58 contra 4 da referência no estágio: abaixo da esperada em 2 carros.
  const antigas: PaceRow = { d: D, c: "A", f: 10, a: [100, 100], m: [58, 58] };
  // 2 carros criados nos últimos 14 dias (D-40) a US$ 100.
  const recentes: PaceRow = { d: D, c: "A", f: 10, a: [40, 40], m: [100, 100] };

  it("referência = preço do que faltava vender (D-35 em diante), não as vendas antigas da referência", () => {
    const { janela } = monta(antigas, BA);
    expect(diariaRestanteJanela(janela)).toBeCloseTo(60, 5); // (50 + 70) ÷ 2, nos 7 dias da janela
  });
  it("(a) tarifa atual: vendas antigas baratas não rebaixam o preço de hoje (caso de 21/01: US$ 58 vendido, tarifa US$ 70)", () => {
    const q = quad(antigas, BA, 70);
    expect(q.fontePreco).toBe("tarifa");
    expect(q.diariaAtual).toBe(70);
    expect(q.preco).toBe("mais-caro"); // +17% contra US$ 60 (com a diária acumulada de US$ 58 daria alinhado/mais barato)
    expect(q.ocupacao).toBe("abaixo");
    expect(q.diagnostico).toBe("preco-alto");
    expect(q.frase).toBe("2 carros abaixo da esperada em D-36; tarifa atual US$ 70 contra US$ 60 que 2025 praticou de D-35 em diante (+17%); ritmo recente igual ao de 2025");
  });
  it("(b) sem tarifa: diária das vendas dos últimos 14 dias", () => {
    const q = quad(recentes, BA, null);
    expect(q.fontePreco).toBe("recentes");
    expect(q.diariaAtual).toBe(100);
    expect(q.preco).toBe("mais-caro");
    expect(q.frase).toContain("diária das vendas recentes (14 dias) US$ 100 contra US$ 60 que 2025 praticou");
  });
  it("(c) sem tarifa e sem vendas recentes: diária já vendida (acumulada), identificada como tal", () => {
    const q = quad(antigas, BA, null);
    expect(q.fontePreco).toBe("acumulada");
    expect(q.diariaAtual).toBe(58);
    expect(q.preco).toBe("alinhado"); // −3%
    expect(q.ritmo).toBe("igual"); // 0 carros novos nos 14 dias contra 0 da referência
    expect(q.diagnostico).toBe("aguardar");
    expect(q.frase).toContain("diária já vendida (vendas antigas) US$ 58 contra US$ 60");
  });
  it("tarifa sem valor (0) não conta: cai para as vendas recentes", () => {
    expect(quad(recentes, BA, 0).fontePreco).toBe("recentes");
  });
  it("data encerrada: ignora tarifa e vendas recentes, usa a diária final contra o total da referência, sem ritmo", () => {
    const q = quad(antigas, B, 70);
    expect(q.fontePreco).toBe("acumulada");
    expect(q.diariaAtual).toBe(58);
    expect(q.diariaRef).toBeCloseTo((4 * 50 + 50 + 70) / 6, 5);
    expect(q.ritmo).toBeNull();
    expect(q.frase).toContain("praticou no total");
    expect(q.frase).not.toContain("ritmo recente");
  });
  it("sem esperada, sem quadrante", () => {
    const { d, rows, janela } = monta(antigas, BA);
    expect(quadranteDia({ ...d, gap: null, esperada: null }, rows, janela, "2023-01-01")).toBeNull();
  });
  it("preço alinhado e abaixo: o ritmo decide entre Aguardar e Avaliar preço", () => {
    const alinhado: PaceRow = { d: D, c: "A", f: 10, a: [40, 40], m: [61, 61] }; // vendas recentes a US$ 61 contra 60
    const q = quad(alinhado, BA, null);
    expect(q.preco).toBe("alinhado");
    expect(q.ritmo).toBe("acima"); // 2 carros nos últimos 14 dias contra 0 da referência
    expect(q.diagnostico).toBe("aguardar");
  });
});

describe("quebra por faixa de antecedência", () => {
  const a = [100, 91, 90, 61, 60, 31, 30, 16, 15, 8, 7, 0];
  const row = (m?: number[]): PaceRow => ({ d: "2026-12-16", c: "A", f: 20, a, ...(m ? { m } : {}) });
  it("cada limite cai na faixa certa; carros, % e diária por faixa", () => {
    const q = quebraAntecedencia([row(a.map((_, i) => 100 + i * 10))]);
    expect(q.faixas.map((f) => f.carros)).toEqual([2, 2, 2, 2, 2, 2]);
    expect(q.faixas.map((f) => f.label)).toEqual(["Mais de D-90", "D-90 a D-61", "D-60 a D-31", "D-30 a D-16", "D-15 a D-8", "D-7 a D-0"]);
    expect(q.faixas[0]!.pct).toBeCloseTo(2 / 12, 5);
    expect(q.faixas[0]!.diaria).toBe(105); // (100 + 110) ÷ 2
    expect(q.faixas[5]!.diaria).toBe(205);
    expect(q.total.carros).toBe(12);
    expect(q.total.diaria).toBeCloseTo(a.reduce((s, _, i) => s + 100 + i * 10, 0) / 12, 5);
  });
  it("só diárias criadas até a data-base e diárias sem preço fora da diária", () => {
    // base em D-20: só entram antecedências ≥ 20 (exclui D-16 em diante)
    const q = quebraAntecedencia([row([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 0])], 20);
    expect(q.faixas.map((f) => f.carros)).toEqual([2, 2, 2, 1, 0, 0]); // 30 ainda entra; 16 e as seguintes não
    expect(q.total.carros).toBe(7);
    // diária ignora a diária sem preço (m = 0), mas o carro conta
    const sem = quebraAntecedencia([row([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 70])]);
    expect(sem.faixas[5]!.carros).toBe(2);
    expect(sem.faixas[5]!.diaria).toBe(70);
    expect(sem.faixas[0]!.diaria).toBeNull();
  });
  it("sem diárias: zeros, sem divisão por zero", () => {
    const q = quebraAntecedencia([{ d: "x", c: "A", f: 5, a: [] }]);
    expect(q.total).toEqual({ carros: 0, diaria: null });
    expect(q.faixas.every((f) => f.pct === 0 && f.diaria === null)).toBe(true);
  });
});

describe("diária das vendas recentes", () => {
  const r: PaceRow = { d: "2027-01-28", c: "A", f: 10, a: [30, 36, 40, 45, 49, 50, 60], m: [999, 100, 110, 120, 130, 999, 999] };
  it("reservas criadas nos últimos N dias antes da antecedência L: [L, L+N)", () => {
    expect(vendasRecentes([r], 36, 14)).toEqual({ carros: 4, diaria: 115 }); // 36, 40, 45, 49
    expect(vendasRecentes([r], 36, 7)).toEqual({ carros: 2, diaria: 105 }); // 36, 40
  });
  it("sem preço: carros sem diária; encerrada ou sem histórico do estágio: null", () => {
    expect(vendasRecentes([{ d: r.d, c: r.c, f: r.f, a: r.a }], 36, 14)).toEqual({ carros: 4, diaria: null });
    expect(vendasRecentes([r], 0, 14)).toBeNull();
    expect(vendasRecentes([r], 36, 14, { date: "2026-01-28", de: "2025-12-15" })).toBeNull(); // 2026-01-28 − 50 dias = 09/12 < de
    expect(vendasRecentes([r], 36, 14, { date: "2026-01-28", de: "2025-01-01" })).not.toBeNull();
  });
});

describe("faixa de preço por época", () => {
  const cal: PacePayload["cal"] = {};
  const linhas: PaceRow[] = [];
  const add = (d: string, c: string, n: number, preco: number, f = 10, ev: string | null = null) => {
    cal[d] = ["Média", ev, ev ? 0 : null];
    linhas.push({ d, c, f, a: Array(n).fill(30), m: Array(n).fill(preco) });
  };
  add("2024-01-05", "A", 5, 40); // diária 40, 20/veículo
  add("2025-01-06", "A", 5, 42);
  add("2025-02-10", "A", 9, 99); // fora: fevereiro
  add("2026-01-07", "A", 8, 60); // diária 60
  add("2023-01-09", "A", 9, 99); // fora: antes de 2024
  add("2026-01-08", "A", 9, 99, 10, "carnaval"); // fora: evento
  add("2026-01-09", "A", 0, 0); // fora: sem preço
  add("2027-01-10", "A", 9, 99); // fora: futuro (≥ hoje)
  add("2026-01-10", "B", 4, 80);
  const payload = { linhas, cal, hoje: "2026-11-12" };
  it("só datas passadas da época, de 2024 em diante, sem evento nem data sem preço", () => {
    const ps = pontosEpoca(payload, { categoria: "A", mes: 1, sazonalidade: null });
    expect(ps.map((p) => p.date)).toEqual(["2024-01-05", "2025-01-06", "2026-01-07"]);
    expect(ps[0]).toMatchObject({ ano: "2024", diaria: 40, revVeic: 20, occ: 0.5 });
    expect(ps[2]).toMatchObject({ diaria: 60, revVeic: 48, occ: 0.8 });
  });
  it("todas as categorias somam faturamento e frota; sazonalidade filtra", () => {
    const todas = pontosEpoca(payload, { categoria: null, mes: 1, sazonalidade: null }).find((p) => p.date === "2026-01-10")!;
    expect(todas).toMatchObject({ diaria: 80 });
    expect(pontosEpoca(payload, { categoria: "A", mes: null, sazonalidade: "Alta" })).toEqual([]);
    expect(pontosEpoca(payload, { categoria: "A", mes: null, sazonalidade: "Média" }).length).toBe(4);
  });
  const pt = (n: number, diaria: number, revVeic: number): PontoEpoca[] =>
    Array.from({ length: n }, (_, i) => ({ date: `2025-01-${String(i + 1).padStart(2, "0")}`, ano: "2025", diaria, revVeic, occ: 0.5 }));
  it("faixas de US$ 5; destaca a de maior faturamento/veículo com amostra suficiente; abaixo disso, amostra pequena", () => {
    const fs = faixasPreco([...pt(5, 41, 20), ...pt(6, 52, 30), ...pt(2, 63, 99)]);
    expect(fs.map((f) => [f.de, f.ate, f.datas, f.pequena, f.destaque])).toEqual([
      [40, 45, 5, false, false],
      [50, 55, 6, false, true],
      [60, 65, 2, true, false], // maior faturamento, mas só 2 datas: nunca destacada
    ]);
    expect(fs[1]!.revVeicMedio).toBe(30);
    expect(fs[1]!.occMedia).toBe(0.5);
  });
  it("limites: 45 cai na faixa 45–50; mínimo e largura configuráveis; sem amostra suficiente nada é destacado", () => {
    expect(faixasPreco(pt(1, 45, 10))[0]).toMatchObject({ de: 45, ate: 50 });
    expect(faixasPreco(pt(1, 44.99, 10))[0]).toMatchObject({ de: 40 });
    expect(faixasPreco([...pt(5, 41, 20), ...pt(6, 52, 30)], { minDatas: 6 }).map((f) => f.destaque)).toEqual([false, true]);
    expect(faixasPreco(pt(4, 41, 20)).some((f) => f.destaque)).toBe(false);
    expect(faixasPreco([...pt(5, 41, 20), ...pt(5, 52, 30)], { largura: 20 }).map((f) => [f.de, f.datas])).toEqual([[40, 10]]);
    expect(faixasPreco([])).toEqual([]);
  });
  it("empate no faturamento: vale a faixa mais barata", () => {
    expect(faixasPreco([...pt(5, 41, 25), ...pt(5, 52, 25)]).map((f) => f.destaque)).toEqual([true, false]);
  });
});
