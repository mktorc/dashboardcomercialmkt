import { createFileRoute } from "@tanstack/react-router";

// Engajamento de UMA área: tendência de visualizações (7 dias x 7 anteriores), ranking do quiz e,
// só para Admin, os motivos do "Isso ajudou? Não".
export const Route = createFileRoute("/api/kb/engajamento")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const kb = await import("@/lib/kb/kb.server");
        const url = new URL(request.url);
        const u = await kb.requireArea(request, url.searchParams.get("area"));
        if ("denied" in u) return u.denied;
        const st = await import("@/lib/kb/engajamento.server");
        const [trend, ranking, notes, misses] = await Promise.all([
          st.viewTrend(),
          st.quizRanking(u.area),
          u.admin ? st.listNotes(u.area) : Promise.resolve([]),
          u.admin ? st.listMisses(u.area) : Promise.resolve([]),
        ]);
        return Response.json({
          ok: true,
          trend,
          ranking: ranking
            .slice(0, 10)
            .map(({ name, best, total, tries }) => ({ name, best, total, tries })),
          notes: notes.map(({ articleId, name, reason, note, at }) => ({
            articleId,
            name,
            reason,
            note,
            at,
          })),
          misses,
        });
      },
    },
  },
});
