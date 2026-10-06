ALTER TABLE public.crm_opportunities ADD COLUMN IF NOT EXISTS pipeline_step_id integer, ADD COLUMN IF NOT EXISTS pipeline_name text;
UPDATE public.crm_opportunities o SET pipeline_step_id = s.sid
FROM (SELECT DISTINCT ON (payload->>'id') payload->>'id' id, (payload->>'pipelineStepId')::int sid FROM public.webhook_logs WHERE payload->>'event' ILIKE 'opportunity' AND payload->>'pipelineStepId' ~ '^\d+$' ORDER BY payload->>'id', received_at DESC) s
WHERE o.opportunity_id = s.id;
UPDATE public.crm_opportunities SET pipeline_name = CASE WHEN pipeline_step_id BETWEEN 1 AND 6 THEN 'Comercial' WHEN pipeline_step_id IS NOT NULL THEN 'Sucesso do Cliente' END;