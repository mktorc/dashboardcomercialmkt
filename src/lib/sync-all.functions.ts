import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Dispara os mesmos endpoints de sync usados pelo agendamento, com o segredo no servidor.
const JOBS = [
  { name: "ClickMassa", path: "/api/public/sync/clickmassa" },
  { name: "ClickMassa (oportunidades)", path: "/api/public/sync/clickmassa-opportunities" },
  { name: "HQ Rentals", path: "/api/public/sync/hqrentals?days=7" },
] as const;

export type SyncFailure = { service: string; error: string; status?: number; stack?: string | undefined };

function resolveOrigin(request: Request): string {
  const envUrl = process.env["PUBLIC_URL"];
  if (envUrl) return envUrl.replace(/\/$/, "");
  const h = request.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (host) {
    const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
    return `${proto}://${host}`;
  }
  return new URL(request.url).origin;
}

// Nunca lança: devolve o erro detalhado de cada serviço no corpo da resposta.
export const syncAll = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const failures: SyncFailure[] = [];
    try {
      const secret =
        process.env["SYNC_CRON_TOKEN"] || process.env["LOVABLE_CRON_SECRET"] || process.env["CRON_SECRET"];
      if (!secret) {
        const error =
          "Segredo do cron não configurado (SYNC_CRON_TOKEN / LOVABLE_CRON_SECRET / CRON_SECRET indefinidos)";
        console.error("[syncAll]", error);
        return { failed: [{ service: "Configuração", error }] as SyncFailure[] };
      }
      const origin = resolveOrigin(getRequest());
      console.log("[syncAll] origem:", origin);
      // Diagnóstico: só presença (booleanos), nunca os valores.
      console.log("[Sync Check] CLICKMASSA_BASE_URL presente:", !!process.env["CLICKMASSA_BASE_URL"]);
      console.log(
        "[Sync Check] CLICKMASSA_TOKEN presente:",
        !!(process.env["CLICKMASSA_API_TOKEN"] || process.env["CLICKMASSA_API_KEY"]),
      );
      console.log("[Sync Check] HQ_BASE_URL presente:", !!process.env["HQ_BASE_URL"]);
      console.log(
        "[Sync Check] HQ_TOKENS presentes:",
        !!process.env["HQ_TENANT_TOKEN"] && !!process.env["HQ_USER_TOKEN"],
      );

      await Promise.all(
        JOBS.map(async (j) => {
          try {
            const r = await fetch(`${origin}${j.path}`, {
              method: "POST",
              headers: { Authorization: `Bearer ${secret}` },
            });
            if (!r.ok) {
              const body = (await r.text()).slice(0, 500);
              let msg = body;
              try {
                const parsed = JSON.parse(body) as { error?: string; detail?: string };
                msg = [parsed.error, parsed.detail].filter(Boolean).join(" — ") || body;
              } catch {
                /* corpo não é JSON */
              }
              console.error(`[syncAll] ${j.name} HTTP ${r.status}: ${msg}`);
              failures.push({ service: j.name, status: r.status, error: msg || `HTTP ${r.status}` });
            }
          } catch (e) {
            const err = e as Error;
            console.error(`[syncAll] ${j.name} exceção:`, err);
            failures.push({ service: j.name, error: err.message, stack: err.stack });
          }
        }),
      );
    } catch (e) {
      const err = e as Error;
      console.error("[syncAll] erro inesperado:", err);
      failures.push({ service: "syncAll", error: err.message, stack: err.stack });
    }
    return { failed: failures };
  });
