ALTER TABLE public.crm_leads
ADD COLUMN first_response_at timestamptz;

ALTER TABLE public.crm_tasks
ADD COLUMN completed_at timestamptz;

COMMENT ON COLUMN public.crm_leads.first_response_at IS 'Timestamp da primeira resposta ou atendimento informado pelo ClickMassa.';
COMMENT ON COLUMN public.crm_tasks.completed_at IS 'Timestamp de conclusão informado pelo ClickMassa para medir execução no prazo.';