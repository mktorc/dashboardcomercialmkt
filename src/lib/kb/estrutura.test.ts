import { describe, expect, it } from "vitest";
import { organizeKb, type EArticle } from "./estrutura";

const art = (id: string, category: string, title: string, src = "doc"): EArticle => ({
  id,
  category,
  title,
  summary: title,
  keywords: "",
  blocks: [{ t: "p", text: `Modelos de exemplo: ${title}.` }],
  sources: [src],
  areas: ["comercial"],
});
const sources = {
  doc: { name: "Cópia de Documento (1).pdf", link: "https://drive/doc" },
  esc: { name: "Cópia de Cadillac Luxury.jpeg", link: "https://drive/esc" },
  sub: { name: "Cópia de Suburban 7 Lugares.mp4", link: "https://drive/sub" },
  man: { name: "Cópia de MANUAL INTERNO.docx", link: "https://drive/man" },
  hq: { name: "Cópia de Introdução HQ (1).mp4", link: "https://drive/hq" },
};
const cats = [
  { id: "comercial-pagamentos", title: "Pagamentos", description: "" },
  { id: "comercial-frota", title: "Frota e Categorias", description: "" },
  { id: "comercial-sistemas", title: "Sistemas (HQ e CRM)", description: "" },
];

describe("organizeKb", () => {
  const r = organizeKb(
    [
      art("condicoes-de-pagamento-pt", "comercial-pagamentos", "Condições de pagamento (PT)"),
      art("condicoes-de-pagamento-es-2", "comercial-pagamentos", "Condições de pagamento (ES)"),
      art("conheca-nossa-frota-pt", "comercial-frota", "Conheça nossa frota (PT)"),
      art("categoria-luxury-pt", "comercial-frota", "Categoria Luxury (PT)"),
      art("categoria-suv-executive-pt", "comercial-frota", "Categoria SUV Executive (PT)"),
      art("categoria-furgoneta-es", "comercial-frota", "Categoria Furgoneta (ES)"),
      art("veiculo-cadillac-escalade", "comercial-frota", "Veículo Cadillac Escalade", "esc"),
      art("chevrolet-suburban-7", "comercial-frota", "Chevrolet Suburban 7 Lugares", "sub"),
      art("categoria-suv-executive", "comercial-frota", "Categoria SUV Executive", "man"),
      art("painel-inicial", "comercial-sistemas", "Painel inicial", "hq"),
    ],
    cats,
    sources,
  );
  const byId = (id: string) => r.articles.find((a) => a.id === id);

  it("não deixa vídeo/foto de veículo solto: vai para a categoria", () => {
    expect(r.articles.map((a) => a.id)).not.toContain("veiculo-cadillac-escalade");
    const lux = byId("frota-luxury-comercial")!;
    expect(lux.blocks).toContainEqual(
      expect.objectContaining({ t: "file", name: "Cadillac Luxury" }),
    );
    const exec = byId("frota-suv-executive-comercial")!;
    expect(exec.blocks).toContainEqual({ t: "h", text: "Regras da categoria" });
    expect(exec.sources).toEqual(expect.arrayContaining(["sub", "man"]));
  });

  it("furgoneta é a Van 12 lugares; visão geral vem primeiro", () => {
    expect(byId("frota-van-comercial")).toBeTruthy();
    const frota = r.articles.filter((a) => a.category === "comercial-frota").map((a) => a.title);
    expect(frota[0]).toBe("Visão geral da frota");
  });

  it("condições de pagamento PT e ES numa página só", () => {
    const p = byId("pagamento-condicoes")!;
    const hs = p.blocks.filter((b) => b.t === "h").map((b) => b["text"]);
    expect(hs).toEqual(["Do material em português", "Do material em espanhol"]);
  });

  it("Sistemas vira tópico com HQ dentro; painel inicial é do HQ e traz o vídeo", () => {
    const sis = r.categories.find((c) => c.id === "comercial-sistemas")!;
    expect(sis.title).toBe("Sistemas");
    const hq = byId("hq-introducao")!;
    expect(r.categories.find((c) => c.id === hq.category)).toMatchObject({
      title: "HQ",
      parent: "comercial-sistemas",
    });
    expect(hq.blocks[0]).toMatchObject({ t: "file", kind: "video", name: "Introdução HQ" });
    expect(r.categories[0]!.id).toBe("comercial-sistemas");
  });
});
