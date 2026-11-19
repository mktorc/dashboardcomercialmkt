import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/fila/toggle")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { requireUser, readJson, db, ok, fail, intId } = await import("@/lib/fila.server");
        const denied = await requireUser(request);
        if (denied) return denied;
        const userId = intId((await readJson(request))?.["userId"]);
        if (!userId) return fail("Informe userId");
        const { data: v, error } = await db
          .from("vendedores")
          .select("id, ativo")
          .eq("cm_user_id", userId)
          .maybeSingle();
        if (error) return fail("Falha ao consultar", 500);
        if (!v) return fail("Vendedor não encontrado", 404);
        const { error: e2 } = await db
          .from("vendedores")
          .update({ ativo: !v.ativo })
          .eq("id", v.id);
        if (e2) return fail("Falha ao atualizar", 500);
        return ok({ ativo: !v.ativo });
      },
    },
  },
});
