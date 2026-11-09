import { describe, expect, it } from "vitest";
import {
  comparable,
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
    expect(priceLevel(10, 2)).toBe("sem-dados"); // poucos concorrentes
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
