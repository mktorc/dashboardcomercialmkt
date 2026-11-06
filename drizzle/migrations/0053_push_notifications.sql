-- Notificações push (PWA) do Controle de Reservas: inscrições dos aparelhos e marcador do último
-- evento pending -> confirmed já notificado. Só o servidor (service_role) lê e grava: sem acesso anon/authenticated.
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.push_subscriptions TO service_role;

CREATE TABLE IF NOT EXISTS public.push_state (
  id integer PRIMARY KEY CHECK (id = 1),
  last_history_id bigint NOT NULL DEFAULT 0
);
ALTER TABLE public.push_state ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.push_state TO service_role;
-- Ponto de partida: o que já está no histórico não gera notificação.
INSERT INTO public.push_state (id, last_history_id)
SELECT 1, COALESCE(MAX(id), 0) FROM public.reservation_status_history
ON CONFLICT (id) DO NOTHING;
