// Aceita o segredo cron da plataforma ou o token dedicado do agendamento noturno.
export function isSyncAuthorized(request: Request): boolean {
  const auth = request.headers.get("authorization") ?? "";
  // CRON_SECRET: segredo que o Vercel Cron envia no cabeçalho Authorization.
  return [
    process.env["LOVABLE_CRON_SECRET"],
    process.env["SYNC_CRON_TOKEN"],
    process.env["CRON_SECRET"],
  ].some((s) => !!s && auth === `Bearer ${s}`);
}
