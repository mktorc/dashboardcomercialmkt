import { describe, expect, it } from "vitest";
import {
  DECISAO_PADRAO as C,
  COR_ACAO,
  COR_SELO,
  acaoDoDia,
  agruparBlocos,
  calendarioAcoes,
  decidirHoje,
  difFaixaPct,
  impacto,
  receitas,
  aindaCedo,
  TEXTO_MUDANCA_PEQUENA,
  grupoDe,
  ETIQUETA_BLOCO,
  matrizOcupacaoMercado,
  movimentoPct,
  explicarConfianca,
  blocosPilares,
  etiquetaAcao,
  cabecalho,
  contexto,
  COR_BARRA,
  separarFila,
  linhaCompacta,
  etiquetas,
  COR_ETIQUETA,
  avisos,
  TEXTO_VERIFICAR_EQUIV,
  proximaAbertura,
  frases,
  dinheiro,
  selos,
  alvoPreco,
  confianca,
  decidir,
  evidencias,
  faixaOtima,
  firmeza,
  precoSugerido,
  regraAcao,
  resumoDia,
  sinalHistorico,
  sinalMercado,
  sinalOcc,
  urgencia,
  type DecisaoEntrada,
  type Regra,
} from "./decisao";
import type { PontoEpoca } from "./preco-analise";
import type { CapturaDecisao } from "./captura-categoria";

const pts = (n: number, diaria: number, revVeic: number): PontoEpoca[] =>
  Array.from({ length: n }, (_, i) => ({
    date: `2025-01-${String(i + 1).padStart(2, "0")}`,
    ano: "2025",
    diaria,
    revVeic,
    occ: 0.8,
  }));

describe("sinais", () => {
  it("ocupação: no ritmo vira dentro", () => {
    expect(sinalOcc("no-ritmo")).toBe("dentro");
    expect(sinalOcc("abaixo")).toBe("abaixo");
    expect(sinalOcc("acima")).toBe("acima");
  });
  it("histórico: faixa ampliada em ±5%", () => {
    const f = { de: 80, ate: 85 };
    expect(sinalHistorico(76, f)).toBe("dentro"); // 80×0,95 = 76
    expect(sinalHistorico(75.9, f)).toBe("abaixo");
    expect(sinalHistorico(89.25, f)).toBe("dentro"); // 85×1,05
    expect(sinalHistorico(89.3, f)).toBe("acima");
    expect(sinalHistorico(80, null)).toBe("sem-historico");
    expect(sinalHistorico(null, f)).toBe("sem-historico");
  });
  it("mercado: ±5% da mediana", () => {
    expect(sinalMercado(5)).toBe("alinhado");
    expect(sinalMercado(-5)).toBe("alinhado");
    expect(sinalMercado(5.1)).toBe("acima");
    expect(sinalMercado(-5.1)).toBe("abaixo");
    expect(sinalMercado(null)).toBe("sem-mercado");
  });
  it("faixa ótima: mês primeiro, depois sazonalidade, senão nada", () => {
    const mes = [...pts(5, 82, 50), ...pts(6, 92, 40)];
    expect(faixaOtima(mes, []).fonte).toBe("mes");
    expect(faixaOtima(mes, []).faixa).toMatchObject({ de: 80, ate: 85 });
    expect(faixaOtima(pts(4, 82, 50), pts(5, 97, 60))).toMatchObject({
      fonte: "sazonalidade",
      faixa: { de: 95 },
    });
    expect(faixaOtima(pts(4, 82, 50), pts(4, 97, 60))).toEqual({ faixa: null, fonte: null });
  });
});

describe("regra de ação", () => {
  const casos: [Parameters<typeof regraAcao>, string, string][] = [
    [["abaixo", "acima", "acima"], "baixar", "alta"],
    [["abaixo", "acima", "dentro"], "baixar-mediana", "media"],
    [["abaixo", "alinhado", "acima"], "baixar-pouco", "media"],
    [["abaixo", "alinhado", "dentro"], "acao-comercial", "alta"],
    [["abaixo", "alinhado", "abaixo"], "acao-comercial", "alta"],
    [["abaixo", "abaixo", "dentro"], "acao-comercial", "alta"],
    [["abaixo", "abaixo", "abaixo"], "acao-comercial", "alta"],
    [["dentro", "acima", "acima"], "manter", "alta"],
    [["acima", "abaixo", "abaixo"], "subir", "alta"],
    [["acima", "abaixo", "dentro"], "subir-pouco", "media"],
    [["acima", "alinhado", "dentro"], "subir-pouco", "media"],
    [["acima", "acima", "abaixo"], "manter", "alta"],
    [["abaixo", "sem-mercado", "sem-historico"], "verificar", "baixa"],
    // padrões aprovados para as combinações não cobertas
    [["abaixo", "abaixo", "acima"], "acao-comercial", "baixa"],
    [["abaixo", "acima", "abaixo"], "baixar-pouco", "baixa"],
    [["acima", "abaixo", "acima"], "subir-pouco", "media"],
    [["acima", "alinhado", "abaixo"], "subir-pouco", "media"],
    [["acima", "alinhado", "acima"], "manter", "alta"],
  ];
  it.each(casos)("%j → %s (%s)", (args, acao, forca) => {
    const r = regraAcao(...args);
    expect(r.acao).toBe(acao);
    expect(r.forca).toBe(forca);
    expect(r.umPilar).toBe(false);
  });
  it("um pilar: o que falta vira neutro", () => {
    expect(regraAcao("abaixo", "acima", "sem-historico")).toEqual({
      acao: "baixar-mediana",
      forca: "media",
      umPilar: true,
    });
    expect(regraAcao("acima", "sem-mercado", "abaixo")).toEqual({
      acao: "subir-pouco",
      forca: "media",
      umPilar: true,
    });
    expect(regraAcao("abaixo", "sem-mercado", "acima")).toMatchObject({
      acao: "baixar-pouco",
      umPilar: true,
    });
  });
});

