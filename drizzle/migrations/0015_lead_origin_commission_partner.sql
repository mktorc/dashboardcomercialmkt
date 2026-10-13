ALTER TABLE public.crm_leads ADD COLUMN IF NOT EXISTS lead_origin text;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS commission_partner text;