import { describe, expect, it } from "vitest";
import {
  addDays,
  benchmarkFor,
  buildModel,
  dailySeries,
  dayPace,
  gapLevel,
  leadOf,
  occupancyAt,
  pickupCurve,
  referenceItems,
  windowAnalysis,
  ganhoAteData,
  avisoFrota,
  revenueOf,
  rowsByDate,
  summarize,
  type PaceParams,
  type PaceRow,
  type PacePayload,
  windowOccupancy,
} from "./occupancy-pace";
import { metaCarros } from "./occupancy-detail";

const BASE = "2026-11-06";
const ALVO = "2026-12-25"; // sexta-feira, D-49 em BASE
const CAT = "SUV";

/** Linha com f=10 carros e `vendidas` diárias: cada uma com a antecedência indicada. */
const linha = (d: string, a: number[], c = CAT): PaceRow => ({ d, c, f: 10, a });
/** `n` diárias com antecedência `cedo` (vendidas cedo) e `m` com antecedência `tarde`. */
const mix = (n: number, cedo: number, m: number, tarde: number) => [
  ...Array(n).fill(cedo),
  ...Array(m).fill(tarde),
];

function payload(
  linhas: PaceRow[],
  cal: PacePayload["cal"],
  params: Partial<PaceParams> = {},
): PacePayload {
  return {
    versao: 2,
    gerado_em: "",
    hoje: BASE,
    de: "2024-01-01",
    ate: "2027-05-01",
    categorias: [CAT],
    params: { n_evento: 2, n_dow: 3, n_saz: 5, estatistica: "media", ...params },
    cal,
    linhas,
  };
}

/** Sextas-feiras "Alta" anteriores à base, cada uma com 5 diárias vendidas em D-60 e 4 em D-10 (D-49 = 50%, final = 90%). */
function sextasAltas(n: number) {
  const linhas: PaceRow[] = [];
  const cal: PacePayload["cal"] = {};
  for (let i = 0; i < n; i++) {
    const d = addDays("2026-07-03", -7 * i); // 03/07/2026 é sexta
    linhas.push(linha(d, mix(5, 60, 4, 10)));
    cal[d] = ["Alta", null, null];
  }
  return { linhas, cal };
}

describe("antecedência", () => {
  it("é a data de retirada menos a data-base", () => {
    expect(leadOf("2026-12-25", "2026-11-06").lead).toBe(49);
    expect(leadOf("2026-12-25", "2026-11-25").lead).toBe(30);
    expect(leadOf("2026-12-25", "2026-12-10").lead).toBe(15);
    expect(leadOf("2026-12-25", "2026-12-18").lead).toBe(7);
  });
  it("data já encerrada é lida em D-0", () => {
    expect(leadOf("2026-10-01", BASE)).toEqual({ lead: 0, closed: true });
    expect(leadOf(BASE, BASE)).toEqual({ lead: 0, closed: false });
  });
});

describe("benchmark por antecedência", () => {
  const { linhas, cal } = sextasAltas(6);
  cal[ALVO] = ["Alta", null, null];
  const alvo = linha(ALVO, mix(3, 60, 0, 0)); // 30% em D-49
  const model = buildModel(payload([...linhas, alvo], cal));

  it("usa a ocupação histórica em D-N, nunca a final", () => {
    expect(benchmarkFor(model, alvo, 49, BASE)?.value).toBeCloseTo(0.5);
    expect(benchmarkFor(model, alvo, 7, BASE)?.value).toBeCloseTo(0.9);
    expect(occupancyAt(linhas[0]!, 49)).toBeCloseTo(0.5);
  });
  it("compara atual e esperada na mesma data, categoria e antecedência", () => {
    const d = dayPace(model, [alvo], ALVO, BASE);
    expect(d.lead).toBe(49);
    expect(d.atual).toBeCloseTo(0.3);
    expect(d.esperada).toBeCloseTo(0.5);
    expect(d.gap).toBeCloseTo(-20);
    expect(gapLevel(d.gap!)).toBe("muito-abaixo");
    expect(d.level).toBe("dow");
  });
  it("não observa antecedências que ainda não chegaram, mas mantém o benchmark", () => {
    const curve = pickupCurve(model, [alvo], ALVO, BASE);
    const at = (L: number) => curve.find((p) => p.L === L)!;
    expect(at(60).atual).toBeCloseTo(0.3); // D-60: foto já existente (a data-base é D-49)
    expect(at(49).atual).toBeCloseTo(0.3);
    for (const L of [45, 30, 15, 7, 1, 0]) {
      expect(at(L).atual).toBeNull();
      expect(at(L).gap).toBeNull();
      expect(at(L).esperada).not.toBeNull();
    }
    expect(at(0).esperada).toBeCloseTo(0.9);
    expect(curve.filter((p) => p.effective).map((p) => p.L)).toEqual([49]);
  });
  it("a própria data não entra no benchmark", () => {
    const outlier = linha(ALVO, mix(10, 60, 0, 0));
    const m = buildModel(payload([...linhas, outlier], cal));
    expect(benchmarkFor(m, outlier, 49, BASE)?.value).toBeCloseTo(0.5);
  });
});

