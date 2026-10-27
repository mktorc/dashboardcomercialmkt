-- Total de tarefas da oportunidade no ClickMassa (tasksCount: agendadas + atrasadas + obrigatórias pendentes + concluídas).
-- O filtro "Sem tarefas" do ClickMassa significa "nunca teve tarefa", então pending_tasks (só pendentes) não basta.
-- NULL = ainda não sincronizado; esses registros não contam como "sem tarefa".
ALTER TABLE public.crm_opportunities ADD COLUMN IF NOT EXISTS total_tasks integer;
-- O GRANT anônimo é por coluna (0037): a página operacional pública precisa ler a nova coluna.
GRANT SELECT (total_tasks) ON public.crm_opportunities TO anon;
