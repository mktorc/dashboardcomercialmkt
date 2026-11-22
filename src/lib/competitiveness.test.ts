import { describe, expect, it } from "vitest";
import {
  extrasCost,
  ourStay,
  stayNights,
  stayOffers,
  latestExtrasByCompetitor,
  withKnownExtras,
  parseExtras,
  comparable,
  latestOffers,
  dailyOf,
  diagnose,
  diffPct,
  latestPerCompetitor,
  marketOf,
  median,
  preferDirect,
  priceLevel,
  type Snapshot,
} from "./competitiveness";

const NOW = "2026-11-09T12:00:00Z";
const snap = (competitor: string, daily: number | null, o: Partial<Snapshot> = {}): Snapshot => ({
  competitor,
  category: "SUV",
  location: "MCO",
  collectedAt: "2026-11-08T10:00:00Z",
  pickupAt: "2026-12-20T10:00:00Z",
  returnAt: "2026-12-25T10:00:00Z",
  totalPrice: null,
  dailyPrice: daily,
  currency: "USD",
  available: true,
  equivalence: "equivalente",
  ...o,
});

describe("competitividade", () => {
  it("mediana de ímpar, par e vazio", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 10])).toBe(2.5);
    expect(median([])).toBeNull();
  });
  it("ausência de preço não vira zero", () => {
    expect(dailyOf(snap("A", null))).toBeNull();
    expect(dailyOf(snap("A", 100, { available: false }))).toBeNull();
    expect(dailyOf(snap("A", null, { totalPrice: 500 }))).toBe(100); // 5 diárias
  });
  const NOTA_UP =
    "Preço sem taxas; extras: motorista=29.99/uma_vez; bebe=5.99/dia; bebe_nome=Bebê Conforto; dias=7";
  it("lê os extras gravados pelo coletor e calcula o custo para N diárias", () => {
    const e = parseExtras(NOTA_UP)!;
    expect(e.motorista).toEqual({ valor: 29.99, unidade: "uma_vez" });
    expect(e.bebe).toEqual({ valor: 5.99, unidade: "dia" });
    expect(e.dias).toBe(7);
    expect(extrasCost(e, 7)).toBeCloseTo(71.92);
    expect(
      parseExtras("extras: motorista=0.00/uma_vez; bebe=0.00/uma_vez; bebe_nome=Baby Seat; dias=7"),
    ).not.toBeNull();
    expect(
      parseExtras("extras não coletados (motorista adicional e bebê conforto desconhecidos)"),
    ).toBeNull();
    expect(parseExtras(null)).toBeNull();
  });
  it("diária: preço do veículo por padrão; com extras soma motorista adicional e bebê conforto", () => {
    const up = snap("UP", 42, { notes: NOTA_UP });
    expect(dailyOf(up)).toBe(42);
    expect(dailyOf(up, true)).toBeCloseTo(42 + (29.99 + 5.99 * 5) / 5, 6); // a coleta de teste tem 5 diárias
    const gratis = snap("Ally", 100, {
      notes: "extras: motorista=0.00/uma_vez; bebe=0.00/uma_vez; bebe_nome=Baby Seat; dias=7",
    });
    expect(dailyOf(gratis, true)).toBe(100);
  });
  it("com extras, coleta sem os extras lidos não entra (não se presume que sejam grátis); sem extras entra normalmente", () => {
    const antiga = snap("UP", 42, { notes: "Preço sem taxas" });
    expect(comparable(antiga, NOW, "USD")).toBe(true);
    expect(comparable(antiga, NOW, "USD", 7, true)).toBe(false);
    expect(comparable(snap("UP", 42, { notes: NOTA_UP }), NOW, "USD", 7, true)).toBe(true);
  });
  it("site direto primeiro: a cotação do DiscoverCars da mesma locadora/categoria/período sai", () => {
    const dc = { notes: "Preço total exibido no DiscoverCars" };
    const rows = [snap("Thrifty", 60), snap("Thrifty", 80, dc), snap("Sixt", 70, dc), snap("Avis (DiscoverCars)", 75, dc)];
    const out = preferDirect(rows);
    expect(out.map((r) => `${r.competitor}:${r.dailyPrice}`).sort()).toEqual(["Avis (DiscoverCars):75", "Sixt:70", "Thrifty:60"]);
  });
  it("mercado: a opção de extras muda a mediana e o número de comparáveis", () => {
    const rows = [
      snap("UP", 42, { notes: NOTA_UP }),
      snap("Allycar", 100, {
        notes: "extras: motorista=0.00/uma_vez; bebe=0.00/uma_vez; bebe_nome=B; dias=7",
      }),
      snap("Antigo", 30, { notes: "Preço sem taxas" }),
    ];
    const base = marketOf(rows, NOW, "USD");
    expect(base.n).toBe(3);
    expect(base.min).toBe(30);
    const comExtras = marketOf(rows, NOW, "USD", true);
    expect(comExtras.n).toBe(2);
    expect(comExtras.min).toBeCloseTo(42 + (29.99 + 5.99 * 5) / 5, 6);
  });
  it("coleta antiga sem extras usa o último valor lido do mesmo concorrente, marcada como estimada", () => {
    const rows = [
      snap("UP", 42, { collectedAt: "2026-11-09T10:00:00Z", notes: "Preço sem taxas" }),
      snap("UP", 44, { collectedAt: "2026-11-08T10:00:00Z", notes: "Preço sem taxas" }),
      snap("UP", 45, {
        collectedAt: "2026-11-09T11:00:00Z",
        notes: "x; extras: motorista=29.99/uma_vez; bebe=5.99/dia",
      }),
      snap("UP", 46, {
        collectedAt: "2026-11-09T09:00:00Z",
        notes: "x; extras: motorista=10.00/uma_vez; bebe=1.00/dia",
      }),
      snap("Allycar", 100, { notes: "Preço sem taxas" }), // nenhuma leitura de extras: continua de fora
    ];
    const known = latestExtrasByCompetitor(rows);
    expect(known.get("UP")?.extras.motorista.valor).toBe(29.99); // a leitura mais recente
    expect(known.has("Allycar")).toBe(false);
    const eff = withKnownExtras(rows, known);
    expect(eff[0]!.extrasEstimados).toBe(true);
    expect(eff[2]!.extrasEstimados).toBeUndefined(); // já tinha a própria leitura
    expect(eff[4]!.extrasEstimados).toBeUndefined();
    expect(dailyOf(eff[0]!, true)).toBeCloseTo(42 + (29.99 + 5.99 * 5) / 5, 6);
    expect(dailyOf(eff[4]!, true)).toBeNull();
    expect(dailyOf(eff[0]!)).toBe(42); // sem extras, o preço do veículo não muda
  });
  it("só compara equivalentes, na mesma moeda e recentes", () => {
    expect(comparable(snap("A", 100), NOW, "USD")).toBe(true);
    expect(comparable(snap("A", 100, { equivalence: "nao_equivalente" }), NOW, "USD")).toBe(false);
    expect(comparable(snap("A", 100, { equivalence: "nao_avaliada" }), NOW, "USD")).toBe(false);
    expect(comparable(snap("A", 100, { currency: "BRL" }), NOW, "USD")).toBe(false);
    expect(comparable(snap("A", 100, { collectedAt: "2026-10-01T00:00:00Z" }), NOW, "USD")).toBe(
      false,
    );
  });
  it("usa a última coleta de cada concorrente", () => {
    const rows = [snap("A", 100), snap("A", 120, { collectedAt: "2026-11-09T08:00:00Z" })];
    expect(latestPerCompetitor(rows)).toHaveLength(1);
    expect(marketOf(rows, NOW, "USD").median).toBe(120);
  });
  it("vários modelos do mesmo concorrente na mesma categoria: usa o mais barato, uma vez", () => {
    const rows = [snap("A", 120), snap("A", 100), snap("A", 140), snap("B", 200)];
    const used = latestPerCompetitor(rows);
    expect(used).toHaveLength(2);
    expect(marketOf(rows, NOW, "USD").median).toBe(150); // A=100, B=200
  });
  it("mostra só a coleta mais recente de cada oferta (concorrente + modelo + datas)", () => {
    const o = (competitor: string, modelo: string, preco: number, coleta: string) =>
      snap(competitor, preco, { sourceCategory: modelo, collectedAt: coleta });
    const rows = [
      o("A", "Palisade", 120, "2026-11-09T20:31:00Z"),
      o("A", "Palisade", 118, "2026-11-09T20:32:00Z"), // repetida, mais recente: vale
      o("A", "Outlander", 100, "2026-11-09T20:32:00Z"), // outro modelo do mesmo concorrente: é outra oferta
      o("B", "Palisade", 130, "2026-11-08T10:00:00Z"),
    ];
    const r = latestOffers(rows);
    expect(r).toHaveLength(3);
    expect(r.find((x) => x.competitor === "A" && x.sourceCategory === "Palisade")!.dailyPrice).toBe(
      118,
    );
  });
  it("mercado: mediana, extremos e confiabilidade", () => {
    const m = marketOf([snap("A", 100), snap("B", 200), snap("C", 150)], NOW, "USD");
    expect(m).toMatchObject({ n: 3, median: 150, mean: 150, min: 100, max: 200, reliable: true });
    const p = marketOf(
      [snap("A", 100), snap("B", 200), snap("C", 150, { equivalence: "parcial" })],
      NOW,
      "USD",
    );
    expect(p.reliable).toBe(false);
    expect(p.partial).toBe(true);
  });
  it("com 1 ou 2 concorrentes classifica, mas não marca a comparação como confiável", () => {
    const m = marketOf([snap("A", 100), snap("B", 200)], NOW, "USD");
    expect(m).toMatchObject({ n: 2, median: 150, reliable: false });
    expect(priceLevel(diffPct(180, m.median), m.n)).toBe("muito-acima");
    expect(marketOf([snap("A", 100)], NOW, "USD")).toMatchObject({
      n: 1,
      median: 100,
      reliable: false,
    });
  });
  it("sem concorrentes: sem mediana e sem classificação", () => {
    const m = marketOf([], NOW, "USD");
    expect(m.median).toBeNull();
    expect(priceLevel(diffPct(100, m.median), m.n)).toBe("sem-dados");
  });
  it("diferença percentual e faixas configuráveis", () => {
    expect(diffPct(110, 100)).toBeCloseTo(10);
    expect(priceLevel(10.5, 3)).toBe("muito-acima");
    expect(priceLevel(5, 3)).toBe("acima");
    expect(priceLevel(-2, 3)).toBe("alinhado");
    expect(priceLevel(-12, 3)).toBe("muito-abaixo");
    expect(priceLevel(5, 3, { significant: 4, close: 1 })).toBe("muito-acima");
    expect(priceLevel(10, 2)).toBe("acima"); // classifica mesmo com poucos concorrentes
    expect(priceLevel(10, 0)).toBe("sem-dados"); // sem nenhum, não classifica
  });
  it("matriz de diagnóstico", () => {
    expect(diagnose("abaixo", "acima")).toBe("perda-competitividade");
    expect(diagnose("muito-abaixo", "abaixo")).toBe("investigar-demanda");
    expect(diagnose("acima", "abaixo")).toBe("oportunidade-aumento");
    expect(diagnose("muito-acima", "muito-acima")).toBe("monitorar-sustentabilidade");
    expect(diagnose("neutro", "acima")).toBe("neutro");
  });
  it("sem concorrência ou sem benchmark não assume posicionamento", () => {
    expect(diagnose("abaixo", "sem-dados")).toBe("sem-posicionamento");
    expect(diagnose(null, "acima")).toBe("sem-posicionamento");
  });
});

