// Gera os artigos da Base de Conhecimento (articles.json) a partir dos arquivos do Drive.
// Roda no fim de cada sincronização: arquivo novo ou alterado (inclusive de uma pasta nova) vira
// artigo(s) escrito(s) pela IA; arquivo sem mudança reaproveita o que já foi gerado; arquivo que
// saiu do Drive some. Cada artigo pertence só à área da pasta de onde veio (COMERCIAL ou CS) e a
// subpasta vira a categoria.

import { callWithFallback } from "./gemini.server";

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
type CacheEntry = { modified_time: string | null; articles: GenArticle[] };

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

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
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

async function generateFor(db: Db, f: FileRow): Promise<GenArticle[]> {
  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) throw new Error("GEMINI_API_KEY não configurada");
  const { data } = await db
    .from("kb_chunks")
    .select("content, idx")
    .eq("file_id", f.file_id)
    .order("idx")
    .limit(5000);
  const text = ((data ?? []) as { content: string }[])
    .map((c) => c.content)
    .join("\n")
    .slice(0, MAX_INPUT_CHARS);
  if (!text.trim()) return [];
  const body = JSON.stringify({
    contents: [
      {
        role: "user",
        parts: [{ text: `${PROMPT}\n\nArquivo: ${f.name}\nPasta: ${f.category}\n\n---\n${text}` }],
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
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await callWithFallback(apiKey, (model) =>
      fetch(`${API}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body,
      }),
    );
    if (res.status === 503 && attempt < 2) {
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
export async function regenerateArticles(db: Db, deadline: number): Promise<GenStats> {
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
      if (c && c.modified_time === f.modified_time) {
        results.set(f.file_id, c.articles);
        stats.reaproveitados++;
      } else todo.push(f);
    }),
  );

  const changed = todo.length > 0;
  for (let i = 0; i < todo.length; i += PARALLEL) {
    if (Date.now() > deadline) {
      stats.pendentes += todo.length - i;
      break;
    }
    await Promise.all(
      todo.slice(i, i + PARALLEL).map(async (f) => {
        try {
          const articles = await generateFor(db, f);
          await writeJson(db, `gen/${f.file_id}.json`, {
            modified_time: f.modified_time,
            articles,
          } satisfies CacheEntry);
          results.set(f.file_id, articles);
          stats.gerados++;
        } catch (e) {
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
    for (const a of gen) {
      let id = slug(a.title);
      for (let n = 2; usedIds.has(id); n++) id = `${slug(a.title)}-${n}`;
      usedIds.add(id);
      articles.push({ id, category: catId, ...a, sources: [f.file_id], areas: [area] });
    }
  }
  // Só regrava se algo mudou: arquivo novo/alterado, arquivo que saiu, ou ainda era o manual.
  const prev = current as { auto?: boolean; sources?: Record<string, unknown> } | null;
  const prevIds = Object.keys(prev?.sources ?? {});
  const sameFiles =
    prevIds.length === Object.keys(sources).length && prevIds.every((id) => id in sources);
  if (prev?.auto && sameFiles && !changed) return stats;
  // Só publica a base completa: com arquivo faltando (erro ou sem tempo), mantém a versão no ar e
  // guarda o que já foi gerado em gen/ para a próxima rodada. Evita a tela com metade dos artigos.
  if (stats.pendentes || stats.erros) return stats;

  await writeJson(db, "articles.json", {
    auto: true,
    generatedAt: new Date().toISOString(),
    categories: [...categories.values()],
    sources,
    articles,
  });
  return stats;
}
