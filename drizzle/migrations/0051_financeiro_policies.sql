-- Perfil financeiro: paga, valida descontos e compensa estornos, como o superadmin.
CREATE OR REPLACE FUNCTION public.reservas_before_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- só superadmin e financeiro dão (ou tira) o "ok" do desconto e compensa estorno; o sync (service_role) não tem auth.uid()
  IF auth.uid() IS NOT NULL AND NOT public.has_any_role(auth.uid(), ARRAY['superadmin','financeiro']::public.app_role[])
     AND (NEW.desconto_validado_em IS DISTINCT FROM OLD.desconto_validado_em
          OR NEW.estorno_compensado_em IS DISTINCT FROM OLD.estorno_compensado_em) THEN
    RAISE EXCEPTION 'Somente superadmin ou financeiro pode validar descontos ou compensar estornos';
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

DROP POLICY IF EXISTS "superadmin marcar paga" ON public.reservas;
CREATE POLICY "superadmin marcar paga" ON public.reservas FOR UPDATE TO authenticated
  USING ((SELECT public.has_any_role((SELECT auth.uid()), ARRAY['superadmin','financeiro']::public.app_role[])) AND liberada AND status_repasse = 'pendente'
         AND NOT retida_agencia AND NOT public.parceiro_travado(commission_partner))
  WITH CHECK (status_repasse = 'paga');

DROP POLICY IF EXISTS "superadmin compensar estorno" ON public.reservas;
CREATE POLICY "superadmin compensar estorno" ON public.reservas FOR UPDATE TO authenticated
  USING ((SELECT public.has_any_role((SELECT auth.uid()), ARRAY['superadmin','financeiro']::public.app_role[])) AND status_repasse = 'paga' AND hq_status = 'cancelled'
          AND estorno_compensado_em IS NULL AND NOT retida_agencia)
  WITH CHECK (estorno_compensado_em IS NOT NULL);
