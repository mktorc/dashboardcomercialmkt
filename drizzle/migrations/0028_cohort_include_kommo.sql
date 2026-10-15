CREATE OR REPLACE FUNCTION public.cohort_reservations(_from timestamp with time zone, _to timestamp with time zone)
RETURNS TABLE(reservation_id text, created_at timestamp with time zone, car_category text, rental_days integer, total_amount numeric, status text, utm_campaign text, commission_partner text, lead_id text, lead_origin text, lead_created_at timestamp with time zone)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
#variable_conflict use_column
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['superadmin','comercial','marketing']::app_role[]) THEN
    RETURN;
  END IF;
  RETURN QUERY
  WITH cohort AS (
    SELECT DISTINCT o.lead_id FROM public.crm_opportunities o
    WHERE o.pipeline_name = 'Comercial' AND o.created_at BETWEEN _from AND _to AND o.lead_id IS NOT NULL
    UNION
    SELECT k.lead_id FROM public.crm_leads k
    WHERE k.lead_id LIKE 'kommo-%' AND k.created_at BETWEEN _from AND _to
  ), cl AS MATERIALIZED (
    SELECT l.created_at, l.phone8 AS p8, l.email_lc AS em
    FROM public.crm_leads l JOIN cohort c ON c.lead_id = l.lead_id
  ), cand AS MATERIALIZED (
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
  WHERE m.lead_id IN (SELECT co.lead_id FROM cohort co);
END;
$fn$;