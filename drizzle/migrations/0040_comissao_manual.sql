-- Ajuste manual da comissão e validação de descontos, feitos pelo superadmin na tela
-- (o HQ não expõe alterações manuais de comissão por API).
--
-- Ordem de precedência de valor_comissao:
--   1) commission_amount        valor fixo informado à mão
--   2) commission_rate_manual   percentual informado à mão × rack_rate
--   3) commission_rate          percentual padrão do parceiro (vem do HQ no sync) × rack_rate
-- O sync diário (importar-hq.mjs) nunca grava commission_amount, commission_rate_manual nem desconto_validado_em.
--
-- Validação de desconto: reserva com desconto precisa de "ok" (desconto_validado_em) para ser paga, e enquanto
-- houver reserva liberada com desconto não validado o parceiro inteiro fica travado para pagamento.
-- Turistorlando não entra nessa regra.
--
-- Acesso: a leitura é pública (sem login), só das colunas financeiras abaixo (sem dados de cliente).
-- Pagar, compensar estorno e validar desconto: só superadmin (logado).
-- Editar comissão (percentual manual e valor fixo, de reservas ainda não pagas): qualquer pessoa com o link,
-- mesmo sem login. A data do último ajuste fica em comissao_ajustada_em.
ALTER TABLE public.reservas ADD COLUMN IF NOT EXISTS commission_rate_manual numeric(6,3);
ALTER TABLE public.reservas ADD COLUMN IF NOT EXISTS desconto numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.reservas ADD COLUMN IF NOT EXISTS desconto_validado_em timestamptz;
ALTER TABLE public.reservas ADD COLUMN IF NOT EXISTS comissao_ajustada_em timestamptz;
ALTER TABLE public.reservas ADD COLUMN IF NOT EXISTS exige_validacao boolean GENERATED ALWAYS AS (
  desconto > 0 AND regexp_replace(lower(commission_partner), '[^a-z]', '', 'g') <> 'turistorlando'
) STORED;

ALTER TABLE public.reservas DROP CONSTRAINT IF EXISTS comissao_manual_valida;
ALTER TABLE public.reservas ADD CONSTRAINT comissao_manual_valida CHECK (
  (commission_rate_manual IS NULL OR commission_rate_manual BETWEEN 0 AND 100)
  AND (commission_amount IS NULL OR commission_amount >= 0)
);

ALTER TABLE public.reservas DROP COLUMN valor_comissao;
ALTER TABLE public.reservas ADD COLUMN valor_comissao numeric(12,2) GENERATED ALWAYS AS (
  coalesce(commission_amount, round(rack_rate * coalesce(commission_rate_manual, commission_rate, 0) / 100, 2))
) STORED;

-- BEFORE UPDATE: guarda de perfil, rastro de ajuste e reset da validação
CREATE OR REPLACE FUNCTION public.reservas_before_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- só superadmin dá (ou tira) o "ok" do desconto e compensa estorno; o sync (service_role) não tem auth.uid()
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'superadmin')
     AND (NEW.desconto_validado_em IS DISTINCT FROM OLD.desconto_validado_em
          OR NEW.estorno_compensado_em IS DISTINCT FROM OLD.estorno_compensado_em) THEN
    RAISE EXCEPTION 'Somente superadmin pode validar descontos ou compensar estornos';
  END IF;
  -- quando a comissão é ajustada à mão, registra quando
  IF NEW.commission_amount IS DISTINCT FROM OLD.commission_amount
     OR NEW.commission_rate_manual IS DISTINCT FROM OLD.commission_rate_manual THEN
    NEW.comissao_ajustada_em := now();
  END IF;
  -- se o desconto mudar no HQ depois do ok, a validação é refeita
  IF NEW.desconto IS DISTINCT FROM OLD.desconto AND NEW.desconto_validado_em IS NOT DISTINCT FROM OLD.desconto_validado_em THEN
    NEW.desconto_validado_em := NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS reservas_reset_validacao ON public.reservas;
DROP TRIGGER IF EXISTS reservas_before_update ON public.reservas;
CREATE TRIGGER reservas_before_update BEFORE UPDATE ON public.reservas
  FOR EACH ROW EXECUTE FUNCTION public.reservas_before_update();

-- parceiro travado: tem reserva liberada, a pagar, com desconto ainda não validado
CREATE OR REPLACE FUNCTION public.parceiro_travado(_parceiro text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.reservas
    WHERE commission_partner = _parceiro AND exige_validacao AND desconto_validado_em IS NULL
      AND liberada AND status_repasse = 'pendente' AND NOT retida_agencia
  )
$$;
REVOKE ALL ON FUNCTION public.parceiro_travado(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parceiro_travado(text) TO authenticated, service_role;

-- edição da comissão: só reservas ainda não pagas, só essas duas colunas, por qualquer pessoa (anon incluído)
GRANT UPDATE (commission_rate_manual, commission_amount) ON public.reservas TO anon, authenticated;
-- validar desconto: coluna liberada só para logados; o trigger restringe a superadmin
GRANT UPDATE (desconto_validado_em) ON public.reservas TO authenticated;

DROP POLICY IF EXISTS "superadmin editar comissao" ON public.reservas;
DROP POLICY IF EXISTS "editar comissao" ON public.reservas;
CREATE POLICY "editar comissao" ON public.reservas FOR UPDATE TO anon, authenticated
  USING (status_repasse = 'pendente')
  WITH CHECK (status_repasse = 'pendente');

-- marcar como paga: agora também exige que o parceiro não esteja travado por desconto a validar
DROP POLICY IF EXISTS "superadmin marcar paga" ON public.reservas;
CREATE POLICY "superadmin marcar paga" ON public.reservas FOR UPDATE TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'superadmin')) AND liberada AND status_repasse = 'pendente'
         AND NOT retida_agencia AND NOT public.parceiro_travado(commission_partner))
  WITH CHECK (status_repasse = 'paga');

-- leitura pública (anon) e para qualquer usuário logado, só das colunas que as telas usam
GRANT SELECT (id, hq_reservation_id, commission_partner, created_at, total_price, total_paid, rack_rate,
  commission_rate, commission_amount, commission_rate_manual, desconto, desconto_validado_em, exige_validacao,
  currency, retida_agencia, hq_status, status_repasse, paga_em, liberada, valor_comissao, estorno_compensado_em)
  ON public.reservas TO anon;

DROP POLICY IF EXISTS "anon le reservas" ON public.reservas;
CREATE POLICY "anon le reservas" ON public.reservas FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "superadmin read reservas" ON public.reservas;
DROP POLICY IF EXISTS "autenticado le reservas" ON public.reservas;
CREATE POLICY "autenticado le reservas" ON public.reservas FOR SELECT TO authenticated USING (true);
