CREATE INDEX IF NOT EXISTS reservations_phone8_idx ON public.reservations (right(regexp_replace(customer_phone, '\D', '', 'g'), 8));
CREATE INDEX IF NOT EXISTS reservations_email_lower_idx ON public.reservations (lower(customer_email));

CREATE OR REPLACE FUNCTION public.cohort_reservations(_from timestamptz, _to timestamptz)
RETURNS TABLE(reservation_id text, created_at timestamptz, car_category text, rental_days integer, total_amount numeric, status text, utm_campaign text, commission_partner text, lead_id text, lead_origin text, lead_created_at timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH cohort AS (
    SELECT DISTINCT o.lead_id FROM public.crm_opportunities o
    WHERE o.pipeline_name = 'Comercial' AND o.created_at BETWEEN _from AND _to AND o.lead_id IS NOT NULL
  ), cl AS (
    SELECT l.lead_id, l.created_at, right(regexp_replace(coalesce(l.phone,''), '\D', '', 'g'), 8) AS p8, lower(nullif(l.email,'')) AS em
    FROM public.crm_leads l JOIN cohort c ON c.lead_id = l.lead_id
  ), cand AS (
    SELECT DISTINCT r.reservation_id FROM public.reservations r JOIN cl ON
      ((length(cl.p8) = 8 AND right(regexp_replace(coalesce(r.customer_phone,''), '\D', '', 'g'), 8) = cl.p8)
       OR (cl.em IS NOT NULL AND lower(r.customer_email) = cl.em))
      AND r.created_at >= cl.created_at - interval '1 day'
    WHERE r.reservation_id IS NOT NULL
  )
  SELECT r.reservation_id, r.created_at, r.car_category, r.rental_days, r.total_amount, r.status, r.utm_campaign, r.commission_partner, m.lead_id, m.lead_origin, m.created_at
  FROM public.reservations r JOIN cand ON cand.reservation_id = r.reservation_id
  CROSS JOIN LATERAL (
    SELECT c.lead_id, c.lead_origin, c.created_at FROM (
      SELECT l.lead_id, l.lead_origin, l.created_at FROM public.crm_leads l
      WHERE length(regexp_replace(coalesce(r.customer_phone, ''), '\D', '', 'g')) >= 8
        AND right(regexp_replace(l.phone, '\D', '', 'g'), 8) = right(regexp_replace(r.customer_phone, '\D', '', 'g'), 8)
        AND l.created_at <= r.created_at + interval '1 day'
      UNION ALL
      SELECT l.lead_id, l.lead_origin, l.created_at FROM public.crm_leads l
      WHERE r.customer_email IS NOT NULL AND r.customer_email <> ''
        AND lower(l.email) = lower(r.customer_email)
        AND l.created_at <= r.created_at + interval '1 day'
    ) c
    ORDER BY c.created_at DESC
    LIMIT 1
  ) m
  WHERE m.lead_id IN (SELECT lead_id FROM cohort);
$$;
GRANT EXECUTE ON FUNCTION public.cohort_reservations(timestamptz, timestamptz) TO authenticated;