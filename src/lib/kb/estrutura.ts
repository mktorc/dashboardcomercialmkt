// Organização da Base de Conhecimento para leitura. A IA gera um artigo por trecho de cada arquivo
// do Drive; aqui juntamos o que é do MESMO assunto numa página só (cada parte vira uma seção),
// ligamos vídeos/fotos à categoria ou ao processo a que pertencem e pomos tudo em ordem lógica.
// Roda sobre os artigos já gerados: não mexe no Drive nem no articles.json. Se um artigo não for
// encontrado (ex.: a IA renomeou), a regra só ignora aquela parte e o artigo continua visível.

type Block = { t: string } & Record<string, unknown>;
export type EArticle = {
  id: string;
  category: string;
  title: string;
  summary: string;
  keywords: string;
  blocks: Block[];
  sources: string[];
  areas: string[];
} & Record<string, unknown>;
export type ECategory = { id: string; title: string; description: string; parent?: string };
type Sources = Record<string, { name: string; link: string }>;

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const langOf = (title: string): "PT" | "ES" | null =>
  (/\((PT|ES)\)\s*$/.exec(title)?.[1] as "PT" | "ES" | undefined) ?? null;
const stripLang = (title: string) => title.replace(/\s*\((PT|ES)\)\s*$/, "").trim();
/** Id sem o sufixo numérico que o gerador põe em títulos repetidos ("-2"). */
const baseId = (id: string) => id.replace(/-\d+$/, "");
const kw = (arts: EArticle[]) =>
  [...new Set(arts.flatMap((a) => (a.keywords ?? "").split(/\s+/)))].join(" ");

const MEDIA = /\.(mp4|mov|m4v|webm|jpe?g|png|webp|gif)$/i;
const VIDEO = /\.(mp4|mov|m4v|webm)$/i;
/** "Cópia de Cópia de Lançamento - PG Global Pays (3).mp4" → "Lançamento - PG Global Pays". */
export const cleanName = (name: string) =>
  name
    .replace(/^(c[oó]pia de\s+)+/i, "")
    .replace(/\.[a-z0-9]{2,4}$/i, "")
    .replace(/(\s*\(\d+\))+\s*$/, "")
    .replace(/[_\s-]+$/, "")
    .trim();

const fileBlock = (src: Sources, id: string): Block | null => {
  const s = src[id];
  if (!s) return null;
  return {
    t: "file",
    name: cleanName(s.name),
    link: s.link,
    kind: VIDEO.test(s.name) ? "video" : MEDIA.test(s.name) ? "image" : "doc",
  };
};

/** Subtítulos internos de uma parte viram "sub" (não abrem seção nova nem entram no índice). */
const demote = (blocks: Block[]): Block[] =>
  blocks.map((b) => (b.t === "h" ? { t: "sub", text: b["text"] } : b));

const PT_H = "Do material em português";
const ES_H = "Do material em espanhol";

/** Junta artigos numa página: vídeos das fontes no topo e cada parte como seção. */
function compose(
  parts: { art: EArticle; h?: string | undefined }[],
  over: Pick<EArticle, "id" | "category" | "title">,
  src: Sources,
): EArticle {
  const arts = parts.map((p) => p.art);
  const sources = [...new Set(arts.flatMap((a) => a.sources))];
  const blocks: Block[] = sources
    .filter((s) => VIDEO.test(src[s]?.name ?? ""))
    .map((s) => fileBlock(src, s))
    .filter((b): b is Block => !!b);
  if (parts.length === 1 && !parts[0]!.h) blocks.push(...parts[0]!.art.blocks);
  else {
    const used = new Set<string>();
    for (const p of parts) {
      let h = p.h ?? stripLang(p.art.title);
      // Mesmo assunto vindo de vídeos diferentes: diz de onde vem para não repetir o título.
      if (used.has(norm(h))) {
        const from = src[p.art.sources[0] ?? ""];
        h = from ? `${h} (${cleanName(from.name)})` : `${h} (2)`;
      }
      used.add(norm(h));
      blocks.push({ t: "h", text: h }, ...demote(p.art.blocks));
    }
  }
  return { ...arts[0]!, keywords: kw(arts), blocks, sources, ...over };
}

