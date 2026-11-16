-- Chave anônima do cliente na view mcp_reservations (para o MCP contar clientes únicos sem expor e-mail/telefone).
-- Cliente = e-mail normalizado (email_lc); sem e-mail, últimos 8 dígitos do telefone (phone8) — mesma regra do painel.
-- A chave é um HMAC-SHA256 com segredo guardado em schema privado: não dá para reverter testando e-mails conhecidos.
-- Rodar inteiro no SQL Editor do Supabase. Pode rodar de novo sem efeito colateral (o segredo não é trocado).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Schema privado: fora da API (PostgREST só expõe public), sem acesso para anon/authenticated.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS private.mcp_secrets (
  name text PRIMARY KEY,
  value text NOT NULL
);
REVOKE ALL ON private.mcp_secrets FROM PUBLIC, anon, authenticated;
INSERT INTO private.mcp_secrets (name, value)
VALUES ('customer_key_salt', encode(extensions.gen_random_bytes(32), 'hex'))
ON CONFLICT (name) DO NOTHING;

-- SECURITY DEFINER: lê o segredo sem dar acesso à tabela a quem chama.
CREATE OR REPLACE FUNCTION private.mcp_customer_key(email text, phone8 text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT left(encode(extensions.hmac(x.k, s.value, 'sha256'), 'hex'), 24)
  FROM (
    SELECT coalesce(
      nullif(lower(trim(email)), ''),
      CASE WHEN length(phone8) = 8 THEN 'p:' || phone8 END
    ) AS k
  ) x
  JOIN private.mcp_secrets s ON s.name = 'customer_key_salt'
  WHERE x.k IS NOT NULL
$$;
REVOKE ALL ON FUNCTION private.mcp_customer_key(text, text) FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO mcp_reader;
GRANT EXECUTE ON FUNCTION private.mcp_customer_key(text, text) TO mcp_reader;

-- Recria a view acrescentando só customer_key no fim, preservando opções (ex.: security_invoker) e grants.
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
    private.mcp_customer_key(email_lc, phone8) AS customer_key
  FROM public.reservations;

  IF opts IS NOT NULL THEN
    EXECUTE format('ALTER VIEW public.mcp_reservations SET (%s)', array_to_string(opts, ', '));
  END IF;
END $$;

COMMIT;

-- Conferência (deve mostrar a coluna nova e uma contagem de clientes):
-- SELECT count(*) AS reservas, count(customer_key) AS com_chave, count(DISTINCT customer_key) AS clientes FROM public.mcp_reservations;
