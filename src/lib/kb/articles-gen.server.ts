// Gera os artigos da Base de Conhecimento (articles.json) a partir dos arquivos do Drive.
// Roda no fim de cada sincronização: arquivo novo ou alterado (inclusive de uma pasta nova) vira
// artigo(s) escrito(s) pela IA; arquivo sem mudança reaproveita o que já foi gerado; arquivo que
// saiu do Drive some. Cada artigo pertence só à área da pasta de onde veio (COMERCIAL ou CS) e a
// subpasta vira a categoria.

import { callWithFallback } from "./gemini.server";
import { fixAccents } from "./acentos";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;
type Area = "comercial" | "cs";

type Step = { title: string; text?: string; list?: string[] };
type Block =
  | { t: "p" | "h" | "note" | "warn"; text: string }
  | { t: "list"; items: string[]; title?: string }
  | { t: "steps"; items: Step[] }
  | { t: "table"; head: string[]; rows: string[][] }
  | { t: "quote"; text: string; title?: string }
  | { t: "tags"; items: string[]; title?: string };

type GenArticle = { title: string; summary: string; keywords: string; blocks: Block[] };
type CacheEntry = { modified_time: string | null; v?: number; articles: GenArticle[] };
// Sobe quando a instrução de geração muda: força refazer todos os artigos.
const GEN_VERSION = 2;
const fresh = (c: CacheEntry | null, mt: string | null) =>
  !!c && c.modified_time === mt && c.v === GEN_VERSION;

type FileRow = {
  file_id: string;
  name: string;
  area: string;
  category: string;
  web_view_link: string | null;
  modified_time: string | null;
};

const API = "https://generativelanguage.googleapis.com";
const MAX_INPUT_CHARS = 120_000;
const PARALLEL = 3;

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "item";

const PROMPT = `Você organiza a base de conhecimento interna de uma locadora de carros (Orlando Rent Car).
Abaixo está o conteúdo de UM arquivo. Transforme-o em artigos de consulta rápida, em português do Brasil.

Regras:
- Um artigo por assunto/etapa/processo do arquivo (de 1 a 12 artigos). Arquivo curto = 1 artigo.
- Use SOMENTE o que está no arquivo. Não invente regra, valor, prazo nem nome de template.
- Procedimentos viram "steps" (passos numerados, títulos curtos e verbo no imperativo).
- Valores e comparações viram "table". Avisos importantes viram "warn"; dicas viram "note".
- Mensagens prontas para o cliente viram "quote" (title = nome do template, se houver).
- Seja objetivo: frases curtas, sem repetir o título.
- Título CURTO: no máximo 40 caracteres (2 a 5 palavras), sem parênteses nem nome de sistema
  quando a pasta já deixa claro. Ex.: "Pagamento em reais", "Cotação no HQ", "Categoria Minivan".
- Português correto, COM acentuação e cedilha em tudo (título, resumo e blocos): "validação",
  "transação", "dólares", "método". Nunca escreva palavras sem acento.
- Se o arquivo estiver em outro idioma, escreva o artigo em português mesmo assim.

Responda APENAS com JSON neste formato:
{"articles":[{"title":"...","summary":"uma frase","keywords":"palavras de busca sem acento",
"blocks":[
 {"t":"p","text":"..."},
 {"t":"h","text":"subtítulo"},
 {"t":"steps","steps":[{"title":"...","text":"...","list":["..."]}]},
 {"t":"list","title":"opcional","items":["..."]},
 {"t":"table","head":["..."],"rows":[["..."]]},
 {"t":"note","text":"..."},{"t":"warn","text":"..."},
 {"t":"quote","title":"opcional","text":"..."},
 {"t":"tags","title":"opcional","items":["..."]}
]}]}`;

const str = (v: unknown) =>
  typeof v === "string"
    ? v.replace(/[\u0000-\u0008\u000b-\u001f\ue000-\uf8ff\ufffd]/g, "").trim()
    : "";
const strs = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

