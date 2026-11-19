Pode usar a service role do .env.local para ler e escrever no banco quando o trabalho exigir, incluindo executar os SQL de sql-para-gravar/. Não usar outras credenciais do .env/.env.local.

Pode usar o SYNC_CRON_TOKEN do .env.local para disparar as rotas de sincronização (/api/public/sync/*).