describe("período exato", () => {
  it("soma as noites de retirada até a véspera da devolução", () => {
    expect(stayNights("2027-01-13", "2027-01-17")).toEqual([
      "2027-01-13",
      "2027-01-14",
      "2027-01-15",
      "2027-01-16",
    ]);
    const rates: Record<string, number> = {
      "2027-01-13": 40,
      "2027-01-14": 50,
      "2027-01-15": 60,
      "2027-01-16": 50,
    };
    expect(ourStay((d) => rates[d], "2027-01-13", "2027-01-17")).toEqual({
      total: 200,
      daily: 50,
      days: 4,
    });
  });
  it("noite sem tarifa = sem reserva (nunca zero)", () => {
    expect(ourStay((d) => (d === "2027-01-15" ? null : 50), "2027-01-13", "2027-01-17")).toBeNull();
    expect(ourStay(() => 50, "2027-01-13", "2027-01-13")).toBeNull();
  });
});

describe("stayOffers", () => {
  const snap = (
    pickup: string,
    ret: string,
    daily: number,
    collectedAt = "2026-11-10T00:00:00Z",
  ) => ({
    competitor: "X",
    category: "SUV",
    sourceCategory: "Modelo",
    location: "MCO",
    collectedAt,
    pickupAt: `${pickup}T10:00:00`,
    returnAt: `${ret}T10:00:00`,
    totalPrice: daily * 7,
    dailyPrice: daily,
    currency: "USD",
    available: true,
    equivalence: "parcial" as const,
  });
  it("usa a cotação exata quando existe", () => {
    const r = stayOffers([snap("2027-01-16", "2027-01-23", 50)], "2027-01-16", "2027-01-23");
    expect(r[0]!.composta).toBeUndefined();
    expect(r[0]!.totalPrice).toBe(350);
  });
  it("compõe 16→22 a partir da cotação 16→23", () => {
    const r = stayOffers([snap("2027-01-16", "2027-01-23", 50)], "2027-01-16", "2027-01-22");
    expect(r[0]!.composta).toBe(true);
    expect(r[0]!.totalPrice).toBe(300);
    expect(r[0]!.dailyPrice).toBe(50);
  });
  it("cada noite usa a cotação que começa mais perto dela", () => {
    const r = stayOffers(
      [snap("2027-01-16", "2027-01-23", 50), snap("2027-01-18", "2027-01-25", 80)],
      "2027-01-17",
      "2027-01-20",
    );
    // 17: só a de 16 (50); 18 e 19: a de 18 (80).
    expect(r[0]!.totalPrice).toBe(210);
  });
  it("noite sem cobertura = sem oferta", () => {
    expect(stayOffers([snap("2027-01-16", "2027-01-23", 50)], "2027-01-20", "2027-01-25")).toEqual(
      [],
    );
  });
});
