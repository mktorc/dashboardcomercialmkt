import { createFileRoute } from "@tanstack/react-router";

// Inscrição pública (sem login) de um aparelho para as notificações do Controle de Reservas.
// POST grava/atualiza a inscrição; DELETE remove pelo endpoint.
const MAX_BODY = 8 * 1024;
const MAX_SUBSCRIPTIONS = 2000;

type Body = { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };

async function readBody(request: Request): Promise<Body | null> {
  try {
    const text = (await request.text()).slice(0, MAX_BODY);
    return JSON.parse(text) as Body;
  } catch {
    return null;
  }
}

const validEndpoint = (v: unknown): v is string => {
  if (typeof v !== "string" || v.length > 2048) return false;
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
};

export const Route = createFileRoute("/api/public/push/subscribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await readBody(request);
        const { endpoint, keys } = body ?? {};
        const p256dh = keys?.p256dh;
        const auth = keys?.auth;
        if (
          !validEndpoint(endpoint) ||
          typeof p256dh !== "string" ||
          typeof auth !== "string" ||
          p256dh.length > 256 ||
          auth.length > 64
        ) {
          return Response.json({ error: "Inscrição inválida" }, { status: 400 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const db = supabaseAdmin;
        const { count } = await db
          .from("push_subscriptions")
          .select("id", { count: "exact", head: true });
        if ((count ?? 0) >= MAX_SUBSCRIPTIONS)
          return Response.json({ error: "Limite de inscrições atingido" }, { status: 429 });
        const { error } = await db
          .from("push_subscriptions")
          .upsert({ endpoint, p256dh, auth }, { onConflict: "endpoint" });
        if (error) return Response.json({ error: "Falha ao salvar" }, { status: 500 });
        return Response.json({ ok: true });
      },
      DELETE: async ({ request }) => {
        const body = await readBody(request);
        if (!validEndpoint(body?.endpoint))
          return Response.json({ error: "Inscrição inválida" }, { status: 400 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const db = supabaseAdmin;
        await db
          .from("push_subscriptions")
          .delete()
          .eq("endpoint", body!.endpoint as string);
        return Response.json({ ok: true });
      },
    },
  },
});
