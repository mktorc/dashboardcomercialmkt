-- Registro das decisões de preço da aba Prioridades (Aceitar / Ajustar / Ignorar).
-- Nada aqui altera tarifa: é só o histórico do que foi recomendado e do que foi decidido.
-- Imutável: sem UPDATE nem DELETE; uma correção vira um registro novo.

CREATE TABLE IF NOT EXISTS public.pricing_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decided_at timestamptz NOT NULL DEFAULT now(),
  pickup_date_start date NOT NULL,
  pickup_date_end date NOT NULL,
  category text NOT NULL,
  lead_days integer NOT NULL,
  occ_signal text NOT NULL CHECK (occ_signal IN ('abaixo', 'dentro', 'acima')),
  hist_signal text NOT NULL CHECK (hist_signal IN ('acima', 'dentro', 'abaixo', 'sem-historico')),
  market_signal text NOT NULL CHECK (market_signal IN ('acima', 'alinhado', 'abaixo', 'sem-mercado')),
  signals jsonb NOT NULL DEFAULT '{}'::jsonb,
  recommended_action text NOT NULL,
  confidence text NOT NULL CHECK (confidence IN ('alta', 'media', 'baixa')),
  rule_version text NOT NULL,
  current_rate numeric,
  tariff_snapshot_at timestamptz,
  suggested_min numeric,
  suggested_max numeric,
  decision text NOT NULL CHECK (decision IN ('aceitou', 'ajustou', 'ignorou')),
  applied_price numeric,
  reason text,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id),
  user_email text NOT NULL DEFAULT lower(auth.jwt() ->> 'email'),
  CHECK (pickup_date_end >= pickup_date_start),
  CHECK (decision <> 'ajustou' OR applied_price IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS pricing_decisions_pickup_idx
  ON public.pricing_decisions (category, pickup_date_start, pickup_date_end);
CREATE INDEX IF NOT EXISTS pricing_decisions_decided_idx
  ON public.pricing_decisions (decided_at DESC);

ALTER TABLE public.pricing_decisions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.pricing_decisions FROM anon, authenticated;
GRANT SELECT, INSERT ON public.pricing_decisions TO authenticated;

DROP POLICY IF EXISTS "pricing decisions email read" ON public.pricing_decisions;
CREATE POLICY "pricing decisions email read" ON public.pricing_decisions FOR SELECT TO authenticated
  USING (lower(auth.jwt() ->> 'email') = 'marketing@orlandorentcar.com');

DROP POLICY IF EXISTS "pricing decisions email insert" ON public.pricing_decisions;
CREATE POLICY "pricing decisions email insert" ON public.pricing_decisions FOR INSERT TO authenticated
  WITH CHECK (
    lower(auth.jwt() ->> 'email') = 'marketing@orlandorentcar.com'
    AND user_id = auth.uid()
    AND user_email = lower(auth.jwt() ->> 'email')
  );
