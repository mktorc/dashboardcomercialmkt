import { describe, expect, it } from "vitest";
import { canAccess, canSeePricing, homeOf, type Access } from "./roles";

const acc = (modules: Access["modules"], admin = false): Access => ({
  modules,
  admin,
  canPay: false,
});

describe("acesso por módulo", () => {
  it("Admin vê tudo, inclusive Configurações", () => {
    for (const p of ["dashboard", "comercial", "comissoes", "fila-leads", "configuracoes"] as const)
      expect(canAccess(acc([], true), p)).toBe(true);
  });
  it("só vê os módulos marcados", () => {
    const a = acc(["comercial", "fila-leads"]);
    expect(canAccess(a, "comercial")).toBe(true);
    expect(canAccess(a, "fila-leads")).toBe(true);
    expect(canAccess(a, "dashboard")).toBe(false);
    expect(canAccess(a, "comissoes")).toBe(false);
  });
  it("Configurações só com Admin", () => {
    expect(canAccess(acc(["dashboard"]), "configuracoes")).toBe(false);
  });
  it("sem cadastro não vê nada", () => {
    expect(canAccess(null, "dashboard")).toBe(false);
  });
  it("home é o primeiro módulo liberado", () => {
    expect(homeOf(acc(["comissoes"]))).toBe("/app/comissoes/a-pagar");
    expect(homeOf(acc(["comissoes", "comercial"]))).toBe("/comercial");
    expect(homeOf(acc([]))).toBe("/app");
    expect(homeOf(acc([], true))).toBe("/app");
  });
});

describe("página oculta de precificação", () => {
  it("só o e-mail autorizado enxerga, ignorando caixa e espaços", () => {
    expect(canSeePricing("marketing@orlandorentcar.com")).toBe(true);
    expect(canSeePricing("  Marketing@OrlandoRentCar.com ")).toBe(true);
  });
  it("nenhum outro e-mail ou perfil enxerga", () => {
    expect(canSeePricing("comercial@orlandorentcar.com")).toBe(false);
    expect(canSeePricing("marketing@orlandorentcar.com.br")).toBe(false);
    expect(canSeePricing(null)).toBe(false);
    expect(canSeePricing(undefined)).toBe(false);
  });
});
