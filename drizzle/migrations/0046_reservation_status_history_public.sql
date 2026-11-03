-- Módulo Controle de Reservas com acesso público (como o Operacional): leitura anônima do histórico
-- de status e das colunas de identificação da reserva usadas na lista.
GRANT SELECT ON public.reservation_status_history TO anon;
DROP POLICY IF EXISTS "anon read reservation_status_history" ON public.reservation_status_history;
CREATE POLICY "anon read reservation_status_history" ON public.reservation_status_history FOR SELECT TO anon USING (true);
GRANT SELECT (reservation_id, car_category) ON public.reservations TO anon;
