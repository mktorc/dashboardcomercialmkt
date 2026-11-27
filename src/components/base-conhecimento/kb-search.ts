// Busca da base no navegador: ignora acento e tolera erro de digitação (distância de edição).
import type { Article, Block } from "./kb-api";

export const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function blockText(b: Block): string {
  switch (b.t) {
    case "steps":
      return b.items
        .map((s) => `${s.title}. ${s.text ?? ""} ${(s.list ?? []).join(". ")}`)
        .join(" ");
    case "list":
    case "tags":
      return `${b.title ?? ""} ${b.items.join(". ")}`;
    case "table":
      return [...b.head, ...b.rows.map((r) => r.join(" "))].join(". ");
    case "img":
      return b.caption;
    case "file":
      return b.name;
    case "cards":
      return b.items.map((c) => `${c.title} ${c.text}`).join(". ");
    case "keys":
      return b.items.map((x) => `${x.value} ${x.label}`).join(". ");
    case "widget":
    case "thumb":
      return "";
    case "quiz":
      return b.items.map((x) => x.q).join(". ");
    case "faq":
      return b.items.map((f) => `${f.q} ${f.a}`).join(". ");
    case "langs":
      return b.items.map((l) => l.text).join(". ");
    case "flow":
      return b.items.map((f) => `${f.title} ${f.when ?? ""}`).join(". ");
    default:
      return b.text;
  }
}

/** Distância de edição limitada (para quando passa de max). */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      best = Math.min(best, cur[j]!);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

const STOP = new Set(
  "a o e de da do das dos em no na um uma para pra por com que se como faco fazer quando qual onde".split(
    " ",
  ),
);

type Indexed = {
  article: Article;
  title: string;
  body: string; // texto original (para trecho)
  bodyNorm: string;
  words: Set<string>;
};

export function buildIndex(articles: Article[]): Indexed[] {
  return articles.map((a) => {
    const body = `${a.summary}. ${a.blocks.map(blockText).join(" ")}`;
    const all = norm(`${a.title} ${a.keywords} ${body}`);
    return {
      article: a,
      title: norm(a.title),
      body,
      bodyNorm: norm(body),
      words: new Set(all.split(/[^a-z0-9]+/).filter((w) => w.length > 1)),
    };
  });
}

export type SearchHit = {
  article: Article;
  score: number;
  snippet: { before: string; match: string; after: string } | null;
};

/** Termo casa com uma palavra: prefixo, ou erro de 1 letra (4+ letras) / 2 letras (7+). */
function termMatches(term: string, words: Set<string>): string | null {
  for (const w of words) if (w.startsWith(term)) return w;
  const max = term.length >= 7 ? 2 : term.length >= 4 ? 1 : 0;
  if (!max) return null;
  for (const w of words)
    if (editDistance(term, w.slice(0, term.length + max), max) <= max) return w;
  return null;
}

export function searchArticles(index: Indexed[], query: string, limit = 20): SearchHit[] {
  const terms = norm(query)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
  if (!terms.length) return [];
  const hits: SearchHit[] = [];
  for (const it of index) {
    let score = 0;
    let firstWord: string | null = null;
    let matched = 0;
    for (const t of terms) {
      const w = termMatches(t, it.words);
      if (!w) continue;
      matched++;
      firstWord ??= w;
      score += it.title.includes(w) ? 5 : 1;
      if (w === t || w.startsWith(t)) score += 1;
    }
    // Exige a maioria dos termos (todos, se forem até 2).
    if (matched < Math.max(1, terms.length <= 2 ? terms.length : Math.ceil(terms.length * 0.6)))
      continue;
    let snippet: SearchHit["snippet"] = null;
    if (firstWord) {
      const pos = it.bodyNorm.indexOf(firstWord);
      if (pos >= 0) {
        const start = Math.max(0, pos - 50);
        const end = Math.min(it.body.length, pos + firstWord.length + 70);
        snippet = {
          before: (start > 0 ? "…" : "") + it.body.slice(start, pos),
          match: it.body.slice(pos, pos + firstWord.length),
          after: it.body.slice(pos + firstWord.length, end) + (end < it.body.length ? "…" : ""),
        };
      }
    }
    hits.push({ article: it.article, score, snippet });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

// ───────────── Resposta direta ─────────────
// "franquia van", "taxa tampa": procura nos números-chave e nas linhas de tabela das páginas
// e devolve o valor, em vez de só listar artigos.
export type QuickAnswer = { value: string; label: string; article: Article };
const foldQ = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const QA_STOP = new Set([
  "qual",
  "quanto",
  "custa",
  "valor",
  "para",
  "como",
  "taxa",
  "preco",
  "de",
  "da",
  "do",
  "em",
  "e",
  "o",
  "a",
]);

export function quickAnswer(articles: Article[], q: string): QuickAnswer | null {
  const all = foldQ(q)
    .split(/[^a-z0-9$]+/)
    .filter((t) => t.length >= 2);
  const toks = all.filter((t) => !QA_STOP.has(t));
  if (!toks.length) return null;
  const wantsFee = all.some((t) => ["taxa", "valor", "quanto", "custa", "preco"].includes(t));
  let best: (QuickAnswer & { score: number }) | null = null;
  const consider = (value: string, label: string, ctx: string, a: Article, bonus: number) => {
    const hay = foldQ(`${label} ${ctx} ${a.title}`);
    const has = (s: string, t: string) =>
      new RegExp(`(^|[^a-z0-9])${t.replace(/[$]/g, "\\$")}`).test(s);
    if (!toks.every((t) => has(hay, t))) return;
    const score = bonus + toks.filter((t) => has(foldQ(label), t)).length;
    if (!best || score > best.score) best = { value, label, article: a, score };
  };
  for (const a of articles)
    for (const b of a.blocks) {
      if (b.t === "keys") for (const k of b.items) consider(k.value, k.label, "", a, 2);
      if (b.t === "table" && b.head.length >= 2)
        for (const r of b.rows) {
          // Valor = primeira coluna (depois da 1ª) com US$ ou %; senão a última.
          let vi = r.findIndex((c, i) => i > 0 && /\$|%/.test(c));
          if (vi < 0) vi = r.length - 1;
          const val = r[vi] ?? "";
          if (wantsFee && !/\$|%|\d/.test(val)) continue;
          consider(
            val,
            r[0] ?? "",
            `${r.join(" ")} ${b.head.join(" ")}`,
            a,
            /\$|%|\d/.test(val) ? 1 : 0,
          );
        }
    }
  return best;
}
