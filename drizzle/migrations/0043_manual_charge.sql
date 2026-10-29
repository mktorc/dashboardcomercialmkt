-- "Manual charge" do HQ: valor que a agência cobrou do cliente acima do que vendemos.
-- Precisa ser repassado à agência junto com a comissão.
-- manual_charge vem do sync (importar-hq.mjs, item "Manual Charge" de selected_additional_charges);
-- valor_comissao continua sendo só a comissão e valor_repasse = comissão + manual charge.
-- A expressão da comissão é repetida (como em 0040) porque coluna gerada não pode referenciar outra.
ALTER TABLE public.reservas ADD COLUMN IF NOT EXISTS manual_charge numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.reservas ADD COLUMN IF NOT EXISTS valor_repasse numeric(12,2) GENERATED ALWAYS AS (
  coalesce(commission_amount, round(rack_rate * coalesce(commission_rate_manual, commission_rate, 0) / 100, 2)) + manual_charge
) STORED;

GRANT SELECT (manual_charge, valor_repasse) ON public.reservas TO anon;