describe("sem vazamento de futuro", () => {
  it("datas na data-base ou depois dela não entram no benchmark", () => {
    const { linhas, cal } = sextasAltas(6);
    cal[ALVO] = ["Alta", null, null];
    const alvo = linha(ALVO, []);
    const base = benchmarkFor(buildModel(payload([...linhas, alvo], cal)), alvo, 49, BASE)!.value;
    const futuras = ["2026-11-06", "2026-11-13", "2026-11-20"].map((d) =>
      linha(d, mix(10, 90, 0, 0)),
    );
    for (const f of futuras) cal[f.d] = ["Alta", null, null];
    const depois = benchmarkFor(
      buildModel(payload([...linhas, ...futuras, alvo], cal)),
      alvo,
      49,
      BASE,
    )!.value;
    expect(depois).toBeCloseTo(base);
  });
  it("com data-base anterior só entra o que já estava encerrado nela", () => {
    const { linhas, cal } = sextasAltas(6);
    cal[ALVO] = ["Alta", null, null];
    const alvo = linha(ALVO, []);
    const m = buildModel(payload([...linhas, alvo], cal));
    // datas: 03/07, 26/06, 19/06, 12/06, 05/06, 29/05; base 20/06 deixa 19/06, 12/06, 05/06, 29/05 (4 ≥ n_dow=3)
    expect(benchmarkFor(m, alvo, 49, "2026-06-20")?.n).toBe(4);
    expect(benchmarkFor(m, alvo, 49, "2026-06-01")).toBeNull(); // só 29/05: histórico insuficiente
  });
});

describe("eventos móveis", () => {
  it("compara só o mesmo evento, na mesma posição relativa", () => {
    const linhas = [
      linha("2024-02-11", mix(2, 30, 0, 0)), // carnaval -2 → 20%
      linha("2025-03-02", mix(4, 30, 0, 0)), // carnaval -2 → 40%
      linha("2024-02-14", mix(9, 30, 0, 0)), // carnaval +1: outra posição, ignorada
      linha("2025-06-17", mix(8, 30, 0, 0)), // corpus christi -2: outro evento, ignorado
      linha("2026-02-15", []),
    ];
    const cal: PacePayload["cal"] = {
      "2024-02-11": ["Alta", "carnaval", -2],
      "2025-03-02": ["Alta", "carnaval", -2],
      "2024-02-14": ["Alta", "carnaval", 1],
      "2025-06-17": ["Alta", "corpus_christi", -2],
      "2026-02-15": ["Alta", "carnaval", -2],
    };
    const m = buildModel(payload(linhas, cal));
    const b = benchmarkFor(m, linhas[4]!, 30, "2026-02-01")!;
    expect(b.level).toBe("evento");
    expect(b.n).toBe(2);
    expect(b.value).toBeCloseTo(0.3);
  });
  it("evento sem amostras suficientes fica sem benchmark, sem cair para a sazonalidade", () => {
    const { linhas, cal } = sextasAltas(8); // há muita data comum "Alta"
    const ev = linha("2025-03-02", mix(4, 30, 0, 0));
    const alvo = linha("2026-02-15", []);
    cal["2025-03-02"] = ["Alta", "carnaval", -2];
    cal["2026-02-15"] = ["Alta", "carnaval", -2];
    const m = buildModel(payload([...linhas, ev, alvo], cal));
    expect(benchmarkFor(m, alvo, 30, "2026-02-01")).toBeNull();
  });
  it("datas de evento não contaminam o benchmark de data comum", () => {
    const { linhas, cal } = sextasAltas(6);
    const ev = linha("2026-06-26", mix(10, 60, 0, 0)); // sexta, "Alta", mas evento
    cal["2026-06-26"] = ["Alta", "corpus_christi", 1];
    const alvo = linha(ALVO, []);
    cal[ALVO] = ["Alta", null, null];
    const m = buildModel(payload([...linhas.filter((l) => l.d !== "2026-06-26"), ev, alvo], cal));
    expect(benchmarkFor(m, alvo, 49, BASE)?.value).toBeCloseTo(0.5);
  });
  it("a data que foi Carnaval num ano não herda o evento no seguinte", () => {
    const { linhas, cal } = sextasAltas(6);
    cal[ALVO] = ["Baixa", null, null]; // 04/03/2026 é comum no calendário de 2026; o payload traz a classificação do ano
    const alvo = linha(ALVO, []);
    const m = buildModel(payload([...linhas, alvo], cal));
    expect(benchmarkFor(m, alvo, 49, BASE)).toBeNull(); // não há histórico "Baixa" e o Carnaval de 2025 não conta
  });
});

