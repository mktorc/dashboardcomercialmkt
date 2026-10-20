ALTER TABLE public.google_ads_metrics ADD COLUMN IF NOT EXISTS conversions numeric NOT NULL DEFAULT 0;
