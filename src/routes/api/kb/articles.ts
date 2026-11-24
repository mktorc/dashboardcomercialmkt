import { createFileRoute } from "@tanstack/react-router";

// Aba "Base": artigos organizados (gerados a partir dos arquivos do Drive) guardados no bucket
// privado "kb" do Supabase Storage. As imagens saem com link assinado de 1 hora.
type Block = { t: string; src?: string } & Record<string, unknown>;
type KbData = { articles: { blocks: Block[] }[] } & Record<string, unknown>;

let cache: { at: number; body: Record<string, unknown> } | null = null;
const TTL_MS = 30 * 60_000; // menor que a validade do link assinado

export const Route = createFileRoute("/api/kb/articles")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const kb = await import("@/lib/kb/kb.server");
        const u = await kb.requireKbUser(request);
        if ("denied" in u) return u.denied;
        if (cache && Date.now() - cache.at < TTL_MS) return kb.ok(cache.body);

        const storage = kb.db.storage.from("kb");
        const { data: file, error } = await storage.download("articles.json");
        if (error || !file) return kb.fail("Base ainda não foi gerada", 404);
        const data = JSON.parse(await file.text()) as KbData;

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
          for (const s of signed ?? []) {
            if (s.path && s.signedUrl) images[s.path.replace(/^img\//, "")] = s.signedUrl;
          }
        }
        const body = { ...data, images };
        cache = { at: Date.now(), body };
        return kb.ok(body);
      },
    },
  },
});
