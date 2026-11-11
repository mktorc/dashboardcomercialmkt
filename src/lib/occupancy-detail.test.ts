import { describe, expect, it } from "vitest";
import {
  avisoFrotaPequena,
  carros,
  curvaDetalhe,
  curvaReferencia,
  difDiariaPct,
  diariaEmL,
  faixaReferencias,
  gapCarros,
  lotouEm,
  precoVendaAtual,
  primeiroCheio,
  projecaoFechamento,
  ritmoRecente,
} from "./occupancy-detail";
import type { PaceRow } from "./occupancy-pace";

const row = (a: number[], x?: [number, number | null][], f = 10, m?: number[]): PaceRow =>
  ({ d: "2026-01-06", c: "A", f, a, ...(x ? { x } : {}), ...(m ? { m } : {}) }) as PaceRow;

describe("conversão em carros", () => {
  it("arredonda ocupação × frota para o inteiro mais próximo", () => {
    expect(carros(0.17, 18)).toBe(3);
    expect(carros(0.78, 18)).toBe(14);
    expect(carros(0.24, 17)).toBe(4);
    expect(carros(0.71, 17)).toBe(12);
  });
  it("gap em p.p. vira carros", () => {
    expect(gapCarros(-61, 18)).toBe(-11);
    expect(gapCarros(0, 18)).toBe(0);
  });
});

describe("faixa das referências", () => {
  const refs = [{ date: "2025-01-07", occ: 0.78 }, { date: "2026-01-06", occ: 0.24 }];
  it("vai da menor à maior ocupação e classifica a atual", () => {
    expect(faixaReferencias(refs, 0.1)).toMatchObject({ status: "abaixo", min: { date: "2026-01-06" }, max: { date: "2025-01-07" } });
    expect(faixaReferencias(refs, 0.5)?.status).toBe("dentro");
    expect(faixaReferencias(refs, 0.24)?.status).toBe("dentro");
    expect(faixaReferencias(refs, 0.9)?.status).toBe("acima");
    expect(faixaReferencias(refs, null)?.status).toBeNull();
  });
  it("com uma referência (ou nenhuma com dado) não há faixa", () => {
    expect(faixaReferencias([refs[0]!], 0.5)).toBeNull();
    expect(faixaReferencias([refs[0]!, { date: "x", occ: null }], 0.5)).toBeNull();
  });
});

describe("projeção de fechamento", () => {
  it("atual + ganho da referência em carros, limitado à frota", () => {
    // referência ganhou 44 p.p. (17% → 61%): em 18 carros, +8
    const p = projecaoFechamento({ occ: 0.17, occFinal: 0.61 }, 3, 18, 100)!;
    expect(p.ganhoCarros).toBe(8);
    expect(p.fechaCarros).toBe(11);
    expect(p.fechaOcc).toBeCloseTo(11 / 18, 10); // % derivado dos carros: 11/18 = 61%
    expect(Math.round(p.fechaOcc * 100)).toBe(61);
    expect(p.revPorVeiculo).toBeCloseTo(p.fechaOcc * 100, 5);
  });
  it("carros e % sempre batem, em qualquer combinação", () => {
    for (const cap of [7, 18, 33])
      for (let booked = 0; booked <= cap; booked += 2)
        for (const gp of [-20, 0, 13, 44, 90]) {
          const p = projecaoFechamento({ occ: 0.1, occFinal: 0.1 + gp / 100 }, booked, cap, 100)!;
          expect(p.fechaOcc).toBeCloseTo(p.fechaCarros / cap, 10);
          expect(Number.isInteger(p.fechaCarros)).toBe(true);
        }
  });
  it("não passa da frota atual e não fica negativa", () => {
    expect(projecaoFechamento({ occ: 0.2, occFinal: 1 }, 17, 18, null)!.fechaCarros).toBe(18);
    expect(projecaoFechamento({ occ: 0.9, occFinal: 0.5 }, 2, 10, 80)!.fechaCarros).toBe(0);
    expect(projecaoFechamento({ occ: 0.2, occFinal: 1 }, 17, 18, null)!.revPorVeiculo).toBeNull();
  });
  it("sem ocupação da referência, sem projeção", () => {
    expect(projecaoFechamento({ occ: null, occFinal: 0.5 }, 3, 18, 100)).toBeNull();
  });
});

describe("preço na mesma antecedência", () => {
  it("diária média da referência lê só as diárias vendidas até D-N", () => {
    const h = row([60, 60, 5], undefined, 10, [50, 50, 200]);
    expect(diariaEmL([h], 30)).toBe(50);
    expect(diariaEmL([h], 0)).toBe(100);
  });
  it("diferença % da diária de hoje contra a da referência", () => {
    expect(difDiariaPct(110, 100)).toBeCloseTo(10, 5);
    expect(difDiariaPct(80, 100)).toBeCloseTo(-20, 5);
    expect(difDiariaPct(null, 100)).toBeNull();
    expect(difDiariaPct(100, 0)).toBeNull();
  });
});

