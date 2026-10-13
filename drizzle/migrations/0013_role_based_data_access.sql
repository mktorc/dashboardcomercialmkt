CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid, _roles public.app_role[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = ANY(_roles))
$$;

DROP POLICY IF EXISTS "auth read leads" ON public.crm_leads;
CREATE POLICY "role read leads" ON public.crm_leads FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['superadmin','comercial','marketing']::public.app_role[]));

DROP POLICY IF EXISTS "auth read reservations" ON public.reservations;
CREATE POLICY "role read reservations" ON public.reservations FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['superadmin','comercial','marketing']::public.app_role[]));

DROP POLICY IF EXISTS "auth read meta" ON public.meta_ads_metrics;
CREATE POLICY "role read meta" ON public.meta_ads_metrics FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['superadmin','marketing']::public.app_role[]));

DROP POLICY IF EXISTS "auth read google" ON public.google_ads_metrics;
CREATE POLICY "role read google" ON public.google_ads_metrics FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['superadmin','marketing']::public.app_role[]));

DROP POLICY IF EXISTS "auth read opportunities" ON public.crm_opportunities;
CREATE POLICY "role read opportunities" ON public.crm_opportunities FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['superadmin','comercial']::public.app_role[]));

DROP POLICY IF EXISTS "auth read tasks" ON public.crm_tasks;
CREATE POLICY "role read tasks" ON public.crm_tasks FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['superadmin','comercial']::public.app_role[]));

DROP POLICY IF EXISTS "auth read fleet" ON public.fleet_stats;
CREATE POLICY "role read fleet" ON public.fleet_stats FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['superadmin','comercial']::public.app_role[]));

DROP POLICY IF EXISTS "auth all goals" ON public.sales_goals;
CREATE POLICY "role read goals" ON public.sales_goals FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['superadmin','comercial']::public.app_role[]));
CREATE POLICY "superadmin write goals" ON public.sales_goals FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'superadmin'));
CREATE POLICY "superadmin update goals" ON public.sales_goals FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin')) WITH CHECK (public.has_role(auth.uid(), 'superadmin'));
CREATE POLICY "superadmin delete goals" ON public.sales_goals FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'));

DROP POLICY IF EXISTS "auth read webhook logs" ON public.webhook_logs;
CREATE POLICY "superadmin read webhook logs" ON public.webhook_logs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'));