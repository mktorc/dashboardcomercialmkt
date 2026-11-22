import { describe, expect, it } from "vitest";
import type { Bloco } from "./decisao";
import {
  CONFIG_PADRAO,
  ajustarBloco,
  construirPerfil,
  lerPadrao,
  ordenarPorPadrao,
  tipoChave,
  type DecisaoRegistrada,
} from "./padrao-aceite";

const AGORA = new Date("2026-11-22T12:00:00Z");
const reg = (p: Partial<DecisaoRegistrada> = {}): DecisaoRegistrada => ({
  decided_at: "2026-11-20T12:00:00Z",
  recommended_action: "baixar",
  occ_signal: "abaixo",
  market_signal: "acima",
  signals: { janela: "agora" },
  decision: "aceitou",
  applied_price: null,
  suggested_min: 70,
  suggested_max: 80,
  ...p,
});
const bloco = (p: { key: string; acao?: string; occ?: string; merc?: string; janela?: string }) =>
  ({
    key: p.key,
    acao: p.acao ?? "baixar",
    janela: p.janela ?? "agora",
    sugMin: 70,
    sugMax: 80,
    itens: [{ lead: 30, occ: p.occ ?? "abaixo", sinalMerc: p.merc ?? "acima" }],
  }) as unknown as Bloco;
const T = { grupo: "baixar" as const, janela: "agora", occ: "abaixo", merc: "acima" };

describe("padrão de aceite", () => {
  it("sem decisões suficientes não influencia", () => {
    const p = construirPerfil([reg(), reg()], CONFIG_PADRAO, AGORA);
    expect(lerPadrao(p, T)).toBeNull();
  });
  it("tipo sempre aceito sobe; sempre ignorado desce e é marcado", () => {
    const regs = [
      ...Array.from({ length: 6 }, () => reg()),
      ...Array.from({ length: 6 }, () =>
        reg({
          recommended_action: "subir",
          occ_signal: "acima",
          market_signal: "abaixo",
          decision: "ignorou",
        }),
      ),
    ];
    const p = construirPerfil(regs, CONFIG_PADRAO, AGORA);
    expect(lerPadrao(p, T)!.tendencia).toBe("aceita");
    const sub = lerPadrao(p, { grupo: "subir", janela: "agora", occ: "acima", merc: "abaixo" })!;
    expect(sub.tendencia).toBe("ignora");
    expect(sub.texto).toMatch(/não mexer/);
    const ord = ordenarPorPadrao(
      [bloco({ key: "s", acao: "subir", occ: "acima", merc: "abaixo" }), bloco({ key: "b" })],
      p,
    );
    expect(ord.map((b) => b.key)).toEqual(["b", "s"]);
  });
  it("usa ação + janela quando o tipo exato tem poucas decisões", () => {
    const regs = Array.from({ length: 6 }, (_, i) =>
      reg({ occ_signal: i % 2 ? "dentro" : "abaixo" }),
    );
    const l = lerPadrao(construirPerfil(regs, CONFIG_PADRAO, AGORA), { ...T, occ: "acima" })!;
    expect(l.exato).toBe(false);
  });
  it("decisões antigas pesam menos e zerar ignora as anteriores", () => {
    const velhas = Array.from({ length: 6 }, () => reg({ decided_at: "2025-11-22T12:00:00Z" }));
    expect(lerPadrao(construirPerfil(velhas, CONFIG_PADRAO, AGORA), T)).toBeNull();
    const regs = Array.from({ length: 6 }, () => reg());
    const p = construirPerfil(regs, { ...CONFIG_PADRAO, zeradoEm: "2026-11-21T00:00:00Z" }, AGORA);
    expect(p.total).toBe(0);
  });
  it("tipo desligado não aprende", () => {
    const regs = Array.from({ length: 6 }, () => reg());
    const p = construirPerfil(regs, { ...CONFIG_PADRAO, desligados: [tipoChave(T)] }, AGORA);
    expect(lerPadrao(p, T)).toBeNull();
  });
  it("aprende o preço: sempre 10% abaixo do sugerido em Baixar", () => {
    const regs = Array.from({ length: 6 }, () => reg({ decision: "ajustou", applied_price: 72 }));
    const { bloco: b, ajuste } = ajustarBloco(
      bloco({ key: "x" }),
      construirPerfil(regs, CONFIG_PADRAO, AGORA),
    );
    expect(ajuste!.razao).toBeCloseTo(0.9);
    expect([b.sugMin, b.sugMax]).toEqual([63, 72]);
  });
  it("ajuste de preço respeita o teto e pode ser desligado", () => {
    const regs = Array.from({ length: 6 }, () => reg({ decision: "ajustou", applied_price: 20 }));
    const p = construirPerfil(regs, CONFIG_PADRAO, AGORA);
    expect(ajustarBloco(bloco({ key: "x" }), p).ajuste!.razao).toBe(0.75);
    const off = construirPerfil(regs, { ...CONFIG_PADRAO, ajustarPreco: false }, AGORA);
    expect(ajustarBloco(bloco({ key: "x" }), off).ajuste).toBeNull();
  });
});
