import { describe, expect, it } from "vitest";
import type { Curva } from "./captura-categoria";
import type { PaceCal, PaceRow } from "./occupancy-pace";
import {
  agruparMesesVizinhos,
  ACAO_MESA_PADRAO,
  acaoMesa,
  datasAcima,
  padraoParaData,
  porqueMesa,
  analisarMesa,
  avisoRepetindo,
  licoes,
  premioFimVenda,
  situacaoAtual,
  celulaMapa,
  corRecorrencia,
  mapaAno,
  ordenarPadroes,
  padroesRecorrentes,
  proximaOcorrencia,
  rotuloMeses,
  separarPorGanho,
  tarifaProximasDoMes,
  type Perda,
  antecedenciaLotou,
  avisoMinimo,
  datasParecidas,
  detectarLotouCedo,
  diariaMediaDatas,
  perdaEstimada,
  precoMinimo,
  precoPossivel,
  resumoMesa,
  ultimasVendas,
  vendidasCedo,
} from "./dinheiro-mesa";

// Linha: frota 10; `a` = antecedência de criação de cada diária; `m` = preço pago de cada diária.
const linha = (d: string, c: string, a: number[], m?: number[], f = 10): PaceRow =>
  ({ d, c, f, a, ...(m ? { m } : {}) }) as unknown as PaceRow;

// Curva normal: 0% em D-120, 20% em D-60, 50% em D-30, 90% em D-7, 100% em D-0.
const CURVA: Curva = {
  base: "categoria-mes",
  datas: 20,
  pontos: [
    { L: 120, share: 0 },
    { L: 60, share: 0.2 },
    { L: 30, share: 0.5 },
    { L: 7, share: 0.9 },
    { L: 0, share: 1 },
  ],
};

// Data que lotou cedo: 10 diárias, 9 vendidas até D-40 (bem acima da curva), a 10ª em D-35.
const cedo = linha(
  "2025-12-20",
  "SUV",
  [100, 90, 80, 70, 60, 55, 50, 45, 40, 35],
  [60, 60, 60, 60, 60, 62, 64, 66, 70, 74],
);

describe("lotou cedo", () => {
  it("antecedência em que atingiu 95% da frota", () => {
    expect(antecedenciaLotou(cedo)).toBe(35); // 95% de 10 = 10 diárias
    expect(antecedenciaLotou(linha("x", "c", [50, 40, 30]))).toBeNull();
    expect(antecedenciaLotou(cedo, 0.5)).toBe(60); // 5 diárias
  });
  it("detecta: lotou antes de D-14 e captura 20 p.p. acima da curva", () => {
    const d = detectarLotouCedo(cedo, CURVA)!;
    expect(d.lotouEm).toBe(35);
    expect(d.ppMax).toBeGreaterThanOrEqual(20);
    expect(d.vendido[60].atual).toBe(0.5);
    expect(d.vendido[60].normal).toBeCloseTo(0.2);
    expect(d.diariaPaga).toBeCloseTo(63.6);
  });
  it("não marca quem lotou só perto da data ou seguiu a curva", () => {
    expect(
      detectarLotouCedo(linha("x", "SUV", [60, 40, 30, 25, 20, 15, 10, 8, 5, 2]), CURVA),
    ).toBeNull();
    // lotou em D-20 seguindo a curva (sem 20 p.p. acima)
    const normal = linha("x", "SUV", [70, 40, 35, 31, 30, 28, 25, 22, 21, 20]);
    expect(detectarLotouCedo(normal, CURVA, { ...configSemPp(), ppAcima: 60 })).toBeNull();
  });
  it("limites configuráveis", () => {
    expect(detectarLotouCedo(cedo, CURVA, { ...configSemPp(), leadCedo: 40 })).toBeNull();
  });
});
function configSemPp() {
  return {
    ocupLotou: 0.95,
    leadCedo: 14,
    ppAcima: 20,
    fechouBem: 0.85,
    diasUltimas: 14,
    desde: "2024-01-01",
  };
}

describe("diárias vendidas cedo demais e últimas vendas", () => {
  it("excesso sobre a curva até a antecedência em que lotou", () => {
    // em D-35 a curva esperaria ~45% de 10 = 4,5; foram 10
    const v = vendidasCedo(cedo, CURVA, 35);
    expect(v.diarias).toBeCloseTo(10 - 10 * 0.45, 1);
    expect(v.diariaPaga).toBeCloseTo(63.6);
  });
  it("diária das reservas dos 14 dias antes de lotar", () => {
    // criadas entre D-48 e D-35: 45, 40, 35 → 66, 70, 74
    expect(ultimasVendas(cedo, 35)).toBeCloseTo(70);
  });
});

