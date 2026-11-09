-- Inteligência competitiva: coletas históricas de preços de concorrentes e snapshots da nossa tarifa de tabela (HQ).
-- Mesmo acesso das demais tabelas pricing_* (0054/0057): só marketing@orlandorentcar.com lê; quem grava é o script/importação, com a service role.
-- Coletas são só inserção: um trigger bloqueia UPDATE e DELETE para nunca sobrescrever um preço anterior.
-- Nenhuma linha é criada aqui: sem fonte implementada, as telas mostram "sem dados" (ausência nunca vira preço zero).
CREATE TABLE IF NOT EXISTS public.competitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  kind text NOT NULL DEFAULT 'direto' CHECK (kind IN ('direto', 'tradicional')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.competitor_category_map (
  competitor_id uuid NOT NULL REFERENCES public.competitors(id),
  source_category text NOT NULL,
  normalized_category text NOT NULL,
  PRIMARY KEY (competitor_id, source_category)
);

CREATE TABLE IF NOT EXISTS public.competitor_price_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id uuid NOT NULL REFERENCES public.competitors(id),
  source text NOT NULL,                       -- planilha, api, cotação manual...
  source_url text,
  location text NOT NULL,
  source_category text,
  normalized_category text,
  collected_at timestamptz NOT NULL,
  pickup_at timestamptz NOT NULL,
  return_at timestamptz NOT NULL,
  total_price numeric(12,2) CHECK (total_price IS NULL OR total_price > 0),
  daily_price numeric(12,2) CHECK (daily_price IS NULL OR daily_price > 0),
  currency text NOT NULL DEFAULT 'BRL',
  taxes_included boolean,                     -- null = desconhecido
  protections text,
  mileage text,
  cancellation_policy text,
  payment_conditions text,
  available boolean,                          -- null = não informado; indisponível não tem preço
  equivalence text NOT NULL DEFAULT 'nao_avaliada' CHECK (equivalence IN ('equivalente', 'parcial', 'nao_equivalente', 'nao_avaliada')),
  equivalence_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (return_at > pickup_at)
);
CREATE INDEX IF NOT EXISTS competitor_price_snapshots_pickup_idx ON public.competitor_price_snapshots (pickup_at, normalized_category);
CREATE INDEX IF NOT EXISTS competitor_price_snapshots_collected_idx ON public.competitor_price_snapshots (collected_at DESC);

-- Nossa tarifa de tabela do HQ (tarifas_atuais/snapshot_tarifas) por categoria e data de retirada, preservada a cada publicação.
CREATE TABLE IF NOT EXISTS public.our_rate_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collected_at timestamptz NOT NULL DEFAULT now(),
  pickup_date date NOT NULL,
  category text NOT NULL,
  daily_rate numeric(12,2) NOT NULL CHECK (daily_rate > 0),
  season text,
  source text NOT NULL DEFAULT 'hq_tabela'
);
CREATE INDEX IF NOT EXISTS our_rate_snapshots_date_idx ON public.our_rate_snapshots (pickup_date, category, collected_at DESC);

CREATE OR REPLACE FUNCTION public.block_snapshot_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Coletas são históricas: % em % não é permitido', TG_OP, TG_TABLE_NAME;
END $$;
DROP TRIGGER IF EXISTS competitor_price_snapshots_append_only ON public.competitor_price_snapshots;
CREATE TRIGGER competitor_price_snapshots_append_only BEFORE UPDATE OR DELETE ON public.competitor_price_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.block_snapshot_mutation();
DROP TRIGGER IF EXISTS our_rate_snapshots_append_only ON public.our_rate_snapshots;
CREATE TRIGGER our_rate_snapshots_append_only BEFORE UPDATE OR DELETE ON public.our_rate_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.block_snapshot_mutation();

ALTER TABLE public.competitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_category_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_price_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.our_rate_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "competitors email read" ON public.competitors;
CREATE POLICY "competitors email read" ON public.competitors FOR SELECT TO authenticated
  USING (lower(auth.jwt() ->> 'email') = 'marketing@orlandorentcar.com');
DROP POLICY IF EXISTS "competitor map email read" ON public.competitor_category_map;
CREATE POLICY "competitor map email read" ON public.competitor_category_map FOR SELECT TO authenticated
  USING (lower(auth.jwt() ->> 'email') = 'marketing@orlandorentcar.com');
DROP POLICY IF EXISTS "competitor snapshots email read" ON public.competitor_price_snapshots;
CREATE POLICY "competitor snapshots email read" ON public.competitor_price_snapshots FOR SELECT TO authenticated
  USING (lower(auth.jwt() ->> 'email') = 'marketing@orlandorentcar.com');
DROP POLICY IF EXISTS "our rate snapshots email read" ON public.our_rate_snapshots;
CREATE POLICY "our rate snapshots email read" ON public.our_rate_snapshots FOR SELECT TO authenticated
  USING (lower(auth.jwt() ->> 'email') = 'marketing@orlandorentcar.com');
