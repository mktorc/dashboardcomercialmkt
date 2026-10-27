-- Complementa a 0037: colunas usadas em filtros/consultas da página que ficaram fora do GRANT anônimo.
GRANT SELECT (pipeline_name) ON public.crm_opportunities TO anon;
GRANT SELECT (miscellaneous_price, additional_charges_price) ON public.reservations TO anon;
