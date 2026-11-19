-- Gestão de Frota: onde cada carro está e para onde precisa ir.
-- 1) Locais do HQ com a região (Orlando, Miami, FLL, Tampa).
-- 2) Trechos de reserva passam a guardar o carro, a categoria e os locais de retirada/devolução.
-- 3) Frota passa a guardar placa, nome, categoria, local atual e status no HQ.
-- 4) Transferências marcadas como feitas (só no dashboard, não volta para o HQ).
-- 5) Novo módulo de acesso 'frota'.
-- Rodar ANTES de publicar o código novo (o sync grava as colunas novas). Pode rodar mais de uma vez.

BEGIN;

-- 1) Locais ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fleet_locations (
  id integer PRIMARY KEY,
  name text NOT NULL,
  region text NOT NULL CHECK (region IN ('Orlando', 'Miami', 'FLL', 'Tampa'))
);
INSERT INTO public.fleet_locations (id, name, region) VALUES
  (1,  'MCO - Orlando International Airport', 'Orlando'),
  (2,  'MIA - Miami International Airport', 'Miami'),
  (3,  'FLL - Fort Lauderdale-Hollywood International Airport', 'FLL'),
  (4,  'TPA - Tampa International Airport', 'Tampa'),
  (5,  'Port Canaveral', 'Orlando'),
  (7,  'Hotel Orlando', 'Orlando'),
  (8,  'Casa de Ferias - Orlando', 'Orlando'),
  (9,  'Lounge ORC', 'Orlando'),
  (10, 'Trem Brightline Miami', 'Miami'),
  (11, 'Trem Brightline Orlando', 'Orlando'),
  (12, 'SFA - Aeroporto de Sanford', 'Orlando'),
  (13, 'Hotel FLL', 'FLL'),
  (14, 'Porto FLL', 'FLL'),
  (15, 'Hotel Miami', 'Miami'),
  (16, 'Porto Miami', 'Miami')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, region = EXCLUDED.region;

-- 2) Trechos --------------------------------------------------------------------------------------
ALTER TABLE public.reservation_segments
  ADD COLUMN IF NOT EXISTS vehicle_id integer,
  ADD COLUMN IF NOT EXISTS vehicle_class_id integer,
  ADD COLUMN IF NOT EXISTS pick_up_location_id integer,
  ADD COLUMN IF NOT EXISTS return_location_id integer;

-- 3) Frota ----------------------------------------------------------------------------------------
ALTER TABLE public.fleet_vehicles
  ADD COLUMN IF NOT EXISTS plate text,
  ADD COLUMN IF NOT EXISTS label text,
  ADD COLUMN IF NOT EXISTS vehicle_class_id integer,
  ADD COLUMN IF NOT EXISTS class_label text,
  ADD COLUMN IF NOT EXISTS current_location_id integer,
  ADD COLUMN IF NOT EXISTS hq_status text;

-- 4) Transferências feitas ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fleet_transfers_done (
  key text PRIMARY KEY,             -- carro|reserva de destino (estável entre recargas)
  vehicle_id integer NOT NULL,
  from_region text NOT NULL,
  to_region text NOT NULL,
  done_at timestamptz NOT NULL DEFAULT now(),
  done_by uuid DEFAULT auth.uid()
);

-- 5) Módulo 'frota' -------------------------------------------------------------------------------
ALTER TABLE public.user_access DROP CONSTRAINT IF EXISTS user_access_modules_validos;
ALTER TABLE public.user_access ADD CONSTRAINT user_access_modules_validos CHECK (
  modules <@ ARRAY['dashboard','comercial','comercial-operacional','comissoes','fila-leads','frota']::text[]
);

CREATE OR REPLACE FUNCTION public.has_frota_access(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_access a
    WHERE a.user_id = _user_id AND (a.is_admin OR 'frota' = ANY (a.modules))
  )
$$;

-- Permissões: quem tem o módulo lê locais, frota e trechos, e marca transferências.
GRANT SELECT ON public.fleet_locations TO authenticated;
GRANT ALL ON public.fleet_locations TO service_role;
ALTER TABLE public.fleet_locations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "frota le locais" ON public.fleet_locations;
CREATE POLICY "frota le locais" ON public.fleet_locations FOR SELECT TO authenticated
  USING ((SELECT public.has_frota_access((SELECT auth.uid()))));

GRANT SELECT, INSERT, DELETE ON public.fleet_transfers_done TO authenticated;
GRANT ALL ON public.fleet_transfers_done TO service_role;
ALTER TABLE public.fleet_transfers_done ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "frota le feitas" ON public.fleet_transfers_done;
CREATE POLICY "frota le feitas" ON public.fleet_transfers_done FOR SELECT TO authenticated
  USING ((SELECT public.has_frota_access((SELECT auth.uid()))));
DROP POLICY IF EXISTS "frota marca feitas" ON public.fleet_transfers_done;
CREATE POLICY "frota marca feitas" ON public.fleet_transfers_done FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_frota_access((SELECT auth.uid()))));
DROP POLICY IF EXISTS "frota desmarca feitas" ON public.fleet_transfers_done;
CREATE POLICY "frota desmarca feitas" ON public.fleet_transfers_done FOR DELETE TO authenticated
  USING ((SELECT public.has_frota_access((SELECT auth.uid()))));

-- Políticas adicionais (somam às existentes) para o módulo ler frota e trechos.
GRANT SELECT ON public.fleet_vehicles, public.reservation_segments TO authenticated;
DROP POLICY IF EXISTS "frota le veiculos" ON public.fleet_vehicles;
CREATE POLICY "frota le veiculos" ON public.fleet_vehicles FOR SELECT TO authenticated
  USING ((SELECT public.has_frota_access((SELECT auth.uid()))));
DROP POLICY IF EXISTS "frota le trechos" ON public.reservation_segments;
CREATE POLICY "frota le trechos" ON public.reservation_segments FOR SELECT TO authenticated
  USING ((SELECT public.has_frota_access((SELECT auth.uid()))));

-- Tela ao vivo: marcar como feito em um navegador atualiza os outros.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'fleet_transfers_done'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.fleet_transfers_done;
  END IF;
END $$;

COMMIT;

-- Conferência: 15 locais e as colunas novas.
SELECT region, count(*) FROM public.fleet_locations GROUP BY region ORDER BY region;