describe("confiança por concordância", () => {
  const c = (acao: string, occ: string | null, sinalMerc: string, sinalHist: string) =>
    confianca({ acao, occ, sinalMerc, sinalHist } as Parameters<typeof confianca>[0]);
  it("alta quando os três sustentam", () => {
    expect(c("baixar", "abaixo", "acima", "acima")).toEqual({ nivel: "alta", motivos: [] });
    expect(c("subir", "acima", "abaixo", "abaixo").nivel).toBe("alta");
    expect(c("acao-comercial", "abaixo", "alinhado", "dentro").nivel).toBe("alta");
  });
  it("média quando um é neutro ou falta", () => {
    expect(c("baixar-mediana", "abaixo", "acima", "dentro")).toEqual({
      nivel: "media",
      motivos: ["o histórico é neutro"],
    });
    expect(c("baixar-mediana", "abaixo", "acima", "sem-historico").motivos).toEqual([
      "sem histórico",
    ]);
    expect(c("subir-pouco", "acima", "sem-mercado", "abaixo").motivos).toEqual(["sem mercado"]);
  });
  it("baixa quando um contradiz", () => {
    expect(c("baixar-pouco", "abaixo", "acima", "abaixo")).toEqual({
      nivel: "baixa",
      motivos: ["o histórico contradiz"],
    });
    expect(c("acao-comercial", "abaixo", "abaixo", "acima").motivos).toEqual([
      "o histórico contradiz",
    ]);
    expect(c("verificar", "abaixo", "sem-mercado", "sem-historico").nivel).toBe("baixa");
  });
  it("qualidade dos dados não muda a confiança", () => {
    const d = decidir(ent({ frota: 10, mercado: { n: 1, idadeDias: 9, pct: 15, mediana: 87 } }));
    // n = 1 dispara alerta de equivalência, mas o histórico também sustenta: segue Baixar com confiança alta.
    expect(d!.acao).toBe("baixar");
    expect(d!.confianca.nivel).toBe("alta");
  });
});

describe("avisos", () => {
  it("principais e permanentes", () => {
    const d = decidir(
      ent({
        frota: 20,
        evento: true,
        hist: { faixa: { de: 80, ate: 85, datas: 6, revVeic: 50 }, fonte: "sazonalidade" },
        mercado: { n: 2, idadeDias: 5, pct: 35, mediana: 74 },
      }),
    )!;
    expect(avisos(d)).toEqual({
      principais: [
        "coleta de mercado há 5 dias",
        "alerta de equivalência",
        "confira se a oferta do concorrente é equivalente",
        "histórico só pela sazonalidade",
        "data de evento",
      ],
      permanentes: ["só 2 concorrentes", "frota pequena"],
    });
  });
  it("sem avisos com dados bons; sem mercado não gera aviso de mercado", () => {
    expect(avisos(decidir(ent({}))!)).toEqual({ principais: [], permanentes: [] });
    expect(avisos(decidir(ent({ tarifa: null }))!).principais).toEqual([]);
  });
});

describe("exceção de equivalência", () => {
  it("Baixar sustentado só pelo mercado com alerta vira Verificar dados", () => {
    // histórico dentro (neutro) + mercado acima com 1 concorrente → seria Baixar até a mediana
    const d = decidir(ent({ tarifa: 84, mercado: { n: 1, idadeDias: 1, pct: 20, mediana: 70 } }))!;
    expect(d.acao).toBe("verificar");
    expect(d.verificarMotivo).toBe(TEXTO_VERIFICAR_EQUIV);
    expect(d.sugerido).toBeNull();
    expect(d.confianca).toEqual({ nivel: "baixa", motivos: [TEXTO_VERIFICAR_EQUIV] });
  });
  it("Subir sustentado só pelo mercado com diferença acima de 30% vira Verificar dados", () => {
    const d = decidir(
      ent({
        occ: "acima",
        gapCarros: 3,
        tarifa: 84,
        mercado: { n: 3, idadeDias: 1, pct: -40, mediana: 140 },
      }),
    )!;
    expect(d.acao).toBe("verificar");
  });
  it("sem alerta, ou com o histórico também sustentando, a ação fica", () => {
    expect(
      decidir(ent({ tarifa: 84, mercado: { n: 3, idadeDias: 1, pct: 20, mediana: 70 } }))!.acao,
    ).toBe("baixar-mediana");
    expect(decidir(ent({ mercado: { n: 1, idadeDias: 1, pct: 15, mediana: 87 } }))!.acao).toBe(
      "baixar",
    );
  });
});

describe("preço sugerido", () => {
  it("firmeza por antecedência", () => {
    expect(firmeza(60)).toBe(0.5);
    expect(firmeza(59)).toBe(0.75);
    expect(firmeza(15)).toBe(0.75);
    expect(firmeza(14)).toBe(1);
  });
  it("alvo: interseção; sem ela, pilar de maior confiança", () => {
    expect(alvoPreco(100, { de: 95, ate: 100 }, "alta", "alta")).toEqual({ de: 95, ate: 105 });
    const M = alvoPreco(100, { de: 60, ate: 65 }, "alta", "media")!;
    expect(M.de).toBeCloseTo(95);
    const H = alvoPreco(100, { de: 60, ate: 65 }, "baixa", "alta")!;
    expect(H.de).toBeCloseTo(57);
    expect(alvoPreco(null, null, "alta", "alta")).toBeNull();
  });
  const e = {
    tarifa: 100,
    lead: 30,
    mediana: 80,
    faixa: null,
    confMercado: "alta" as const,
    confHist: "baixa" as const,
  };
  it("limita o passo (10% × ¾ em D-30)", () => {
    expect(precoSugerido({ ...e, acao: "baixar" })).toMatchObject({
      min: 93,
      max: 93,
      passoPct: 7.5,
    });
  });
  it("passo cheio perto da data, metade longe", () => {
    expect(precoSugerido({ ...e, acao: "baixar", lead: 5 })).toMatchObject({ min: 90, max: 90 });
    expect(precoSugerido({ ...e, acao: "baixar", lead: 90 })).toMatchObject({ min: 95, max: 95 });
  });
  it("um número só: vai até o centro do alvo quando cabe no passo", () => {
    // mediana 95 → alvo 90,25–99,75, centro 95; passo cheio (10%) alcança
    expect(precoSugerido({ ...e, mediana: 95, acao: "baixar", lead: 5 })).toMatchObject({
      min: 95,
      max: 95,
    });
  });
  it("casos reais: 97 e 133 sobem para um número, nunca o preço atual", () => {
    const sub = { ...e, acao: "subir" as const, lead: 62, faixa: null };
    // hoje 97, mediana 100: meio passo (5% = 4,85) alcança 100
    expect(precoSugerido({ ...sub, tarifa: 97, mediana: 100 })).toMatchObject({
      min: 100,
      max: 100,
    });
    // hoje 133, mediana 145: meio passo (5% = 6,65) → 139,65 → 140
    expect(precoSugerido({ ...sub, tarifa: 133, mediana: 145 })).toMatchObject({
      min: 140,
      max: 140,
    });
  });
  it("baixar até 5% nunca passa de 5%", () => {
    expect(precoSugerido({ ...e, acao: "baixar-pouco", lead: 5 })).toMatchObject({
      min: 95,
      max: 95,
    });
  });
  it("baixar até a mediana vai até a mediana", () => {
    expect(precoSugerido({ ...e, mediana: 98, acao: "baixar-mediana", lead: 5 })).toMatchObject({
      min: 98,
      max: 98,
    });
  });
  it("subir", () => {
    expect(precoSugerido({ ...e, mediana: 130, acao: "subir", lead: 5 })).toMatchObject({
      min: 110,
      max: 110,
    });
  });
  it("sem preço para manter, ação comercial, verificar e sem tarifa", () => {
    for (const acao of ["manter", "acao-comercial", "verificar"] as const)
      expect(precoSugerido({ ...e, acao })).toBeNull();
    expect(precoSugerido({ ...e, acao: "baixar", tarifa: null })).toBeNull();
  });
  it("nada a mover no sentido da ação", () => {
    expect(precoSugerido({ ...e, mediana: 120, acao: "baixar" })).toBeNull();
  });
});

