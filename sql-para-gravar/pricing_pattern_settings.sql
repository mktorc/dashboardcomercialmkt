-- Calibração do "Seu padrão" (Fila de decisões, aba Prioridades). Rodar no SQL Editor do Supabase.
-- Uma linha só (id = 'padrao'). Sem esta tabela, a tela usa os valores padrão e não salva a calibração.
CREATE TABLE IF NOT EXISTS public.pricing_pattern_settings (
  id text PRIMARY KEY DEFAULT 'padrao' CHECK (id = 'padrao'),
  min_decisoes numeric NOT NULL DEFAULT 5,
  meia_vida_dias integer NOT NULL DEFAULT 90,
  ajustar_preco boolean NOT NULL DEFAULT true,
  ajuste_max numeric NOT NULL DEFAULT 0.25,
  peso_ordem numeric NOT NULL DEFAULT 0.6,
  zerado_em timestamptz,
  desligados text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text DEFAULT lower(auth.jwt() ->> 'email')
);

ALTER TABLE public.pricing_pattern_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pricing_pattern_settings FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.pricing_pattern_settings TO authenticated;
GRANT ALL ON public.pricing_pattern_settings TO service_role;

DROP POLICY IF EXISTS "pricing pattern email all" ON public.pricing_pattern_settings;
CREATE POLICY "pricing pattern email all" ON public.pricing_pattern_settings FOR ALL TO authenticated
  USING (lower(auth.jwt() ->> 'email') = 'marketing@orlandorentcar.com')
  WITH CHECK (lower(auth.jwt() ->> 'email') = 'marketing@orlandorentcar.com');

INSERT INTO public.pricing_pattern_settings (id) VALUES ('padrao') ON CONFLICT (id) DO NOTHING;