// ───────────────────────────── Frota ─────────────────────────────

type FleetKey =
  "sedan" | "suv-media" | "suv-grande" | "minivan" | "suv-executive" | "van" | "luxury";
const FLEET: { key: FleetKey; name: string; re: RegExp }[] = [
  { key: "sedan", name: "Sedan", re: /\bsedan\b|corolla/ },
  { key: "suv-media", name: "SUV Média", re: /\bsuv (media|medio|mediana)\b/ },
  { key: "suv-grande", name: "SUV Grande (Full Size)", re: /\bsuv grande\b|full ?size/ },
  { key: "minivan", name: "Minivan", re: /\bminivan\b|carnival/ },
  { key: "suv-executive", name: "SUV Executive", re: /\bsuv executiv|suburban|yukon/ },
  { key: "van", name: "Van 12 lugares", re: /\bvan\b|furgoneta|transit/ },
  { key: "luxury", name: "Luxury", re: /\bluxury\b|\bluxo\b|escalade|cadillac/ },
];
const fleetKeyOf = (title: string) => FLEET.find((f) => f.re.test(norm(stripLang(title))))?.key;
const isFleetCategory = (c: ECategory) => /frota/.test(norm(c.title));
const isFleetIntro = (a: EArticle) => /^(apresentacao|conheca)\b.*\bfrota/.test(norm(a.title));
const esName = (a?: EArticle) => (a ? stripLang(a.title).replace(/^categoria\s+/i, "") : "");

/** Frase de modelos ("Modelos de exemplo: X, Y.") de um artigo de categoria. */
const modelsOf = (a?: EArticle) => {
  const p = a?.blocks.find((b) => b.t === "p" && /modelo/i.test(String(b["text"])));
  return p ? String(p["text"]).replace(/^modelos? de (exemplo|refer[eê]ncia):\s*/i, "") : "";
};

type FleetSlot = { PT?: EArticle; ES?: EArticle; media: EArticle[]; rules: EArticle[] };

/**
 * Frota: uma "Visão geral" e uma página por categoria com TUDO dela junto: modelos e capacidade,
 * vídeos/fotos do veículo, regras específicas e o que vier do material em espanhol.
 */