/** Aceita só os tipos de bloco que a tela sabe desenhar, com os campos certos. */
function cleanBlock(b: Record<string, unknown>): Block | null {
  const t = str(b["t"]);
  if (t === "p" || t === "h" || t === "note" || t === "warn") {
    const text = str(b["text"]);
    return text ? { t, text } : null;
  }
  if (t === "list" || t === "tags") {
    const items = strs(b["items"]);
    const title = str(b["title"]);
    return items.length ? { t, items, ...(title ? { title } : {}) } : null;
  }
  if (t === "quote") {
    const text = str(b["text"]);
    const title = str(b["title"]);
    return text ? { t, text, ...(title ? { title } : {}) } : null;
  }
  if (t === "steps") {
    const raw = Array.isArray(b["steps"])
      ? b["steps"]
      : Array.isArray(b["items"])
        ? b["items"]
        : [];
    const items = raw
      .map((s: Record<string, unknown>) => {
        const title = str(s?.["title"]);
        const text = str(s?.["text"]);
        const list = strs(s?.["list"]);
        return title
          ? { title, ...(text ? { text } : {}), ...(list.length ? { list } : {}) }
          : null;
      })
      .filter(Boolean) as Step[];
    return items.length ? { t, items } : null;
  }
  if (t === "table") {
    const head = strs(b["head"]);
    const rows = (Array.isArray(b["rows"]) ? b["rows"] : [])
      .map((r: unknown) => (Array.isArray(r) ? r.map((c) => String(c ?? "").trim()) : null))
      .filter(Boolean) as string[][];
    return head.length && rows.length ? { t, head, rows } : null;
  }
  return null;
}

function parseArticles(raw: string): GenArticle[] {
  const json = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "")) as {
    articles?: Record<string, unknown>[];
  };
  return (json.articles ?? [])
    .map((a) => ({
      title: str(a["title"]),
      summary: str(a["summary"]),
      keywords: str(a["keywords"]),
      blocks: (Array.isArray(a["blocks"]) ? a["blocks"] : [])
        .map((b: Record<string, unknown>) => cleanBlock(b ?? {}))
        .filter(Boolean) as Block[],
    }))
    .filter((a) => a.title && a.blocks.length);
}

// Formato obrigatório da resposta: o Gemini só devolve JSON que segue este esquema (evita JSON
// quebrado). Um único tipo de bloco com campos opcionais; cleanBlock valida cada tipo.
const S = { type: "STRING" } as const;
const SA = { type: "ARRAY", items: S } as const;
const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    articles: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: S,
          summary: S,
          keywords: S,
          blocks: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                t: {
                  type: "STRING",
                  enum: ["p", "h", "note", "warn", "list", "tags", "quote", "steps", "table"],
                },
                text: S,
                title: S,
                items: SA,
                steps: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: { title: S, text: S, list: SA },
                    required: ["title"],
                  },
                },
                head: SA,
                rows: { type: "ARRAY", items: SA },
              },
              required: ["t"],
            },
          },
        },
        required: ["title", "summary", "keywords", "blocks"],
      },
    },
  },
  required: ["articles"],
};

/** Sem tempo nesta rodada: o arquivo fica pendente (não conta como erro) e segue na próxima. */
class SemTempo extends Error {}

// Arquivo grande (vídeo longo, PDF extenso) vira partes de até PART_CHARS, cada uma gerada e
// guardada à parte (gen/<id>.p<n>.json). Assim nenhum arquivo precisa caber inteiro numa rodada:
// cada rodada avança algumas partes e a última junta tudo.
const PART_CHARS = 20_000;
// Uma chamada travada não pode comer a rodada inteira: corta e passa para o próximo modelo.
const CALL_TIMEOUT_MS = 120_000;