describe("urgência", () => {
  const u = { carros: 5, receita: 1000, acao: "baixar" as const, ritmo: null };
  it("antecedência e carros", () => {
    expect(urgencia({ ...u, lead: 10 })).toBe("alta");
    expect(urgencia({ ...u, lead: 10, carros: 1 })).toBe("media");
    expect(urgencia({ ...u, lead: 80 })).toBe("media");
    expect(urgencia({ ...u, lead: 80, carros: -2 })).toBe("baixa");
    expect(urgencia({ ...u, lead: 10, acao: "manter" })).toBe("baixa");
  });
  it("ritmo igual/acima reduz em baixar e ação comercial", () => {
    expect(urgencia({ ...u, lead: 10, ritmo: "igual" })).toBe("media");
    expect(urgencia({ ...u, lead: 10, acao: "acao-comercial", ritmo: "acima" })).toBe("media");
    expect(urgencia({ ...u, lead: 10, acao: "subir", ritmo: "acima" })).toBe("alta");
  });
});

const ent = (o: Partial<DecisaoEntrada>): DecisaoEntrada => ({
  date: "2026-12-10",
  category: "SUV",
  lead: 23,
  frota: 40,
  vagos: 6,
  tarifa: 100,
  occ: "abaixo",
  gapPp: -15,
  gapCarros: -6,
  ritmo: "abaixo",
  ritmoAtual: 1,
  ritmoRef: 3,
  hist: { faixa: { de: 80, ate: 85, datas: 6, revVeic: 50 }, fonte: "mes" },
  evento: false,
  mercado: { n: 4, idadeDias: 1, pct: 15, mediana: 87 },
  captura: cap(),
  ...o,
});

describe("decidir e blocos", () => {
  it("decisão completa", () => {
    const d = decidir(ent({}))!;
    expect(d.acao).toBe("baixar");
    expect(d.confianca.nivel).toBe("alta");
    expect(d.sugerido).toMatchObject({ min: 93, max: 93 });
    expect(d.receita).toBe(600);
    expect(d.urgencia).toBe("alta");
    expect(evidencias(d)).toEqual({ ocupacao: "favor", historico: "favor", mercado: "favor" });
  });
  it("sem ocupação fica fora; sem tarifa = sem mercado", () => {
    expect(decidir(ent({ occ: null }))).toBeNull();
    expect(decidir(ent({ tarifa: null }))!.acao).toBe("verificar");
  });
  it("agrupa datas consecutivas da mesma categoria e ação", () => {
    const ds = [
      decidir(ent({ date: "2026-12-10" }))!,
      decidir(ent({ date: "2026-12-11", lead: 24 }))!,
      decidir(ent({ date: "2026-12-13", lead: 26 }))!,
      decidir(ent({ date: "2026-12-12", lead: 25, occ: "dentro" }))!,
      decidir(ent({ date: "2026-12-11", category: "Minivan", lead: 24 }))!,
    ];
    const bs = agruparBlocos(ds);
    expect(bs.map((b) => [b.category, b.de, b.ate, b.acao])).toEqual([
      ["SUV", "2026-12-10", "2026-12-11", "baixar"],
      ["Minivan", "2026-12-11", "2026-12-11", "baixar"],
      ["SUV", "2026-12-13", "2026-12-13", "baixar"],
      ["SUV", "2026-12-12", "2026-12-12", "manter"],
    ]);
    expect(bs[0]!.carros).toBe(-12);
    const r = resumoDia(bs);
    expect(r.porGrupo.baixar).toEqual({ blocos: 3, datas: 4 });
    expect(r.porGrupo.manter).toEqual({ blocos: 1, datas: 1 });
    expect(r.carroDias).toBe(24);
    expect(r.receitaRisco).toBe(2400);
    expect(r.receitaPotencial).toBe(0);
  });
});

describe("totais", () => {
  it("receita em risco e potencial", () => {
    expect(receitas("baixar", -4, 100, null)).toEqual({ risco: 400, potencial: 0 });
    expect(receitas("acao-comercial", -2, 90, null)).toEqual({ risco: 180, potencial: 0 });
    expect(receitas("baixar", 3, 100, null)).toEqual({ risco: 0, potencial: 0 });
    expect(receitas("subir", 3, 100, { min: 105, max: 110 })).toEqual({ risco: 0, potencial: 15 });
    expect(receitas("subir", 3, 100, null)).toEqual({ risco: 0, potencial: 0 });
    expect(receitas("manter", -5, 100, null)).toEqual({ risco: 0, potencial: 0 });
    expect(receitas("verificar", -5, 100, null)).toEqual({ risco: 0, potencial: 0 });
  });
  it("carro-dias só das decisões com ação; potencial do Subir", () => {
    const sub = decidir(
      ent({
        date: "2026-12-20",
        lead: 5,
        occ: "acima",
        gapCarros: 4,
        mercado: { n: 4, idadeDias: 1, pct: -20, mediana: 125 },
        hist: { faixa: { de: 120, ate: 125, datas: 6, revVeic: 50 }, fonte: "mes" },
      }),
    )!;
    expect(sub.acao).toBe("subir");
    expect(sub.sugerido).toMatchObject({ min: 110 });
    const man = decidir(ent({ date: "2026-12-21", occ: "dentro", gapCarros: -1 }))!;
    const ver = decidir(ent({ date: "2026-12-22", tarifa: null, gapCarros: -3 }))!;
    const r = resumoDia(agruparBlocos([sub, man, ver, decidir(ent({}))!]));
    expect(r.carroDias).toBe(4 + 6);
    expect(r.receitaPotencial).toBe(40);
    expect(r.receitaRisco).toBe(600);
  });
});