describe("amostra mínima", () => {
  it("sem amostras suficientes não há benchmark nem gap", () => {
    const { linhas, cal } = sextasAltas(2);
    cal[ALVO] = ["Alta", null, null];
    const alvo = linha(ALVO, mix(3, 60, 0, 0));
    const d = dayPace(buildModel(payload([...linhas, alvo], cal)), [alvo], ALVO, BASE);
    expect(d.esperada).toBeNull();
    expect(d.gap).toBeNull();
    expect(d.atual).toBeCloseTo(0.3);
  });
  it("cai de dia da semana para sazonalidade só quando o nível 2 não tem amostras", () => {
    const linhas: PaceRow[] = [];
    const cal: PacePayload["cal"] = {};
    for (let i = 1; i <= 6; i++) {
      const d = addDays("2026-07-05", i); // dias de semana distintos: nenhum dia da semana chega a n_dow=3
      linhas.push(linha(d, mix(5, 60, 0, 0)));
      cal[d] = ["Alta", null, null];
    }
    cal[ALVO] = ["Alta", null, null];
    const alvo = linha(ALVO, []);
    const b = benchmarkFor(buildModel(payload([...linhas, alvo], cal)), alvo, 49, BASE)!;
    expect(b.level).toBe("saz");
    expect(b.n).toBe(6);
  });
  it("aceita mediana como estatística", () => {
    const { linhas, cal } = sextasAltas(3);
    linhas[0] = linha(linhas[0]!.d, mix(10, 60, 0, 0)); // uma data atípica (100%)
    cal[ALVO] = ["Alta", null, null];
    const alvo = linha(ALVO, []);
    const media = benchmarkFor(buildModel(payload([...linhas, alvo], cal)), alvo, 49, BASE)!.value;
    const mediana = benchmarkFor(
      buildModel(payload([...linhas, alvo], cal, { estatistica: "mediana" })),
      alvo,
      49,
      BASE,
    )!.value;
    expect(media).toBeCloseTo((1 + 0.5 + 0.5) / 3);
    expect(mediana).toBeCloseTo(0.5);
  });
});

describe("gap, KPIs e calendário", () => {
  it("classifica o gap nas faixas e respeita faixas customizadas", () => {
    expect([-20, -10, 0, 10, 20].map((g) => gapLevel(g))).toEqual([
      "muito-abaixo",
      "abaixo",
      "neutro",
      "acima",
      "muito-acima",
    ]);
    expect(gapLevel(-8, { strong: 15, mild: 10 })).toBe("neutro");
  });
  it("KPIs e calendário descrevem as mesmas datas", () => {
    const { linhas, cal } = sextasAltas(6);
    // 4 sextas-alvo com 20%, 50%, 80% e uma sem foto comparável (sem benchmark: sábado sem histórico)
    const alvos = [
      linha("2026-12-04", mix(2, 60, 0, 0)),
      linha("2026-12-11", mix(5, 60, 0, 0)),
      linha("2026-12-18", mix(8, 60, 0, 0)),
    ];
    for (const a of alvos) cal[a.d] = ["Alta", null, null];
    const sem = linha("2026-12-12", mix(5, 60, 0, 0));
    cal["2026-12-12"] = ["Média", null, null];
    const todas = [...linhas, ...alvos, sem];
    const model = buildModel(payload(todas, cal));
    const days = dailySeries(
      model,
      rowsByDate(model.payload, CAT),
      "2026-12-04",
      "2026-12-18",
      BASE,
    );
    const s = summarize(days);
    const comparaveis = days.filter((d) => d.gap != null);
    expect(s.compared).toBe(comparaveis.length);
    expect(s.compared).toBe(3);
    expect(s.below).toBe(comparaveis.filter((d) => d.gap! < -5).length);
    expect(s.above).toBe(comparaveis.filter((d) => d.gap! > 5).length);
    expect(s.below).toBe(1);
    expect(s.above).toBe(1);
    expect(s.atual).toBeCloseTo((0.2 + 0.5 + 0.8) / 3);
    expect(s.gap).toBeCloseTo((s.atual! - s.esperada!) * 100);
  });
});

