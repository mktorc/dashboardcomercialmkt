CREATE INDEX IF NOT EXISTS crm_leads_phone8_idx ON public.crm_leads (right(regexp_replace(phone, '\D', '', 'g'), 8));
CREATE INDEX IF NOT EXISTS crm_leads_email_lower_idx ON public.crm_leads (lower(email));

CREATE OR REPLACE FUNCTION public.reservation_lead_matches(_from timestamptz, _to timestamptz)
RETURNS TABLE(reservation_id text, lead_id text, lead_origin text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT r.reservation_id, m.lead_id, m.lead_origin
  FROM public.reservations r
  CROSS JOIN LATERAL (
    SELECT c.lead_id, c.lead_origin FROM (
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
    ORDER BY (nullif(trim(c.lead_origin), '') IS NOT NULL) DESC, c.created_at DESC
    LIMIT 1
  ) m
  WHERE r.created_at BETWEEN _from AND _to AND r.reservation_id IS NOT NULL;
$$;
GRANT EXECUTE ON FUNCTION public.reservation_lead_matches(timestamptz, timestamptz) TO authenticated;