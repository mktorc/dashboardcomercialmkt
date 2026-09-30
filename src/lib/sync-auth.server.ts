// Aceita o segredo cron da plataforma ou o token dedicado do agendamento noturno.
export function isSyncAuthorized(request: Request): boolean {
  const auth = request.headers.get("authorization") ?? "";
  return [process.env["LOVABLE_CRON_SECRET"], process.env["SYNC_CRON_TOKEN"]].some(
    (s) => !!s && auth === `Bearer ${s}`,
  );
}