describe("categoria sem histórico não anula a data inteira", () => {
  // A tem histórico (6 sextas) e frota 30; B é nova (sem nenhuma data anterior) com frota `fB`.
  const montar = (fB: number) => {
    const { linhas, cal } = sextasAltas(6);
    const hist = linhas.map((l) => ({ ...l, f: 30 }));
    const alvoA: PaceRow = { d: "2026-12-04", c: CAT, f: 30, a: mix(6, 60, 0, 0) };
    const alvoB: PaceRow = { d: "2026-12-04", c: "Nova", f: fB, a: mix(1, 60, 0, 0) };
    cal["2026-12-04"] = ["Alta", null, null];
    const model = buildModel(payload([...hist, alvoA, alvoB], cal));
    return dayPace(model, [alvoA, alvoB], "2026-12-04", BASE);
  };
  it("com a categoria nova em até 10% da frota, o esperado existe e compara só o que tem histórico", () => {
    const d = montar(3); // 30 de 33 = 91% de cobertura
    expect(d.esperada).not.toBeNull();
    expect(d.cobertura).toBeCloseTo(30 / 33);
    expect(d.semBenchmark).toEqual(["Nova"]);
    // gap = ocupação de A (6/30) contra o esperado de A: a categoria sem benchmark não entra em nenhum dos lados
    expect(d.gap).toBeCloseTo((6 / 30 - d.esperada!) * 100);
  });
  it("com menos de 90% da frota coberta, não há esperado (nada é afirmado)", () => {
    const d = montar(10); // 30 de 40 = 75%
    expect(d.esperada).toBeNull();
    expect(d.gap).toBeNull();
    expect(d.cobertura).toBeCloseTo(0.75);
  });
});

describe("windowOccupancy (igual à Utilização do HQ na janela)", () => {
  const min = (iso: string) => Date.parse(`${iso}:00Z`) / 60000;
  const payload = {
    versao: 7,
    gerado_em: "",
    hoje: "2026-01-10",
    de: "2026-01-01",
    ate: "2026-01-31",
    categorias: ["A", "B"],
    params: { n_evento: 1, n_dow: 1, n_saz: 1, estatistica: "maximo" },
    cal: {},
    linhas: ["2026-01-01", "2026-01-02", "2026-01-03"].flatMap((d) => [
      { d, c: "A", f: 1, a: [] },
      { d, c: "B", f: 1, a: [] },
    ]),
    t: [
      [0, min("2026-01-01T15:00"), min("2026-01-03T12:00")],
      [1, min("2026-01-02T10:00"), min("2026-01-02T12:00")],
    ],
  } as unknown as Parameters<typeof windowOccupancy>[0];
  it("um dia: o trecho conta em toda data que toca", () => {
    expect(windowOccupancy(payload, null, "2026-01-02", "2026-01-02")).toMatchObject({
      carDays: 2,
      capacity: 2,
    });
    expect(windowOccupancy(payload, null, "2026-01-03", "2026-01-03")).toMatchObject({
      carDays: 1,
      capacity: 2,
    });
  });
  it("intervalo: arredonda o trecho inteiro na janela (45 h − 5 h → 2 dias), não a soma dos dias", () => {
    expect(windowOccupancy(payload, "A", "2026-01-01", "2026-01-03")).toMatchObject({
      carDays: 2,
      capacity: 3,
    });
  });
  it("sem trechos publicados devolve null", () => {
    const { t: _t, ...sem } = payload;
    expect(windowOccupancy(sem as typeof payload, null, "2026-01-01", "2026-01-03")).toBeNull();
  });
});

