import { createFileRoute } from "@tanstack/react-router";

// Artigos de UMA área (?area=comercial|cs), filtrados no servidor: o usuário só recebe a área a que
// tem acesso. Junta: artigos (bucket privado "kb"), imagens assinadas, templates do Drive,
// data de atualização real dos arquivos de origem, visualizações e votos.
type Block = { t: string; src?: string } & Record<string, unknown>;
type Article = {
  id: string;
  areas: string[];
  sources: string[];
  blocks: Block[];
} & Record<string, unknown>;
type KbData = {
  generatedAt: string;
  categories: unknown[];
  sources: Record<string, { name: string; link: string }>;
  articles: Article[];
};

// Cache do conteúdo estático (artigos + links assinados); estatísticas vêm sempre na hora.
let cache: { at: number; data: KbData; images: Record<string, string> } | null = null;
const TTL_MS = 30 * 60_000; // menor que a validade do link assinado (1 h)

const fileIdOf = (link: string) => /\/d\/([\w-]{10,})/.exec(link)?.[1] ?? null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readJson<T>(storage: any, path: string): Promise<T | null> {
  const { data, error } = await storage.download(path);
  if (error || !data) return null;
  try {
    return JSON.parse(await data.text()) as T;
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/api/kb/articles")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const kb = await import("@/lib/kb/kb.server");
        const url = new URL(request.url);
        const u = await kb.requireArea(request, url.searchParams.get("area"));
        if ("denied" in u) return u.denied;
        const storage = kb.db.storage.from("kb");

        if (!cache || Date.now() - cache.at > TTL_MS) {
          const data = await readJson<KbData>(storage, "articles.json");
          if (!data) return kb.fail("Base ainda não foi gerada", 404);
          const srcs = [
            ...new Set(
              data.articles.flatMap((a) =>
                a.blocks.filter((b) => b.t === "img" && b.src).map((b) => `img/${b.src}`),
              ),
            ),
          ];
          const images: Record<string, string> = {};
          if (srcs.length) {
            const { data: signed } = await storage.createSignedUrls(srcs, 60 * 60);
            for (const s of signed ?? [])
              if (s.path && s.signedUrl) images[s.path.replace(/^img\//, "")] = s.signedUrl;
          }
          cache = { at: Date.now(), data, images };
        }
        const { data, images } = cache;
        const articles = data.articles.filter((a) => a.areas.includes(u.area));
        const ids = articles.map((a) => a.id);

        // Data real de atualização: o arquivo de origem mais recente no Drive.
        const fileIds = [
          ...new Set(
            articles.flatMap((a) =>
              a.sources.map((s) => fileIdOf(data.sources[s]?.link ?? "")).filter(Boolean),
            ),
          ),
        ];
        const [files, views, votes, myVotes, tplArea, tplShared] = await Promise.all([
          fileIds.length
            ? kb.db.from("kb_files").select("file_id, modified_time").in("file_id", fileIds)
            : { data: [] },
          kb.db.from("kb_article_views").select("article_id, views").in("article_id", ids),
          kb.db.from("kb_article_votes").select("article_id, vote").in("article_id", ids),
          kb.db
            .from("kb_article_votes")
            .select("article_id, vote")
            .eq("user_id", u.userId)
            .in("article_id", ids),
          readJson<{ templates: unknown[] }>(storage, `templates-${u.area}.json`),
          readJson<{ templates: unknown[] }>(storage, "templates-compartilhado.json"),
        ]);
        const modByFile = new Map<string, string>(
          (files.data ?? []).map((f: { file_id: string; modified_time: string }) => [
            f.file_id,
            f.modified_time,
          ]),
        );
        const stats: Record<string, { views: number; up: number; down: number; mine: number }> = {};
        for (const id of ids) stats[id] = { views: 0, up: 0, down: 0, mine: 0 };
        for (const v of views.data ?? []) stats[v.article_id]!.views = v.views;
        for (const v of votes.data ?? []) {
          if (v.vote > 0) stats[v.article_id]!.up++;
          else stats[v.article_id]!.down++;
        }
        for (const v of myVotes.data ?? []) stats[v.article_id]!.mine = v.vote;

        const withDates = articles.map((a) => {
          const mods = a.sources
            .map((s) => modByFile.get(fileIdOf(data.sources[s]?.link ?? "") ?? ""))
            .filter(Boolean) as string[];
          const updatedAt = mods.sort().at(-1) ?? data.generatedAt;
          return { ...a, updatedAt, shared: a.areas.length > 1 };
        });

        return kb.ok({
          area: u.area,
          areas: u.areas,
          admin: u.admin,
          generatedAt: data.generatedAt,
          categories: data.categories,
          sources: data.sources,
          articles: withDates,
          images,
          stats,
          templates: [...(tplArea?.templates ?? []), ...(tplShared?.templates ?? [])],
        });
      },
    },
  },
});
