import { createFileRoute } from "@tanstack/react-router";

// Sincroniza as pastas do Drive com o índice. GET = Vercel Cron (Bearer KB_SYNC_SECRET/CRON_SECRET);
// POST = botão "Sincronizar agora" (login com o módulo) ou o mesmo segredo.
async function handle(request: Request, viaCron: boolean) {
  const kb = await import("@/lib/kb/kb.server");
  if (!kb.isSyncSecret(request)) {
    if (viaCron) return kb.fail("Não autorizado", 401);
    const u = await kb.requireKbAdmin(request);
    if ("denied" in u) return u.denied;
  }
  const { data: running } = await kb.db
    .from("kb_sync_runs")
    .select("id")
    .eq("status", "rodando")
    .gte("started_at", new Date(Date.now() - 6 * 60_000).toISOString())
    .limit(1);
  if (running?.length) return kb.fail("Já existe uma sincronização em andamento", 409);
  const result = await kb.runSync(viaCron ? "cron" : "manual");
  return kb.ok(result);
}

export const Route = createFileRoute("/api/kb/sync")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request, true),
      POST: ({ request }) => handle(request, false),
    },
  },
});
