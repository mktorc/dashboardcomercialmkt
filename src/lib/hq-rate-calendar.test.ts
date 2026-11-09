import { describe, expect, it } from "vitest";
import { changedRates, dailyRatesOf } from "./hq-rate-calendar";

const CATS = new Map([
  [2, "Midsize Suv"],
  [3, "Midsize Sedan"],
]);
const season = (rates: object[], o: object = {}) => ({
  name: "2027",
  date_start: "2027-02-01T00:00:00.000000Z",
  date_end: "2027-02-01T00:00:00.000000Z",
  active: true,
  deleted_at: null,
  rates,
  ...o,
});
const rate = (cls: number, daily: string | null, o: object = {}) => ({
  vehicle_class_id: cls,
  daily_rate: daily,
  currency: "usd",
  rate_type_id: null,
  ...o,
});

describe("calendário de tarifas do HQ", () => {
  it("extrai a diária de cada categoria nossa, com moeda", () => {
    const r = dailyRatesOf(season([rate(2, "75.8000000"), rate(3, "62.32")]), CATS);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({
      pickup_date: "2027-02-01",
      category: "Midsize Suv",
      daily_rate: 75.8,
      currency: "USD",
    });
  });
  it("ignora temporada de vários dias, inativa ou apagada", () => {
    const rates = [rate(2, "70")];
    expect(dailyRatesOf(season(rates, { date_end: "2027-02-05T00:00:00Z" }), CATS)).toEqual([]);
    expect(dailyRatesOf(season(rates, { active: false }), CATS)).toEqual([]);
    expect(dailyRatesOf(season(rates, { deleted_at: "2027-01-01" }), CATS)).toEqual([]);
  });
  it("ausência, zero e categoria fora das nossas não viram tarifa", () => {
    const r = dailyRatesOf(season([rate(2, null), rate(3, "0"), rate(99, "50")]), CATS);
    expect(r).toEqual([]);
  });
  it("duas tarifas para a mesma categoria na data é ambíguo e não publica", () => {
    expect(
      dailyRatesOf(season([rate(2, "70"), rate(2, "80"), rate(3, "60")]), CATS).map(
        (x) => x.category,
      ),
    ).toEqual(["Midsize Sedan"]);
  });
  it("arredonda a diária para 2 casas, como o banco, para não reinserir tarifa que não mudou", () => {
    const fresh = dailyRatesOf(season([rate(2, "75.7894737")]), CATS);
    expect(fresh[0]!.daily_rate).toBe(75.79);
    const guardada = new Map([["2027-02-01|Midsize Suv", { daily_rate: 75.79, currency: "USD" }]]);
    expect(changedRates(fresh, guardada)).toEqual([]);
  });
  it("só grava o que mudou", () => {
    const fresh = dailyRatesOf(season([rate(2, "75.8"), rate(3, "62.32")]), CATS);
    const latest = new Map([["2027-02-01|Midsize Suv", { daily_rate: 75.8, currency: "USD" }]]);
    expect(changedRates(fresh, latest).map((x) => x.category)).toEqual(["Midsize Sedan"]);
    latest.set("2027-02-01|Midsize Suv", { daily_rate: 70, currency: "USD" });
    expect(changedRates(fresh, latest)).toHaveLength(2);
  });
});
