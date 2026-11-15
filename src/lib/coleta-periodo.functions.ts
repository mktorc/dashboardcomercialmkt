import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Pede ao GitHub Actions a coleta dos concorrentes para UM período exato (retirada → devolução escolhidas no filtro).
// A coleta leva alguns minutos: aqui só se pede o início. Requer GITHUB_DISPATCH_TOKEN (o mesmo da rota de coleta).
const REPO = "mktorc/dashboardcomercialmkt";
const WORKFLOW = "coleta-concorrentes.yml";
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export const coletarPeriodo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { retirada: string; devolucao: string }) => {
    if (!ISO.test(d.retirada) || !ISO.test(d.devolucao) || d.devolucao <= d.retirada)
      throw new Error("Período inválido: a devolução deve ser depois da retirada.");
    return d;
  })
  .handler(async ({ data }): Promise<{ ok: boolean; error?: string }> => {
    const token = process.env["GITHUB_DISPATCH_TOKEN"];
    if (!token) return { ok: false, error: "GITHUB_DISPATCH_TOKEN não configurado no servidor." };
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
        body: JSON.stringify({
          ref: "main",
          inputs: { retirada: data.retirada, devolucao: data.devolucao },
        }),
      },
    );
    if (r.status !== 204) {
      const body = (await r.text()).slice(0, 300);
      console.error(`[coletarPeriodo] GitHub HTTP ${r.status}: ${body}`);
      return { ok: false, error: `GitHub respondeu ${r.status}` };
    }
    return { ok: true };
  });
