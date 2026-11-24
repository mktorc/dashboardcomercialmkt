import { createFileRoute } from "@tanstack/react-router";

// Visualização ({ action: "view" }) e "Isso ajudou?" ({ action: "vote", vote: 1 | -1 | 0 }).
// Um voto por usuário e artigo: votar de novo troca o voto; 0 remove.
export const Route = createFileRoute("/api/kb/feedback")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const kb = await import("@/lib/kb/kb.server");
        let b: Record<string, unknown> = {};
        try {
          b = JSON.parse((await request.text()).slice(0, 2048));
        } catch {
          return kb.fail("Corpo inválido");
        }
        const u = await kb.requireArea(request, b["area"]);
        if ("denied" in u) return u.denied;
        const id = typeof b["articleId"] === "string" ? b["articleId"] : "";
        const areas = (await kb.articleAreas()).get(id);
        if (!areas?.includes(u.area)) return kb.fail("Artigo não encontrado nesta área", 404);

        if (b["action"] === "view") {
          await kb.db.rpc("kb_register_view", { p_article: id });
          return kb.ok();
        }
        if (b["action"] === "vote") {
          const vote = Number(b["vote"]);
          if (vote === 0) {
            await kb.db
              .from("kb_article_votes")
              .delete()
              .eq("article_id", id)
              .eq("user_id", u.userId);
          } else if (vote === 1 || vote === -1) {
            const { error } = await kb.db.from("kb_article_votes").upsert({
              article_id: id,
              user_id: u.userId,
              vote,
              updated_at: new Date().toISOString(),
            });
            if (error) return kb.fail("Falha ao gravar o voto", 500);
          } else return kb.fail("Voto inválido");
          return kb.ok();
        }
        return kb.fail("Ação inválida");
      },
    },
  },
});
