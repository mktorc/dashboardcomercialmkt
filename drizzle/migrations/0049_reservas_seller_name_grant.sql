-- A tela pública lê a tabela como anon, que só tem SELECT por coluna: libera a coluna seller_name.
GRANT SELECT (seller_name) ON public.reservas TO anon;
