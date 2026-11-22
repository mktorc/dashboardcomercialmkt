Pode usar a service role do .env.local para ler e escrever no banco quando o trabalho exigir, incluindo executar os SQL de sql-para-gravar/. Não usar outras credenciais do .env/.env.local.

Pode usar o SYNC_CRON_TOKEN do .env.local para disparar as rotas de sincronização (/api/public/sync/*).

Exceção: pode usar HQ_BASE_URL, HQ_TENANT_TOKEN e HQ_USER_TOKEN do .env.local para a integração da Gestão de Frota com o HQ Rentals ("Aplicar no HQ"). Leitura (GET) liberada para investigar; escrita em reserva real (assign-vehicle, free-vehicle-class-upgrades etc.) só pelo botão do painel, com confirmação do usuário — nunca por conta própria em teste.

Pode usar o APIFY_TOKEN do .env.local só para LER execuções e datasets antigos da Apify (GET, sem custo). Nunca iniciar execução de robô (é pago).
