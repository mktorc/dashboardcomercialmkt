-- Script para migrar dados de meta_ads_daily para meta_ads_metrics (tabela correta)
-- Execute este script no SQL Editor do Supabase

-- 1. Verificar se a tabela meta_ads_daily existe e tem dados
SELECT COUNT(*) as total_records FROM meta_ads_daily;

-- 2. Inserir dados de meta_ads_daily em meta_ads_metrics
INSERT INTO public.meta_ads_metrics
  (date, campaign_name, campaign_id, spend, clicks, impressions, utm_campaign, conversations)
SELECT
  date,
  campaign_name,
  campaign_id,
  spend,
  clicks,
  impressions,
  utm_campaign,
  conversations
FROM meta_ads_daily
ON CONFLICT (date, campaign_id) DO UPDATE SET
  campaign_name = EXCLUDED.campaign_name,
  spend = EXCLUDED.spend,
  clicks = EXCLUDED.clicks,
  impressions = EXCLUDED.impressions,
  utm_campaign = EXCLUDED.utm_campaign,
  conversations = EXCLUDED.conversations;

-- 3. Verificar dados inseridos
SELECT COUNT(*) as total_in_meta_ads_metrics FROM public.meta_ads_metrics;

-- 4. Amostra dos dados
SELECT * FROM public.meta_ads_metrics
WHERE date >= '2026-01-01' AND date <= '2026-09-30'
ORDER BY date DESC
LIMIT 10;

-- 5. Validar gasto total (deve ser ~US$ 38.687,60 para Meta)
SELECT
  SUM(spend) as total_spend,
  COUNT(*) as record_count,
  MIN(date) as first_date,
  MAX(date) as last_date
FROM public.meta_ads_metrics
WHERE date >= '2026-01-01' AND date <= '2026-09-30';

-- 6. Validar Julho (deve ser ~US$ 5.974,34)
SELECT
  SUM(spend) as july_spend,
  COUNT(*) as july_records
FROM public.meta_ads_metrics
WHERE EXTRACT(YEAR FROM date) = 2026
  AND EXTRACT(MONTH FROM date) = 7;
