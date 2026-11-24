-- Base de Conhecimento: índice dos arquivos do Google Drive (lido só pelo servidor, com a service role).
-- RLS ligada e sem políticas: o navegador não lê estas tabelas; tudo passa por /api/kb/*.

-- 1) Arquivos vistos nas pastas -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.kb_files (
  file_id        text PRIMARY KEY,
  name           text NOT NULL,
  folder         text NOT NULL DEFAULT '',
  web_view_link  text,
  mime_type      text NOT NULL,
  modified_time  timestamptz,
  status         text NOT NULL CHECK (status IN ('indexado','ignorado','vazio','erro')),
  detail         text,
  chunks         integer NOT NULL DEFAULT 0,
  indexed_at     timestamptz NOT NULL DEFAULT now()
);

-- 2) Trechos de texto -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.kb_chunks (
  id       bigserial PRIMARY KEY,
  file_id  text NOT NULL REFERENCES public.kb_files(file_id) ON DELETE CASCADE,
  idx      integer NOT NULL,
  content  text NOT NULL
);
CREATE INDEX IF NOT EXISTS kb_chunks_file_idx ON public.kb_chunks (file_id, idx);

-- 3) Execuções da sincronização -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.kb_sync_runs (
  id           bigserial PRIMARY KEY,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  status       text NOT NULL DEFAULT 'rodando',  -- rodando | ok | parcial | erro
  origem       text NOT NULL DEFAULT 'manual',   -- manual | cron
  stats        jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- 4) Perguntas feitas (limite de requisições por usuário) ------------------------------------------
CREATE TABLE IF NOT EXISTS public.kb_ask_log (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kb_ask_log_user_idx ON public.kb_ask_log (user_id, created_at DESC);

ALTER TABLE public.kb_files     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kb_chunks    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kb_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kb_ask_log   ENABLE ROW LEVEL SECURITY;

-- 5) Módulo 'base-conhecimento' -------------------------------------------------------------------
ALTER TABLE public.user_access DROP CONSTRAINT IF EXISTS user_access_modules_validos;
ALTER TABLE public.user_access ADD CONSTRAINT user_access_modules_validos CHECK (
  modules <@ ARRAY['dashboard','comercial','comercial-operacional','comissoes','fila-leads','frota','base-conhecimento']::text[]
);
