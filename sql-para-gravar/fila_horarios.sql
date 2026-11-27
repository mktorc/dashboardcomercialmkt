-- Fila de Leads: horário programado por dia da semana (fuso America/Sao_Paulo).
-- Rodar ANTES de publicar o código novo. Só acrescenta colunas/funções: o código antigo segue funcionando.
--
-- horarios: {"0": {"ini":"09:00","fim":"18:00"}, ..., "6": {...}}  (0 = domingo … 6 = sábado; dia ausente = folga)
-- usar_horario = false: vale só o botão manual (ativo).
-- usar_horario = true: precisa estar ativo E (dentro do horário do dia OU forcar_ativo).
ALTER TABLE public.vendedores ADD COLUMN IF NOT EXISTS usar_horario boolean NOT NULL DEFAULT false;
ALTER TABLE public.vendedores ADD COLUMN IF NOT EXISTS horarios jsonb NOT NULL DEFAULT '{}'::jsonb;
-- forcar_ativo = true: plantão, recebe mesmo fora do horário (desde que ativo).
ALTER TABLE public.vendedores ADD COLUMN IF NOT EXISTS forcar_ativo boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.fila_no_horario(
  p_usar boolean, p_horarios jsonb, p_agora timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE WHEN NOT p_usar THEN true ELSE COALESCE((
    SELECT l.t >= (dd.d->>'ini')::time AND l.t < (dd.d->>'fim')::time
    FROM (SELECT p_agora AT TIME ZONE 'America/Sao_Paulo' AS ts) z
    CROSS JOIN LATERAL (SELECT z.ts::time AS t, extract(dow FROM z.ts)::int AS dow) l
    CROSS JOIN LATERAL (SELECT p_horarios -> l.dow::text AS d) dd
    WHERE dd.d ? 'ini' AND dd.d ? 'fim'
  ), false) END;
$$;

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
  WHERE ativo AND (forcar_ativo OR public.fila_no_horario(usar_horario, horarios))
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

-- Modo de teste (?teste=1): quem seria o próximo, sem gravar nem mover a fila.
CREATE OR REPLACE FUNCTION public.fila_previa()
RETURNS TABLE (cm_user_id integer, nome text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT v.cm_user_id, v.nome FROM public.vendedores v
  WHERE v.ativo AND (v.forcar_ativo OR public.fila_no_horario(v.usar_horario, v.horarios))
  ORDER BY v.ultimo_lead_at ASC NULLS FIRST, v.id ASC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.fila_no_horario(boolean, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fila_previa() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fila_no_horario(boolean, jsonb, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.fila_previa() TO service_role;
