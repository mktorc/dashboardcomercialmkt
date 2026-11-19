-- Gestão de Frota ao vivo: avisa a tela quando o local/status de um carro muda (webhook do HQ).
-- Pode rodar mais de uma vez.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'fleet_vehicles'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.fleet_vehicles;
  END IF;
END $$;

SELECT tablename FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
  AND tablename IN ('reservation_segments', 'fleet_vehicles', 'fleet_transfers_done');