describe("ritmo recente", () => {
  it("conta as diárias criadas nos últimos 7 dias antes da antecedência", () => {
    // em D-10: uma criada em D-12 (dentro da janela D-17..D-10)
    expect(ritmoRecente([row([30, 30, 12, 5])], 10, 7)).toBe(1);
    expect(ritmoRecente([row([30, 30, 12, 5])], 10, 14)).toBe(1);
  });
  it("cancelada depois conta se estava ativa na época", () => {
    // [12, 5]: criada em D-12 e cancelada em D-5 (depois de D-10) → estava ativa em D-10
    expect(ritmoRecente([row([30, 30, 12, 5], [[12, 5]])], 10, 7)).toBe(2);
    // [14, 15]: cancelada em D-15 (antes de D-10) → não conta
    expect(ritmoRecente([row([30, 30, 12], [[14, 15]])], 10, 7)).toBe(1);
  });
  it("soma as categorias e indisponível em data encerrada ou antes do início da base", () => {
    expect(ritmoRecente([row([12]), row([11])], 10, 7)).toBe(2);
    expect(ritmoRecente([row([12])], 0, 7)).toBeNull();
    expect(ritmoRecente([row([12])], 10, 14, { date: "2024-01-20", de: "2024-01-01" })).toBeNull();
    expect(ritmoRecente([row([12])], 10, 14, { date: "2025-01-20", de: "2024-01-01" })).toBe(1);
  });
});

describe("aviso de lotação da referência", () => {
  it("devolve a maior antecedência em que chegou a 100%", () => {
    expect(lotouEm([row([30, 20], undefined, 2)])).toBe(20);
    expect(lotouEm([row([30, 30], undefined, 2)])).toBe(30);
  });
  it("sem lotar antes de D-0, null", () => {
    expect(lotouEm([row([30, 20], undefined, 3)])).toBeNull();
    expect(lotouEm([row([0, 0], undefined, 2)])).toBeNull();
  });
  it("curva da referência e primeiro ponto cheio", () => {
    const c = curvaReferencia([row([30, 20], undefined, 2)], [30, 20, 0]);
    expect(c.map((p) => p.occ)).toEqual([0.5, 1, 1]);
    expect(primeiroCheio(c)?.L).toBe(20);
    expect(primeiroCheio(curvaReferencia([row([30], undefined, 4)], [30, 0]))).toBeNull();
  });
});

describe("aviso de frota pequena", () => {
  it("avisa abaixo do limite (padrão 30) com o valor de cada carro", () => {
    expect(avisoFrotaPequena(18)?.ppPorCarro).toBeCloseTo(5.56, 2);
    expect(avisoFrotaPequena(18)?.texto).toBe("cada carro vale 5,6 p.p.; a esperada oscila muito");
  });
  it("não avisa a partir do limite, que é configurável", () => {
    expect(avisoFrotaPequena(30)).toBeNull();
    expect(avisoFrotaPequena(50, 60)).not.toBeNull();
    expect(avisoFrotaPequena(0)).toBeNull();
  });
});

describe("curva com as referências", () => {
  it("uma série por outra referência, tooltip em carros e marca em 100%", () => {
    const pontos = [
      { label: "D-30", L: 30, atual: 0.2, esperada: 0.5 },
      { label: "D-20", L: 20, atual: null, esperada: 1 },
    ];
    const usada = { date: "2025-01-07", chosen: true, occ: 1, hist: [row([30, 20], undefined, 2)] };
    const outra = { date: "2026-01-06", chosen: false, occ: 0.5, hist: [row([30, 30], undefined, 4)] };
    const c = curvaDetalhe(pontos, [usada, outra] as never, 10);
    expect(c.extras).toEqual([{ key: "ref0", date: "2026-01-06" }]);
    expect(c.data[0]).toMatchObject({ esperada: 50, esperadaCarros: 5, atualCarros: 2, ref0: 50, ref0Carros: 5, capacidade: 10 });
    expect(c.marcas).toEqual([{ key: "esperada", label: "D-20" }]);
  });
});

describe("preço de venda atual", () => {
  const r = (c: string, f: number): PaceRow => ({ d: "2027-01-28", c, f, a: [] }) as PaceRow;
  const t = new Map([["2027-01-28|A", 60], ["2027-01-28|B", 100]]);
  it("uma categoria: a tarifa dela", () => {
    expect(precoVendaAtual([r("A", 10)], t, "2027-01-28")).toMatchObject({ valor: 60, cobertas: 1, total: 1 });
  });
  it("várias: média ponderada pela frota, só das que têm tarifa", () => {
    const p = precoVendaAtual([r("A", 30), r("B", 10), r("C", 50)], t, "2027-01-28")!;
    expect(p.valor).toBeCloseTo((60 * 30 + 100 * 10) / 40, 5);
    expect(p).toMatchObject({ cobertas: 2, total: 3, faltam: ["C"] });
  });
  it("sem tarifa para a data, null", () => {
    expect(precoVendaAtual([r("C", 5)], t, "2027-01-28")).toBeNull();
    expect(precoVendaAtual([r("A", 10)], t, "2027-02-01")).toBeNull();
  });
});
