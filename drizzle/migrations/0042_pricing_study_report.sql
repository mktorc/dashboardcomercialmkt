-- Estudo de precificação (menu oculto "Precificação"): guarda o relatório HTML gerado por scripts/precificacao.
-- Acesso por E-MAIL, não por perfil: só marketing@orlandorentcar.com lê (nem superadmin, nem MCP, que lê com o token do usuário).
-- Sem política de escrita: quem grava é o script `publicar`, com a service role (ignora RLS).
-- Conteúdo agregado, sem dado pessoal de cliente.
CREATE TABLE IF NOT EXISTS public.pricing_study_report (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generated_at timestamptz NOT NULL DEFAULT now(),
  period_start date NOT NULL,
  period_end date NOT NULL,
  html text NOT NULL
);
ALTER TABLE public.pricing_study_report ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pricing study email read" ON public.pricing_study_report FOR SELECT TO authenticated
  USING (lower(auth.jwt() ->> 'email') = 'marketing@orlandorentcar.com');