describe("preço possível e perda", () => {
  it("conservador = menor referência acima da paga; otimista = maior", () => {
    expect(precoPossivel(60, { ultimas: 70, parecidas: 80, mercado: null })).toEqual({
      conservador: 70,
      otimista: 80,
      usadas: ["ultimas", "parecidas"],
    });
    expect(precoPossivel(60, { ultimas: 55, parecidas: 75, mercado: 90 })).toEqual({
      conservador: 75,
      otimista: 90,
      usadas: ["parecidas", "mercado"],
    });
    expect(precoPossivel(60, { ultimas: null, parecidas: 72, mercado: null })).toEqual({
      conservador: 72,
      otimista: 72,
      usadas: ["parecidas"],
    });
  });
  it("sem referência acima da paga = sem perda", () => {
    expect(precoPossivel(80, { ultimas: 70, parecidas: 75, mercado: null })).toBeNull();
    expect(precoPossivel(80, { ultimas: null, parecidas: null, mercado: null })).toBeNull();
    expect(precoPossivel(null, { ultimas: 90, parecidas: null, mercado: null })).toBeNull();
  });
  it("perda em faixa", () => {
    const p = precoPossivel(60, { ultimas: 70, parecidas: 80, mercado: null });
    expect(perdaEstimada(5, 60, p)).toEqual({ min: 50, max: 100 });
    expect(perdaEstimada(0, 60, p)).toBeNull();
    expect(perdaEstimada(5, 60, null)).toBeNull();
  });
});

describe("datas parecidas e preço mínimo por antecedência", () => {
  const cal: PaceCal = {};
  const bem = (d: string, m: number[]) => linha(d, "SUV", [95, 70, 50, 40, 25, 20, 10, 9, 5], m); // 9/10 = 90%, lotou só perto (não chega a 95%)
  const p1 = bem("2024-12-10", [80, 82, 84, 86, 90, 92, 96, 98, 100]);
  const p2 = bem("2023-12-11", [80, 82, 84, 86, 90, 92, 96, 98, 100]);
  const ruim = linha("2024-12-12", "SUV", [30, 20, 10], [50, 50, 50]); // fechou com 30%
  const outroMes = bem("2024-11-10", [1, 1, 1, 1, 1, 1, 1, 1, 1]);
  const rows = [cedo, p1, p2, ruim, outroMes];
  it("mesma categoria e mês, fechou bem e não lotou cedo", () => {
    const par = datasParecidas(rows, cal, "SUV", 12, "2026-11-17");
    expect(par.map((r) => r.d).sort()).toEqual(["2023-12-11", "2024-12-10"]);
    expect(diariaMediaDatas(par)).toBeCloseTo(89.78, 1);
  });
  it("tabela de mínimo por faixa e aviso da Prioridades", () => {
    const tab = precoMinimo([{ category: "SUV", date: "2025-12-20" }], {
      linhas: rows,
      cal,
      hoje: "2026-11-17",
    });
    expect(tab).toHaveLength(1);
    expect(tab[0]!.minimo["61+"]).toBe(81);
    expect(tab[0]!.minimo["15-60"]).toBe(88);
    expect(tab[0]!.minimo["0-14"]).toBe(98);
    expect(avisoMinimo(tab, "SUV", "2026-12-20", 45, 79)!.texto).toBe(
      "abaixo do mínimo histórico para D-60 a D-15 (US$ 88): em anos anteriores esta época esgotou cedo",
    );
    expect(avisoMinimo(tab, "SUV", "2026-12-20", 45, 90)).toBeNull();
    expect(avisoMinimo(tab, "Minivan", "2026-12-20", 45, 50)).toBeNull();
    expect(avisoMinimo(tab, "SUV", "2026-11-20", 45, 50)).toBeNull();
  });
});

