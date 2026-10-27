-- Aba Comercial Operacional sem login: leitura anônima restrita às colunas que a página usa.
REVOKE ALL ON public.reservations, public.crm_tasks, public.crm_opportunities, public.sales_goals, public.fleet_stats FROM anon;

GRANT SELECT (created_at, total_amount, discount_amount, rack_rate, status, seller_name, pick_up_at, return_at) ON public.reservations TO anon;
GRANT SELECT (lead_id, user_name, completed, due_date, created_at) ON public.crm_tasks TO anon;
GRANT SELECT (opportunity_id, lead_id, name, stage_name, status, seller_name, pending_tasks, created_at) ON public.crm_opportunities TO anon;
GRANT SELECT (seller_name, month, revenue_goal, ticket_goal, discount_goal, conversion_goal) ON public.sales_goals TO anon;
GRANT SELECT (id, vehicles) ON public.fleet_stats TO anon;

DROP POLICY IF EXISTS "anon read reservations" ON public.reservations;
CREATE POLICY "anon read reservations" ON public.reservations FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "anon read tasks" ON public.crm_tasks;
CREATE POLICY "anon read tasks" ON public.crm_tasks FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "anon read opportunities" ON public.crm_opportunities;
CREATE POLICY "anon read opportunities" ON public.crm_opportunities FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "anon read goals" ON public.sales_goals;
CREATE POLICY "anon read goals" ON public.sales_goals FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "anon read fleet" ON public.fleet_stats;
CREATE POLICY "anon read fleet" ON public.fleet_stats FOR SELECT TO anon USING (true);
