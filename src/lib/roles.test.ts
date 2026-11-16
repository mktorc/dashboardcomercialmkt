import { describe, expect, it } from "vitest";
import { canAccess, canSeePricing } from "./roles";

const TABS = ["dashboard", "comercial", "comercial-operacional"] as const;

describe("permissões por perfil", () => {
  it("superadmin vê todas as abas", () => {
    for (const p of [...TABS, "configuracoes"] as const)
      expect(canAccess("superadmin", p)).toBe(true);
  });
  it("equipes veem todas as abas de dados", () => {
    for (const r of ["comercial", "marketing"] as const)
      for (const p of TABS) expect(canAccess(r, p)).toBe(true);
  });
  it("comercial_gerencial só vê o menu Comercial", () => {
    expect(canAccess("comercial_gerencial", "comercial")).toBe(true);
    expect(canAccess("comercial_gerencial", "comercial-operacional")).toBe(true);
    expect(canAccess("comercial_gerencial", "dashboard")).toBe(false);
    expect(canAccess("comercial_gerencial", "configuracoes")).toBe(false);
  });
  it("só superadmin acessa Configurações", () => {
    expect(canAccess("comercial", "configuracoes")).toBe(false);
    expect(canAccess("marketing", "configuracoes")).toBe(false);
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
