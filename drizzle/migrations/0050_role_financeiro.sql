-- Novo perfil: só enxerga Comissões e pode marcar como paga / validar descontos.
-- Em Postgres o novo valor do enum só pode ser usado em outra transação: a 0051 cria as políticas.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'financeiro';
