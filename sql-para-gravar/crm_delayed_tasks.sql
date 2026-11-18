-- Tarefas em atraso por oportunidade, direto do ClickMassa (tasksCount.countDelayed).
-- NULL = oportunidade ainda não ressincronizada depois desta coluna; o painel usa o cruzamento com crm_tasks nesses casos.
-- Rodar no SQL Editor do Supabase ANTES de publicar o código novo (sync e webhook passam a gravar esta coluna).
ALTER TABLE public.crm_opportunities ADD COLUMN IF NOT EXISTS delayed_tasks integer;