function organizeFleet(articles: EArticle[], categories: ECategory[], src: Sources) {
  const order: string[] = [];
  let out = articles;
  for (const cat of categories.filter(isFleetCategory)) {
    const area = cat.id.split("-")[0]!;
    const inCat = out.filter((a) => a.category === cat.id);
    const per = new Map<FleetKey, FleetSlot>();
    const intro: { PT?: EArticle; ES?: EArticle } = {};
    const general: EArticle[] = [];
    for (const a of inCat) {
      const lang = langOf(a.title);
      const key = fleetKeyOf(a.title);
      if (isFleetIntro(a)) intro[lang ?? "PT"] = a;
      else if (!key) general.push(a);
      else {
        const slot = per.get(key) ?? { media: [], rules: [] };
        if (lang && !slot[lang]) slot[lang] = a;
        else if (MEDIA.test(src[a.sources[0] ?? ""]?.name ?? "")) slot.media.push(a);
        else slot.rules.push(a);
        per.set(key, slot);
      }
    }
    if (!per.size) continue;
    const made: EArticle[] = [];

    // Visão geral: apresentação + tabela das categorias + regras gerais da frota.
    const rows = FLEET.filter((f) => per.has(f.key)).map((f) => {
      const s = per.get(f.key)!;
      return [f.name, modelsOf(s.PT ?? s.ES) || "—", esName(s.ES) || "—"];
    });
    const ov: Block[] = [
      ...(intro.PT?.blocks ?? intro.ES?.blocks ?? []),
      { t: "h", text: "Categorias da frota" },
      { t: "table", head: ["Categoria", "Modelos de referência", "Nome em espanhol"], rows },
      {
        t: "note",
        text: "Abra a página de cada categoria para ver passageiros e malas, vídeos e regras.",
      },
    ];
    for (const g of general) ov.push({ t: "h", text: stripLang(g.title) }, ...demote(g.blocks));
    if (intro.ES && intro.PT) ov.push({ t: "h", text: ES_H }, ...demote(intro.ES.blocks));
    const ovArts = [intro.PT, intro.ES, ...general].filter((a): a is EArticle => !!a);
    made.push({
      ...(ovArts[0] ?? inCat[0]!),
      id: `frota-visao-geral-${area}`,
      category: cat.id,
      title: "Visão geral da frota",
      summary: "Apresentação da frota, as categorias com seus modelos e as regras gerais.",
      keywords: `frota categorias modelos capacidade apresentacao flota ${kw(ovArts)}`,
      blocks: ov,
      sources: [...new Set(ovArts.flatMap((a) => a.sources))],
    });

    for (const f of FLEET) {
      const s = per.get(f.key);
      if (!s) continue;
      const blocks: Block[] = [...((s.PT ?? s.ES)?.blocks ?? [])];
      if (s.media.length) {
        blocks.push({ t: "h", text: "Vídeos e fotos do veículo" });
        for (const id of new Set(s.media.flatMap((m) => m.sources))) {
          const fb = fileBlock(src, id);
          if (fb) blocks.push(fb);
        }
        for (const m of s.media) {
          // Do vídeo, só a descrição; os "passos" que a IA tirou da filmagem não são instrução.
          const keep = m.blocks.filter((b) => b.t === "p" || b.t === "list" || b.t === "note");
          if (keep.length) blocks.push({ t: "sub", text: stripLang(m.title) }, ...demote(keep));
        }
      }
      if (s.rules.length) {
        blocks.push({ t: "h", text: "Regras da categoria" });
        for (const r of s.rules) blocks.push(...demote(r.blocks));
      }
      // O material em espanhol traz os mesmos modelos e capacidades (a IA já gera em português);
      // fica só o nome que a categoria tem lá, para o vendedor reconhecer.
      if (s.ES && norm(esName(s.ES)) !== norm(esName(s.PT)))
        blocks.push({
          t: "note",
          text: `No material em espanhol esta categoria aparece como "${esName(s.ES)}".`,
        });
      const all = [s.PT, s.ES, ...s.media, ...s.rules].filter((a): a is EArticle => !!a);
      const extras = [s.media.length ? "vídeos" : "", s.rules.length ? "regras" : ""].filter(
        Boolean,
      );
      made.push({
        ...all[0]!,
        id: `frota-${f.key}-${area}`,
        category: cat.id,
        title: f.name,
        summary: `Modelos e capacidade de passageiros e malas${extras.length ? `, ${extras.join(" e ")}` : ""} da categoria ${f.name}.`,
        keywords: kw(all),
        blocks,
        sources: [...new Set(all.flatMap((a) => a.sources))],
      });
    }
    order.push(...made.map((m) => m.id));
    const firstIdx = out.findIndex((a) => a.category === cat.id);
    out = out.filter((a) => a.category !== cat.id);
    out.splice(Math.max(0, Math.min(firstIdx, out.length)), 0, ...made);
  }
  return { articles: out, order };
}

// ───────────────────── Assuntos (Comercial) ─────────────────────
// Cada assunto junta as partes (ids dos artigos gerados, sem o sufixo "-2") numa página, na ordem
// em que se aprende. `cat` acha a pasta pelo nome; `sub` cria o subtópico dentro dela.

type Sub = { key: string; title: string; description: string };
type Topic = {
  cat: string;
  sub?: Sub;
  id: string;
  title: string;
  summary?: string;
  parts: (string | [string, string])[];
};
const HQ: Sub = {
  key: "hq",
  title: "HQ",
  description: "HQ Rental Software: painel, reservas e dados do cliente.",
};
const CRM: Sub = {
  key: "crm",
  title: "CRM",
  description: "CRM ClickMassa: atendimento, oportunidades, tarefas e fechamento.",
};

