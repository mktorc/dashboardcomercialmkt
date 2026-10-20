-- Leitura para o perfil comercial_gerencial: apenas os dados das abas Comercial.
-- NÃO inclui meta_ads_metrics nem google_ads_metrics (dados de Marketing).
DROP POLICY IF EXISTS "role read leads" ON public.crm_leads;
CREATE POLICY "role read leads" ON public.crm_leads FOR SELECT TO authenticated
  USING ((SELECT public.has_any_role((SELECT auth.uid()), ARRAY['superadmin','comercial','marketing','comercial_gerencial']::app_role[])));

DROP POLICY IF EXISTS "role read reservations" ON public.reservations;
CREATE POLICY "role read reservations" ON public.reservations FOR SELECT TO authenticated
  USING ((SELECT public.has_any_role((SELECT auth.uid()), ARRAY['superadmin','comercial','marketing','comercial_gerencial']::app_role[])));

DROP POLICY IF EXISTS "role read opportunities" ON public.crm_opportunities;
CREATE POLICY "role read opportunities" ON public.crm_opportunities FOR SELECT TO authenticated
  USING ((SELECT public.has_any_role((SELECT auth.uid()), ARRAY['superadmin','comercial','marketing','comercial_gerencial']::app_role[])));

DROP POLICY IF EXISTS "role read tasks" ON public.crm_tasks;
CREATE POLICY "role read tasks" ON public.crm_tasks FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['superadmin','comercial','marketing','comercial_gerencial']::app_role[]));

DROP POLICY IF EXISTS "role read fleet" ON public.fleet_stats;
CREATE POLICY "role read fleet" ON public.fleet_stats FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['superadmin','comercial','marketing','comercial_gerencial']::app_role[]));

DROP POLICY IF EXISTS "role read goals" ON public.sales_goals;
CREATE POLICY "role read goals" ON public.sales_goals FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['superadmin','comercial','marketing','comercial_gerencial']::app_role[]));

DROP POLICY IF EXISTS "role read sync_runs" ON public.sync_runs;
CREATE POLICY "role read sync_runs" ON public.sync_runs FOR SELECT TO authenticated
  USING ((SELECT public.has_any_role((SELECT auth.uid()), ARRAY['superadmin','comercial','marketing','comercial_gerencial']::public.app_role[])));
