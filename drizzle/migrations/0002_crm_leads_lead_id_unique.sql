DROP INDEX IF EXISTS public.crm_leads_lead_id_key;
ALTER TABLE public.crm_leads ADD CONSTRAINT crm_leads_lead_id_unique UNIQUE (lead_id);