-- Histórico de mudanças de status das reservas (ex.: pending -> confirmed, que no HQ é o "open").
-- O sync faz upsert e sobrescreve o status, então a data da mudança não existia. O gatilho registra
-- cada INSERT e cada UPDATE que altera o status. changed_at = momento em que o sync detectou a mudança
-- (não a hora exata no HQ). Só há histórico a partir desta migração.
CREATE TABLE IF NOT EXISTS public.reservation_status_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reservation_id text NOT NULL,
  from_status text,
  to_status text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_res_status_hist_changed ON public.reservation_status_history (changed_at);
CREATE INDEX IF NOT EXISTS idx_res_status_hist_res ON public.reservation_status_history (reservation_id);

CREATE OR REPLACE FUNCTION public.log_reservation_status_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.reservation_status_history (reservation_id, from_status, to_status)
    VALUES (NEW.reservation_id, NULL, NEW.status);
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.reservation_status_history (reservation_id, from_status, to_status)
    VALUES (NEW.reservation_id, OLD.status, NEW.status);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_log_reservation_status ON public.reservations;
CREATE TRIGGER trg_log_reservation_status
  AFTER INSERT OR UPDATE OF status ON public.reservations
  FOR EACH ROW EXECUTE FUNCTION public.log_reservation_status_change();

-- Ponto de partida: o status atual de cada reserva existente (from_status nulo = estado inicial conhecido).
INSERT INTO public.reservation_status_history (reservation_id, from_status, to_status, changed_at)
SELECT reservation_id, NULL, status, now() FROM public.reservations WHERE reservation_id IS NOT NULL;

GRANT SELECT ON public.reservation_status_history TO authenticated;
GRANT ALL ON public.reservation_status_history TO service_role;
ALTER TABLE public.reservation_status_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "role read reservation_status_history" ON public.reservation_status_history;
CREATE POLICY "role read reservation_status_history" ON public.reservation_status_history FOR SELECT TO authenticated
  USING ((SELECT public.has_any_role((SELECT auth.uid()), ARRAY['superadmin','comercial','marketing','comercial_gerencial']::public.app_role[])));