describe("blocos: gap médio, dias e faixas de nível", () => {
  it("média por dia e níveis mínimo/máximo", () => {
    const [b] = agruparBlocos([
      decidir(ent({ date: "2026-12-10", lead: 10, gapCarros: -6 }))!,
      decidir(ent({ date: "2026-12-11", lead: 80, gapCarros: -2 }))!,
      decidir(ent({ date: "2026-12-12", lead: 81, gapCarros: -1, frota: 20 }))!,
    ]);
    expect(b!.dias).toBe(3);
    expect(b!.carros).toBe(-9);
    expect(b!.carrosDia).toBe(-3);
    expect(b!.urgencia).toBe("alta");
    expect(b!.urgenciaMin).toBe("baixa");
    expect(b!.confianca).toBe("alta");
    expect(b!.confiancaMax).toBe("alta");
  });
});

const cap = (o: Partial<CapturaDecisao> = {}): CapturaDecisao => ({
  base: "categoria-mes",
  datas: 20,
  pontos: [],
  atual: 0.5,
  falta: 0.5,
  prox14: 0.2,
  prox30: 0.3,
  janela: "agora",
  abre: "2026-11-17",
  ...o,
});

describe("Decidir hoje", () => {
  it("carros/dia × captura 14d; dias do bloco não multiplicam; sem Cedo/Tarde/Manter", () => {
    const bs = agruparBlocos([
      // A: 2 carros/dia em 10 dias, 20% → 0,4
      ...Array.from({ length: 10 }, (_, i) =>
        decidir(
          ent({ category: "A", date: `2026-12-${String(10 + i)}`, gapCarros: -2, captura: cap() }),
        )!,
      ),
      // B: 3 carros/dia num dia só, 20% → 0,6
      decidir(ent({ category: "B", gapCarros: -3, captura: cap() }))!,
      // C: 4 carros/dia, 5% → 0,2; empate com D desfeito pela tarifa
      decidir(
        ent({ category: "C", gapCarros: -4, captura: cap({ prox14: 0.05, janela: "ultima" }) }),
      )!,
      decidir(
        ent({
          category: "D",
          gapCarros: -4,
          tarifa: 90,
          captura: cap({ prox14: 0.05, janela: "ultima" }),
        }),
      )!,
      decidir(
        ent({ category: "E", gapCarros: -9, captura: cap({ janela: "cedo", abre: "2026-12-01" }) }),
      )!,
      decidir(ent({ category: "F", gapCarros: -9, captura: cap({ janela: "tarde" }) }))!,
      decidir(ent({ category: "G", occ: "dentro", captura: cap() }))!,
    ]);
    expect(impacto(bs.find((b) => b.category === "A")!)).toBeCloseTo(0.4);
    expect(decidirHoje(bs).map((b) => b.category)).toEqual(["B", "A", "C", "D"]);
    expect(decidirHoje(bs, 1).map((b) => b.category)).toEqual(["B"]);
    expect(aindaCedo(bs).map((b) => b.category)).toEqual(["E"]);
    expect(proximaAbertura(bs)).toBe("2026-12-01");
    const r = resumoDia(bs);
    expect(r.paraDecidir).toBe(4);
    expect(r.paraDecidirPor.baixar).toBe(4);
    expect(r.aindaCedo).toBe(1);
  });
  it("nada na janela: lista vazia e próxima abertura", () => {
    const bs = agruparBlocos([
      decidir(ent({ captura: cap({ janela: "cedo", abre: "2027-01-05" }) }))!,
    ]);
    expect(decidirHoje(bs)).toEqual([]);
    expect(proximaAbertura(bs)).toBe("2027-01-05");
  });
  it("divide blocos que atravessam janelas; usa a janela do primeiro dia", () => {
    const bs = agruparBlocos([
      decidir(ent({ date: "2026-12-10", captura: cap({ janela: "ultima" }) }))!,
      decidir(ent({ date: "2026-12-11", lead: 24, captura: cap({ janela: "ultima" }) }))!,
      decidir(
        ent({ date: "2026-12-12", lead: 25, captura: cap({ janela: "agora", prox14: 0.3 }) }),
      )!,
    ]);
    expect(bs.map((b) => [b.de, b.ate, b.janela])).toEqual(
      expect.arrayContaining([
        ["2026-12-10", "2026-12-11", "ultima"],
        ["2026-12-12", "2026-12-12", "agora"],
      ]),
    );
    expect(bs.find((b) => b.janela === "agora")!.captura!.prox14).toBe(0.3);
  });
  it("carros abaixo do esperado: média por dia nas datas com ação", () => {
    const r = resumoDia(
      agruparBlocos([
        decidir(ent({ category: "A", gapCarros: -6 }))!,
        decidir(ent({ category: "B", gapCarros: -2 }))!,
        decidir(ent({ category: "C", occ: "dentro", gapCarros: -9 }))!,
      ]),
    );
    expect(r.carrosAbaixoDia).toBe(4);
    expect(r.datasAbaixo).toBe(2);
  });
});

