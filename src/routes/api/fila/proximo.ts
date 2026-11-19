import { createFileRoute } from "@tanstack/react-router";

// Endpoint da IA: devolve quem é o próximo da fila e já o move para o fim (round-robin).
// A IA faz o forceTicketToUser no ClickMassa; aqui só se controla a fila.
export const Route = createFileRoute("/api/fila/proximo")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { checkApiKey, db, ok, fail, text } = await import("@/lib/fila.server");
        if (!checkApiKey(request)) return fail("Chave inválida", 401);
        const url = new URL(request.url);
        const { data, error } = await db.rpc("fila_proximo", {
          p_nome: text(url.searchParams.get("nome")),
          p_telefone: text(url.searchParams.get("telefone"), 40),
        });
        if (error) return fail("Falha ao consultar a fila", 500);
        const v = Array.isArray(data) ? data[0] : data;
        if (!v) return fail("Nenhum vendedor ativo");
        return ok({ userId: v.cm_user_id, nome: v.nome });
      },
    },
  },
});
