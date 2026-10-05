CREATE TABLE public.webhook_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  event_type text,
  payload jsonb,
  authorized boolean NOT NULL DEFAULT false,
  processing_status text NOT NULL DEFAULT 'received',
  error_message text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

GRANT SELECT ON public.webhook_logs TO authenticated;
GRANT ALL ON public.webhook_logs TO service_role;

ALTER TABLE public.webhook_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read webhook logs"
ON public.webhook_logs
FOR SELECT
TO authenticated
USING (true);

CREATE INDEX webhook_logs_source_received_idx
ON public.webhook_logs (source, received_at DESC);