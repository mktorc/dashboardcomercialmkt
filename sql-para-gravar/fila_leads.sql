-- Fila de Leads (round-robin). Rodar no SQL Editor do Supabase ANTES de publicar o código novo.
-- Só o servidor (service_role) lê e grava: RLS ligada, sem policies para anon/authenticated.
CREATE TABLE IF NOT EXISTS public.vendedores (
  id serial PRIMARY KEY,
  cm_user_id integer NOT NULL UNIQUE,
  nome text NOT NULL,
  email text,
  ativo boolean NOT NULL DEFAULT true,
  ultimo_lead_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.vendedores ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.vendedores TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.vendedores_id_seq TO service_role;

CREATE TABLE IF NOT EXISTS public.historico_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  nome_lead text,
  telefone text,
  origem text,
  vendedor_nome text,
  vendedor_cm_user_id integer,
  status text
);
ALTER TABLE public.historico_leads ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.historico_leads TO service_role;
CREATE INDEX IF NOT EXISTS historico_leads_created_at_idx ON public.historico_leads (created_at DESC);

-- Escolhe o próximo vendedor com trava de linha (FOR UPDATE SKIP LOCKED), move ele para o fim da fila
-- e registra no histórico, tudo numa transação. Nunca devolve o mesmo vendedor a duas chamadas simultâneas.
CREATE OR REPLACE FUNCTION public.fila_proximo(p_nome text DEFAULT NULL, p_telefone text DEFAULT NULL)
RETURNS TABLE (cm_user_id integer, nome text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v public.vendedores%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.vendedores
  WHERE ativo
  ORDER BY ultimo_lead_at ASC NULLS FIRST, id ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN; END IF;

  UPDATE public.vendedores SET ultimo_lead_at = now() WHERE id = v.id;
  INSERT INTO public.historico_leads (nome_lead, telefone, origem, vendedor_nome, vendedor_cm_user_id, status)
  VALUES (p_nome, p_telefone, 'IA', v.nome, v.cm_user_id, 'Distribuído');

  cm_user_id := v.cm_user_id;
  nome := v.nome;
  RETURN NEXT;
END;
$$;

-- Lead pego por fora: vendedor vai para o fim da fila.
CREATE OR REPLACE FUNCTION public.fila_externo(p_cm_user_id integer, p_nome text, p_telefone text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v public.vendedores%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.vendedores WHERE cm_user_id = p_cm_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.vendedores SET ultimo_lead_at = now() WHERE id = v.id;
  INSERT INTO public.historico_leads (nome_lead, telefone, origem, vendedor_nome, vendedor_cm_user_id, status)
  VALUES (p_nome, p_telefone, 'Externo', v.nome, v.cm_user_id, 'Registrado (externo)');
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.fila_proximo(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fila_externo(integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fila_proximo(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fila_externo(integer, text, text) TO service_role;
