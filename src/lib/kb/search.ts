// Busca da Base de Conhecimento. Interface isolada: para trocar por embeddings depois,
// basta outra implementação de Searcher (o resto do código só usa search()).

export type KbChunk = {
  id: number;
  fileId: string;
  idx: number;
  content: string;
  name: string;
  folder: string;
  link: string | null;
  modifiedTime: string | null;
};

export type KbHit = KbChunk & { score: number };

export interface Searcher {
  search(query: string, k: number): KbHit[];
}

const STOP = new Set(
  (
    "a o e de da do das dos em no na nos nas um uma uns umas para pra por com sem que se ao aos " +
    "as os é ou mais como mas foi ser tem ter qual quais onde quando quem isso essa esse este esta " +
    "the of and to in is for on it eu voce vc nos me minha meu sua seu ja nao sim ha"
  ).split(" "),
);

/** Minúsculas, sem acento, só letras/números; descarta palavras vazias. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

/** BM25 (Okapi) em memória. Nome do arquivo e pasta entram no texto indexado. */
export class Bm25Searcher implements Searcher {
  private docs: { chunk: KbChunk; tf: Map<string, number>; len: number }[] = [];
  private df = new Map<string, number>();
  private avgLen = 1;

  constructor(
    chunks: KbChunk[],
    private k1 = 1.2,
    private b = 0.75,
  ) {
    let total = 0;
    for (const chunk of chunks) {
      const toks = tokenize(`${chunk.name} ${chunk.folder} ${chunk.content}`);
      const tf = new Map<string, number>();
      for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      this.docs.push({ chunk, tf, len: toks.length });
      total += toks.length;
    }
    this.avgLen = this.docs.length ? total / this.docs.length || 1 : 1;
  }

  search(query: string, k: number): KbHit[] {
    const terms = [...new Set(tokenize(query))];
    if (!terms.length || !this.docs.length) return [];
    const n = this.docs.length;
    const idf = new Map(
      terms.map((t) => {
        const df = this.df.get(t) ?? 0;
        return [t, Math.log(1 + (n - df + 0.5) / (df + 0.5))];
      }),
    );
    const hits: KbHit[] = [];
    for (const d of this.docs) {
      let score = 0;
      for (const t of terms) {
        const f = d.tf.get(t);
        if (!f) continue;
        score +=
          (idf.get(t) ?? 0) *
          ((f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * d.len) / this.avgLen)));
      }
      if (score > 0) hits.push({ ...d.chunk, score });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, k);
  }
}
