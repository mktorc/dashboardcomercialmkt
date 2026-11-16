import { describe, expect, it } from "vitest";
import type { Snapshot } from "./competitiveness";
import {
  ageDays,
  ageLabel,
  bannerOf,
  axisPos,
  buildCalendar,
  buildComparisons,
  cellKey,
  collectionAges,
  datesWithoutQuotes,
  distributionOf,
  equivalenceAlert,
  pickupDates,
  summarizeCategories,
  symmetricAxis,
  type CategorySummary,
  classifyQuotes,
  confidenceOf,
  isStrong,
  medianOfMedians,
  positionOf,
  usVsThem,
  type CategoryPosition,
} from "./competitiveness-view";

const NOW = "2026-11-09T12:00:00Z";
const snap = (competitor: string, daily: number | null, o: Partial<Snapshot> = {}): Snapshot => ({
  competitor,
  category: "SUV",
  sourceCategory: "Modelo",
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
const cat = (category: string, ours: number, med: number): CategoryPosition => ({
  category,
  ours,
  median: med,
  pct: ((ours - med) / med) * 100,
  market: { n: 3, median: med, mean: med, min: med, max: med, reliable: true, partial: false, lastCollectedAt: NOW },
});

describe("posição acima / alinhado / abaixo (±5%)", () => {
  it("classifica nos limites", () => {
    expect(positionOf(5)).toBe("alinhado");
    expect(positionOf(-5)).toBe("alinhado");
    expect(positionOf(5.01)).toBe("acima");
    expect(positionOf(-5.01)).toBe("abaixo");
    expect(positionOf(null)).toBeNull();
    expect(positionOf(4, { close: 3, significant: 10 })).toBe("acima");
  });
  it("intensidade a partir de ±10%", () => {
    expect(isStrong(9.9)).toBe(false);
    expect(isStrong(10)).toBe(true);
    expect(isStrong(-12)).toBe(true);
  });
  it("texto nós vs eles", () => {
    expect(usVsThem(23.2)).toEqual({ text: "nós 23% mais caros", position: "acima" });
    expect(usVsThem(-19)).toEqual({ text: "nós 19% mais baratos", position: "abaixo" });
    expect(usVsThem(2).position).toBe("alinhado");
  });
});

describe("mediana geral e banner", () => {
  it("número par de categorias: média dos dois do meio", () => {
    expect(medianOfMedians([cat("A", 1, 100), cat("B", 1, 200), cat("C", 1, 300), cat("D", 1, 1000)])).toBe(250);
    expect(medianOfMedians([cat("A", 1, 100), cat("B", 1, 200)])).toBe(150);
    expect(medianOfMedians([])).toBeNull();
  });
  it("uma categoria: nossa diária contra a mediana dela", () => {
    const b = bannerOf([cat("SUV", 110, 100)]);
    expect(b).toMatchObject({ kind: "uma", position: "acima", ours: 110, median: 100 });
  });
  it("várias: média das diferenças por categoria", () => {
    const b = bannerOf([cat("A", 110, 100), cat("B", 96, 100), cat("C", 103, 100)]);
    expect(b.kind).toBe("varias");
    if (b.kind === "varias") {
      expect(b.pct).toBeCloseTo(3);
      expect(b.position).toBe("alinhado");
      expect(b.count).toBe(3);
    }
    expect(bannerOf([]).kind).toBe("sem-dados");
  });
});

describe("motivo de exclusão das cotações", () => {
  it("explica cada cotação fora da mediana", () => {
    const rows = [
      snap("A", 100, { sourceCategory: "Tahoe" }),
      snap("A", 120, { sourceCategory: "Suburban" }), // mais caro do mesmo concorrente, mesma coleta
      snap("A", 90, { sourceCategory: "Tahoe", collectedAt: "2026-11-07T10:00:00Z" }), // coleta anterior
      snap("B", 100, { equivalence: "nao_equivalente" }),
      snap("C", 100, { equivalence: "nao_avaliada" }),
      snap("D", 100, { currency: "BRL" }),
      snap("E", 100, { collectedAt: "2026-10-30T10:00:00Z" }),
      snap("F", null),
      snap("G", 100, { equivalence: "parcial" }),
    ];
    const r = classifyQuotes(rows, NOW, "USD").map((x) => x.reason);
    expect(r).toEqual([
      null,
      "outro modelo do mesmo concorrente, mais caro",
      "coleta mais antiga do mesmo concorrente",
      "não equivalente",
      "equivalência não avaliada",
      "moeda diferente",
      "coleta com mais de 7 dias",
      "indisponível ou sem preço",
      null,
    ]);
  });
});

describe("idade da coleta e confiança", () => {
  it("conta dias inteiros", () => {
    expect(ageDays("2026-11-09T08:00:00Z", NOW)).toBe(0);
    expect(ageDays("2026-11-08T11:00:00Z", NOW)).toBe(1);
    expect(ageDays("2026-11-05T12:00:00Z", NOW)).toBe(4);
    expect(ageDays("2026-11-10T12:00:00Z", NOW)).toBe(0); // futuro não vira negativo
    expect(ageLabel(0)).toBe("hoje");
    expect(ageLabel(4)).toBe("há 4 dias");
  });
  it("confiança baixa com menos de 3 concorrentes", () => {
    expect(confidenceOf(2)).toBe("baixa");
    expect(confidenceOf(3)).toBe("alta");
  });
});

describe("período de retirada × duração da locação", () => {
  it("o intervalo lista as datas de retirada, inclusive", () => {
    expect(pickupDates("2027-01-14", "2027-01-16")).toEqual(["2027-01-14", "2027-01-15", "2027-01-16"]);
    expect(pickupDates("2027-01-14", "2027-01-14")).toEqual(["2027-01-14"]);
  });
  const q = (competitor: string, pickup: string, ret: string, daily: number) =>
    snap(competitor, daily, { pickupAt: `${pickup}T10:00:00`, returnAt: `${ret}T10:00:00` });
  // Cotações de 7 dias (01/12 → 08/12): retiradas até 06/12 com 2 diárias são compostas a partir delas.
  const rows = [
    q("A", "2026-12-01", "2026-12-08", 100),
    q("B", "2026-12-01", "2026-12-08", 120),
    q("C", "2026-12-01", "2026-12-08", 140),
  ];
  const rateOf = (d: string, c: string) => (c === "SUV" ? (d === "2026-12-03" ? 150 : 130) : 90);
  const comps = buildComparisons({
    rows,
    categories: ["SUV", "Minivan"],
    from: "2026-12-01",
    to: "2026-12-10",
    duration: 2,
    rateOf,
    now: NOW,
    currency: "USD",
  });
  it("cada retirada compara uma reserva da duração escolhida, não o intervalo", () => {
    const c = comps.find((x) => x.date === "2026-12-02" && x.category === "SUV")!;
    expect(c.returnDate).toBe("2026-12-04");
    expect(c.ours).toBe(140); // noites 02 e 03: (130 + 150) / 2
    expect(c.oursTotal).toBe(280);
    expect(c.market.median).toBe(120);
    // A diferença de cada cotação contra a nossa diária (eixo da régua).
    expect(c.quotes.map((x) => Math.round(x.vsUs!))).toEqual([-29, -14, 0]);
  });
  it("duração de 7 usa a cotação exata", () => {
    const c7 = buildComparisons({ rows, categories: ["SUV"], from: "2026-12-01", to: "2026-12-01", duration: 7, rateOf, now: NOW, currency: "USD" });
    expect(c7[0]!.market.n).toBe(3);
    expect(c7[0]!.quotes.every((x) => !x.row.composta)).toBe(true);
  });
  it("calendário: célula vazia e datas sem nenhuma cotação", () => {
    const cells = buildCalendar(comps, NOW);
    expect(cells.get(cellKey("2026-12-01", "SUV"))).toMatchObject({ empty: false, ours: 130, median: 120, n: 3, confidence: "alta", ageDays: 1, position: "acima", strong: false });
    expect(cells.get(cellKey("2026-12-02", "SUV"))!.strong).toBe(true);
    expect(cells.get(cellKey("2026-12-01", "Minivan"))).toMatchObject({ empty: true, n: 0, median: null, pct: null, position: null, confidence: null });
    // 07/12 em diante: a reserva de 2 noites passa da devolução 08/12 das cotações.
    expect(datesWithoutQuotes(pickupDates("2026-12-01", "2026-12-10"), cells)).toEqual(["2026-12-07", "2026-12-08", "2026-12-09", "2026-12-10"]);
  });
  it("sem nossa tarifa a célula fica vazia", () => {
    const c = buildComparisons({ rows, categories: ["SUV"], from: "2026-12-01", to: "2026-12-01", duration: 2, rateOf: () => null, now: NOW, currency: "USD" });
    expect(buildCalendar(c, NOW).get(cellKey("2026-12-01", "SUV"))!.empty).toBe(true);
  });
  it("resumo por categoria no intervalo: média das datas, ordenado por diferença", () => {
    const s = summarizeCategories(comps);
    expect(s.map((x) => x.category)).toEqual(["SUV"]);
    expect(s[0]!.dates).toBe(6);
    expect(s[0]!.maxN).toBe(3);
    expect(s[0]!.alert).toBe(false);
  });
});

const sum = (category: string, pct: number, maxN = 3): CategorySummary => ({
  category,
  pct,
  ours: 100,
  median: 100,
  dates: 1,
  maxN,
  minN: maxN,
  medianVsUs: -pct,
  alert: equivalenceAlert(pct, maxN),
});

describe("banner com distribuição", () => {
  it("conta acima / alinhado / abaixo e mostra as 2 maiores de cada lado", () => {
    const d = distributionOf([
      sum("Midsize SUV", 45),
      sum("Van 12 Seats", 42),
      sum("Luxury", 8),
      sum("Corolla", 3),
      sum("Fullsize SUV", -19),
      sum("SUV Executive 8 Seats", -32),
    ]);
    expect([d.acima, d.alinhado, d.abaixo]).toEqual([3, 1, 2]);
    expect(d.topAcima.map((c) => c.category)).toEqual(["Midsize SUV", "Van 12 Seats"]);
    expect(d.topAbaixo.map((c) => c.category)).toEqual(["SUV Executive 8 Seats", "Fullsize SUV"]);
    expect(d.mean).toBeCloseTo(47 / 6);
  });
  it("sem categorias", () => {
    expect(distributionOf([])).toMatchObject({ acima: 0, alinhado: 0, abaixo: 0, mean: null });
  });
});

describe("régua em eixo único de %", () => {
  it("eixo simétrico em múltiplos de 10, mínimo ±10%", () => {
    expect(symmetricAxis([-12, 41, null])).toBe(50);
    expect(symmetricAxis([3])).toBe(10);
    expect(symmetricAxis([])).toBe(10);
  });
  it("nossa diária fica no centro", () => {
    expect(axisPos(0, 50)).toBe(0.5);
    expect(axisPos(-50, 50)).toBe(0);
    expect(axisPos(25, 50)).toBe(0.75);
    expect(axisPos(80, 50)).toBe(1);
  });
});

describe("coleta mais antiga e alerta de equivalência", () => {
  it("selo usa a mais antiga; tooltip o intervalo", () => {
    expect(collectionAges(["2026-11-08T10:00:00Z", "2026-11-04T10:00:00Z", "2026-11-09T10:00:00Z"], NOW)).toEqual({ oldest: 5, newest: 0 });
    expect(collectionAges([], NOW)).toBeNull();
  });
  it("alerta com um único concorrente ou diferença acima de ±30%", () => {
    expect(equivalenceAlert(2, 1)).toBe(true);
    expect(equivalenceAlert(31, 3)).toBe(true);
    expect(equivalenceAlert(-30.5, 4)).toBe(true);
    expect(equivalenceAlert(30, 2)).toBe(false);
    expect(equivalenceAlert(null, 2)).toBe(false);
  });
});

describe("Allycar: pareamento", () => {
  it("Outlander fica sem categoria; Palisade e Highlander entram pela média", async () => {
    const { overrideCategory, marketOf } = await import("./competitiveness");
    expect(overrideCategory("Allycar", "Mitsubishi Outlander", "Fullsize Suv")).toBeNull();
    expect(overrideCategory("Allycar", "Hyundai Palisade", "Fullsize Suv")).toBe("Fullsize Suv");
    expect(overrideCategory("Florida", "Mitsubishi Outlander", "Midsize Suv")).toBe("Midsize Suv");
    const a = (model: string, daily: number, collectedAt = "2026-11-08T10:00:00Z") =>
      snap("Allycar", daily, { category: "Fullsize Suv", sourceCategory: model, collectedAt });
    const rows = [
      a("Hyundai Palisade", 100),
      a("Toyota Grand Highlander", 140, "2026-11-08T10:01:00Z"),
      snap("B", 200, { category: "Fullsize Suv" }),
    ];
    const m = marketOf(rows, NOW, "USD");
    expect(m.n).toBe(2);
    expect(m.median).toBe(160); // mediana de 120 (média Allycar) e 200
    expect(classifyQuotes(rows, NOW, "USD").map((x) => x.reason)).toEqual([null, null, null]);
  });
  it("outros concorrentes continuam com o modelo mais barato", async () => {
    const { marketOf } = await import("./competitiveness");
    const rows = [snap("B", 100, { sourceCategory: "X" }), snap("B", 140, { sourceCategory: "Y" })];
    expect(marketOf(rows, NOW, "USD").median).toBe(100);
  });
});
