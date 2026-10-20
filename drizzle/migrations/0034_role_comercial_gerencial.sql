-- Novo perfil: só enxerga o menu Comercial (Gerencial e Operacional), sem Marketing.
-- Em Postgres o novo valor do enum só pode ser usado em outra transação: a 0035 cria as políticas.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'comercial_gerencial';