describe("frases", () => {
  it("com mercado e histórico", () => {
    const [b] = agruparBlocos([
      decidir(
        ent({
          date: "2026-12-10",
          gapCarros: -6,
          ritmoAtual: 0,
          ritmoRef: 2,
          ritmoAno: "2025",
          hist: {
            faixa: { de: 80, ate: 85, datas: 6, revVeic: 50 },
            fonte: "mes",
            rotulo: "dezembro",
          },
          mercado: { n: 2, idadeDias: 1, pct: 12, mediana: 89 },
          captura: cap({ prox14: 0.18, falta: 0.42 }),
        }),
      )!,
      decidir(ent({ date: "2026-12-11", lead: 24, gapCarros: -4, captura: cap() }))!,
    ]);
    const f = frases(b!);
    expect(f.titulo).toBe(
      "SUV · 10/12 a 11/12 (2 dias) · faltam 23 dias → Baixar para US$ 93 (hoje US$ 100)",
    );
    expect(f.sinais).toBe(
      "~5 carros/dia abaixo do esperado · nenhuma reserva nova em 14 dias; 2025 teve 2 no mesmo período · tarifa 12% acima do mercado, mediana US$ 89, 2 concorrentes · 18% acima da faixa que mais rendeu em dezembro, US$ 80–85",
    );
    expect(f.captura).toBe(
      "Nos próximos 14 dias costuma entrar 18% das reservas desta data (base: categoria, mês). Ainda faltam 42%. Janela: agora.",
    );
    expect(f.confianca).toBe("Confiança alta: os três sinais concordam");
  });
  it("sem mercado, sem histórico e sem curva", () => {
    const [b] = agruparBlocos([
      decidir(
        ent({ tarifa: null, hist: { faixa: null, fonte: null }, ritmoAtual: null, captura: null }),
      )!,
    ]);
    const f = frases(b!);
    expect(f.titulo).toBe("SUV · 10/12 (1 dia) · faltam 23 dias → Verificar dados");
    expect(f.sinais).toBe(
      "~6 carros/dia abaixo do esperado · sem cotação de mercado · sem histórico suficiente",
    );
    expect(f.captura).toBe("Sem curva de captura com amostra suficiente para esta categoria.");
  });
  it("revisar canais, cedo e confiança", () => {
    const [b] = agruparBlocos([
      decidir(
        ent({
          tarifa: 82,
          frota: 20,
          mercado: { n: 2, idadeDias: 1, pct: 0, mediana: 82 },
          captura: cap({ janela: "cedo", abre: "2026-12-01", prox14: 0.04 }),
        }),
      )!,
    ]);
    const f = frases(b!);
    expect(f.titulo).toContain("→ Revisar canais e demanda (hoje US$ 82)");
    expect(f.captura).toContain("Janela: cedo, rever a partir de 01/12.");
    expect(f.confianca).toBe("Confiança alta: os três sinais concordam");
    const [c] = agruparBlocos([decidir(ent({}))!]);
    expect(frases(c!).confianca).toBe("Confiança alta: os três sinais concordam");
  });
  it("dinheiro compacto", () => {
    expect(dinheiro(89900)).toBe("US$ 89,9 mil");
    expect(dinheiro(1250000)).toBe("US$ 1,3 mi");
    expect(dinheiro(9500)).toBe("US$ 9.500");
  });
});

describe("selos", () => {
  it("texto e cor", () => {
    const [b] = agruparBlocos([
      decidir(ent({ date: "2026-12-10", gapCarros: -6, ritmoAtual: 0, ritmoRef: 2 }))!,
      decidir(ent({ date: "2026-12-11", lead: 24, gapCarros: -4 }))!,
    ]);
    const s = selos(b!);
    expect(s.ocupacao).toEqual({ texto: "Ocup. −5 carros/dia · ritmo 0 vs 2", tom: "sustenta" });
    expect(s.historico).toEqual({ texto: "Hist. +18% da faixa ótima", tom: "sustenta" });
    expect(s.mercado).toEqual({ texto: "Merc. +15% (4 conc.)", tom: "sustenta" });
    expect(COR_SELO.sustenta).toContain("red");
    expect(COR_SELO.contradiz).toContain("amber");
    expect(COR_SELO.neutro).toContain("muted");
    expect(COR_SELO["sem-dado"]).toContain("dashed");
  });
  it("contradiz, neutro e sem dado", () => {
    // Baixar até 5% com mercado acima e histórico abaixo: histórico contradiz.
    const [b] = agruparBlocos([
      decidir(ent({ tarifa: 70, mercado: { n: 2, idadeDias: 1, pct: 12, mediana: 62 } }))!,
    ]);
    expect(b!.acao).toBe("baixar-pouco");
    expect(selos(b!).historico).toEqual({ texto: "Hist. −13% da faixa ótima", tom: "contradiz" });
    const [c] = agruparBlocos([
      decidir(ent({ mercado: { n: 0, idadeDias: null, pct: null, mediana: null }, tarifa: 82 }))!,
    ]);
    expect(selos(c!).mercado).toEqual({ texto: "sem mercado", tom: "sem-dado" });
    expect(selos(c!).historico).toEqual({ texto: "Hist. na faixa ótima", tom: "sustenta" });
    const [d] = agruparBlocos([decidir(ent({ hist: { faixa: null, fonte: null } }))!]);
    expect(selos(d!).historico).toEqual({ texto: "sem histórico", tom: "sem-dado" });
  });
  it("diferença para a faixa ótima", () => {
    expect(difFaixaPct(90, { de: 80, ate: 85 })).toBeCloseTo(5.88, 1);
    expect(difFaixaPct(82, { de: 80, ate: 85 })).toBe(0);
    expect(difFaixaPct(72, { de: 80, ate: 85 })).toBeCloseTo(-10);
  });
});

describe("calendário por ação", () => {
  it("ação mais urgente do dia; Manter só se todas mantêm", () => {
    const man = decidir(ent({ category: "A", occ: "dentro" }))!;
    const ver = decidir(ent({ category: "B", tarifa: null }))!;
    const bx = decidir(ent({ category: "C", lead: 80, gapCarros: -1 }))!;
    expect(acaoDoDia([man])!.grupo).toBe("manter");
    expect(acaoDoDia([man, ver])!.grupo).toBe("verificar");
    expect(acaoDoDia([man, ver, bx])!.grupo).toBe("baixar");
    expect(acaoDoDia([])).toBeNull();
    const cal = calendarioAcoes([man, ver, bx]);
    expect(cal.get("2026-12-10")).toMatchObject({ grupo: "baixar", count: 3 });
    expect(COR_ACAO.baixar).toContain("sky");
    expect(COR_ACAO.subir).toContain("emerald");
    expect(COR_ACAO["acao-comercial"]).toContain("amber");
  });
});

describe("cards no recorte da janela", () => {
  it("só Agora/Última chance; total inclui ainda cedo, não Tarde", () => {
    const r = resumoDia(
      agruparBlocos([
        decidir(ent({ category: "A", gapCarros: -4 }))!, // agora: risco 400
        decidir(ent({ category: "B", gapCarros: -2, captura: cap({ janela: "ultima" }) }))!, // 200
        decidir(ent({ category: "C", gapCarros: -10, captura: cap({ janela: "cedo" }) }))!, // 1000 só no total
        decidir(ent({ category: "D", gapCarros: -8, captura: cap({ janela: "tarde" }) }))!, // fora
      ]),
    );
    expect(r.paraDecidir).toBe(2);
    expect(r.aindaCedo).toBe(1);
    expect(r.carrosAbaixoDia).toBe(3);
    expect(r.datasAbaixo).toBe(2);
    expect(r.receitaRisco).toBe(600);
    expect(r.receitaRiscoTotal).toBe(1600);
  });
});

