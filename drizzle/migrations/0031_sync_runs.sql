CREATE TABLE IF NOT EXISTS public.sync_runs (
  service text PRIMARY KEY,
  last_success_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.sync_runs TO authenticated;
GRANT ALL ON public.sync_runs TO service_role;
ALTER TABLE public.sync_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "role read sync_runs" ON public.sync_runs;
CREATE POLICY "role read sync_runs" ON public.sync_runs FOR SELECT TO authenticated
  USING ((SELECT public.has_any_role((SELECT auth.uid()), ARRAY['superadmin','comercial','marketing']::public.app_role[])));