describe("análise completa", () => {
  it("encontra a data, estima a perda e resume", () => {
    const cal: PaceCal = {};
    const base = Array.from({ length: 16 }, (_, i) =>
      linha(
        `2024-12-${String(i + 1).padStart(2, "0")}`,
        "SUV",
        [95, 70, 50, 40, 25, 20, 10, 9, 5],
        [80, 82, 84, 86, 90, 92, 96, 98, 100],
      ),
    );
    const perdas = analisarMesa({
      linhas: [...base, cedo],
      cal,
      hoje: "2026-11-17",
      de: "2023-01-01",
    });
    expect(perdas).toHaveLength(1);
    const p = perdas[0]!;
    expect(p.date).toBe("2025-12-20");
    expect(p.refs.mercado).toBeNull();
    expect(p.possivel!.usadas).toContain("parecidas");
    expect(p.perda!.max).toBeGreaterThan(0);
    const r = resumoMesa(perdas);
    expect(r.datas).toBe(1);
    expect(r.total.max).toBeCloseTo(p.perda!.max);
    expect(r.porCategoria[0]!.category).toBe("SUV");
  });
});

describe("padrões que se repetem", () => {
  const p = (date: string, category = "SUV", perda = 100, lotouEm = 40): Perda =>
    ({
      date,
      category,
      lotouEm,
      diariaPaga: 60,
      possivel: { conservador: 70, otimista: 80, usadas: ["parecidas"] },
      perda: { min: perda, max: perda * 2 },
    }) as unknown as Perda;
  it("agrupa meses vizinhos, com a virada do ano", () => {
    expect(agruparMesesVizinhos([1, 2, 5, 12])).toEqual([[12, 1, 2], [5]]);
    expect(agruparMesesVizinhos([3, 4, 7])).toEqual([[3, 4], [7]]);
    expect(agruparMesesVizinhos([12])).toEqual([[12]]);
    expect(rotuloMeses([12, 1])).toBe("dez–jan");
    expect(rotuloMeses([7])).toBe("jul");
  });
  it("recorrência: só categoria × mês em 2 anos ou mais", () => {
    const ps = [
      p("2024-12-20"),
      p("2025-12-22"),
      p("2025-01-03"),
      p("2026-01-04"),
      p("2025-07-10"), // só um ano
      p("2024-12-21", "Minivan"), // só um ano
    ];
    const r = padroesRecorrentes(ps);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      category: "SUV",
      meses: [12, 1],
      anos: [2024, 2025, 2026],
      datas: 4,
    });
    expect(r[0]!.perda).toEqual({ min: 400, max: 800 });
    expect(r[0]!.paga).toBe(60);
    expect(r[0]!.possivel).toBe(70);
    expect(padroesRecorrentes(ps, 3)).toHaveLength(0);
    expect(
      padroesRecorrentes(ps, 1)
        .map((x) => x.category)
        .sort(),
    ).toEqual(["Minivan", "SUV", "SUV"]);
  });
  it('próxima ocorrência e "acontecendo agora"', () => {
    // fora dos meses, primeira data já dentro de D-120: "janela"
    expect(proximaOcorrencia([12, 1], "2026-11-17")).toEqual({
      de: "2026-12-01",
      ate: "2027-01-31",
      dias: 14,
      estado: "janela",
      diasAteJanela: 0,
      chegando: true,
    });
    // dentro dos meses: acontecendo agora
    expect(proximaOcorrencia([12, 1], "2026-12-10")).toMatchObject({
      de: "2026-12-10",
      ate: "2027-01-31",
      estado: "agora",
    });
    expect(proximaOcorrencia([12, 1], "2027-01-10")).toMatchObject({
      ate: "2027-01-31",
      estado: "agora",
    });
    // longe: faltam N dias até a primeira data entrar em D-120
    expect(proximaOcorrencia([7], "2026-11-17")).toMatchObject({
      de: "2027-07-01",
      estado: "longe",
      diasAteJanela: 226 - 120,
      chegando: false,
    });
    expect(proximaOcorrencia([3, 4], "2026-11-17")).toMatchObject({ dias: 104, estado: "janela" });
  });
  it("ordena: chegando primeiro, depois maior perda", () => {
    const ps = padroesRecorrentes([
      p("2024-07-10", "A", 900),
      p("2025-07-10", "A", 900),
      p("2024-12-10", "B", 10),
      p("2025-12-10", "B", 10),
      p("2024-08-10", "C", 50),
      p("2025-08-10", "C", 50),
    ]);
    expect(ordenarPadroes(ps, "2026-11-17").map((x) => x.category)).toEqual(["B", "A", "C"]);
  });
  it("mapa do ano e cor por recorrência", () => {
    const m = mapaAno([p("2024-12-20"), p("2025-12-22"), p("2025-12-23"), p("2025-07-10")]);
    expect(m.get("SUV|12")).toEqual({ anos: [2024, 2025], datas: 3, min: 300, max: 600 });
    expect(m.get("SUV|7")!.anos).toEqual([2025]);
    expect(corRecorrencia(1)).toContain("red-500/15");
    expect(corRecorrencia(2)).toContain("red-500/40");
    expect(corRecorrencia(3)).toContain("red-600");
    expect(corRecorrencia(0)).toBe("");
  });
});

