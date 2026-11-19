-- Vencimento com hora (o ClickMassa considera atrasada a tarefa de hoje cujo horário já passou).
ALTER TABLE public.crm_tasks ADD COLUMN IF NOT EXISTS due_at timestamptz;
CREATE INDEX IF NOT EXISTS crm_tasks_due_at_idx ON public.crm_tasks (due_at) WHERE completed = false;
