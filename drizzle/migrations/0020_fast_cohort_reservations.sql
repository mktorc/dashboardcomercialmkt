ALTER TABLE public.crm_leads ADD COLUMN IF NOT EXISTS phone8 text GENERATED ALWAYS AS (nullif(right(regexp_replace(coalesce(phone,''), '\D', '', 'g'), 8), '')) STORED;
ALTER TABLE public.crm_leads ADD COLUMN IF NOT EXISTS email_lc text GENERATED ALWAYS AS (lower(nullif(email,''))) STORED;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS phone8 text GENERATED ALWAYS AS (nullif(right(regexp_replace(coalesce(customer_phone,''), '\D', '', 'g'), 8), '')) STORED;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS email_lc text GENERATED ALWAYS AS (lower(nullif(customer_email,''))) STORED;
CREATE INDEX IF NOT EXISTS crm_leads_phone8_idx ON public.crm_leads (phone8, created_at);
CREATE INDEX IF NOT EXISTS crm_leads_email_lc_idx ON public.crm_leads (email_lc, created_at);
CREATE INDEX IF NOT EXISTS reservations_phone8_idx ON public.reservations (phone8);
CREATE INDEX IF NOT EXISTS reservations_email_lc_idx ON public.reservations (email_lc);
CREATE INDEX IF NOT EXISTS crm_opps_pipeline_created_idx ON public.crm_opportunities (pipeline_name, created_at);

CREATE OR REPLACE FUNCTION public.cohort_reservations(_from timestamptz, _to timestamptz)
RETURNS TABLE(reservation_id text, created_at timestamptz, car_category text, rental_days integer, total_amount numeric, status text, utm_campaign text, commission_partner text, lead_id text, lead_origin text, lead_created_at timestamptz)
LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  WITH cohort AS (
    SELECT DISTINCT o.lead_id FROM public.crm_opportunities o
    WHERE o.pipeline_name = 'Comercial' AND o.created_at BETWEEN _from AND _to AND o.lead_id IS NOT NULL
  ), cl AS (
    SELECT l.created_at, l.phone8 AS p8, l.email_lc AS em
    FROM public.crm_leads l JOIN cohort c ON c.lead_id = l.lead_id
  ), cand AS (
    SELECT r.reservation_id FROM public.reservations r JOIN cl ON r.phone8 = cl.p8 AND length(cl.p8) = 8
      WHERE r.created_at >= cl.created_at - interval '1 day'
    UNION
    SELECT r.reservation_id FROM public.reservations r JOIN cl ON r.email_lc = cl.em
      WHERE r.created_at >= cl.created_at - interval '1 day'
  )
  SELECT r.reservation_id, r.created_at, r.car_category, r.rental_days, r.total_amount, r.status, r.utm_campaign, r.commission_partner, m.lead_id, m.lead_origin, m.created_at
  FROM public.reservations r JOIN cand ON cand.reservation_id = r.reservation_id
  CROSS JOIN LATERAL (
    SELECT c.lead_id, c.lead_origin, c.created_at FROM (
      SELECT l.lead_id, l.lead_origin, l.created_at FROM public.crm_leads l
      WHERE length(r.phone8) = 8 AND l.phone8 = r.phone8 AND l.created_at <= r.created_at + interval '1 day'
      UNION ALL
      SELECT l.lead_id, l.lead_origin, l.created_at FROM public.crm_leads l
      WHERE r.email_lc IS NOT NULL AND l.email_lc = r.email_lc AND l.created_at <= r.created_at + interval '1 day'
    ) c ORDER BY c.created_at DESC LIMIT 1
  ) m
  WHERE m.lead_id IN (SELECT lead_id FROM cohort);
$function$;