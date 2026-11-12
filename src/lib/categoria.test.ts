import { describe, expect, it } from "vitest";
import { normCategoria, rateKey } from "./categoria";

describe("chave de categoria", () => {
  it("ignora caixa, espaços e acentos, mas não confunde categorias diferentes", () => {
    expect(normCategoria("Fullsize Suv")).toBe(normCategoria("Fullsize SUV"));
    expect(normCategoria(" Fullsize  SUV ")).toBe(normCategoria("FULLSIZE SUV"));
    expect(normCategoria("Full size SUV")).toBe(normCategoria("Fullsize Suv"));
    expect(normCategoria("Utilitário")).toBe(normCategoria("utilitario"));
    expect(normCategoria("SUV Executive 7 Seats")).not.toBe(normCategoria("SUV Executive 8 Seats"));
    expect(normCategoria("Midsize Suv")).not.toBe(normCategoria("Fullsize Suv"));
  });
  it("rateKey junta data e categoria normalizada", () => {
    expect(rateKey("2027-01-12", "Fullsize SUV")).toBe(rateKey("2027-01-12", "Fullsize Suv"));
    expect(rateKey("2027-01-12", "A")).not.toBe(rateKey("2027-01-13", "A"));
  });
});
