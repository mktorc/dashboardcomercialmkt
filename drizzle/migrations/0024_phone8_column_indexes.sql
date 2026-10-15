CREATE INDEX IF NOT EXISTS crm_leads_phone8_col_idx ON public.crm_leads (phone8, created_at);
CREATE INDEX IF NOT EXISTS reservations_phone8_col_idx ON public.reservations (phone8);
ANALYZE public.crm_leads;
ANALYZE public.reservations;
ANALYZE public.crm_opportunities;