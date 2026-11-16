import { describe, expect, it } from "vitest";
import { pricingTabDocument, splitPricingReport } from "./pricing-report";

const HTML =
  "<!doctype html><html><head><style>body{margin:0}</style></head><body><main>" +
  '<section id="resumo"><h2>Resumo executivo</h2><p>a</p></section>' +
  '<section id="ocupacao"><h2>A. Ocupação e frota</h2><table></table></section>' +
  '<section id="nova"><h2>Seção nova</h2><p>b</p></section></main></body></html>';

describe("relatório de precificação em abas", () => {
  it("separa uma aba por seção, com rótulo curto quando conhecido", () => {
    const { css, tabs } = splitPricingReport(HTML);
    expect(css).toBe("body{margin:0}");
    expect(tabs.map((t) => t.label)).toEqual(["Resumo", "Ocupação e frota", "Seção nova"]);
    expect(tabs[0]?.html).toBe("<p>a</p>");
  });
  it("monta o documento da aba sem script", () => {
    const { css, tabs } = splitPricingReport(HTML);
    const doc = pricingTabDocument(css, tabs[0]!);
    expect(doc).toContain("Resumo executivo");
    expect(doc).not.toContain("<script");
  });
  it("sem seções, não há abas", () => {
    expect(splitPricingReport("<p>vazio</p>").tabs).toEqual([]);
  });
});
