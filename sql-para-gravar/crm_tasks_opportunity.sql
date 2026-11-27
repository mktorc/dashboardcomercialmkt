-- Tarefa ligada à oportunidade (o ClickMassa conta "tarefas vencidas" por oportunidade, não por contato).
ALTER TABLE public.crm_tasks ADD COLUMN IF NOT EXISTS opportunity_id text;
CREATE INDEX IF NOT EXISTS crm_tasks_opportunity_idx ON public.crm_tasks (opportunity_id) WHERE completed = false;
