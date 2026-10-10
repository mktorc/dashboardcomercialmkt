import { describe, expect, it } from "vitest";
import { canAccess } from "./roles";

describe("permissões por perfil", () => {
  it("superadmin vê todas as abas", () => {
    for (const p of ["dashboard", "comercial", "comercial-operacional", "configuracoes"] as const)
      expect(canAccess("superadmin", p)).toBe(true);
  });
  it("Comercial - Equipe só vê Comercial Operacional", () => {
    expect(canAccess("comercial", "comercial-operacional")).toBe(true);
    expect(canAccess("comercial", "comercial")).toBe(false);
    expect(canAccess("comercial", "dashboard")).toBe(false);
    expect(canAccess("comercial", "configuracoes")).toBe(false);
  });
  it("Mkt - Equipe só vê Marketing", () => {
    expect(canAccess("marketing", "dashboard")).toBe(true);
    expect(canAccess("marketing", "comercial-operacional")).toBe(false);
    expect(canAccess("marketing", "configuracoes")).toBe(false);
  });
});