describe("separação da fila por janela", () => {
  const bs = () =>
    agruparBlocos([
      decidir(ent({ category: "A" }))!, // baixar, agora
      decidir(ent({ category: "B", captura: cap({ janela: "ultima" }) }))!,
      decidir(ent({ category: "C", captura: cap({ janela: "cedo", abre: "2026-12-20" }) }))!,
      decidir(ent({ category: "D", captura: cap({ janela: "cedo", abre: "2026-12-01" }) }))!,
      decidir(ent({ category: "E", captura: cap({ janela: "tarde" }) }))!,
      decidir(ent({ category: "F", occ: "dentro", captura: cap({ janela: "cedo" }) }))!,
      decidir(ent({ category: "G", tarifa: null, captura: cap({ janela: "tarde" }) }))!,
    ]);
  it("Cedo e Tarde ficam fora dos grupos de ação", () => {
    const f = separarFila(bs());
    expect(f.porGrupo.baixar.map((b) => b.category).sort()).toEqual(["A", "B"]);
    expect(f.porGrupo.verificar).toEqual([]);
    expect(f.porGrupo.manter.map((b) => b.category)).toEqual(["F"]);
    expect(f.cedo.map((b) => b.category)).toEqual(["D", "C"]);
    expect(f.passou.map((b) => b.category).sort()).toEqual(["E", "G"]);
  });
  it("contagens dos cards batem com os grupos", () => {
    const b = bs();
    const f = separarFila(b);
    const r = resumoDia(b);
    expect(r.paraDecidir).toBe(
      f.porGrupo.baixar.length + f.porGrupo.subir.length + f.porGrupo["acao-comercial"].length,
    );
    expect(r.aindaCedo).toBe(f.cedo.length);
  });
  it("linha compacta", () => {
    const f = separarFila(bs());
    expect(linhaCompacta(f.cedo[0]!)).toBe(
      "D · 10/12 · faltam 23 dias · tendência: baixar · rever a partir de 01/12",
    );
    expect(linhaCompacta(f.passou.find((b) => b.category === "G")!)).toBe(
      "G · 10/12 · faltam 23 dias · tendência: verificar dados",
    );
  });
});

describe("etiquetas dos sinais", () => {
  it("a favor, neutro, contra e sem dado", () => {
    expect(etiquetas(decidir(ent({}))!).map((e) => e.tom)).toEqual(["favor", "favor", "favor"]);
    // baixar até 5% (mercado acima, histórico abaixo): histórico contra
    expect(
      etiquetas(
        decidir(ent({ tarifa: 70, mercado: { n: 4, idadeDias: 1, pct: 12, mediana: 62 } }))!,
      ).map((e) => [e.nome, e.tom]),
    ).toEqual([
      ["Ocupação", "favor"],
      ["Mercado", "favor"],
      ["Histórico", "contra"],
    ]);
    expect(
      etiquetas(
        decidir(ent({ tarifa: 84, mercado: { n: 4, idadeDias: 1, pct: 20, mediana: 70 } }))!,
      )[2].tom,
    ).toBe("neutro");
    expect(etiquetas(decidir(ent({ hist: { faixa: null, fonte: null } }))!)[2].tom).toBe(
      "sem-dado",
    );
    expect(COR_ETIQUETA.favor).toContain("emerald");
    expect(COR_ETIQUETA.contra).toContain("amber");
    expect(COR_ETIQUETA["sem-dado"]).toContain("dashed");
  });
});

describe("etapa final: avisos e potencial limitado", () => {
  it("1 ou 2 concorrentes com diferença acima de ±20% pede conferir a oferta", () => {
    const av = (n: number, pct: number) =>
      avisos(decidir(ent({ mercado: { n, idadeDias: 1, pct, mediana: 80 } }))!).principais;
    expect(av(2, 25)).toContain("confira se a oferta do concorrente é equivalente");
    expect(av(2, -21)).toContain("confira se a oferta do concorrente é equivalente");
    expect(av(2, 15)).not.toContain("confira se a oferta do concorrente é equivalente");
    expect(av(3, 25)).not.toContain("confira se a oferta do concorrente é equivalente");
  });
  it("potencial de alta marcado como limitado pelo passo", () => {
    const sub = (mediana: number, lead = 70) =>
      decidir(
        ent({
          occ: "acima",
          gapCarros: 3,
          lead,
          hist: { faixa: null, fonte: null },
          mercado: { n: 4, idadeDias: 1, pct: (100 / mediana - 1) * 100, mediana },
        }),
      )!;
    // mediana 125, D-70: alvo até ~131, mas o passo (meio passo = 5%) para em 105
    expect(sub(125).acao).toBe("subir-pouco");
    expect(resumoDia(agruparBlocos([sub(125)])).potencialLimitado).toBe(true);
    // mediana 104, D-5: alvo até ~109, alcançado com o passo cheio (10%)
    expect(resumoDia(agruparBlocos([sub(104, 5)])).potencialLimitado).toBe(false);
  });
});

