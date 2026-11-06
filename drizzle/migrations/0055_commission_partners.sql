-- Notas internas dos parceiros de comissão (aba Commission Partners do HQ, que a API não expõe).
-- Preenchidas por scripts/comissoes/importar-parceiros.mjs (service role). Têm dados bancários:
-- só usuários logados leem; anon (link público de comissões) não vê.
CREATE TABLE IF NOT EXISTS public.commission_partners (
  name text PRIMARY KEY,
  internal_notes text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.commission_partners ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "autenticado le parceiros" ON public.commission_partners;
CREATE POLICY "autenticado le parceiros" ON public.commission_partners FOR SELECT TO authenticated USING (true);
