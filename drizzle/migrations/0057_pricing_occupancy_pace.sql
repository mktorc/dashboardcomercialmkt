-- Gestão de Ocupação: ritmo de reservas (pickup) e benchmark histórico por categoria, data e antecedência (gerado por scripts/precificacao/ritmo.py).
-- Mesmo acesso da previsão (0054): só marketing@orlandorentcar.com lê; quem grava é o script, com a service role. Conteúdo agregado.
CREATE TABLE IF NOT EXISTS public.pricing_occupancy_pace (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generated_at timestamptz NOT NULL DEFAULT now(),
  as_of date NOT NULL,
  payload jsonb NOT NULL
);
ALTER TABLE public.pricing_occupancy_pace ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pricing pace email read" ON public.pricing_occupancy_pace;
CREATE POLICY "pricing pace email read" ON public.pricing_occupancy_pace FOR SELECT TO authenticated
  USING (lower(auth.jwt() ->> 'email') = 'marketing@orlandorentcar.com');
