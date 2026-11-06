-- Precificação: ocupação esperada por categoria e data futura (gerada por scripts/precificacao/previsao.py).
-- Mesmo acesso do estudo (0042): só marketing@orlandorentcar.com lê; quem grava é o script, com a service role.
-- Conteúdo agregado, sem dado pessoal de cliente.
CREATE TABLE IF NOT EXISTS public.pricing_occupancy_forecast (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generated_at timestamptz NOT NULL DEFAULT now(),
  as_of date NOT NULL,
  payload jsonb NOT NULL
);
ALTER TABLE public.pricing_occupancy_forecast ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pricing forecast email read" ON public.pricing_occupancy_forecast FOR SELECT TO authenticated
  USING (lower(auth.jwt() ->> 'email') = 'marketing@orlandorentcar.com');
