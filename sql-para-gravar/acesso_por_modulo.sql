-- Acesso por módulo: cada usuário tem os módulos que enxerga, mais duas permissões à parte:
--   is_admin  -> Configurações, validar desconto e todos os módulos (era o perfil superadmin)
--   can_pay   -> marcar comissão como paga e compensar estorno (era o perfil financeiro)
-- As RLS existentes continuam chamando has_role/has_any_role; essas funções passam a ler user_access:
--   'superadmin'                              -> is_admin
--   'financeiro'                              -> is_admin ou can_pay
--   'comercial' | 'marketing' | 'comercial_gerencial' -> is_admin ou algum módulo de dados
--      (dashboard, comercial, comercial-operacional, fila-leads)
-- user_roles fica no banco só como backup (o app não lê mais).

BEGIN;

CREATE TABLE IF NOT EXISTS public.user_access (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  modules text[] NOT NULL DEFAULT '{}',
  is_admin boolean NOT NULL DEFAULT false,
  can_pay boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_access_modules_validos CHECK (
    modules <@ ARRAY['dashboard','comercial','comercial-operacional','comissoes','fila-leads']::text[]
  )
);
GRANT SELECT ON public.user_access TO authenticated;
GRANT ALL ON public.user_access TO service_role;
ALTER TABLE public.user_access ENABLE ROW LEVEL SECURITY;

-- Copia o que cada perfil liberava hoje.
INSERT INTO public.user_access (user_id, modules, is_admin, can_pay)
SELECT user_id,
  CASE role
    WHEN 'superadmin' THEN ARRAY['dashboard','comercial','comercial-operacional','comissoes','fila-leads']
    WHEN 'comercial' THEN ARRAY['dashboard','comercial','comercial-operacional','comissoes','fila-leads']
    WHEN 'marketing' THEN ARRAY['dashboard','comercial','comercial-operacional']
    WHEN 'comercial_gerencial' THEN ARRAY['comercial','comercial-operacional','comissoes','fila-leads']
    WHEN 'financeiro' THEN ARRAY['comissoes']
  END::text[],
  role = 'superadmin',
  role = 'financeiro'
FROM public.user_roles
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_access a
    WHERE a.user_id = _user_id AND (
      a.is_admin
      OR (_role = 'financeiro' AND a.can_pay)
      OR (_role IN ('comercial','marketing','comercial_gerencial')
          AND a.modules && ARRAY['dashboard','comercial','comercial-operacional','fila-leads']::text[])
    )
  )
$$;

CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid, _roles public.app_role[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM unnest(_roles) r WHERE public.has_role(_user_id, r))
$$;

DROP POLICY IF EXISTS "read own access" ON public.user_access;
CREATE POLICY "read own access" ON public.user_access FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR (SELECT public.has_role((SELECT auth.uid()), 'superadmin')));

COMMIT;