describe("cartão de leitura rápida", () => {
  it("três blocos com dados", () => {
    const [b] = agruparBlocos([
      decidir(
        ent({
          gapCarros: -5,
          ritmoAtual: 1,
          ritmoRef: 1,
          ritmoAno: "2025",
          hist: {
            faixa: { de: 80, ate: 85, datas: 6, revVeic: 50 },
            fonte: "mes",
            rotulo: "janeiro",
          },
          mercado: { n: 2, idadeDias: 1, pct: 15, mediana: 87 },
        }),
      )!,
    ]);
    expect(blocosPilares(b!)).toEqual([
      {
        nome: "Ocupação",
        valor: "−5 carros/dia",
        conclusao: "abaixo do esperado",
        detalhe: "1 reserva em 14 dias (2025: 1)",
        tom: "problema",
      },
      {
        nome: "Mercado",
        valor: "+15%",
        conclusao: "mais caro",
        detalhe: "mediana US$ 87 · 2 concorrentes",
        tom: "favor",
      },
      {
        nome: "Nosso histórico",
        valor: "+18%",
        conclusao: "acima da faixa que mais rende",
        detalhe: "mais rendeu: US$ 80–85 (janeiro)",
        tom: "favor",
      },
    ]);
    expect(COR_BARRA.problema).toContain("red");
    expect(COR_BARRA.favor).toContain("emerald");
    expect(COR_BARRA.contra).toContain("amber");
  });
  it("sem dados e contradição", () => {
    const [b] = agruparBlocos([
      decidir(ent({ tarifa: null, hist: { faixa: null, fonte: null }, ritmoAtual: null }))!,
    ]);
    const [o, m, h] = blocosPilares(b!);
    expect(o.tom).toBe("neutro"); // verificar: ocupação não é o "problema" de uma ação de preço
    expect(o.detalhe).toBe("sem ritmo de referência");
    expect([m.conclusao, m.tom]).toEqual(["sem cotação", "sem-dado"]);
    expect([h.conclusao, h.tom]).toEqual(["sem histórico", "sem-dado"]);
    // Revisar canais com mercado já mais barato e histórico acima (contradiz)
    const [c] = agruparBlocos([
      decidir(ent({ tarifa: 100, mercado: { n: 4, idadeDias: 1, pct: -8, mediana: 109 } }))!,
    ]);
    expect(c!.acao).toBe("acao-comercial");
    const [, mc, hc] = blocosPilares(c!);
    expect([mc.valor, mc.conclusao, mc.tom]).toEqual(["−8%", "já mais barato", "favor"]);
    expect(hc.tom).toBe("contra");
    const [dn] = agruparBlocos([decidir(ent({ occ: "dentro" }))!]);
    expect(blocosPilares(dn!)[0]).toMatchObject({
      valor: "0 carros/dia",
      conclusao: "no esperado",
    });
  });
  it("etiqueta de cada ação", () => {
    const um = (o: Partial<DecisaoEntrada>) => agruparBlocos([decidir(ent(o))!])[0]!;
    expect(etiquetaAcao(um({}))).toMatchObject({ texto: "Baixar para US$ 93", icone: "baixar" });
    expect(
      etiquetaAcao(
        um({
          lead: 5,
          occ: "acima",
          gapCarros: 3,
          mercado: { n: 4, idadeDias: 1, pct: -20, mediana: 125 },
          hist: { faixa: { de: 120, ate: 125, datas: 6, revVeic: 1 }, fonte: "mes" },
        }),
      ),
    ).toMatchObject({ texto: "Subir para US$ 110", icone: "subir" });
    expect(
      etiquetaAcao(um({ tarifa: 82, mercado: { n: 4, idadeDias: 1, pct: 0, mediana: 82 } })),
    ).toMatchObject({
      texto: "Não baixar preço · revisar canais e demanda",
      icone: "canais",
    });
    expect(etiquetaAcao(um({ tarifa: null })).texto).toBe("Verificar: sem tarifa nossa nesta data");
    expect(
      etiquetaAcao(
        um({
          hist: { faixa: null, fonte: null },
          mercado: { n: 0, idadeDias: null, pct: null, mediana: null },
        }),
      ).texto,
    ).toBe("Verificar: sem mercado e sem histórico");
    expect(
      etiquetaAcao(um({ tarifa: 84, mercado: { n: 1, idadeDias: 1, pct: 20, mediana: 70 } })).texto,
    ).toBe("Verificar: cotação do concorrente pode não ser equivalente");
    expect(etiquetaAcao(um({ occ: "dentro" })).texto).toBe("Manter");
  });
  it("cabeçalho e linha de contexto", () => {
    const b = agruparBlocos([
      decidir(ent({ date: "2026-12-10", captura: cap({ prox14: 0.11, falta: 0.38 }) }))!,
      decidir(ent({ date: "2026-12-11", lead: 24, tarifa: 97, captura: cap() }))!,
    ])[0]!;
    expect(cabecalho(b)).toEqual({ titulo: "SUV · 10/12 a 11/12", sub: "2 dias · faltam 23" });
    expect(contexto(b)).toBe(
      "Tarifa hoje US$ 97–100 · nos próximos 14 dias entram ~11% das reservas · faltam 38%",
    );
    expect(contexto(agruparBlocos([decidir(ent({ captura: null }))!])[0]!)).toBe(
      "Tarifa hoje US$ 100 · sem curva de captura",
    );
  });
});

describe("explicação da confiança", () => {
  it("média: histórico não opina", () => {
    const d = decidir(
      ent({
        occ: "acima",
        gapCarros: 3,
        tarifa: 82,
        mercado: { n: 4, idadeDias: 1, pct: -12, mediana: 93 },
      }),
    )!;
    expect(d.acao).toBe("subir-pouco");
    expect(explicarConfianca(d)).toEqual({
      resumo:
        "Confiança média: dois sinais pedem subir e um não opina. A sugestão vale, mas com um apoio a menos.",
      linhas: [
        "✓ Ocupação: vendendo mais que o esperado → também pede subir.",
        "✓ Mercado: estamos mais baratos que o mercado → também pede subir.",
        "— Histórico: tarifa dentro da faixa que mais rendeu → não pede nem subir nem baixar.",
      ],
    });
  });
  it("alta, baixa e sem dado", () => {
    expect(explicarConfianca(decidir(ent({}))!).resumo).toBe(
      "Confiança alta: os três sinais pedem baixar.",
    );
    const b = explicarConfianca(
      decidir(ent({ tarifa: 70, mercado: { n: 4, idadeDias: 1, pct: 12, mediana: 62 } }))!,
    );
    expect(b.linhas[2]).toBe(
      "✗ Histórico: tarifa abaixo da faixa que mais rendeu → aponta para o lado contrário.",
    );
    expect(explicarConfianca(decidir(ent({ hist: { faixa: null, fonte: null } }))!).linhas[2]).toBe(
      "— Histórico: sem dado, não opina.",
    );
  });
});

describe("casos do print", () => {
  it("Baixar até 5% sem interseção dos alvos ainda dá preço (Midsize Sedan: 61 → 58)", () => {
    const d = decidir(
      ent({
        tarifa: 61,
        lead: 19,
        hist: { faixa: { de: 65, ate: 70, datas: 6, revVeic: 50 }, fonte: "mes" },
        mercado: { n: 2, idadeDias: 4, pct: 14, mediana: 53 },
      }),
    )!;
    expect(d.acao).toBe("baixar-pouco");
    expect(d.sugerido).toMatchObject({ min: 58, max: 58 });
  });
  it("sem interseção, usa o pilar que aponta no sentido da ação", () => {
    // mercado (confiança alta) aponta para cima, mas a ação é baixar: usa o histórico
    expect(
      precoSugerido({
        tarifa: 100,
        acao: "baixar",
        lead: 5,
        mediana: 120,
        faixa: { de: 80, ate: 85 },
        confMercado: "alta",
        confHist: "baixa",
      }),
    ).toMatchObject({ min: 90 });
  });
  it("bloco com tarifas diferentes: % e faixa conforme o dia", () => {
    const b = agruparBlocos([
      decidir(
        ent({
          date: "2026-12-13",
          tarifa: 125,
          mercado: { n: 3, idadeDias: 1, pct: 10, mediana: 103 },
          hist: { faixa: { de: 100, ate: 105, datas: 6, revVeic: 50 }, fonte: "mes" },
        }),
      )!,
      decidir(
        ent({
          date: "2026-12-14",
          lead: 24,
          tarifa: 112,
          mercado: { n: 3, idadeDias: 1, pct: 10, mediana: 103 },
          hist: { faixa: { de: 100, ate: 105, datas: 6, revVeic: 50 }, fonte: "mes" },
        }),
      )!,
    ])[0]!;
    expect(b.sugMin).not.toBe(b.sugMax);
    expect(movimentoPct(b)).toBeLessThan(0);
    expect(etiquetaAcao(b).texto).toMatch(/^Baixar ~\d+% \(US\$ \d+–\d+ conforme o dia\)$/);
  });
});