describe("esperada escolhida pelo dia todo", () => {
  const mk = (d: string, c: string, f: number, n: number, preco: number, g?: number) => ({
    d,
    c,
    f,
    ...(g ? { g } : {}),
    a: Array(n).fill(30),
    m: Array(n).fill(preco),
  });
  const linhas = [
    // 2025 (364 dias antes): ocupação 6/10, US$ 40 por veículo. 2024 (728): 9/10, US$ 90 por veículo (a de maior faturamento).
    mk("2026-11-12", "A", 5, 3, 50),
    mk("2026-11-12", "B", 5, 3, 50),
    mk("2025-11-13", "A", 5, 3, 40),
    mk("2025-11-13", "B", 5, 3, 40),
    mk("2024-11-14", "A", 5, 5, 90),
    mk("2024-11-14", "B", 5, 4, 90),
  ];
  const payload = {
    versao: 7,
    gerado_em: "",
    hoje: "2026-11-10",
    de: "2024-01-01",
    ate: "2026-12-31",
    categorias: ["A", "B"],
    params: { n_evento: 1, n_dow: 1, n_saz: 1, estatistica: "maximo" },
    cal: {
      "2026-11-12": ["Média", null, null],
      "2025-11-13": ["Média", null, null],
      "2024-11-14": ["Média", null, null],
    },
    linhas,
  } as unknown as Parameters<typeof buildModel>[0];
  it("usa a ocupação da data de maior faturamento por veículo, somando as categorias", () => {
    const m = buildModel(payload, "maximo");
    const d = dayPace(m, linhas.slice(0, 2) as never, "2026-11-12", "2026-11-10");
    expect(d.esperada).toBeCloseTo(0.9, 5);
    expect(d.atual).toBeCloseTo(0.6, 5);
  });
  it("capacidade da referência inclui os veículos depois vendidos (g)", () => {
    const l2 = linhas.map((r) => (r.d === "2024-11-14" ? { ...r, g: 6 } : r));
    const m = buildModel({ ...payload, linhas: l2 } as never, "maximo");
    const d = dayPace(m, l2.slice(0, 2) as never, "2026-11-12", "2026-11-10");
    expect(d.esperada).toBeCloseTo(9 / 12, 5);
  });
});

describe("referência escolhida pelo faturamento final", () => {
  // Alvo 2026-12-25, base 2026-11-10 (D-45). 2025: vende cedo (D-60) e barato, final US$ 30/veículo. 2024: vende tarde (D-5) e caro, final US$ 80.
  // Em D-45 o parcial favorece 2025; o final favorece 2024.
  const mk = (d: string, a: number[], m: number[]) => ({ d, c: "A", f: 10, a, m });
  const linhas = [
    mk("2026-12-25", [], []),
    mk("2025-12-26", Array(6).fill(60), Array(6).fill(50)),
    mk(
      "2024-12-27",
      [...Array(2).fill(60), ...Array(6).fill(5)],
      [...Array(2).fill(10), ...Array(6).fill(130)],
    ),
  ];
  const cal = {
    "2026-12-25": ["Alta", null, null],
    "2025-12-26": ["Alta", null, null],
    "2024-12-27": ["Alta", null, null],
  };
  const pl = {
    versao: 7,
    gerado_em: "",
    hoje: "2026-11-10",
    de: "2024-01-01",
    ate: "2027-05-01",
    categorias: ["A"],
    params: { n_evento: 1, n_dow: 1, n_saz: 1, estatistica: "maximo" },
    cal,
    linhas,
  } as unknown as Parameters<typeof buildModel>[0];
  it("escolhe pelo faturamento final e usa a ocupação dela na antecedência analisada", () => {
    const m = buildModel(pl, "maximo");
    const rows = [linhas[0]] as never;
    const it = referenceItems(m, rows, "2026-12-25", "2026-11-10", 45);
    const r25 = it.find((i) => i.date === "2025-12-26")!;
    const r24 = it.find((i) => i.date === "2024-12-27")!;
    expect(r25.rev!).toBeGreaterThan(r24.rev!); // parcial favoreceria 2025
    expect(r24.revFinal!).toBeGreaterThan(r25.revFinal!);
    expect(r24.chosen).toBe(true);
    expect(r25.chosen).toBe(false);
    expect(dayPace(m, rows, "2026-12-25", "2026-11-10").esperada).toBeCloseTo(0.2, 5); // 2 de 10 em D-45
  });
});

