import { describe, expect, it } from "vitest";
import {
  comparable,
  latestOffers,
  dailyOf,
  diagnose,
  diffPct,
  latestPerCompetitor,
  marketOf,
  median,
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
