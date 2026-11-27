import { createFileRoute } from "@tanstack/react-router";

// Endpoint da IA: devolve quem é o próximo da fila e já o move para o fim (round-robin).
// A IA faz o forceTicketToUser no ClickMassa; aqui só se controla a fila.
// ?teste=1 só mostra quem seria o próximo, sem gravar nem mover a fila.
// Limite de 8 s no banco: com o Supabase lento, devolve erro rápido em vez de a IA estourar o tempo.
const DB_TIMEOUT_MS = 8_000;

export const Route = createFileRoute("/api/fila/proximo")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { checkApiKey, db, ok, fail, text } = await import("@/lib/fila.server");
        const noStore = (r: Response) => {
          r.headers.set("Cache-Control", "no-store");
          return r;
        };
        if (!checkApiKey(request)) return noStore(fail("Chave inválida", 401));
        const url = new URL(request.url);
        const teste = url.searchParams.get("teste") === "1";
        const signal = AbortSignal.timeout(DB_TIMEOUT_MS);
        try {
          if (teste) {
            // fila_previa aplica a mesma regra de fila_proximo (ativo + horário programado).
            const { data, error } = await db.rpc("fila_previa").abortSignal(signal);
            if (error) throw error;
            const v = Array.isArray(data) ? data[0] : data;
            if (!v) return noStore(fail("Nenhum vendedor ativo"));
            return noStore(ok({ userId: v.cm_user_id, nome: v.nome, teste: true }));
          }
          const { data, error } = await db
            .rpc("fila_proximo", {
              p_nome: text(url.searchParams.get("nome")),
              p_telefone: text(url.searchParams.get("telefone"), 40),
            })
            .abortSignal(signal);
          if (error) throw error;
          const v = Array.isArray(data) ? data[0] : data;
          if (!v) return noStore(fail("Nenhum vendedor ativo"));
          return noStore(ok({ userId: v.cm_user_id, nome: v.nome }));
        } catch {
          if (signal.aborted)
            return noStore(fail("Fila indisponível no momento (tempo esgotado)", 503));
          return noStore(fail("Falha ao consultar a fila", 500));
        }
      },
    },
  },
});
