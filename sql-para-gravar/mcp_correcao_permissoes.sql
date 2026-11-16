-- Correção após mcp_customer_key.sql (validação com o token mcp_reader em 16/11/2026):
-- 1) mcp_reservations deu "permission denied for table reservations": a view é security_invoker e passou a ler
--    email_lc/phone8, colunas que o mcp_reader não pode ler. Agora a chave é calculada por função SECURITY DEFINER
--    que busca e-mail/telefone pelo id da reserva; a view volta a usar só colunas já liberadas.
-- 2) O mcp_reader conseguia SELECT * direto na tabela reservas. Passa a ter acesso só às colunas da view mcp_reservas
--    (o mesmo que a view já expõe), então SELECT * na tabela é recusado.
-- Rodar inteiro no SQL Editor do Supabase.

BEGIN;

-- ---------- 1) customer_key sem ler colunas pessoais na view ----------

CREATE OR REPLACE FUNCTION private.mcp_customer_key_for(res_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT left(encode(extensions.hmac(x.k, s.value, 'sha256'), 'hex'), 24)
  FROM (
    SELECT coalesce(
      nullif(lower(trim(r.email_lc)), ''),
      CASE WHEN length(r.phone8) = 8 THEN 'p:' || r.phone8 END
    ) AS k
    FROM public.reservations r
    WHERE r.id = res_id
  ) x
  JOIN private.mcp_secrets s ON s.name = 'customer_key_salt'
  WHERE x.k IS NOT NULL
$$;
REVOKE ALL ON FUNCTION private.mcp_customer_key_for(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.mcp_customer_key_for(uuid) TO mcp_reader;

DO $$
DECLARE opts text[];
BEGIN
  SELECT reloptions INTO opts FROM pg_class WHERE oid = 'public.mcp_reservations'::regclass;

  CREATE OR REPLACE VIEW public.mcp_reservations AS
  SELECT id,
    reservation_id,
    car_category,
    rental_days,
    total_amount,
    status,
    utm_campaign,
    created_at,
    seller_name,
    discount_amount,
    pick_up_at,
    return_at,
    commission_partner,
    rack_rate,
    miscellaneous_price,
    additional_charges_price,
    private.mcp_customer_key_for(id) AS customer_key
  FROM public.reservations;

  IF opts IS NOT NULL THEN
    EXECUTE format('ALTER VIEW public.mcp_reservations SET (%s)', array_to_string(opts, ', '));
  END IF;
END $$;

-- A versão anterior (por e-mail/telefone) não é mais usada.
DROP FUNCTION IF EXISTS private.mcp_customer_key(text, text);

-- ---------- 2) reservas: só as colunas da view ----------

REVOKE SELECT ON public.reservas FROM mcp_reader;
GRANT SELECT (
  id, hq_reservation_id, commission_partner, created_at, total_price, total_paid, rack_rate,
  commission_rate, commission_amount, status_repasse, paga_em, imported_at, currency, payment_methods,
  retida_agencia, hq_status, estorno_compensado_em, liberada, commission_rate_manual, desconto,
  desconto_validado_em, comissao_ajustada_em, exige_validacao, valor_comissao, manual_charge,
  incluir_manual_charge, valor_repasse, seller_name
) ON public.reservas TO mcp_reader;

COMMIT;

-- Conferências:
-- SELECT count(*) AS reservas, count(customer_key) AS com_chave, count(DISTINCT customer_key) AS clientes FROM public.mcp_reservations;
-- Opções da view (esperado security_invoker=true ou vazio):
-- SELECT reloptions FROM pg_class WHERE oid = 'public.mcp_reservations'::regclass;