describe("padrões mais precisos", () => {
  const p = (date: string, category = "SUV", paga = 60, possivel: number | null = 70): Perda =>
    ({
      date,
      category,
      lotouEm: 40,
      diariaPaga: paga,
      possivel:
        possivel == null
          ? null
          : { conservador: possivel, otimista: possivel, usadas: ["parecidas"] },
      perda: possivel == null ? null : { min: 10, max: 10 },
    }) as unknown as Perda;
  it("recorrência por mês: cada mês precisa cumprir sozinho", () => {
    // jan em 2 anos, fev em 2 anos, mar só em 1 → padrão jan–fev; mar fica de fora
    const ps = [
      p("2024-01-10"),
      p("2025-01-10"),
      p("2024-02-10"),
      p("2025-02-10"),
      p("2025-03-10"),
    ];
    const r = padroesRecorrentes(ps, 2);
    expect(r.map((x) => x.meses)).toEqual([[1, 2]]);
    expect(r[0]!.datas).toBe(4);
  });
  it("só meses consecutivos que cumprem: jan e mar não se juntam sem fev", () => {
    const ps = [
      p("2024-01-10"),
      p("2025-01-10"),
      p("2024-03-10"),
      p("2025-03-10"),
      p("2025-02-10"),
    ];
    expect(padroesRecorrentes(ps, 2).map((x) => x.meses)).toEqual([[1], [3]]);
  });
  it("dezembro e janeiro contam como consecutivos", () => {
    const ps = [p("2024-12-10"), p("2025-12-10"), p("2025-01-10"), p("2026-01-10")];
    expect(padroesRecorrentes(ps, 2).map((x) => x.meses)).toEqual([[12, 1]]);
  });
  it("filtro de ganho mínimo (5%)", () => {
    const com = padroesRecorrentes([
      p("2024-01-10", "A", 60, 66),
      p("2025-01-10", "A", 60, 66),
    ])[0]!; // +10%
    const lim = padroesRecorrentes([
      p("2024-01-10", "B", 100, 105),
      p("2025-01-10", "B", 100, 105),
    ])[0]!; // +5%
    const sem = padroesRecorrentes([
      p("2024-01-10", "C", 100, 103),
      p("2025-01-10", "C", 100, 103),
    ])[0]!; // +3%
    const nada = padroesRecorrentes([
      p("2024-01-10", "D", 100, null),
      p("2025-01-10", "D", 100, null),
    ])[0]!;
    const r = separarPorGanho([com, lim, sem, nada]);
    expect(r.comSinal.map((x) => x.category)).toEqual(["A", "B"]);
    expect(r.semSinal.map((x) => x.category)).toEqual(["C", "D"]);
    expect(separarPorGanho([com], 20).comSinal).toEqual([]);
  });
  it("tarifa das próximas datas do mês", () => {
    const t = [
      { date: "2026-12-05", category: "SUV", rate: 90 },
      { date: "2026-12-10", category: "SUV", rate: 100 },
      { date: "2026-12-20", category: "SUV", rate: 110 },
      { date: "2027-12-10", category: "SUV", rate: 999 },
      { date: "2026-12-10", category: "Van", rate: 50 },
    ];
    expect(tarifaProximasDoMes(t, "SUV", 12, "2026-11-17")).toEqual({ valor: 100, lead: 23 });
    expect(tarifaProximasDoMes(t, "SUV", 1, "2026-11-17")).toBeNull();
  });
});

