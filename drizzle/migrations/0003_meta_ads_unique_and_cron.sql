ALTER TABLE public.meta_ads_metrics ADD CONSTRAINT meta_ads_metrics_date_campaign_key UNIQUE (date, campaign_id);
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;