const TOPICS_COMERCIAL: Topic[] = [
  // Sistemas → HQ
  {
    cat: "sistemas",
    sub: HQ,
    id: "hq-introducao",
    title: "Introdução ao HQ",
    summary: "O painel inicial do HQ: abas, relatórios e onde encontrar cada informação.",
    parts: ["painel-inicial"],
  },
  {
    cat: "sistemas",
    sub: HQ,
    id: "hq-observacoes-de-contato",
    title: "Observações de contato no HQ",
    parts: ["observacoes-de-contato-no-hq"],
  },
  // Sistemas → CRM
  {
    cat: "sistemas",
    sub: CRM,
    id: "crm-introducao",
    title: "Introdução ao CRM ClickMassa",
    summary: "Visão geral do CRM: módulos, dashboards, atendimentos e pipeline.",
    parts: [
      "introducao-ao-crm-clickmassa",
      "uso-dos-dashboards",
      "gestao-de-atendimentos",
      "pipeline-e-tarefas",
    ],
  },
  {
    cat: "sistemas",
    sub: CRM,
    id: "crm-atendimento",
    title: "Atendimento e mensagens",
    summary: "Assumir atendimentos da IA, fila de atendimentos, mensagens e ferramentas do chat.",
    parts: [
      "atendimento-humano",
      "gerenciar-fila-de-atendimentos",
      "verificar-mensagens-e-atendimento",
      "envio-de-mensagens-e-templates",
      "uso-de-ferramentas",
    ],
  },
  {
    cat: "sistemas",
    sub: CRM,
    id: "crm-oportunidades",
    title: "Oportunidades e funil de vendas",
    summary: "Criar, editar e filtrar oportunidades; produtos, etapas e lead de agência.",
    parts: [
      "gestao-de-oportunidades",
      "edicao-de-oportunidades",
      "editar-produtos-na-oportunidade",
      "edicao-e-fechamento-de-oportunidades",
      "filtrar-funil-de-vendas",
      ["dados-da-agencia-no-crm", "Lead intermediado por agência"],
    ],
  },
  {
    cat: "sistemas",
    sub: CRM,
    id: "crm-tarefas",
    title: "Tarefas e follow-up",
    summary: "Tarefas e follow-ups obrigatórios, mensagens automáticas e anexos de WhatsApp.",
    parts: [
      "criar-e-gerenciar-tarefas",
      "gestao-de-tarefas",
      "gerenciamento-de-tarefas",
      "gerenciamento-de-tarefas-no-crm",
      "gerenciamento-de-tarefas-e-follow-up",
      "gestao-de-tarefas-e-follow-up",
    ],
  },
  {
    cat: "sistemas",
    sub: CRM,
    id: "crm-templates",
    title: "Templates comerciais",
    parts: ["templates-comerciais"],
  },
  {
    cat: "sistemas",
    sub: CRM,
    id: "crm-fechamento",
    title: "Fechamento no ClickMassa",
    parts: ["fechamento-no-clickmassa"],
  },
  // Reservas e Vendas: na ordem do atendimento.
  {
    cat: "reserva",
    id: "reserva-cotacao",
    title: "Cotação de reserva",
    parts: ["cotacao-de-reserva"],
  },
  {
    cat: "reserva",
    id: "reserva-lancamento-hq",
    title: "Lançamento da reserva no HQ",
    summary: "Documentos, regras de voo, validação com o cliente e conclusão da reserva.",
    parts: [
      "documentos-para-reserva",
      "regras-de-voo-na-reserva",
      "validacao-com-o-cliente",
      "conclusao-e-entrega-da-reserva",
    ],
  },
  {
    cat: "reserva",
    id: "reserva-lancamentos-incompletos",
    title: "Lançamentos incompletos",
    parts: ["lancamentos-incompletos"],
  },
  // Pagamentos
  {
    cat: "pagamento",
    id: "pagamento-condicoes",
    title: "Condições de pagamento",
    summary: "Condições de reserva e formas de pagamento (material em português e em espanhol).",
    parts: [
      ["condicoes-de-reserva", "Condições de reserva"],
      ["condicoes-de-pagamento-pt", PT_H],
      ["condicoes-de-pagamento-es", ES_H],
    ],
  },
  {
    cat: "pagamento",
    id: "pagamento-em-reais-global-pays",
    title: "Pagamento em reais (Global Pays)",
    summary: "Como lançar o pagamento em reais no Global Pays e validar o recebimento.",
    parts: ["pagamento-em-reais", "pagamento-em-reais-no-global-pays", "validar-pagamento"],
  },
  {
    cat: "pagamento",
    id: "pagamento-link-parcelado",
    title: "Link parcelado sem juros",
    parts: ["link-parcelado-sem-juros"],
  },
  // Retirada e Logística
  {
    cat: "retirada",
    id: "retirada-regras-gerais",
    title: "Retirada e entrega: regras gerais",
    summary: "Como funcionam retirada e devolução, exceções fora do horário e taxas de logística.",
    parts: [
      ["retirada-e-entrega-pt", "Retirada e entrega"],
      ["entrega-e-retirada", "Fora do horário e exceções"],
      "taxas-de-logistica",
    ],
  },
  {
    cat: "retirada",
    id: "retirada-orlando",
    title: "Retirada em Orlando (MCO)",
    parts: ["retirada-em-orlando-mco-es"],
  },
  {
    cat: "retirada",
    id: "retirada-miami-fll",
    title: "Retirada em Miami e Fort Lauderdale",
    parts: ["retirada-em-miami-e-fort-lauderdale-es"],
  },
  {
    cat: "retirada",
    id: "retirada-tampa-sanford",
    title: "Retirada em Tampa e Sanford",
    parts: ["retirada-em-tampa-e-sanford-es"],
  },
  {
    cat: "retirada",
    id: "retirada-hoteis-casas",
    title: "Entrega em hotéis e casas",
    parts: ["entrega-em-hoteis-e-casas-es"],
  },
  // Seguros e Regras
  {
    cat: "seguro",
    id: "seguro-e-franquia",
    title: "Seguro e franquia",
    summary: "O que o seguro cobre, franquia por categoria e o que fazer em caso de sinistro.",
    parts: [
      ["seguro-e-franquia", "Regras do seguro"],
      ["franquias-de-seguro", "Franquias por categoria"],
      ["politica-de-seguro-pt", PT_H],
      ["politica-de-seguro-es", ES_H],
    ],
  },
  {
    cat: "seguro",
    id: "cancelamento-e-alteracoes",
    title: "Cancelamento e alterações",
    summary: "Prazos e regras para cancelar ou alterar a reserva.",
    parts: [
      ["cancelamento-e-alteracoes", "Regras de cancelamento e alteração"],
      ["cancelamento-pt", PT_H],
      ["politica-de-cancelamento-es", ES_H],
    ],
  },
  {
    cat: "seguro",
    id: "politica-de-combustivel",
    title: "Política de combustível",
    parts: ["politica-de-combustivel"],
  },
  // Dicas e Benefícios
  {
    cat: "dica",
    id: "beneficios-inclusos",
    title: "Benefícios e cadeirinhas grátis",
    parts: [
      ["beneficios-extras-pt", PT_H],
      ["beneficios-e-cadeirinhas-gratis-es", ES_H],
    ],
  },
  {
    cat: "dica",
    id: "dicas-de-viagem",
    title: "Dicas de viagem",
    parts: [
      ["dicas-de-viagem-pt", PT_H],
      ["dicas-essenciais-de-viagem-es", ES_H],
    ],
  },
  {
    cat: "dica",
    id: "como-abastecer",
    title: "Como abastecer nos EUA",
    parts: ["como-abastecer-nos-eua"],
  },
];

