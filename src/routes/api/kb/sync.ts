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
  chainIfPartial(request, result.status);
  return kb.ok(result);
}

// Vídeos e PDFs levam ~1-2 min cada no Gemini e a função tem 300 s: uma rodada só dá conta de
// poucos. Quando sobra arquivo ("parcial"), a própria sincronização chama a próxima rodada, até
// processar tudo (no máximo MAX_CHAIN rodadas seguidas). Assim basta o disparo diário.
const MAX_CHAIN = 40;
function chainIfPartial(request: Request, status: string) {
  if (status !== "parcial") return;
  const secret = process.env["KB_SYNC_SECRET"] || process.env["CRON_SECRET"];
  const depth = Number(request.headers.get("x-kb-chain") ?? 0);
  if (!secret || depth >= MAX_CHAIN) return;
  const next = fetch(new URL("/api/kb/sync", request.url), {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "x-kb-chain": String(depth + 1) },
    // Só precisa entregar o pedido: a próxima rodada segue sozinha em outra execução.
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {
    /* timeout esperado: a próxima rodada já começou */
  });
  const waitUntil = (request as unknown as { waitUntil?: (p: Promise<unknown>) => void }).waitUntil;
  if (typeof waitUntil === "function") waitUntil(next);
}

export const Route = createFileRoute("/api/kb/sync")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request, true),
      POST: ({ request }) => handle(request, false),
    },
  },
});
