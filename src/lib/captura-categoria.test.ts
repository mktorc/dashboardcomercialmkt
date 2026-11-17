import { describe, expect, it } from "vitest";
import {
  aberturaJanela,
  capturaEm,
  capturaProximos,
  curvaCategoria,
  faltaCapturar,
  janelaDe,
} from "./captura-categoria";
import type { PaceCal, PaceRow } from "./occupancy-pace";

// Curva: 0% em D-120, 20% em D-60, 50% em D-30, 90% em D-7, 100% em D-0.
const C = {
  pontos: [
    { L: 120, share: 0 },
    { L: 60, share: 0.2 },
    { L: 30, share: 0.5 },
    { L: 7, share: 0.9 },
    { L: 0, share: 1 },
  ],
};

describe("interpolação e números de captura", () => {
  it("interpola entre pontos e trata as pontas", () => {
    expect(capturaEm(C, 45)).toBeCloseTo(0.35);
    expect(capturaEm(C, 60)).toBeCloseTo(0.2);
    expect(capturaEm(C, 0)).toBe(1);
    expect(capturaEm(C, -3)).toBe(1);
    expect(capturaEm(C, 300)).toBe(0);
    expect(capturaEm({ pontos: [{ L: 30, share: 0.5 }] }, 15)).toBeCloseTo(0.75);
    // sem ponto além de 30: vai até 0 em D-400
    expect(capturaEm({ pontos: [{ L: 30, share: 0.5 }] }, 215)).toBeCloseTo(0.25);
  });
  it("falta capturar e próximos 14 dias", () => {
    expect(faltaCapturar(C, 30)).toBeCloseTo(0.5);
    expect(capturaProximos(C, 30)).toBeCloseTo(capturaEm(C, 16) - 0.5);
    expect(capturaProximos(C, 60, 14)).toBeCloseTo(0.34 - 0.2);
  });
  it("data em que a janela abre", () => {
    // Em D-100 os 14 dias seguintes capturam 0,0467; passa de 10% quando L−14 cruza ~D-53.
    const abre = aberturaJanela(C, 100, "2026-11-17");
    expect(abre).not.toBeNull();
    const k = (Date.parse(abre!) - Date.parse("2026-11-17")) / 86400000;
    expect(capturaProximos(C, 100 - k)).toBeGreaterThan(0.1);
    expect(capturaProximos(C, 100 - k + 1)).toBeLessThanOrEqual(0.1);
    expect(aberturaJanela(C, 30, "2026-11-17")).toBe("2026-11-17");
    expect(
      aberturaJanela(
        {
          pontos: [
            { L: 0, share: 1 },
            { L: 400, share: 0.99 },
          ],
        },
        50,
        "2026-11-17",
      ),
    ).toBeNull();
  });
});

describe("janela de ação", () => {
  it("classifica", () => {
    expect(janelaDe(C, 100)).toBe("cedo");
    expect(janelaDe(C, 45)).toBe("agora");
    expect(janelaDe(C, 12)).toBe("ultima"); // falta ~19%
    expect(janelaDe(C, 1)).toBe("tarde"); // falta ~1,4%
  });
  it("limites configuráveis", () => {
    const cfg = { minDatas: 15, agora14: 0.5, cedo30: 0.1, ultima: 0.25, tarde: 0.05 };
    expect(janelaDe(C, 45, cfg)).toBe("cedo");
  });
});

// Linhas sintéticas: `a` = antecedências de criação das diárias; f = frota.
const linha = (d: string, c: string, a: number[]): PaceRow =>
  ({ d, c, f: 10, a }) as unknown as PaceRow;
const datas = (mes: string, n: number, c: string, a: number[]) =>
  Array.from({ length: n }, (_, i) => linha(`2025-${mes}-${String(i + 1).padStart(2, "0")}`, c, a));

describe("curva por categoria com fallback", () => {
  const cal: PaceCal = {};
  for (let i = 1; i <= 28; i++) {
    cal[`2025-01-${String(i).padStart(2, "0")}`] = ["Alta", null, null];
    cal[`2025-02-${String(i).padStart(2, "0")}`] = ["Alta", null, null];
  }
  const base = "2026-11-17";
  const de = "2023-01-01";
  it("categoria + mês com amostra", () => {
    const rows = datas("01", 16, "SUV", [90, 30, 10, 5]);
    const c = curvaCategoria(rows, base, de, cal, "SUV", 1, "Alta")!;
    expect(c.base).toBe("categoria-mes");
    expect(c.datas).toBe(16);
    expect(capturaEm(c, 60)).toBeCloseTo(0.25);
  });
  it("cai para sazonalidade e depois para todas as categorias", () => {
    const rows = [
      ...datas("01", 10, "SUV", [90, 30, 10, 5]),
      ...datas("02", 10, "SUV", [90, 30, 10, 5]),
    ];
    expect(curvaCategoria(rows, base, de, cal, "SUV", 1, "Alta")!.base).toBe(
      "categoria-sazonalidade",
    );
    const rows2 = [
      ...datas("01", 10, "SUV", [90, 30, 10, 5]),
      ...datas("01", 10, "Minivan", [20, 10, 5, 1]),
    ];
    const c2 = curvaCategoria(rows2, base, de, {}, "SUV", 1, null)!;
    expect(c2.base).toBe("todas-mes");
    expect(c2.datas).toBe(20);
    expect(
      curvaCategoria(datas("01", 5, "SUV", [9, 3, 1]), base, de, cal, "SUV", 1, "Alta"),
    ).toBeNull();
  });
  it("mínimo configurável e datas de evento fora", () => {
    const rows = datas("01", 10, "SUV", [90, 30, 10, 5]);
    expect(
      curvaCategoria(rows, base, de, cal, "SUV", 1, "Alta", {
        minDatas: 10,
        agora14: 0.1,
        cedo30: 0.1,
        ultima: 0.25,
        tarde: 0.05,
      })!.base,
    ).toBe("categoria-mes");
    const ev: PaceCal = { ...cal, "2025-01-01": ["Alta", "natal", 0] };
    const c = curvaCategoria(datas("01", 16, "SUV", [90, 30, 10, 5]), base, de, ev, "SUV", 1, null);
    expect(c?.datas).toBe(15);
  });
});
