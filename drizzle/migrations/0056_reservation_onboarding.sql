-- Onboarding por reserva (Controle de reservas): se foi realizado e quem fez.
-- Responsável só pode existir com onboarding realizado.
CREATE TABLE IF NOT EXISTS public.reservation_onboarding (
  reservation_id text PRIMARY KEY,
  realizado boolean NOT NULL DEFAULT false,
  responsavel text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT onboarding_responsavel_valido CHECK (responsavel IS NULL OR (realizado AND responsavel IN ('Vinicius', 'Lizie')))
);
ALTER TABLE public.reservation_onboarding ENABLE ROW LEVEL SECURITY;
-- leitura e edição públicas, como a página (sem login), igual ao ajuste de comissão da 0040
GRANT SELECT, INSERT, UPDATE ON public.reservation_onboarding TO anon, authenticated;
DROP POLICY IF EXISTS "anon read reservation_onboarding" ON public.reservation_onboarding;
DROP POLICY IF EXISTS "role read reservation_onboarding" ON public.reservation_onboarding;
DROP POLICY IF EXISTS "role write reservation_onboarding" ON public.reservation_onboarding;
DROP POLICY IF EXISTS "public read reservation_onboarding" ON public.reservation_onboarding;
CREATE POLICY "public read reservation_onboarding" ON public.reservation_onboarding FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "public insert reservation_onboarding" ON public.reservation_onboarding;
CREATE POLICY "public insert reservation_onboarding" ON public.reservation_onboarding FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "public update reservation_onboarding" ON public.reservation_onboarding;
CREATE POLICY "public update reservation_onboarding" ON public.reservation_onboarding FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
