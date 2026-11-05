-- Validar desconto volta a ser só do superadmin; o financeiro segue pagando e compensando estornos.
CREATE OR REPLACE FUNCTION public.reservas_before_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- só superadmin dá (ou tira) o "ok" do desconto; o sync (service_role) não tem auth.uid()
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'superadmin')
     AND NEW.desconto_validado_em IS DISTINCT FROM OLD.desconto_validado_em THEN
    RAISE EXCEPTION 'Somente superadmin pode validar descontos';
  END IF;
  -- superadmin e financeiro compensam estorno
  IF auth.uid() IS NOT NULL AND NOT public.has_any_role(auth.uid(), ARRAY['superadmin','financeiro']::public.app_role[])
     AND NEW.estorno_compensado_em IS DISTINCT FROM OLD.estorno_compensado_em THEN
    RAISE EXCEPTION 'Somente superadmin ou financeiro pode compensar estornos';
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