describe("referência com categoria sem tarifa", () => {
  // A e B no alvo; na referência, B não tem preço (sem `m`): o faturamento vale só A (US$ 100 ÷ frota 10 de A).
  const alvo = [
    { d: "2026-12-25", c: "A", f: 10, a: [] },
    { d: "2026-12-25", c: "B", f: 10, a: [] },
  ];
  const ref = [
    { d: "2025-12-26", c: "A", f: 10, a: [60, 60], m: [50, 50] },
    { d: "2025-12-26", c: "B", f: 10, a: [60] },
  ];
  const pl = {
    versao: 7,
    gerado_em: "",
    hoje: "2026-11-10",
    de: "2024-01-01",
    ate: "2027-05-01",
    categorias: ["A", "B"],
    params: { n_evento: 1, n_dow: 1, n_saz: 1, estatistica: "maximo" },
    cal: { "2026-12-25": ["Alta", null, null], "2025-12-26": ["Alta", null, null] },
    linhas: [...alvo, ...ref],
  } as unknown as Parameters<typeof buildModel>[0];
  it("calcula o faturamento só com as categorias que têm preço", () => {
    const it = referenceItems(
      buildModel(pl, "maximo"),
      alvo as never,
      "2026-12-25",
      "2026-11-10",
      45,
    )[0]!;
    expect(it.revFinal).toBe(10);
    expect(it.rev).toBe(10);
    expect(it.occFinal).toBeCloseTo(3 / 20, 5);
  });
});

describe("painel de referências: ganho e frota", () => {
  it("ganho até a data = ocupação final − ocupação em D-N, em p.p.", () => {
    expect(ganhoAteData({ occ: 0.6, occFinal: 0.89 })).toBeCloseTo(29, 5);
    expect(ganhoAteData({ occ: null, occFinal: 0.89 })).toBeNull();
  });
  it("avisa só quando a frota difere da atual em mais que o limite", () => {
    expect(avisoFrota(70, 100)).toBe("frota 30% menor que a atual");
    expect(avisoFrota(130, 100)).toBe("frota 30% maior que a atual");
    expect(avisoFrota(85, 100)).toBeNull(); // exatamente 15%: dentro do limite
    expect(avisoFrota(80, 100, 0.25)).toBeNull(); // limite configurável
    expect(avisoFrota(0, 100)).toBeNull();
  });
  it("referenceItems traz a frota da época e a atual das mesmas categorias", () => {
    const alvo = [{ d: "2026-12-25", c: "A", f: 10, a: [] }];
    const ref = { d: "2025-12-26", c: "A", f: 7, g: 7, a: [60] };
    const pl = {
      versao: 7,
      gerado_em: "",
      hoje: "2026-11-10",
      de: "2024-01-01",
      ate: "2027-05-01",
      categorias: ["A"],
      params: { n_evento: 1, n_dow: 1, n_saz: 1, estatistica: "maximo" },
      cal: { "2026-12-25": ["Alta", null, null], "2025-12-26": ["Alta", null, null] },
      linhas: [...alvo, ref],
    } as unknown as Parameters<typeof buildModel>[0];
    const it = referenceItems(
      buildModel(pl, "maximo"),
      alvo as never,
      "2026-12-25",
      "2026-11-10",
      45,
    )[0]!;
    expect([it.fleet, it.fleetAtual]).toEqual([7, 10]);
    expect(avisoFrota(it.fleet, it.fleetAtual)).toBe("frota 30% menor que a atual");
  });
});

describe("revenueOf com categoria sem tarifa", () => {
  const a = { d: "2027-02-03", c: "A", f: 4, a: [30, 30], m: [100, 200] };
  const lux = { d: "2027-02-03", c: "Luxury", f: 2, a: [30] };
  it("ignora a linha sem preço em vez de zerar a data", () => {
    const r = revenueOf([a, lux] as never, 10);
    expect(r.diaria).toBe(150);
    expect(r.porVeiculo).toBe(300 / 4);
    expect(r.semPreco).toEqual(["Luxury"]);
  });
  it("só categorias sem preço: sem valor", () => {
    const r = revenueOf([lux] as never, 10);
    expect(r.diaria).toBeNull();
    expect(r.porVeiculo).toBeNull();
  });
});