describe("matriz ocupação × mercado", () => {
  it("conta por célula e separa sem ocupação", () => {
    const m = matrizOcupacaoMercado([
      { occ: "abaixo", merc: "acima" },
      { occ: "abaixo", merc: "acima" },
      { occ: "dentro", merc: "sem-mercado" },
      { occ: "acima", merc: "abaixo" },
      { occ: null, merc: "acima" },
    ]);
    const c = (o: string, k: string) => m.cells.find((x) => x.occ === o && x.market === k)!.count;
    expect(c("abaixo", "acima")).toBe(2);
    expect(c("neutro", "sem-dados")).toBe(1);
    expect(c("acima", "abaixo")).toBe(1);
    expect(m.cells).toHaveLength(12);
    expect(m.semBenchmark).toBe(1);
  });
});

describe("etiquetas de sustentação dos blocos", () => {
  it("texto e cor por papel do sinal", () => {
    const [b] = agruparBlocos([
      decidir(ent({ tarifa: 70, mercado: { n: 4, idadeDias: 1, pct: 12, mediana: 62 } }))!,
    ]);
    const [o, m, h] = blocosPilares(b!);
    expect(ETIQUETA_BLOCO[o.tom].texto).toBe("motivo da ação");
    expect(ETIQUETA_BLOCO[m.tom].texto).toBe("sustenta a ação");
    expect(ETIQUETA_BLOCO[h.tom].texto).toBe("contra");
    expect(ETIQUETA_BLOCO.problema.cor).toContain("red");
    expect(ETIQUETA_BLOCO.favor.cor).toContain("emerald");
    expect(ETIQUETA_BLOCO.contra.cor).toContain("amber");
    expect(ETIQUETA_BLOCO.neutro.texto).toBe("neutro");
  });
});

describe("Subir/Baixar sempre com preço", () => {
  // Fullsize Suv 18–19/01 do print: tarifa 97, mediana 100 (−3%, alinhado), faixa ótima 90–95 (dentro), ocupação acima.
  const fullsize = () =>
    decidir(
      ent({
        occ: "acima",
        gapCarros: 3,
        lead: 62,
        tarifa: 97,
        mercado: { n: 2, idadeDias: 1, pct: -3, mediana: 100 },
        hist: {
          faixa: { de: 90, ate: 95, datas: 6, revVeic: 50 },
          fonte: "mes",
          rotulo: "janeiro",
        },
      }),
    )!;
  it("caso Fullsize Suv: alvo centrado na tarifa atual vira Manter", () => {
    // regra: acima + alinhado + dentro = Subir pouco; alvo = (95–105) ∩ (85,5–99,75) = 95–99,75, centro ≈ 97,4 → arredonda para 97
    expect(regraAcao("acima", "alinhado", "dentro").acao).toBe("subir-pouco");
    const d = fullsize();
    expect(d.acao).toBe("manter");
    expect(d.sugerido).toBeNull();
    expect(d.manterMotivo).toBe(TEXTO_MUDANCA_PEQUENA);
    expect(etiquetaAcao(agruparBlocos([d])[0]!).texto).toBe(
      "Manter · mudança sugerida pequena demais",
    );
  });
  it("mudança menor que US$ 2 vira Manter; a partir de 2 fica", () => {
    // hoje 100, mediana 101 → centro 101: mudança de 1 → Manter
    const peq = decidir(
      ent({
        occ: "acima",
        gapCarros: 3,
        lead: 5,
        hist: { faixa: null, fonte: null },
        mercado: { n: 4, idadeDias: 1, pct: -6, mediana: 101 },
      }),
    )!;
    expect(peq.acao).toBe("manter");
    const ok = decidir(
      ent({
        occ: "acima",
        gapCarros: 3,
        lead: 5,
        hist: { faixa: null, fonte: null },
        mercado: { n: 4, idadeDias: 1, pct: -6, mediana: 106 },
      }),
    )!;
    expect(ok.acao).toBe("subir-pouco");
    expect(ok.sugerido!.min).toBe(106);
  });
  it("limite configurável", () => {
    const d = decidir(
      ent({
        occ: "acima",
        gapCarros: 3,
        lead: 5,
        hist: { faixa: null, fonte: null },
        mercado: { n: 4, idadeDias: 1, pct: -6, mediana: 106 },
      }),
      { ...C, minMudanca: 10 },
    )!;
    expect(d.acao).toBe("manter");
  });
  it("toda decisão de Subir/Baixar tem preço", () => {
    for (const pct of [-40, -20, -8, 8, 20, 40])
      for (const occ of ["abaixo", "acima"] as const) {
        const d = decidir(
          ent({
            occ,
            gapCarros: occ === "abaixo" ? -3 : 3,
            mercado: { n: 4, idadeDias: 1, pct, mediana: 100 / (1 + pct / 100) },
          }),
        )!;
        const g = grupoDe(d.acao);
        if (g === "baixar" || g === "subir") expect(d.sugerido).not.toBeNull();
      }
  });
});

describe("cor do motivo da ação", () => {
  it("vermelho quando a ocupação está abaixo, azul quando está acima", () => {
    const [baixo] = agruparBlocos([decidir(ent({}))!]);
    expect(blocosPilares(baixo!)[0].tom).toBe("problema");
    const [alto] = agruparBlocos([
      decidir(
        ent({
          occ: "acima",
          gapCarros: 3,
          lead: 5,
          hist: { faixa: null, fonte: null },
          mercado: { n: 4, idadeDias: 1, pct: -6, mediana: 106 },
        }),
      )!,
    ]);
    expect(alto!.acao).toBe("subir-pouco");
    expect(blocosPilares(alto!)[0].tom).toBe("motivo-alta");
    expect(ETIQUETA_BLOCO.problema.cor).toContain("red");
    expect(ETIQUETA_BLOCO["motivo-alta"].cor).toContain("sky");
    expect(ETIQUETA_BLOCO["motivo-alta"].texto).toBe("motivo da ação");
    expect(COR_BARRA["motivo-alta"]).toContain("sky");
  });
});