describe("lição do passado e situação atual", () => {
  it("prêmio de fim de venda", () => {
    // até D-49: 60..64 (média de 60,60,60,60,60,62,64 = 60,857); D-48 a D-35: 66,70,74 (média 70)
    expect(premioFimVenda(cedo, 35)).toBeCloseTo(70 / (426 / 7) - 1, 4);
    expect(premioFimVenda(linha("x", "c", [40, 35], [50, 50]), 35)).toBeNull(); // sem reservas anteriores
  });
  it("adiantamento típico e esgota em (medianas por categoria × mês)", () => {
    const p = (date: string, ppMax: number, ppEm: number, lotouEm: number, premio: number | null) =>
      ({
        date,
        category: "SUV",
        ppMax,
        ppEm,
        lotouEm,
        premio,
        diariaPaga: 60,
        refs: { ultimas: 66 },
        perda: { min: 10, max: 20 },
      }) as unknown as Perda;
    const [l] = licoes([
      p("2024-12-10", 20, 90, 30, 0.1),
      p("2025-12-10", 30, 60, 40, 0.2),
      p("2025-12-12", 25, 90, 50, null),
    ]);
    expect(l).toMatchObject({
      category: "SUV",
      mes: 12,
      anos: [2024, 2025],
      datas: 3,
      adiantamentoPp: 25,
      adiantamentoEm: 90,
      esgotaEm: 40,
      perda: { min: 30, max: 60 },
    });
    expect(l!.premio).toBeCloseTo(0.15);
  });
  it("captura atual contra a curva na mesma antecedência", () => {
    // hoje 2026-11-17; data 2026-12-17 = D-30; curva em D-30 = 50%; final típico 80% → normal 40% da frota
    const r = linha("2026-12-17", "SUV", [100, 90, 80, 70, 60, 50, 40], [], 10); // 7 vendidas até D-30 = 70%
    const s = situacaoAtual([r], CURVA, 0.8, "SUV", 12, "2026-11-17")!;
    expect(s.lead).toBe(30);
    expect(s.pp).toBeCloseTo(30);
    expect(s.falta).toBeCloseTo(0.5);
    // últimos 14 dias (D-44 a D-30): 1 reserva (40); normal: (50% − 36%) × 0,8 × 10 = 1,12
    expect(s.ritmo.atual).toBe(1);
    expect(s.ritmo.normal).toBeCloseTo(1.12, 2);
    expect(s.passou).toBe(false);
    expect(situacaoAtual([r], CURVA, 0.8, "SUV", 1, "2026-11-17")).toBeNull();
  });
  it("classificação da ação e limite do passo", () => {
    const l = (anos: number[], premio: number | null) => ({ anos, premio });
    const s = (pp: number, passou = false) => ({ pp, passou });
    expect(acaoMesa(l([2024, 2025], 0.12), s(18))).toEqual({ tipo: "repetindo", subirPct: 10 }); // limitado a 10%
    expect(acaoMesa(l([2024, 2025], 0.06), s(10))).toEqual({ tipo: "repetindo", subirPct: 6 });
    // prêmio pequeno (1%, 2%) ou negativo: não sugere subir
    expect(acaoMesa(l([2024, 2025], 0.01), s(15))).toEqual({ tipo: "acelerado" });
    expect(acaoMesa(l([2024, 2025], 0.024), s(15))).toEqual({ tipo: "acelerado" });
    expect(acaoMesa(l([2024, 2025], 0.03), s(15))).toEqual({ tipo: "repetindo", subirPct: 3 });
    expect(acaoMesa(l([2024, 2025], 0.12), s(9))).toEqual({ tipo: "risco" });
    expect(acaoMesa(l([2024, 2025], 0.12), s(30, true))).toEqual({ tipo: "passou" });
    expect(acaoMesa(l([2025], 0.12), s(30))).toEqual({ tipo: "sem-padrao" });
    expect(acaoMesa(l([2024, 2025], 0.12), null)).toEqual({ tipo: "sem-padrao" });
    expect(acaoMesa(l([2024, 2025], 0.2), s(15), { ...ACAO_MESA_PADRAO, passoMaxPct: 15 })).toEqual(
      {
        tipo: "repetindo",
        subirPct: 15,
      },
    );
    expect(acaoMesa(l([2024, 2025], -0.05), s(15))).toEqual({ tipo: "acelerado" });
  });
  it("aviso da Prioridades", () => {
    expect(avisoRepetindo(3, 18.4, 0.12)).toBe(
      "Este mês esgotou cedo em 3 anos; hoje está +18 p.p. acima do ritmo normal. No passado, os últimos clientes pagaram +12%.",
    );
  });
});

