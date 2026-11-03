import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { resolveOrigin } from "@/lib/sync-all.functions";

// Sincronização manual das reservas do HQ para as telas públicas (Controle de Reservas e Comissões).
// Sem login, então só dispara o sync do HQ (nunca os outros) e respeita um intervalo mínimo entre execuções.
const COOLDOWN_MS = 30_000;

export const syncReservations = createServerFn({ method: "POST" }).handler(async () => {
  try {
    const secret = process.env["SYNC_CRON_TOKEN"] || process.env["LOVABLE_CRON_SECRET"] || process.env["CRON_SECRET"];
    if (!secret) return { ok: false as const, error: "Segredo do cron não configurado" };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.from("sync_runs").select("last_success_at").eq("service", "hqrentals").maybeSingle();
    const last = data?.last_success_at ? Date.parse(data.last_success_at) : 0;
    if (Date.now() - last < COOLDOWN_MS) return { ok: true as const, throttled: true as const };

    const r = await fetch(`${resolveOrigin(getRequest())}/api/public/sync/hqrentals?days=7`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
    });
    if (!r.ok) {
      console.error("[syncReservations] HTTP", r.status, (await r.text()).slice(0, 300));
      return { ok: false as const, error: `Falha ao sincronizar com o HQ (HTTP ${r.status})` };
    }
    return { ok: true as const, throttled: false as const };
  } catch (e) {
    console.error("[syncReservations]", e);
    return { ok: false as const, error: (e as Error).message || "Erro ao sincronizar" };
  }
});
