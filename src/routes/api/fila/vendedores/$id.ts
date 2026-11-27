import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/fila/vendedores/$id")({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => {
        const { requireUser, readJson, db, ok, fail, intId } = await import("@/lib/fila.server");
        const { parseHorarios } = await import("@/lib/fila-horario");
        const denied = await requireUser(request);
        if (denied) return denied;
        const id = intId(params.id);
        if (!id) return fail("ID inválido");
        const b = await readJson(request);
        // Aceita { usar_horario, horarios } (configuração) e/ou { forcar_ativo } (plantão).
        const patch: Record<string, unknown> = {};
        if (b && "usar_horario" in b) {
          const horarios = parseHorarios(b["horarios"]);
          if (typeof b["usar_horario"] !== "boolean" || !horarios)
            return fail("Horários inválidos (use HH:MM e início antes do fim)");
          patch["usar_horario"] = b["usar_horario"];
          patch["horarios"] = horarios;
        }
        if (b && "forcar_ativo" in b) {
          if (typeof b["forcar_ativo"] !== "boolean") return fail("forcar_ativo inválido");
          patch["forcar_ativo"] = b["forcar_ativo"];
        }
        if (!Object.keys(patch).length) return fail("Nada para salvar");
        const { data, error } = await db
          .from("vendedores")
          .update(patch)
          .eq("id", id)
          .select()
          .maybeSingle();
        if (error) return fail("Falha ao salvar", 500);
        if (!data) return fail("Vendedor não encontrado", 404);
        return ok({ vendedor: data });
      },
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
