DROP POLICY IF EXISTS "role read opportunities" ON public.crm_opportunities;
CREATE POLICY "role read opportunities" ON public.crm_opportunities FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['superadmin','comercial','marketing']::public.app_role[]));