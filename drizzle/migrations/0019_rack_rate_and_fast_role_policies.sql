ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS rack_rate numeric(12,2);

DROP POLICY IF EXISTS "role read leads" ON public.crm_leads;
CREATE POLICY "role read leads" ON public.crm_leads FOR SELECT TO authenticated
  USING ((SELECT public.has_any_role((SELECT auth.uid()), ARRAY['superadmin','comercial','marketing']::app_role[])));

DROP POLICY IF EXISTS "role read opportunities" ON public.crm_opportunities;
CREATE POLICY "role read opportunities" ON public.crm_opportunities FOR SELECT TO authenticated
  USING ((SELECT public.has_any_role((SELECT auth.uid()), ARRAY['superadmin','comercial','marketing']::app_role[])));

DROP POLICY IF EXISTS "role read reservations" ON public.reservations;
CREATE POLICY "role read reservations" ON public.reservations FOR SELECT TO authenticated
  USING ((SELECT public.has_any_role((SELECT auth.uid()), ARRAY['superadmin','comercial','marketing']::app_role[])));

DROP POLICY IF EXISTS "role read tasks" ON public.crm_tasks;
CREATE POLICY "role read tasks" ON public.crm_tasks FOR SELECT TO authenticated
  USING ((SELECT public.has_any_role((SELECT auth.uid()), ARRAY['superadmin','comercial']::app_role[])));