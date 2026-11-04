-- Ocupação no mesmo critério do relatório de Utilização do HQ.
-- A unidade do HQ é o trecho de cada veículo dentro da reserva (uma troca de carro vira dois trechos),
-- e a capacidade soma os dias em que cada veículo já fazia parte da frota (entrada/saída).
-- status é copiado da reserva (e mantido por gatilho) para o cálculo ler uma tabela só.
CREATE TABLE IF NOT EXISTS public.reservation_segments (
  reservation_id text NOT NULL,
  seq integer NOT NULL,
  status text NOT NULL,
  pick_up_at timestamptz NOT NULL,
  return_at timestamptz NOT NULL,
  PRIMARY KEY (reservation_id, seq)
);
CREATE INDEX IF NOT EXISTS reservation_segments_range_idx ON public.reservation_segments (status, pick_up_at, return_at);

CREATE TABLE IF NOT EXISTS public.fleet_vehicles (
  id integer PRIMARY KEY,
  entry_date timestamptz NOT NULL,
  exit_date timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- O sync sobrescreve o status da reserva; os trechos acompanham a mudança (qualquer caminho de escrita).
CREATE OR REPLACE FUNCTION public.sync_reservation_segments_status() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE public.reservation_segments SET status = NEW.status WHERE reservation_id = NEW.reservation_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_reservation_segments_status ON public.reservations;
CREATE TRIGGER trg_sync_reservation_segments_status
  AFTER UPDATE OF status ON public.reservations
  FOR EACH ROW EXECUTE FUNCTION public.sync_reservation_segments_status();

CREATE OR REPLACE FUNCTION public.delete_reservation_segments() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  DELETE FROM public.reservation_segments WHERE reservation_id = OLD.reservation_id;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_delete_reservation_segments ON public.reservations;
CREATE TRIGGER trg_delete_reservation_segments
  AFTER DELETE ON public.reservations
  FOR EACH ROW EXECUTE FUNCTION public.delete_reservation_segments();

GRANT SELECT ON public.reservation_segments, public.fleet_vehicles TO authenticated;
GRANT ALL ON public.reservation_segments, public.fleet_vehicles TO service_role;
ALTER TABLE public.reservation_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fleet_vehicles ENABLE ROW LEVEL SECURITY;

-- Mesmos papéis que leem fleet_stats e reservations (hoje: superadmin, comercial, marketing e comercial_gerencial).
DROP POLICY IF EXISTS "role read reservation_segments" ON public.reservation_segments;
CREATE POLICY "role read reservation_segments" ON public.reservation_segments FOR SELECT TO authenticated
  USING ((SELECT public.has_any_role((SELECT auth.uid()), ARRAY['superadmin','comercial','marketing','comercial_gerencial']::public.app_role[])));
DROP POLICY IF EXISTS "role read fleet_vehicles" ON public.fleet_vehicles;
CREATE POLICY "role read fleet_vehicles" ON public.fleet_vehicles FOR SELECT TO authenticated
  USING ((SELECT public.has_any_role((SELECT auth.uid()), ARRAY['superadmin','comercial','marketing','comercial_gerencial']::public.app_role[])));

-- Aba Comercial Operacional sem login: leitura anônima só das colunas usadas no cálculo de ocupação.
REVOKE ALL ON public.reservation_segments, public.fleet_vehicles FROM anon;
GRANT SELECT (status, pick_up_at, return_at) ON public.reservation_segments TO anon;
GRANT SELECT (id, entry_date, exit_date) ON public.fleet_vehicles TO anon;
DROP POLICY IF EXISTS "anon read reservation_segments" ON public.reservation_segments;
CREATE POLICY "anon read reservation_segments" ON public.reservation_segments FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "anon read fleet_vehicles" ON public.fleet_vehicles;
CREATE POLICY "anon read fleet_vehicles" ON public.fleet_vehicles FOR SELECT TO anon USING (true);

-- Trechos de partida para o que já existe: uma reserva = um trecho, até o próximo sync trazer os trechos reais por veículo.
INSERT INTO public.reservation_segments (reservation_id, seq, status, pick_up_at, return_at)
SELECT reservation_id, 0, status, pick_up_at, return_at
FROM public.reservations
WHERE reservation_id IS NOT NULL AND pick_up_at IS NOT NULL AND return_at IS NOT NULL
ON CONFLICT (reservation_id, seq) DO NOTHING;
