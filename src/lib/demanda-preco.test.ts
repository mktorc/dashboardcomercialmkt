import { describe, expect, it } from "vitest";
import {
  TODAS,
  adrAntecedencia,
  alertas,
  anoAntes,
  horaNY,
  indiceSazonal,
  pickup,
  prepararReservas,
  preco,
  resumoProximos,
  sazonalidade,
  type ReservaRow,
} from "./demanda-preco";

let seq = 0;
function row(p: Partial<ReservaRow> & { pick_up_at: string; created_at: string }): ReservaRow {
  seq += 1;
  return {
    reservation_id: String(seq),
    status: "confirmed",
    car_category: "Midsize Suv",
    rental_days: 4,
    total_amount: 500,
    rack_rate: 400,
    discount_amount: 0,
    pick_up_location_id: 1,
    ...p,
  };
}

describe("preparação", () => {
  it("só Orlando (inclui TPA), só demanda, cortesia fora do preço", () => {
    const rs = prepararReservas([
      row({ pick_up_at: "2025-03-10T10:00:00+00:00", created_at: "2025-03-01T15:00:00Z" }),
      row({
        pick_up_at: "2025-03-10T10:00:00+00:00",
        created_at: "2025-03-01T15:00:00Z",
        pick_up_location_id: 4,
      }),
      row({
        pick_up_at: "2025-03-10T10:00:00+00:00",
        created_at: "2025-03-01T15:00:00Z",
        pick_up_location_id: 2,
      }),
      row({
        pick_up_at: "2025-03-10T10:00:00+00:00",
        created_at: "2025-03-01T15:00:00Z",
        pick_up_location_id: null,
      }),
      row({
        pick_up_at: "2025-03-10T10:00:00+00:00",
        created_at: "2025-03-01T15:00:00Z",
        status: "cancelled",
      }),
      row({
        pick_up_at: "2025-03-10T10:00:00+00:00",
        created_at: "2025-03-01T15:00:00Z",
        status: "cancelled-paid",
      }),
      row({
        pick_up_at: "2025-03-10T10:00:00+00:00",
        created_at: "2025-03-01T15:00:00Z",
        total_amount: 0,
        rack_rate: 0,
      }),
    ]);
    expect(rs).toHaveLength(4);
    const p = preco(rs);
    expect(p.pagas).toBe(3);
    expect(p.adr).toBe(100);
  });

  it("data de reserva no horário de Orlando define a antecedência", () => {
    // 02:00 UTC de 02/03 ainda é 01/03 em Orlando.
    expect(horaNY("2025-03-02T02:00:00Z")).toBe("2025-03-01T21:00");
    const [r] = prepararReservas([
      row({ pick_up_at: "2025-03-10T10:00:00+00:00", created_at: "2025-03-02T02:00:00Z" }),
    ]);
    expect(r!.antecedencia).toBe(9);
    expect(anoAntes("2024-02-29T10:00")).toBe("2023-02-28T10:00");
  });

  it("criada depois da retirada fica fora do pickup", () => {
    const [r] = prepararReservas([
      row({ pick_up_at: "2025-03-01T10:00:00+00:00", created_at: "2025-03-05T15:00:00Z" }),
    ]);
    expect(r!.usarPickup).toBe(false);
  });
});

describe("sazonalidade", () => {
  it("índice ignora anos excluídos e incompletos", () => {
    const pontos = [];
    for (const ano of [2019, 2020, 2021, 2022])
      for (let m = 1; m <= 12; m++)
        pontos.push({
          mes: `${ano}-${String(m).padStart(2, "0")}-01`,
          valor: ano === 2020 ? 1 : m === 12 ? 200 : 100,
        });
    const idx = indiceSazonal(
      pontos.filter((p) => !(p.mes.startsWith("2022") && p.mes > "2022-06")),
    );
    expect(idx[11]).toBeCloseTo(200 / (1300 / 12));
  });
});

