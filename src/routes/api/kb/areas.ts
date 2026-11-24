import { createFileRoute } from "@tanstack/react-router";

// Tela de escolha: áreas que o usuário pode abrir e quantos artigos cada uma tem.
export const Route = createFileRoute("/api/kb/areas")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const kb = await import("@/lib/kb/kb.server");
        const u = await kb.requireKbUser(request);
        if ("denied" in u) return u.denied;
        const index = await kb.articleAreas();
        const counts = Object.fromEntries(
          u.areas.map((a) => [a, [...index.values()].filter((ar) => ar.includes(a)).length]),
        );
        return kb.ok({ areas: u.areas, admin: u.admin, counts });
      },
    },
  },
});
