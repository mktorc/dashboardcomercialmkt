-- Investimento mensal na equipe de marketing, somado ao investimento do CAC (dashboard, "Todas as origens").
CREATE TABLE IF NOT EXISTS public.marketing_team_costs (
  month text PRIMARY KEY CHECK (month ~ '^\d{4}-\d{2}$'),
  amount numeric NOT NULL DEFAULT 0 CHECK (amount >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_team_costs TO authenticated;
GRANT ALL ON public.marketing_team_costs TO service_role;
ALTER TABLE public.marketing_team_costs ENABLE ROW LEVEL SECURITY;

-- Leitura: mesmas abas que veem o dashboard; escrita: só superadmin.
DROP POLICY IF EXISTS "role read team costs" ON public.marketing_team_costs;
CREATE POLICY "role read team costs" ON public.marketing_team_costs FOR SELECT TO authenticated
  USING ((SELECT public.has_any_role((SELECT auth.uid()), ARRAY['superadmin','comercial','marketing']::public.app_role[])));
DROP POLICY IF EXISTS "superadmin write team costs" ON public.marketing_team_costs;
CREATE POLICY "superadmin write team costs" ON public.marketing_team_costs FOR ALL TO authenticated
  USING ((SELECT public.has_any_role((SELECT auth.uid()), ARRAY['superadmin']::public.app_role[])))
  WITH CHECK ((SELECT public.has_any_role((SELECT auth.uid()), ARRAY['superadmin']::public.app_role[])));