/** Mesmo assunto em PT e ES sem regra específica (CS, arquivos novos): junta em uma página. */
function mergeLanguagePairs(articles: EArticle[], src: Sources): EArticle[] {
  const groups = new Map<string, EArticle[]>();
  for (const a of articles) {
    if (!langOf(a.title)) continue;
    const k = `${a.category}|${norm(stripLang(a.title))}`;
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }
  const replace = new Map<string, EArticle | null>();
  for (const g of groups.values()) {
    if (new Set(g.map((a) => langOf(a.title))).size < 2) continue;
    g.sort((a, b) => Number(langOf(a.title) !== "PT") - Number(langOf(b.title) !== "PT"));
    const m = compose(
      g.map((a) => ({ art: a, h: langOf(a.title) === "PT" ? PT_H : ES_H })),
      {
        id: `${baseId(g[0]!.id).replace(/-(pt|es)$/, "")}-pt-es`,
        category: g[0]!.category,
        title: stripLang(g[0]!.title),
      },
      src,
    );
    g.forEach((a, i) => replace.set(a.id, i === 0 ? m : null));
  }
  return articles.flatMap((a) => {
    if (!replace.has(a.id)) return [a];
    const r = replace.get(a.id);
    return r ? [r] : [];
  });
}

// Ordem das categorias: primeiro as ferramentas, depois o produto e o processo de venda.
const CAT_ORDEM = [
  "sistemas",
  "frota",
  "reserva",
  "pagamento",
  "retirada",
  "seguro",
  "dica",
  "atendimento",
  "outros",
];
const catRank = (c: ECategory) => {
  const i = CAT_ORDEM.findIndex((k) => norm(c.title).includes(k));
  return i < 0 ? CAT_ORDEM.length - 1 : i;
};

