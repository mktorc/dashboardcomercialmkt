// Registra a última execução bem-sucedida de cada sync (lida pelo indicador do cabeçalho).
export async function recordSyncRun(service: string) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("sync_runs")
      .upsert({ service, last_success_at: new Date().toISOString() });
  } catch (e) {
    console.error("[sync_runs]", e);
  }
}
