-- Limpeza do webhook_logs (auditoria dos webhooks do ClickMassa e do HQ Rentals).
-- Contexto: a tabela chegou a ~1,2 GB (231 mil linhas, ~5 KB de payload cada, ~53 mil por semana) e estourou a cota do plano Free.
-- Nenhum código lê o histórico (só os webhooks gravam e atualizam a linha que acabaram de criar), então é seguro apagar o antigo.
-- Política: linhas OK (processed/logged/processing) ficam 7 dias; linhas com problema (failed, error:*, unauthorized,
-- invalid_payload) ficam 30 dias, para dar tempo de investigar. Pode rodar mais de uma vez.
--
-- Rode os passos na ordem, um de cada vez, no SQL Editor do Supabase. Apagar é irreversível (há backup diário no Pro).

-- 1) CONFERIR antes de apagar: quantas linhas saem e quantas ficam.
SELECT
  count(*) FILTER (WHERE apagar) AS vai_apagar,
  count(*) FILTER (WHERE NOT apagar) AS vai_ficar,
  pg_size_pretty(pg_total_relation_size('public.webhook_logs')) AS tamanho_atual
FROM (
  SELECT
    CASE
      WHEN processing_status IN ('processed', 'logged', 'processing') THEN received_at < now() - interval '7 days'
      ELSE received_at < now() - interval '30 days'
    END AS apagar
  FROM public.webhook_logs
) t;

-- 2) APAGAR o que passou do prazo.
DELETE FROM public.webhook_logs
WHERE CASE
        WHEN processing_status IN ('processed', 'logged', 'processing') THEN received_at < now() - interval '7 days'
        ELSE received_at < now() - interval '30 days'
      END;

-- 3) DEVOLVER o espaço ao disco (opcional, mas é o que faz o "Database Size" cair).
-- O DELETE só libera espaço para reuso interno; o arquivo da tabela só encolhe se ela for reescrita.
-- O SQL Editor roda tudo numa transação e o VACUUM FULL não aceita isso (erro 25001), então usamos CLUSTER pela chave
-- primária, que reescreve a tabela do mesmo jeito e funciona no editor. Trava a tabela por alguns segundos (os webhooks
-- esperam e gravam em seguida), então rode num horário calmo. Selecione e rode SÓ este bloco.
DO $$
DECLARE
  pk text;
BEGIN
  SELECT conname INTO pk FROM pg_constraint
  WHERE conrelid = 'public.webhook_logs'::regclass AND contype = 'p';
  EXECUTE format('CLUSTER public.webhook_logs USING %I', pk);
END $$;

-- 4) MANTER limpo sozinho: todo dia às 06:30 UTC (03:30 em Brasília) aplica a mesma política.
-- Exige a extensão pg_cron (Database > Extensions > pg_cron, disponível no Pro).
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'limpar-webhook-logs';

SELECT cron.schedule(
  'limpar-webhook-logs',
  '30 6 * * *',
  $$DELETE FROM public.webhook_logs
    WHERE CASE
            WHEN processing_status IN ('processed', 'logged', 'processing') THEN received_at < now() - interval '7 days'
            ELSE received_at < now() - interval '30 days'
          END$$
);

-- 5) CONFERIR o resultado.
SELECT pg_size_pretty(pg_total_relation_size('public.webhook_logs')) AS tamanho_tabela,
       pg_size_pretty(pg_database_size(current_database())) AS tamanho_banco,
       (SELECT count(*) FROM public.webhook_logs) AS linhas;
