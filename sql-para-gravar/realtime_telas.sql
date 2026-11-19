-- Telas ao vivo: coloca as tabelas que os webhooks e syncs gravam na publicação do Supabase Realtime,
-- para o navegador ser avisado de cada mudança (src/lib/live-updates.ts). Pode rodar mais de uma vez.
-- O Realtime respeita o RLS: cada usuário só recebe aviso das linhas que já pode ler.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['crm_leads', 'crm_opportunities', 'reservations', 'reservation_segments', 'reservas'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- Conferência: deve listar as 5 tabelas.
SELECT tablename FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
  AND tablename IN ('crm_leads', 'crm_opportunities', 'reservations', 'reservation_segments', 'reservas');
