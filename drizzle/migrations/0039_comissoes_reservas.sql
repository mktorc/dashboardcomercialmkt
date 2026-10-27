-- Módulo de Gerenciamento de Comissões (migrado do projeto gerenciamento-comissoes).
-- Estado final das migrações 001 a 006 do projeto original; acesso restrito ao superadmin.
CREATE TABLE IF NOT EXISTS public.reservas (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hq_reservation_id  text NOT NULL UNIQUE,
  commission_partner text NOT NULL,
  created_at         timestamptz NOT NULL,
  total_price        numeric(12,2) NOT NULL DEFAULT 0,
  total_paid         numeric(12,2) NOT NULL DEFAULT 0,
  rack_rate          numeric(12,2) NOT NULL DEFAULT 0,
  -- informe um dos dois: percentual (ex.: 10 = 10%) ou valor fixo
  commission_rate    numeric(6,3),
  commission_amount  numeric(12,2),
  status_repasse     text NOT NULL DEFAULT 'pendente' CHECK (status_repasse IN ('pendente', 'paga')),
  paga_em            timestamptz,
  imported_at        timestamptz NOT NULL DEFAULT now(),
  currency           text NOT NULL DEFAULT 'USD',
  payment_methods    text[] NOT NULL DEFAULT '{}',
  retida_agencia     boolean NOT NULL DEFAULT false,
  hq_status          text,
  estorno_compensado_em timestamptz,
  -- só open/completed/rental entram; GioConcierge e TuristOrlando liberam na criação; demais: total_paid >= rack_rate
  liberada boolean GENERATED ALWAYS AS (
    hq_status IN ('open', 'completed', 'rental')
    AND (
      regexp_replace(lower(commission_partner), '[^a-z]', '', 'g') IN ('gioconcierge', 'turistorlando')
      OR total_paid >= rack_rate
    )
  ) STORED,
  valor_comissao numeric(12,2) GENERATED ALWAYS AS (
    coalesce(commission_amount, round(rack_rate * coalesce(commission_rate, 0) / 100, 2))
  ) STORED,
  CONSTRAINT comissao_definida CHECK (commission_rate IS NOT NULL OR commission_amount IS NOT NULL),
  CONSTRAINT paga_em_coerente CHECK ((status_repasse = 'paga') = (paga_em IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS reservas_partner_idx ON public.reservas (commission_partner);
CREATE INDEX IF NOT EXISTS reservas_created_at_idx ON public.reservas (created_at);
CREATE INDEX IF NOT EXISTS reservas_a_pagar_idx ON public.reservas (commission_partner, created_at)
  WHERE liberada AND status_repasse = 'pendente';
CREATE INDEX IF NOT EXISTS reservas_estorno_idx ON public.reservas (commission_partner)
  WHERE status_repasse = 'paga' AND hq_status = 'cancelled' AND estorno_compensado_em IS NULL;

ALTER TABLE public.reservas ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.reservas FROM anon, authenticated;
GRANT SELECT ON public.reservas TO authenticated;
GRANT UPDATE (status_repasse, paga_em, estorno_compensado_em) ON public.reservas TO authenticated;
GRANT ALL ON public.reservas TO service_role;

DROP POLICY IF EXISTS "superadmin read reservas" ON public.reservas;
CREATE POLICY "superadmin read reservas" ON public.reservas FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'superadmin')));

DROP POLICY IF EXISTS "superadmin marcar paga" ON public.reservas;
CREATE POLICY "superadmin marcar paga" ON public.reservas FOR UPDATE TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'superadmin')) AND liberada AND status_repasse = 'pendente' AND NOT retida_agencia)
  WITH CHECK (status_repasse = 'paga');

DROP POLICY IF EXISTS "superadmin compensar estorno" ON public.reservas;
CREATE POLICY "superadmin compensar estorno" ON public.reservas FOR UPDATE TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'superadmin')) AND status_repasse = 'paga' AND hq_status = 'cancelled'
          AND estorno_compensado_em IS NULL AND NOT retida_agencia)
  WITH CHECK (estorno_compensado_em IS NOT NULL);