export function organizeKb<A extends EArticle>(
  articlesIn: A[],
  categoriesIn: ECategory[],
  sources: Sources = {},
): { articles: A[]; categories: ECategory[] } {
  let articles: EArticle[] = [...articlesIn];
  let categories: ECategory[] = categoriesIn.map((c) => ({ ...c }));
  const rank = new Map<string, number>(); // ordem dentro da categoria

  // 1) Frota (Comercial e CS).
  const fleet = organizeFleet(articles, categories, sources);
  articles = fleet.articles;
  fleet.order.forEach((id, i) => rank.set(id, i));

  // 2) Assuntos do Comercial.
  const area = categories[0]?.id.split("-")[0];
  if (area === "comercial") {
    const byBase = new Map<string, EArticle[]>();
    for (const a of articles) byBase.set(baseId(a.id), [...(byBase.get(baseId(a.id)) ?? []), a]);
    const used = new Set<string>();
    const made: EArticle[] = [];
    TOPICS_COMERCIAL.forEach((t, ti) => {
      const parent = categories.find((c) => !c.parent && norm(c.title).includes(t.cat));
      if (!parent) return;
      const parts: { art: EArticle; h?: string | undefined }[] = [];
      for (const p of t.parts) {
        const [id, h] = typeof p === "string" ? [p, undefined] : p;
        for (const art of byBase.get(id) ?? [])
          if (!used.has(art.id)) {
            parts.push({ art, h });
            used.add(art.id);
          }
      }
      if (!parts.length) return;
      let catId = parent.id;
      if (t.sub) {
        catId = `${area}-${t.sub.key}`;
        if (!categories.some((c) => c.id === catId))
          categories.push({
            id: catId,
            title: t.sub.title,
            description: t.sub.description,
            parent: parent.id,
          });
      }
      const m = compose(parts, { id: t.id, category: catId, title: t.title }, sources);
      if (t.summary) m.summary = t.summary;
      rank.set(t.id, ti);
      made.push(m);
    });
    // A pasta "Sistemas (HQ e CRM)" vira só "Sistemas", com os subtópicos HQ e CRM.
    const sis = categories.find((c) => !c.parent && norm(c.title).startsWith("sistemas"));
    if (sis) sis.title = "Sistemas";
    articles = [...articles.filter((a) => !used.has(a.id)), ...made];
  }

  // 3) PT/ES do mesmo assunto que sobraram.
  articles = mergeLanguagePairs(articles, sources);

  // 4) Ordem: categorias (filhos logo após o pai) e artigos dentro de cada uma.
  const tops = categories
    .filter((c) => !c.parent)
    .map((c, i) => ({ c, i }))
    .sort((a, b) => catRank(a.c) - catRank(b.c) || a.i - b.i)
    .map((x) => x.c);
  categories = tops.flatMap((c) => [c, ...categories.filter((k) => k.parent === c.id)]);
  const pos = new Map(articles.map((a, i) => [a.id, i]));
  const r = (a: EArticle) => rank.get(a.id) ?? 1e6 + pos.get(a.id)!;
  const out: EArticle[] = [];
  for (const c of categories)
    out.push(...articles.filter((a) => a.category === c.id).sort((a, b) => r(a) - r(b)));
  const seen = new Set(out.map((a) => a.id));
  out.push(...articles.filter((a) => !seen.has(a.id))); // nada some

  const has = (id: string) => out.some((a) => a.category === id);
  return {
    articles: out as unknown as A[],
    categories: categories.filter(
      (c) => has(c.id) || categories.some((k) => k.parent === c.id && has(k.id)),
    ),
  };
}
