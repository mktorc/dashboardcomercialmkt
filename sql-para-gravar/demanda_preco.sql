-- Aba "Demanda & Preço" (Precificação). Rodar no SQL Editor do Supabase.

-- 1) Chegadas mensais de brasileiros (NTTO / I-94), gravadas pelo coletor Python (analise-demanda/main.py)
--    com a service role. Dado público; a leitura segue a da Precificação (só o e-mail autorizado).
CREATE TABLE IF NOT EXISTS public.ntto_chegadas (
  mes date PRIMARY KEY,                    -- 1º dia do mês
  eua integer,                             -- total de brasileiros (Tabela I.1)
  florida integer,                         -- estado de 1º endereço Flórida (Tabela I.1)
  orlando integer,                         -- porto aéreo Orlando, FL (Tabela Q.1)
  miami integer,                           -- porto aéreo Miami, FL (Tabela Q.1)
  fort_lauderdale integer,                 -- porto aéreo Fort Lauderdale, FL (Tabela Q.1)
  preliminar boolean NOT NULL DEFAULT false,
  fonte text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ntto_chegadas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ntto_chegadas FROM anon, authenticated;
GRANT SELECT ON public.ntto_chegadas TO authenticated;
GRANT ALL ON public.ntto_chegadas TO service_role;

DROP POLICY IF EXISTS "ntto chegadas pricing read" ON public.ntto_chegadas;
CREATE POLICY "ntto chegadas pricing read" ON public.ntto_chegadas FOR SELECT TO authenticated
  USING (lower(auth.jwt() ->> 'email') = 'marketing@orlandorentcar.com');

-- 2) Loja de retirada em cada reserva (HQ pick_up_location_id). O sync passa a gravar e o histórico é
--    preenchido a partir do HQ. Sem esta coluna a aba não consegue separar Orlando.
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS pick_up_location_id integer;
CREATE INDEX IF NOT EXISTS reservations_pick_up_location_idx ON public.reservations (pick_up_location_id);
