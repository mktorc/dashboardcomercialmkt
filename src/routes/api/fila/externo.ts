import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/fila/externo")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { requireUser, readJson, db, ok, fail, text, intId } =
          await import("@/lib/fila.server");
        const denied = await requireUser(request);
        if (denied) return denied;
        const b = await readJson(request);
        const userId = intId(b?.["userId"]);
        const nome = text(b?.["nome"]);
        const telefone = text(b?.["telefone"], 40);
        if (!userId || !nome || !telefone) return fail("Informe userId, nome e telefone");
        const { data, error } = await db.rpc("fila_externo", {
          p_cm_user_id: userId,
          p_nome: nome,
          p_telefone: telefone,
        });
        if (error) return fail("Falha ao registrar", 500);
        if (!data) return fail("Vendedor não encontrado", 404);
        return ok();
      },
    },
  },
});
