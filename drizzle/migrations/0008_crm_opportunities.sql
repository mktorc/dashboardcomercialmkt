CREATE TABLE public.crm_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id text NOT NULL UNIQUE,
  lead_id text,
  name text,
  stage_name text,
  status text,
  seller_name text,
  value numeric NOT NULL DEFAULT 0,
  pending_tasks integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.crm_opportunities TO authenticated;
GRANT ALL ON public.crm_opportunities TO service_role;
ALTER TABLE public.crm_opportunities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read opportunities" ON public.crm_opportunities FOR SELECT TO authenticated USING (true);
CREATE INDEX crm_opportunities_created_idx ON public.crm_opportunities (created_at);

INSERT INTO public.crm_opportunities (opportunity_id, lead_id, name, stage_name, status, seller_name, value, pending_tasks, created_at, updated_at)
SELECT DISTINCT ON (payload->>'id')
  payload->>'id',
  'cm-' || (payload->>'contactId'),
  payload->>'name',
  payload->'pipelineStep'->>'name',
  payload->>'status',
  COALESCE(payload->'responsible'->>'name', payload->'user'->>'name'),
  COALESCE(NULLIF(payload->>'value','')::numeric, 0),
  COALESCE((payload->'tasksCount'->>'countSchendule')::int,0) + COALESCE((payload->'tasksCount'->>'countDelayed')::int,0) + COALESCE((payload->'tasksCount'->>'countRequiredPending')::int,0),
  (payload->>'createdAt')::timestamptz,
  COALESCE((payload->>'updatedAt')::timestamptz, received_at)
FROM public.webhook_logs
WHERE event_type = 'Opportunity' AND payload->>'id' IS NOT NULL
ORDER BY payload->>'id', received_at DESC;