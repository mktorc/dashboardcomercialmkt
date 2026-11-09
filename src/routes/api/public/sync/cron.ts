import { createFileRoute } from "@tanstack/react-router";
import { isSyncAuthorized } from "@/lib/sync-auth";

// Rotina diária chamada pelo Vercel Cron (GET, com Authorization: Bearer <CRON_SECRET>).
// Dispara os syncs incrementais em paralelo e devolve o resultado de cada um.
// Syncs longos (histórico completo) continuam manuais: aqui só entram as janelas curtas.
const JOBS = [
  { name: "meta-ads", path: "/api/public/sync/meta-ads?days=7" },
  { name: "google-ads", path: "/api/public/sync/google-ads?days=7" },
  { name: "hqrentals", path: "/api/public/sync/hqrentals?days=7" },
  { name: "hq-rates", path: "/api/public/sync/hq-rates" },
  { name: "clickmassa", path: "/api/public/sync/clickmassa?startPage=1&maxPages=50" },
  { name: "clickmassa-opportunities", path: "/api/public/sync/clickmassa-opportunities" },
] as const;

function originOf(request: Request): string {
  const publicUrl = process.env["PUBLIC_URL"];
  if (publicUrl) return publicUrl.replace(/\/$/, "");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) return `${request.headers.get("x-forwarded-proto") ?? "https"}://${host}`;
  return new URL(request.url).origin;
}

async function run(request: Request) {
  if (!isSyncAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const secret = process.env["SYNC_CRON_TOKEN"] || process.env["CRON_SECRET"] || process.env["LOVABLE_CRON_SECRET"];
  if (!secret) return Response.json({ error: "Segredo do cron não configurado" }, { status: 500 });
  const origin = originOf(request);
  const results = await Promise.all(
    JOBS.map(async (job) => {
      try {
        const r = await fetch(`${origin}${job.path}`, { method: "POST", headers: { Authorization: `Bearer ${secret}` } });
        const body = (await r.text()).slice(0, 300);
        if (!r.ok) console.error(`[cron] ${job.name} HTTP ${r.status}: ${body}`);
        return { job: job.name, status: r.status, ok: r.ok, body };
      } catch (e) {
        console.error(`[cron] ${job.name}`, e);
        return { job: job.name, status: 0, ok: false, body: (e as Error).message };
      }
    }),
  );
  return Response.json({ ok: results.every((r) => r.ok), results });
}

export const Route = createFileRoute("/api/public/sync/cron")({
  server: {
    handlers: {
      GET: ({ request }) => run(request),
      POST: ({ request }) => run(request),
    },
  },
});
