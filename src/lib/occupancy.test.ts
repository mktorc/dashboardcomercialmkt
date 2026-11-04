import { describe, expect, it } from "vitest";
import { computeOccupancy, occupancyMonthVariation, segmentDays, vehicleDays } from "./occupancy";

describe("computeOccupancy", () => {
  it("conta só os dias da reserva dentro de cada mês", () => {
    // 10 carros; reserva de 28/out a 05/nov (8 dias)
    const r = [{ pick_up_at: "2026-10-28T00:00:00Z", return_at: "2026-11-05T00:00:00Z" }];
    const m = computeOccupancy(r, 10, new Date("2026-10-07T12:00:00Z"));
    expect(m[0]!.carDays).toBe(4);
    expect(m[0]!.rate).toBeCloseTo(4 / 310);
    expect(m[1]!.carDays).toBe(4);
    expect(m[1]!.rate).toBeCloseTo(4 / 300);
    expect(m[2]!.carDays).toBe(0);
  });

  it("gera os cinco meses de mês -2 a mês +2 com nome e ano", () => {
    const months = computeOccupancy([], 10, new Date("2026-10-08T12:00:00Z"), 5, -2);
    expect(months.map((month) => month.label)).toEqual([
      "ago/2026",
      "set/2026",
      "out/2026",
      "nov/2026",
      "dez/2026",
    ]);
  });

  it("compara meses-calendário completos", () => {
    const reservations = [
      { pick_up_at: "2026-06-01T00:00:00Z", return_at: "2026-06-16T00:00:00Z" },
      { pick_up_at: "2026-07-01T00:00:00Z", return_at: "2026-08-01T00:00:00Z" },
    ];
    const months = computeOccupancy(reservations, 1, new Date("2026-07-15T12:00:00Z"), 2, -1);

    expect(months[0]?.rate).toBe(0.5);
    expect(months[1]?.rate).toBe(1);
    expect(occupancyMonthVariation(months[1], months[0])).toBe(100);
  });
});

describe("segmentDays (critério do relatório de Utilização do HQ)", () => {
  const nov = Date.UTC(2026, 10, 1);
  const dec = Date.UTC(2026, 11, 1);

  it("conta 1 dia para qualquer trecho que encosta em um único dia", () => {
    const day = Date.UTC(2026, 10, 15);
    // devolução às 04:30 e retirada às 19:30 do mesmo dia contam, cada uma, 1 dia
    expect(segmentDays("2026-11-14T10:00:00Z", "2026-11-15T04:30:00Z", day, day + 86400000)).toBe(1);
    expect(segmentDays("2026-11-15T19:30:00Z", "2026-11-24T15:05:00Z", day, day + 86400000)).toBe(1);
  });

  it("não conta trecho fora do período", () => {
    expect(segmentDays("2026-10-20T10:00:00Z", "2026-10-31T23:59:00Z", nov, dec)).toBe(0);
    expect(segmentDays("2026-12-01T00:00:00Z", "2026-12-05T10:00:00Z", nov, dec)).toBe(0);
  });

  it("dá tolerância de 5 horas além do dia cheio", () => {
    // 9 dias + 5 h: 9 dias; 9 dias + 6 h: 10 dias
    expect(segmentDays("2026-11-02T10:00:00Z", "2026-11-11T15:00:00Z", nov, dec)).toBe(9);
    expect(segmentDays("2026-11-02T10:00:00Z", "2026-11-11T16:00:00Z", nov, dec)).toBe(10);
  });

  it("corta o trecho no limite do período antes de arredondar", () => {
    // retirada em 29/11 às 16:30 e devolução em 07/12: 31,5 h em novembro => 2 dias
    expect(segmentDays("2026-11-29T16:30:00Z", "2026-12-07T19:00:00Z", nov, dec)).toBe(2);
  });

  it("conta o dia de uma retirada feita à noite", () => {
    // 4 h restantes no dia da retirada ainda contam 1 dia no período de um dia só
    expect(segmentDays("2026-11-30T20:00:00Z", "2026-12-08T12:00:00Z", Date.UTC(2026, 10, 30), dec)).toBe(1);
  });
});

describe("vehicleDays", () => {
  const nov = Date.UTC(2026, 10, 1);
  const dec = Date.UTC(2026, 11, 1);

  it("conta só os dias a partir da entrada na frota", () => {
    expect(vehicleDays({ entry_date: "2026-11-15T00:00:00Z", exit_date: null }, nov, dec)).toBe(16);
    expect(vehicleDays({ entry_date: "2026-12-01T00:00:00Z", exit_date: null }, nov, dec)).toBe(0);
    expect(vehicleDays({ entry_date: "2025-01-01T00:00:00Z", exit_date: null }, nov, dec)).toBe(30);
  });

  it("para de contar na saída", () => {
    expect(vehicleDays({ entry_date: "2025-01-01T00:00:00Z", exit_date: "2026-11-11T00:00:00Z" }, nov, dec)).toBe(10);
  });
});

describe("computeOccupancy com trechos e frota do HQ", () => {
  it("conta dois trechos quando o carro é trocado e usa a data de entrada dos veículos", () => {
    const today = new Date("2026-11-10T12:00:00Z");
    const segments = [
      { pick_up_at: "2026-11-01T10:00:00Z", return_at: "2026-11-03T19:05:00Z" },
      { pick_up_at: "2026-11-03T19:05:00Z", return_at: "2026-11-05T10:00:00Z" },
    ];
    const fleet = [
      { entry_date: "2025-01-01T00:00:00Z", exit_date: null },
      { entry_date: "2026-11-21T00:00:00Z", exit_date: null },
    ];
    const [nov] = computeOccupancy(segments, fleet, today, 1);
    // trecho 1: 3 dias e 9 h => 3; trecho 2: 1 dia e 15 h => 2; capacidade 30 + 10 dias
    expect(nov!.carDays).toBe(5);
    expect(nov!.capacity).toBe(40);
    expect(nov!.rate).toBeCloseTo(5 / 40);
  });
});
