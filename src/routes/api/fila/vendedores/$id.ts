import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/fila/vendedores/$id")({
  server: {
    handlers: {
      DELETE: async ({ request, params }) => {
        const { requireUser, db, ok, fail, intId } = await import("@/lib/fila.server");
        const denied = await requireUser(request);
        if (denied) return denied;
        const id = intId(params.id);
        if (!id) return fail("ID inválido");
        const { data, error } = await db.from("vendedores").delete().eq("id", id).select("id");
        if (error) return fail("Falha ao remover", 500);
        if (!data?.length) return fail("Vendedor não encontrado", 404);
        return ok();
      },
    },
  },
});
