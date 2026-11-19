import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/fila/vendedores/")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { requireUser, db, ok, fail } = await import("@/lib/fila.server");
        const denied = await requireUser(request);
        if (denied) return denied;
        const { data, error } = await db
          .from("vendedores")
          .select("*")
          .order("ultimo_lead_at", { ascending: true, nullsFirst: true })
          .order("id", { ascending: true });
        if (error) return fail("Falha ao consultar", 500);
        return ok({ vendedores: data ?? [] });
      },
      POST: async ({ request }) => {
        const { requireUser, readJson, db, ok, fail, text, intId } =
          await import("@/lib/fila.server");
        const denied = await requireUser(request);
        if (denied) return denied;
        const b = await readJson(request);
        const cm = intId(b?.["cm_user_id"]);
        const nome = text(b?.["nome"]);
        if (!cm || !nome) return fail("Informe cm_user_id e nome");
        const { data, error } = await db
          .from("vendedores")
          .insert({ cm_user_id: cm, nome, email: text(b?.["email"]) })
          .select()
          .single();
        if (error) {
          if (error.code === "23505")
            return fail("Já existe vendedor com esse ID do ClickMassa", 409);
          return fail("Falha ao cadastrar", 500);
        }
        return ok({ vendedor: data }, 201);
      },
    },
  },
});
