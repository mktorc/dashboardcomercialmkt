-- Incluir o manual charge no repasse é uma escolha por reserva (padrão: não incluir).
-- valor_repasse = comissão + manual charge só quando incluir_manual_charge = true.
-- A expressão da comissão é repetida (como em 0040/0043) porque coluna gerada não pode referenciar outra.
ALTER TABLE public.reservas ADD COLUMN IF NOT EXISTS incluir_manual_charge boolean NOT NULL DEFAULT false;

ALTER TABLE public.reservas DROP COLUMN IF EXISTS valor_repasse;
ALTER TABLE public.reservas ADD COLUMN valor_repasse numeric(12,2) GENERATED ALWAYS AS (
  coalesce(commission_amount, round(rack_rate * coalesce(commission_rate_manual, commission_rate, 0) / 100, 2))
  + CASE WHEN incluir_manual_charge THEN manual_charge ELSE 0 END
) STORED;

-- mesma regra da edição de comissão: só reservas ainda não pagas (policy "editar comissao")
GRANT UPDATE (incluir_manual_charge) ON public.reservas TO anon, authenticated;
GRANT SELECT (manual_charge, incluir_manual_charge, valor_repasse) ON public.reservas TO anon;
