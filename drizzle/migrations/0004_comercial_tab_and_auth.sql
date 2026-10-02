ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS seller_name text, ADD COLUMN IF NOT EXISTS discount_amount numeric NOT NULL DEFAULT 0;
ALTER TABLE public.crm_leads ADD COLUMN IF NOT EXISTS seller_name text;

CREATE TABLE public.crm_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id text NOT NULL UNIQUE,
  user_name text,
  lead_id text,
  completed boolean NOT NULL DEFAULT false,
  due_date date,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.crm_tasks TO authenticated;
GRANT ALL ON public.crm_tasks TO service_role;
ALTER TABLE public.crm_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read tasks" ON public.crm_tasks FOR SELECT TO authenticated USING (true);
CREATE INDEX crm_tasks_created_idx ON public.crm_tasks(created_at);

CREATE TABLE public.sales_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_name text NOT NULL,
  month text NOT NULL,
  revenue_goal numeric NOT NULL DEFAULT 0,
  ticket_goal numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (seller_name, month)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_goals TO authenticated;
GRANT ALL ON public.sales_goals TO service_role;
ALTER TABLE public.sales_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all goals" ON public.sales_goals FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "public read leads" ON public.crm_leads;
DROP POLICY IF EXISTS "public read google" ON public.google_ads_metrics;
DROP POLICY IF EXISTS "public read meta" ON public.meta_ads_metrics;
DROP POLICY IF EXISTS "public read reservations" ON public.reservations;
REVOKE SELECT ON public.crm_leads, public.google_ads_metrics, public.meta_ads_metrics, public.reservations FROM anon;
GRANT SELECT ON public.crm_leads, public.google_ads_metrics, public.meta_ads_metrics, public.reservations TO authenticated;
CREATE POLICY "auth read leads" ON public.crm_leads FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth read google" ON public.google_ads_metrics FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth read meta" ON public.meta_ads_metrics FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth read reservations" ON public.reservations FOR SELECT TO authenticated USING (true);