function splitParts(chunks: string[]): string[] {
  const parts: string[] = [];
  let cur = "";
  for (const c of chunks) {
    if (cur && cur.length + c.length > PART_CHARS) {
      parts.push(cur);
      cur = "";
    }
    cur += (cur ? "\n" : "") + c;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

async function generateFor(db: Db, f: FileRow, hardStop: number): Promise<GenArticle[]> {
  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) throw new Error("GEMINI_API_KEY não configurada");
  const { data } = await db
    .from("kb_chunks")
    .select("content, idx")
    .eq("file_id", f.file_id)
    .order("idx")
    .limit(5000);
  const chunks = ((data ?? []) as { content: string }[]).map((c) => c.content);
  const total = chunks.join("\n").slice(0, MAX_INPUT_CHARS);
  if (!total.trim()) return [];
  if (total.length <= PART_CHARS * 1.25) return generatePart(apiKey, f, total, hardStop, "");

  const parts = splitParts(chunks).slice(0, Math.ceil(MAX_INPUT_CHARS / PART_CHARS));
  const all: GenArticle[] = [];
  for (let i = 0; i < parts.length; i++) {
    const path = `gen/${f.file_id}.p${i}.json`;
    const cached = await readJson<CacheEntry>(db, path);
    if (fresh(cached, f.modified_time)) {
      all.push(...cached!.articles);
      continue;
    }
    const label = ` (parte ${i + 1} de ${parts.length})`;
    const articles = await generatePart(apiKey, f, parts[i]!, hardStop, label);
    await writeJson(db, path, {
      modified_time: f.modified_time,
      v: GEN_VERSION,
      articles,
    } satisfies CacheEntry);
    all.push(...articles);
  }
  return all;
}

async function generatePart(
  apiKey: string,
  f: FileRow,
  text: string,
  hardStop: number,
  label: string,
): Promise<GenArticle[]> {
  const body = JSON.stringify({
    contents: [
      {
        role: "user",
        parts: [
          { text: `${PROMPT}\n\nArquivo: ${f.name}${label}\nPasta: ${f.category}\n\n---\n${text}` },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 32768,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  });
  // Resposta cortada ou fora do formato: tenta de novo (até 3 vezes no total).
  let lastErr: unknown = null;
  // Cada chamada é cortada no limite da função (hardStop): sem isso a Vercel mata a execução no
  // meio, a rodada fica presa em "rodando" e nada do que já foi gerado é gravado.
  const left = () => hardStop - Date.now();
  for (let attempt = 0; attempt < 3; attempt++) {
    if (left() < 20_000) throw new SemTempo("Sem tempo nesta rodada");
    const res = await callWithFallback(apiKey, async (model) => {
      if (left() < 10_000) return new Response("sem tempo", { status: 503 });
      try {
        return await fetch(`${API}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
          body,
          signal: AbortSignal.timeout(Math.min(CALL_TIMEOUT_MS, left())),
        });
      } catch {
        // Demorou demais: trata como sobrecarga e deixa o próximo modelo tentar.
        return new Response("timeout", { status: 503 });
      }
    });
    if (res.status === 503 && left() < 20_000) throw new SemTempo("Sem tempo nesta rodada");
    if (res.status === 503 && attempt < 2 && left() > 15_000 * (attempt + 1) + 30_000) {
      // Todos os modelos sobrecarregados: espera um pouco e tenta de novo.
      await new Promise((r) => setTimeout(r, 15_000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 500)}`);
    const out = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const raw = (out.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    try {
      return parseArticles(raw);
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`Resposta do Gemini fora do formato: ${String(lastErr).slice(0, 300)}`);
}

async function readJson<T>(db: Db, path: string): Promise<T | null> {
  const { data, error } = await db.storage.from("kb").download(path);
  if (error || !data) return null;
  try {
    return JSON.parse(await data.text()) as T;
  } catch {
    return null;
  }
}

async function writeJson(db: Db, path: string, value: unknown) {
  const { error } = await db.storage
    .from("kb")
    .upload(path, new Blob([JSON.stringify(value)], { type: "application/json" }), {
      upsert: true,
      contentType: "application/json",
    });
  if (error) throw new Error(`Falha ao gravar ${path}: ${error.message}`);
}

export type GenStats = {
  gerados: number;
  reaproveitados: number;
  pendentes: number;
  erros: number;
};

/**
 * Atualiza o articles.json. `deadline` (epoch ms): não começa arquivo novo depois dele; o que
 * faltar fica para a próxima sincronização (status "parcial").
 */
export async function regenerateArticles(
  db: Db,
  deadline: number,
  hardStop: number,
): Promise<GenStats> {
  const stats: GenStats = { gerados: 0, reaproveitados: 0, pendentes: 0, erros: 0 };
  const { data } = await db
    .from("kb_files")
    .select("file_id, name, area, category, web_view_link, modified_time")
    .eq("status", "indexado")
    .in("area", ["comercial", "cs"])
    .order("name")
    .limit(10_000);
  const files = (data ?? []) as FileRow[];

  // Guarda uma cópia dos artigos escritos à mão antes da primeira geração automática.
  const current = await readJson<{ auto?: boolean }>(db, "articles.json");
  if (current && !current.auto && !(await readJson(db, "articles-manual-backup.json")))
    await writeJson(db, "articles-manual-backup.json", current);

  const results = new Map<string, GenArticle[]>();
  const todo: FileRow[] = [];
  await Promise.all(
    files.map(async (f) => {
      const c = await readJson<CacheEntry>(db, `gen/${f.file_id}.json`);
      if (fresh(c, f.modified_time)) {
        results.set(f.file_id, c!.articles);
        stats.reaproveitados++;
      } else {
        // Versão antiga do arquivo continua no ar até a nova ficar pronta.
        if (c?.articles?.length) results.set(f.file_id, c!.articles);
        todo.push(f);
      }
    }),
  );

  // Menores primeiro: numa rodada curta, muitos arquivos pequenos entram antes dos vídeos longos.
  const { data: sizes } = await db
    .from("kb_chunks")
    .select("file_id")
    .in(
      "file_id",
      todo.map((f) => f.file_id),
    )
    .limit(100_000);
  const nChunks = new Map<string, number>();
  for (const r of (sizes ?? []) as { file_id: string }[])
    nChunks.set(r.file_id, (nChunks.get(r.file_id) ?? 0) + 1);
  todo.sort((x, y) => (nChunks.get(x.file_id) ?? 0) - (nChunks.get(y.file_id) ?? 0));
  let changed = false;
  for (let i = 0; i < todo.length; i += PARALLEL) {
    if (Date.now() > deadline) {
      stats.pendentes += todo.length - i;
      break;
    }
    await Promise.all(
      todo.slice(i, i + PARALLEL).map(async (f) => {
        try {
          const articles = await generateFor(db, f, hardStop);
          await writeJson(db, `gen/${f.file_id}.json`, {
            modified_time: f.modified_time,
            v: GEN_VERSION,
            articles,
          } satisfies CacheEntry);
          results.set(f.file_id, articles);
          stats.gerados++;
          changed = true;
        } catch (e) {
          if (e instanceof SemTempo) {
            stats.pendentes++;
            return;
          }
          console.error(`[kb] artigos: falha em ${f.name}`, e);
          stats.erros++;
        }
      }),
    );
  }

  // Monta o articles.json só com os arquivos que já têm artigo gerado.
  const categories = new Map<string, { id: string; title: string; description: string }>();
  const sources: Record<string, { name: string; link: string }> = {};
  const articles: Record<string, unknown>[] = [];
  const usedIds = new Set<string>();
  for (const f of files) {
    const gen = results.get(f.file_id);
    if (!gen?.length) continue;
    const area = f.area as Area;
    const catId = `${area}-${slug(f.category || "Geral")}`;
    if (!categories.has(catId))
      categories.set(catId, {
        id: catId,
        title: f.category || "Geral",
        description: `Pasta ${f.category || "Geral"} (${area === "cs" ? "CS" : "Comercial"}).`,
      });
    sources[f.file_id] = { name: f.name, link: f.web_view_link ?? "" };
    // Documento com versão em português e espanhol ([ORC PT] / [ORC ES] no nome): o idioma vai
    // no título, para as duas versões aparecerem lado a lado sem parecer duplicadas.
    const lang = /\[ORC\s*(PT|ES)\]/i.exec(f.name)?.[1]?.toUpperCase();
    for (const g0 of gen) {
      const g = accentArticle(g0);
      const a =
        lang && !g.title.endsWith(`(${lang})`) ? { ...g, title: `${g.title} (${lang})` } : g;
      let id = slug(a.title);
      for (let n = 2; usedIds.has(id); n++) id = `${slug(a.title)}-${n}`;
      usedIds.add(id);
      articles.push({ id, category: catId, ...a, sources: [f.file_id], areas: [area] });
    }
  }
  // Arquivos soltos na raiz da área (sem subpasta) caem todos em "Geral": a IA agrupa esses
  // artigos por assunto. Subpasta no Drive continua mandando na categoria.
  for (const area of ["comercial", "cs"] as Area[]) {
    const geralId = `${area}-geral`;
    const loose = articles.filter((a) => a["category"] === geralId);
    if (loose.length < 6) continue;
    const groups = await groupByTopic(db, area, loose, hardStop);
    if (!groups) continue;
    categories.delete(geralId);
    for (const g of groups.categories) categories.set(g.id, g);
    for (const a of loose) a["category"] = groups.assign[a["id"] as string] ?? geralId;
    if (loose.some((a) => a["category"] === geralId))
      categories.set(geralId, { id: geralId, title: "Outros", description: "Outros assuntos." });
  }
  // Só regrava se algo mudou: arquivo novo/alterado, arquivo que saiu, ou ainda era o manual.
  const prev = current as {
    auto?: boolean;
    sources?: Record<string, unknown>;
    grouped?: number;
  } | null;
  const prevIds = Object.keys(prev?.sources ?? {});
  const sameFiles =
    prevIds.length === Object.keys(sources).length && prevIds.every((id) => id in sources);
  if (prev?.auto && prev.grouped === GROUP_VERSION && sameFiles && !changed) return stats;
  // Publica a cada avanço: com o Gemini instável (503), exigir base completa travava a publicação
  // para sempre. O que falhou fica para a próxima rodada (status "parcial" encadeia outra).
  if (!Object.keys(sources).length) return stats;

  await writeJson(db, "articles.json", {
    auto: true,
    grouped: GROUP_VERSION,
    generatedAt: new Date().toISOString(),
    categories: [...categories.values()],
    sources,
    articles,
  });
  return stats;
}

// ---- Agrupamento por assunto -------------------------------------------------------------

const GROUP_VERSION = 3;
type Cat = { id: string; title: string; description: string };
type Groups = { key: string; categories: Cat[]; assign: Record<string, string> };

const GROUP_PROMPT = `Você organiza o menu de uma base de conhecimento interna de uma locadora de carros.
Abaixo estão os artigos de uma área (id | título | resumo). Agrupe-os em 5 a 10 categorias por
assunto, com nomes curtos em português (2 a 4 palavras, ex.: "Frota e Categorias", "Pagamentos",
"Sistemas (HQ e CRM)", "Seguros e Regras"). Ordene as categorias da mais usada no dia a dia para a
menos usada. Todo artigo entra em exatamente uma categoria. Use os ids exatamente como recebidos.`;

const GROUP_SCHEMA = {
  type: "OBJECT",
  properties: {
    categories: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: S,
          description: S,
          articles: SA,
        },
        required: ["title", "description", "articles"],
      },
    },
  },
  required: ["categories"],
};

/** Agrupa por assunto com a IA; guarda em groups-<area>.json e só refaz quando os artigos mudam. */
async function groupByTopic(
  db: Db,
  area: Area,
  arts: Record<string, unknown>[],
  hardStop: number,
): Promise<Groups | null> {
  const key =
    `${GROUP_VERSION}:` +
    arts
      .map((a) => a["id"] as string)
      .sort()
      .join(",");
  const path = `groups-${area}.json`;
  const cached = await readJson<Groups>(db, path);
  if (cached?.key === key) return cached;
  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey || hardStop - Date.now() < 30_000) return cached ?? null;
  const list = arts.map((a) => `${a["id"]} | ${a["title"]} | ${a["summary"] ?? ""}`).join("\n");
  try {
    const res = await callWithFallback(apiKey, async (model) => {
      try {
        return await fetch(`${API}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: `${GROUP_PROMPT}\n\n${list}` }] }],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 16384,
              responseMimeType: "application/json",
              responseSchema: GROUP_SCHEMA,
            },
          }),
          signal: AbortSignal.timeout(Math.max(1_000, Math.min(90_000, hardStop - Date.now()))),
        });
      } catch {
        return new Response("timeout", { status: 503 });
      }
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}`);
    const out = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const raw = (out.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    const json = JSON.parse(raw) as {
      categories?: { title?: string; description?: string; articles?: string[] }[];
    };
    const valid = new Set(arts.map((a) => a["id"] as string));
    const categories: Cat[] = [];
    const assign: Record<string, string> = {};
    for (const c of json.categories ?? []) {
      const title = str(c.title);
      if (!title) continue;
      let id = `${area}-${slug(title)}`;
      for (let n = 2; categories.some((x) => x.id === id); n++) id = `${area}-${slug(title)}-${n}`;
      const ids = strs(c.articles).filter((x) => valid.has(x) && !assign[x]);
      if (!ids.length) continue;
      for (const x of ids) assign[x] = id;
      categories.push({ id, title, description: str(c.description) || title });
    }
    if (!categories.length) throw new Error("agrupamento vazio");
    const groups: Groups = { key, categories, assign };
    await writeJson(db, path, groups);
    return groups;
  } catch (e) {
    console.error(`[kb] agrupamento ${area} falhou`, e);
    return cached ?? null; // sem IA agora: usa o último agrupamento (ou fica em "Geral")
  }
}

/** Acentua título, resumo e todo texto dos blocos (palavras-chave ficam sem acento, para busca). */
function accentArticle(a: GenArticle): GenArticle {
  const deep = (v: unknown): unknown =>
    typeof v === "string"
      ? fixAccents(v)
      : Array.isArray(v)
        ? v.map(deep)
        : v && typeof v === "object"
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === "t" ? x : deep(x)]))
          : v;
  return {
    ...a,
    title: fixAccents(a.title),
    summary: fixAccents(a.summary),
    blocks: deep(a.blocks) as Block[],
  };
}
