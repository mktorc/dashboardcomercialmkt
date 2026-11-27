import { createFileRoute } from "@tanstack/react-router";

// Visualização ({ action: "view" }), "Isso ajudou?" ({ action: "vote", vote: 1 | -1 | 0 }),
// motivo do "Não" ({ action: "note", reason, note }) e nota do quiz ({ action: "quiz", score, total }).
// Um voto por usuário e artigo: votar de novo troca o voto; 0 remove.
// Visualização por dia, motivos e notas do quiz: tabelas kb_article_views_daily, kb_feedback_notes
// e kb_quiz_results (sql-para-gravar/base_conhecimento_engajamento.sql).
export const Route = createFileRoute("/api/kb/feedback")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const kb = await import("@/lib/kb/kb.server");
        let b: Record<string, unknown> = {};
        try {
          b = JSON.parse((await request.text()).slice(0, 32 * 1024));
        } catch {
          return kb.fail("Corpo inválido");
        }
        const u = await kb.requireArea(request, b["area"]);
        if ("denied" in u) return u.denied;
        if (b["action"] === "miss") {
          // Busca que não achou nada: guarda o termo (minúsculo, até 80 letras) para o painel de saúde.
          const q = String(b["q"] ?? "")
            .trim()
            .toLowerCase()
            .replace(/\s+/g, " ")
            .slice(0, 80);
          if (q.length >= 3) await kb.db.rpc("kb_register_miss", { p_area: u.area, p_q: q });
          return kb.ok();
        }
        if (b["action"] === "ai_rate" || b["action"] === "progress") {
          const st0 = await import("@/lib/kb/engajamento.server");
          try {
            if (b["action"] === "ai_rate") {
              const qid = Math.floor(Number(b["id"]));
              const r = Number(b["rating"]);
              if (!Number.isFinite(qid) || qid <= 0) return kb.fail("Pergunta inválida");
              await st0.rateQuestion(qid, u.userId, r === 1 ? 1 : r === -1 ? -1 : null);
              return kb.ok();
            }
            const ids = (v: unknown) =>
              Array.isArray(v)
                ? v.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 120))
                : [];
            const merged = await st0.saveProgress(
              u.area,
              u.userId,
              ids(b["read"]),
              Array.isArray(b["favs"]) ? ids(b["favs"]) : null,
            );
            return Response.json({ ok: true, ...merged });
          } catch {
            return kb.fail("Falha ao gravar", 500);
          }
        }
        const id = typeof b["articleId"] === "string" ? b["articleId"] : "";
        const areas = (await kb.articleAreas()).get(id);
        // Páginas criadas na revisão (perguntas frequentes, quiz...) não estão no articles.json.
        const { CURADORIA } = await import("@/lib/kb/curadoria");
        const curated = CURADORIA[u.area]?.pages.some((p) => p.id === id);
        if (!areas?.includes(u.area) && !curated)
          return kb.fail("Artigo não encontrado nesta área", 404);
        const st = await import("@/lib/kb/engajamento.server");

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
        if (b["action"] === "note") {
          const reason = String(b["reason"] ?? "").slice(0, 60);
          const note = String(b["note"] ?? "").slice(0, 500);
          if (!reason && !note) return kb.fail("Diga o que faltou");
          try {
            await st.addNote({ area: u.area, articleId: id, userId: u.userId, reason, note });
          } catch {
            return kb.fail("Falha ao gravar", 500);
          }
          return kb.ok();
        }
        if (b["action"] === "quiz") {
          const score = Math.max(0, Math.floor(Number(b["score"])));
          const total = Math.max(1, Math.floor(Number(b["total"])));
          if (!Number.isFinite(score) || score > total) return kb.fail("Nota inválida");
          try {
            await st.saveQuiz(u.area, u.userId, score, total);
          } catch {
            return kb.fail("Falha ao gravar a nota", 500);
          }
          return kb.ok();
        }
        return kb.fail("Ação inválida");
      },
    },
  },
});