describe("esperada pela janela de 7 dias (data ±3)", () => {
  // Alvo quarta 16/12/2026, base 10/11/2026 (D-36). Referências: mesmo dia da semana 364 (2025) e 728 (2024) dias antes.
  const B = "2026-11-10";
  const D = "2026-12-16";
  const ev = (d: string, n: number, preco: number, ant = 60, g?: number): PaceRow =>
    ({
      d,
      c: "A",
      f: 10,
      ...(g ? { g } : {}),
      a: Array(n).fill(ant),
      m: Array(n).fill(preco),
    }) as PaceRow;
  const alvo = { d: D, c: "A", f: 10, a: [] } as PaceRow;
  const monta = (linhas: PaceRow[], cal: PacePayload["cal"] = {}) =>
    buildModel(
      {
        versao: 7,
        gerado_em: "",
        hoje: B,
        de: "2023-01-01",
        ate: "2027-05-01",
        categorias: ["A"],
        params: { n_evento: 1, n_dow: 1, n_saz: 1, estatistica: "maximo" },
        cal,
        linhas,
      } as PacePayload,
      "maximo",
    );
  /** Uma linha por dia da janela de `ano` (offset em dias −3..+3 do alvo, deslocado por `lag`). */
  const ano = (lag: number, f: (k: number) => PaceRow | null) =>
    [-3, -2, -1, 0, 1, 2, 3]
      .map((k) => f(k) && { ...f(k)!, d: addDays(D, k - lag) })
      .filter((x): x is PaceRow => !!x);

  it("janela comum: o ano vem da média da janela, não só do dia analisado", () => {
    // No dia do alvo 2024 fatura mais (US$ 90 contra 20), mas na janela 2025 ganha (20 contra ~16).
    const l25 = ano(364, (k) => ev("x", [3, 4, 5, 4, 4, 4, 4][k + 3]!, 50));
    const l24 = ano(728, (k) => (k === 0 ? ev("x", 9, 100) : ev("x", 2, 40)));
    const m = monta([alvo, ...l25, ...l24]);
    const { items, janela } = windowAnalysis(m, [alvo], D, B, 36);
    expect(janela.dias).toHaveLength(7);
    expect(janela.criterio).toBe("faturamento");
    expect(janela.escolhido!.label).toBe("2025");
    expect(items.find((i) => i.chosen)!.date).toBe("2025-12-17");
    expect(janela.usados).toHaveLength(7);
    expect(janela.esperada).toBeCloseTo(0.4, 5); // média de 3,4,5,4,4,4,4 ÷ 10
    expect(dayPace(m, [alvo], D, B).esperada).toBeCloseTo(0.4, 5);
    expect(dayPace(m, [alvo], D, B).n).toBe(2); // anos comparados
  });

  it("média da semana de cada ano: a do ano escolhido é a esperada, a dos outros anos usa a mesma regra", () => {
    const l25 = ano(364, (k) => ev("x", [3, 4, 5, 4, 4, 4, 4][k + 3]!, 50));
    const l24 = ano(728, (k) => (k === 0 ? ev("x", 9, 100) : ev("x", 2, 40)));
    const { janela } = windowAnalysis(monta([alvo, ...l25, ...l24]), [alvo], D, B, 36);
    const por = Object.fromEntries(janela.anos.map((a) => [a.label, a.occMedia]));
    expect(por["2025"]).toBeCloseTo(janela.esperada!, 5);
    expect(por["2025"]).toBeCloseTo(0.4, 5);
    expect(por["2024"]).toBeCloseTo((9 + 2 * 6) / 7 / 10, 5); // 0,3: no dia do alvo 2024 tem 90%, mas a semana dele é 30%
  });

  it("cada dia da janela é lido na antecedência do próprio dia", () => {
    // Dia D+1 (antecedência 37): as 6 diárias foram vendidas com 36 dias; lidas em D-37 não existem ainda.
    const l25 = ano(364, (k) => (k === 1 ? ev("x", 6, 50, 36) : ev("x", 4, 50)));
    const { janela } = windowAnalysis(monta([alvo, ...l25]), [alvo], D, B, 36);
    expect(janela.esperada).toBeCloseTo((6 * 4) / 7 / 10 + 0, 5); // 6 dias com 4 + um com 0
  });

  it("janela que encosta em evento: dia comum não leva dia de evento; dia de evento só leva o mesmo evento", () => {
    const e = (d: string, rel: number): [string, string, number] => ["Alta", "carnaval", rel];
    const cal: PacePayload["cal"] = {
      [addDays(D, 2)]: e("", 0),
      [addDays(D, 1)]: e("", -1),
      [addDays(D, 3)]: e("", 1),
      [addDays(D, 2 - 364)]: e("", 0),
      [addDays(D, 1 - 364)]: e("", -1),
      [addDays(D, 3 - 364)]: e("", 1),
    };
    const l25 = ano(364, (k) => ev("x", 4, 50));
    const m = monta([alvo, ...l25], cal);
    // comum: sai D+1, D+2 e D+3 (evento)
    expect(windowAnalysis(m, [alvo], D, B, 36).janela.dias).toEqual(
      [-3, -2, -1, 0].map((k) => addDays(D, k)),
    );
    // evento (D+2, posição 0): só D+1..D+3 (mesmo evento); a quarta e os demais dias comuns ficam de fora
    const dEv = addDays(D, 2);
    const evRow = { d: dEv, c: "A", f: 10, a: [] } as PaceRow;
    const r = windowAnalysis(m, [evRow], dEv, B, 38);
    expect(r.janela.dias).toEqual([addDays(D, 1), dEv, addDays(D, 3)]);
    expect(r.items.map((i) => i.date)).toEqual([addDays(dEv, -364)]); // mesma posição na edição passada
    expect(r.janela.escolhido!.label).toBe("2025");
    expect(r.janela.esperada).toBeCloseTo(0.4, 5);
  });

  it("dias sem dados: a escolha usa só os dias em que todos os anos têm dados; a média usa os dias do ano escolhido", () => {
    // 2025 não tem os dias −3 e −2. Nos 5 dias comuns 2025 fatura 20 e 2024 fatura 8; nos 2 dias só de 2024 ele faturaria 100.
    const l25 = ano(364, (k) => (k <= -2 ? null : ev("x", 4, 50)));
    const l24 = ano(728, (k) => (k <= -2 ? ev("x", 10, 100) : ev("x", 2, 40)));
    const { janela } = windowAnalysis(monta([alvo, ...l25, ...l24]), [alvo], D, B, 36);
    expect(janela.diasComuns).toBe(5);
    expect(janela.escolhido!.label).toBe("2025"); // com os 7 dias de 2024 (média 34) ele ganharia
    expect(janela.escolhido!.revMedio).toBeCloseTo(20, 5);
    expect(janela.outro!.revMedio).toBeCloseTo(8, 5);
    expect(janela.usados).toHaveLength(5);
    expect(janela.esperada).toBeCloseTo(0.4, 5);
  });

  it("sem faturamento em algum ano, escolhe pela maior ocupação final média", () => {
    const sem = (n: number) => ({ ...ev("x", n, 0), m: undefined }) as unknown as PaceRow;
    const l25 = ano(364, () => sem(3));
    const l24 = ano(728, () => ev("x", 7, 30));
    const { janela } = windowAnalysis(monta([alvo, ...l25, ...l24]), [alvo], D, B, 36);
    expect(janela.criterio).toBe("ocupacao");
    expect(janela.escolhido!.label).toBe("2024");
    expect(janela.esperada).toBeCloseTo(0.7, 5);
  });

  it("empate na escolha do ano: vale o mais recente", () => {
    const l25 = ano(364, () => ev("x", 4, 50)); // 20 por veículo
    const l24 = ano(728, () => ev("x", 8, 25)); // 20 por veículo
    const { janela } = windowAnalysis(monta([alvo, ...l25, ...l24]), [alvo], D, B, 36);
    expect(janela.escolhido!.label).toBe("2025");
    expect(janela.esperada).toBeCloseTo(0.4, 5);
  });

  it("meta em carros: carros da referência na antecedência e % da frota atual; não muda a esperada", () => {
    // Referência com frota da época 8 (g) e 6 carros; frota atual 10: repetir 6 carros = 60% da frota atual.
    const l25 = ano(364, () => ev("x", 6, 50, 60, 8));
    const m = monta([alvo, ...l25]);
    const { items, janela } = windowAnalysis(m, [alvo], D, B, 36);
    const it = items[0]!;
    expect([it.carros, it.fleet, it.fleetAtual]).toEqual([6, 8, 10]);
    expect(metaCarros(it.carros, it.fleetAtual)).toEqual({ carros: 6, pct: 0.6, frota: 10 });
    expect(janela.carros).toBe(6);
    expect(janela.fleetAtual).toBe(10);
    expect(janela.esperada).toBeCloseTo(6 / 8, 5); // ocupação sobre a frota da época, inalterada pela meta
    expect(metaCarros(76, 105)!.pct).toBeCloseTo(0.724, 3);
    expect(metaCarros(null, 105)).toBeNull();
  });
});
