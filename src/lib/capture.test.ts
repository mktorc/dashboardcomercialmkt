import { describe, expect, it } from "vitest";
import {
  activeAt,
  buildModel,
  grossAt,
  soldAt,
  type PacePayload,
  type PaceRow,
} from "./occupancy-pace";
import { captureCurve, captureInfo, captureProfile, captureSpeed, expectedShare } from "./capture";
import { enrich, NO_PRICE, DEFAULT_CRIT, tendenciaOf, type PriorityRow } from "./prioridades";

const BASE = "2026-11-09";
// Dias comuns históricos: 10 diárias finais, 2 criadas em D-120+, 4 em D-60+, 7 em D-30+.
const hist = (d: string): PaceRow => ({
  d,
  c: "SUV",
  f: 10,
  a: [130, 125, 80, 70, 40, 35, 33, 10, 5, 2],
});
const dates = Array.from({ length: 12 }, (_, i) => `2026-0${(i % 9) + 1}-1${(i % 4) + 1}`);
const linhas = [...new Set(dates)].map(hist);
const alvo: PaceRow = { d: "2026-12-14", c: "SUV", f: 10, a: [130, 80] };
const payload = (de = "2023-06-24"): PacePayload => ({
  versao: 2,
  gerado_em: "",
  hoje: BASE,
  de,
  ate: "2026-12-31",
  categorias: ["SUV"],
  params: { n_evento: 2, n_dow: 8, n_saz: 5, estatistica: "media" },
  cal: Object.fromEntries([...linhas, alvo].map((r) => [r.d, ["Média", null, null]])),
  linhas: [...linhas, alvo],
});

describe("curva de captura", () => {
  const model = buildModel(payload());
  it("parcela esperada = diárias criadas até D-L ÷ diárias finais", () => {
    expect(expectedShare(model, alvo, 120, BASE)!.share).toBeCloseTo(0.2);
    expect(expectedShare(model, alvo, 60, BASE)!.share).toBeCloseTo(0.4);
    expect(expectedShare(model, alvo, 30, BASE)!.share).toBeCloseTo(0.7);
  });
  it("sem amostra suficiente não há referência (nada é inventado)", () => {
    const pouco = buildModel({ ...payload(), linhas: [hist("2026-01-11"), alvo] });
    expect(expectedShare(pouco, alvo, 60, BASE)).toBeNull();
  });
  it("fotos anteriores ao início da base são descartadas (vendas truncadas)", () => {
    const tarde = buildModel(payload("2026-06-01"));
    expect(expectedShare(tarde, alvo, 120, BASE)).toBeNull();
  });
  it("captura atual é medida sobre a ocupação final típica, separada da ocupação da frota", () => {
    const info = captureInfo(model, alvo, alvo.d, BASE)!;
    expect(info.histShare).toBeCloseTo(0.6); // D-35: 6 das 10 diárias já existiam
  });
  it("curva: atual só onde a foto já existe", () => {
    const c = captureCurve(model, alvo, alvo.d, BASE);
    const d180 = c.find((p) => p.L === 180)!;
    const d7 = c.find((p) => p.L === 7)!;
    expect(d180.atual).not.toBeNull();
    expect(d7.atual).toBeNull();
    expect(c.find((p) => p.L === 0)!.hist).toBe(100);
  });
  it("perfil agregado e velocidade", () => {
    const pr = captureProfile(model.payload.linhas, BASE, "2023-06-24");
    expect(pr.find((p) => p.L === 90)!.share).toBeCloseTo(0.2);
    const sp = captureSpeed(pr);
    expect(sp.every((s) => Number.isFinite(s.ppPerDay))).toBe(true);
  });
});

describe("tendência e criticidade com ritmo", () => {
  it("tendência só com amostra mínima", () => {
    expect(tendenciaOf(1, 0.4)).toBeNull();
    expect(tendenciaOf(1, 4)).toBe("desacelerando");
    expect(tendenciaOf(4, 4)).toBe("estavel");
    expect(tendenciaOf(8, 4)).toBe("acelerando");
  });
  const row = (o: Partial<PriorityRow> = {}): PriorityRow => ({
    date: "2026-12-14",
    lead: 35,
    closed: false,
    capacity: 10,
    booked: 2,
    atual: 0.2,
    esperada: 0.6,
    gap: -40,
    n: 20,
    level: "dow",
    event: null,
    eventRel: null,
    season: "Alta",
    category: "SUV",
    vacant: 8,
    score: 2,
    criticidade: "critica",
    confianca: "alta",
    ...o,
  });
});

describe("captura bruta, líquida e ativa; monotonicidade", () => {
  // 10 confirmadas finais; 2 canceladas (criadas em D-100 e D-50): uma cancelada em D-80 e outra em D-20.
  const row: PaceRow = {
    d: "2026-03-10",
    c: "SUV",
    f: 10,
    a: [130, 125, 80, 70, 40, 35, 33, 10, 5, 2],
    x: [
      [100, 80],
      [50, 20],
    ],
  };
  it("bruta ≥ ativa ≥ líquida em cada antecedência; no D-0 a bruta soma todas as canceladas", () => {
    for (const L of [120, 90, 60, 30, 10, 0]) {
      expect(grossAt(row, L)).toBeGreaterThanOrEqual(activeAt(row, L));
      expect(activeAt(row, L)).toBeGreaterThanOrEqual(soldAt(row, L));
    }
    expect(grossAt(row, 0)).toBe(12);
    expect(soldAt(row, 0)).toBe(10);
  });
  it("ativa em D-L inclui a cancelada só enquanto ainda não tinha cancelado", () => {
    expect(activeAt(row, 90)).toBe(soldAt(row, 90) + 1); // criada em D-100, cancelou em D-80: ativa em D-90
    expect(activeAt(row, 70)).toBe(soldAt(row, 70)); // já cancelada
    expect(activeAt(row, 40)).toBe(soldAt(row, 40) + 1); // criada em D-50, cancela em D-20: ativa em D-40
    expect(activeAt(row, 10)).toBe(soldAt(row, 10)); // cancelada em D-20
  });
  it("sem dados de cancelamento a ativa e a bruta caem na líquida (nada é inventado)", () => {
    const sem: PaceRow = { ...row };
    delete sem.x;
    expect(activeAt(sem, 90)).toBe(soldAt(sem, 90));
    expect(grossAt(sem, 90)).toBe(soldAt(sem, 90));
  });
  it("a curva histórica é monotônica não decrescente com a menor antecedência e termina em 100%", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ ...hist(`2026-01-${10 + i}`) }));
    const pr = captureProfile(rows, BASE, "2023-06-24");
    for (let i = 1; i < pr.length; i++)
      expect(pr[i]!.share!).toBeGreaterThanOrEqual(pr[i - 1]!.share!);
    expect(pr.at(-1)!.share).toBe(1);
    expect(captureSpeed(pr).every((s) => s.ppPerDay >= 0)).toBe(true);
  });
  it("taxa de cancelamento por antecedência vem do dado, e é null sem dados de cancelamento", () => {
    const com = captureProfile([row, row, row], "2026-11-09", "2023-06-24");
    expect(com.find((p) => p.L === 60)!.cancelamento).toBeCloseTo(
      (grossAt(row, 60) - soldAt(row, 60)) / grossAt(row, 60),
    );
    const semX = captureProfile([hist("2026-01-11"), hist("2026-01-12")], BASE, "2023-06-24");
    expect(semX.every((p) => p.cancelamento == null)).toBe(true);
  });
});
