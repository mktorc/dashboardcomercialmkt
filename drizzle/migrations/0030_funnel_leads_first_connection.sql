ALTER TABLE public.meta_ads_metrics ADD COLUMN IF NOT EXISTS leads integer NOT NULL DEFAULT 0;
ALTER TABLE public.crm_leads ADD COLUMN IF NOT EXISTS first_connection_name text;