describe("antecedência e pickup", () => {
  const rows = [
    row({
      pick_up_at: "2025-09-10T10:00:00+00:00",
      created_at: "2025-09-08T15:00:00Z",
      rack_rate: 400,
    }), // 0–7: 100/dia
    row({
      pick_up_at: "2025-09-10T10:00:00+00:00",
      created_at: "2025-05-01T15:00:00Z",
      rack_rate: 480,
    }), // 90+: 120/dia
  ];
  it("ADR por faixa e prêmio contra a última hora", () => {
    const f = adrAntecedencia(prepararReservas(rows), "2025-11-20");
    expect(f[0]!.adr).toBe(100);
    expect(f[4]!.adr).toBe(120);
    expect(f[4]!.premio).toBeCloseTo(0.2);
  });

  it("on the books vs mesma data do ano anterior, com ADR", () => {
    const base = [
      row({ pick_up_at: "2024-06-10T10:00:00+00:00", created_at: "2024-05-01T12:00:00Z" }),
    ];
    for (let i = 0; i < 12; i++)
      base.push(
        row({
          pick_up_at: "2025-01-15T10:00:00+00:00",
          created_at: i < 10 ? "2024-10-01T12:00:00Z" : "2024-12-20T12:00:00Z",
          rack_rate: 400,
        }),
      );
    for (let i = 0; i < 15; i++)
      base.push(
        row({
          pick_up_at: "2026-01-15T10:00:00+00:00",
          created_at: "2025-10-01T12:00:00Z",
          rack_rate: 360,
        }),
      );
    const rs = prepararReservas(base);
    const jan = pickup(rs, "2025-11-01", 4).find(
      (p) => p.categoria === TODAS && p.mes === "2026-01",
    )!;
    expect(jan.otb).toBe(15);
    expect(jan.otbAnoAnterior).toBe(10);
    expect(jan.finalAnoAnterior).toBe(12);
    expect(jan.razao).toBeCloseTo(1.5);
    expect(jan.adr).toBe(90);
    expect(jan.adrAnoAnterior).toBe(100);
    const r = resumoProximos(rs, "2025-11-01", 3);
    expect(r.otb).toBe(15);
    expect(r.otbAnoAnterior).toBe(10);

    const al = alertas(
      rs,
      [],
      "2025-11-01",
      sazonalidade(rs, [], "2025-11-01"),
      pickup(rs, "2025-11-01", 4),
    );
    expect(
      al.some(
        (a) =>
          a.acao === "Subir preço da categoria" &&
          a.categoria === "Midsize Suv" &&
          a.mes === "2026-01",
      ),
    ).toBe(true);
  });

  it("alerta de última hora quando 0–7 dias paga menos que as outras faixas", () => {
    const base = [];
    for (let i = 0; i < 10; i++)
      base.push(
        row({
          pick_up_at: "2025-09-10T10:00:00+00:00",
          created_at: "2025-09-08T15:00:00Z",
          rack_rate: 280,
        }),
      );
    for (let i = 0; i < 10; i++)
      base.push(
        row({
          pick_up_at: "2025-09-10T10:00:00+00:00",
          created_at: "2025-08-01T15:00:00Z",
          rack_rate: 400,
        }),
      );
    const rs = prepararReservas(base);
    const al = alertas(rs, [], "2025-11-20", sazonalidade(rs, [], "2025-11-20"), []);
    const ult = al.filter((a) => a.acao === "Revisar desconto de última hora");
    expect(ult.map((a) => a.categoria).sort()).toEqual(["Midsize Suv", TODAS]);
    expect(ult[0]!.valor).toBeCloseTo(-0.3);
  });
});

describe("exibição", () => {
  it("SUV em maiúsculas", async () => {
    const { nomeCategoria } = await import("./demanda-preco");
    expect(nomeCategoria("Midsize Suv")).toBe("Midsize SUV");
    expect(nomeCategoria("SUV Executive 7 Seats")).toBe("SUV Executive 7 Seats");
    expect(nomeCategoria("Mini Van 8 Seats")).toBe("Mini Van 8 Seats");
  });
});
