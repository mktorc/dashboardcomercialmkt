import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/fila/historico")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { requireUser, db, ok, fail } = await import("@/lib/fila.server");
        const denied = await requireUser(request);
        if (denied) return denied;
        const { data, error } = await db
          .from("historico_leads")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(50);
        if (error) return fail("Falha ao consultar", 500);
        return ok({ historico: data ?? [] });
      },
    },
  },
});
