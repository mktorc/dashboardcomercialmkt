import { createFileRoute } from "@tanstack/react-router";
import { isSyncAuthorized } from "@/lib/sync-auth";

// Dispara a coleta de preços dos concorrentes (fluxo "Coleta de concorrentes" do GitHub Actions, que usa navegador automatizado).
// A coleta roda no GitHub e leva alguns minutos: esta rota só pede o início e responde na hora; os dados aparecem quando o fluxo termina.
// Requer GITHUB_DISPATCH_TOKEN (token fino do GitHub, só para este repositório, com permissão Actions: leitura e escrita).
// Proteção: Authorization: Bearer <segredo do cron>.

const REPO = "mktorc/dashboardcomercialmkt";
const WORKFLOW = "coleta-concorrentes.yml";

export const Route = createFileRoute("/api/public/sync/coleta-concorrentes")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isSyncAuthorized(request))
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        const token = process.env["GITHUB_DISPATCH_TOKEN"];
        if (!token)
          return Response.json(
            {
              error:
                "GITHUB_DISPATCH_TOKEN não configurado: a coleta de concorrentes não pode ser disparada daqui",
            },
            { status: 500 },
          );
        const r = await fetch(
          `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
              "User-Agent": "dashboardcomercialmkt-sync",
            },
            body: JSON.stringify({ ref: "main" }),
          },
        );
        if (r.status !== 204) {
          const body = (await r.text()).slice(0, 300);
          console.error(`[coleta-concorrentes] GitHub HTTP ${r.status}: ${body}`);
          return Response.json(
            { error: `GitHub respondeu ${r.status}`, detail: body },
            { status: 502 },
          );
        }
        return Response.json({ ok: true, started: true });
      },
    },
  },
});