describe("frase do porquê", () => {
  it("explica cada ação", () => {
    const l = { anos: [2024, 2025], premio: 0.11 };
    expect(porqueMesa(l, { pp: 18 }, { tipo: "repetindo", subirPct: 10 })).toBe(
      "Está vendendo 18 p.p. acima do normal, como nos 2 anos em que esgotou cedo. Naqueles anos, quem reservou por último pagou 11% a mais: dá para subir agora.",
    );
    expect(porqueMesa({ ...l, premio: 0.01 }, { pp: 15 }, { tipo: "acelerado" })).toContain(
      "pagou só 1% a mais",
    );
    expect(porqueMesa(l, { pp: 2 }, { tipo: "risco" })).toBe(
      "Hoje está no ritmo normal (+2 p.p.). Como este mês já esgotou cedo em 2 anos, não vale baixar o preço. Se o ritmo acelerar, a recomendação passa a ser subir.",
    );
  });
});

describe("lição por data e freio do ritmo", () => {
  const l = { anos: [2024, 2025], premio: 0.12 };
  it("ritmo dos últimos 14 dias abaixo do normal freia o Subir", () => {
    expect(acaoMesa(l, { pp: 18, passou: false, ritmo: { atual: 44, normal: 74 } })).toEqual({
      tipo: "desacelerou",
    });
    expect(acaoMesa(l, { pp: 18, passou: false, ritmo: { atual: 70, normal: 74 } })).toEqual({
      tipo: "repetindo",
      subirPct: 10,
    });
    expect(acaoMesa(l, { pp: 18, passou: false, ritmo: { atual: 80, normal: 74 } })).toEqual({
      tipo: "repetindo",
      subirPct: 10,
    });
    expect(porqueMesa(l, { pp: 18 }, { tipo: "desacelerou" })).toContain("não suba agora");
  });
  it("só a data acima do normal recebe Subir; as outras, não baixar", () => {
    // datas do mês: uma 70% vendida em D-30 (normal 40% → +30 p.p.), outra 40% em D-31 (normal ~39% → +1 p.p.)
    const a = linha("2026-12-17", "SUV", [100, 90, 80, 70, 60, 50, 40]);
    const b = linha("2026-12-18", "SUV", [100, 90, 80, 70]);
    const sit = situacaoAtual([a, b], CURVA, 0.8, "SUV", 12, "2026-11-17")!;
    expect(sit.porData.map((d) => [d.date, Math.round(d.pp)])).toEqual([
      ["2026-12-17", 30],
      ["2026-12-18", 1],
    ]);
    expect(datasAcima(sit)).toEqual(["2026-12-17"]);
    const prev = { acao: { tipo: "repetindo" as const, subirPct: 10 }, sit };
    expect(padraoParaData(prev, "2026-12-17")).toEqual({ tipo: "repetindo", subirPct: 10 });
    expect(padraoParaData(prev, "2026-12-18")).toEqual({ tipo: "nao-baixar" });
    expect(padraoParaData({ acao: { tipo: "desacelerou" }, sit }, "2026-12-17")).toEqual({
      tipo: "nao-baixar",
    });
    expect(padraoParaData({ acao: { tipo: "sem-padrao" }, sit }, "2026-12-17")).toBeNull();
    expect(padraoParaData(undefined, "2026-12-17")).toBeNull();
  });
});

describe("célula do mapa do ano", () => {
  it("cor só com perda real; sem perda = tracejada, sem valor", () => {
    expect(celulaMapa({ anos: [2024, 2025], datas: 3, min: 300, max: 600 })).toMatchObject({
      tipo: "perda",
      valor: 300,
      classe: corRecorrencia(2),
    });
    const s = celulaMapa({ anos: [2024, 2025, 2026], datas: 4, min: 0, max: 0 });
    expect(s).toMatchObject({ tipo: "sem-sinal", valor: null });
    expect(s.classe).toContain("dashed");
    expect(s.dica).toBe(
      "Esgotou cedo em 3 anos, mas os últimos clientes pagaram o mesmo preço: sem sinal de que dava para cobrar mais",
    );
    expect(celulaMapa({ anos: [2025], datas: 1, min: 0.3, max: 0.4 }).tipo).toBe("sem-sinal"); // nunca "US$ 0"
  });
});
