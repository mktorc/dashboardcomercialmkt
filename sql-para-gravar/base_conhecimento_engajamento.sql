-- Base de Conhecimento: engajamento (tendência de visualizações, motivo do "Não" e quiz).
-- Rodar depois de base_conhecimento_areas.sql. Acesso só pelo servidor (service role): RLS ligada
-- e sem políticas, como as outras tabelas kb_*.

-- 1) Visualizações por dia (para a seta de tendência: 7 dias x 7 anteriores) ---------------------
CREATE TABLE IF NOT EXISTS public.kb_article_views_daily (
  article_id  text NOT NULL,
  day         date NOT NULL DEFAULT (now() AT TIME ZONE 'America/New_York')::date,
  views       integer NOT NULL DEFAULT 0,
  PRIMARY KEY (article_id, day)
);
CREATE INDEX IF NOT EXISTS kb_article_views_daily_day_idx ON public.kb_article_views_daily (day);

-- kb_register_view passa a somar também no dia.
CREATE OR REPLACE FUNCTION public.kb_register_view(p_article text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.kb_article_views (article_id, views, last_view) VALUES (p_article, 1, now())
  ON CONFLICT (article_id) DO UPDATE SET views = kb_article_views.views + 1, last_view = now();
  INSERT INTO public.kb_article_views_daily (article_id, day, views)
  VALUES (p_article, (now() AT TIME ZONE 'America/New_York')::date, 1)
  ON CONFLICT (article_id, day) DO UPDATE SET views = kb_article_views_daily.views + 1;
END;
$$;
REVOKE ALL ON FUNCTION public.kb_register_view(text) FROM PUBLIC, anon, authenticated;

-- 2) "Isso ajudou? Não": o que faltou --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.kb_feedback_notes (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  area        text NOT NULL CHECK (area IN ('comercial','cs')),
  article_id  text NOT NULL,
  user_id     uuid NOT NULL,
  user_name   text,
  reason      text NOT NULL DEFAULT '',
  note        text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kb_feedback_notes_area_idx ON public.kb_feedback_notes (area, created_at DESC);

-- 3) Quiz: melhor nota por pessoa e área -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.kb_quiz_results (
  area        text NOT NULL CHECK (area IN ('comercial','cs')),
  user_id     uuid NOT NULL,
  user_name   text,
  best        integer NOT NULL,
  total       integer NOT NULL,
  tries       integer NOT NULL DEFAULT 1,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (area, user_id)
);

ALTER TABLE public.kb_article_views_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kb_feedback_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kb_quiz_results ENABLE ROW LEVEL SECURITY;

-- 4) Buscas que não acharam nada (painel de saúde da base) ----------------------------------------
CREATE TABLE IF NOT EXISTS public.kb_search_misses (
  area      text NOT NULL CHECK (area IN ('comercial','cs')),
  q         text NOT NULL,
  hits      integer NOT NULL DEFAULT 1,
  last_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (area, q)
);
ALTER TABLE public.kb_search_misses ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.kb_register_miss(p_area text, p_q text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.kb_search_misses (area, q, hits, last_at) VALUES (p_area, p_q, 1, now())
  ON CONFLICT (area, q) DO UPDATE SET hits = kb_search_misses.hits + 1, last_at = now();
$$;
REVOKE ALL ON FUNCTION public.kb_register_miss(text, text) FROM PUBLIC, anon, authenticated;

-- 5) Perguntas feitas à ORCI (painel do administrador: o que mais perguntam, quem pergunta,
--    o que a base não respondeu e a nota 👍/👎 de cada resposta) ---------------------------------
CREATE TABLE IF NOT EXISTS public.kb_ai_questions (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  area        text NOT NULL CHECK (area IN ('comercial','cs')),
  user_id     uuid NOT NULL,
  user_name   text,
  question    text NOT NULL,
  answered    boolean NOT NULL DEFAULT true,
  rating      smallint CHECK (rating IN (-1, 1)),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kb_ai_questions_area_idx ON public.kb_ai_questions (area, created_at DESC);
ALTER TABLE public.kb_ai_questions ENABLE ROW LEVEL SECURITY;

-- 6) Progresso de cada pessoa (trilha lida e favoritos), para não perder ao trocar de computador
--    e para o painel do gestor -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.kb_progress (
  area        text NOT NULL CHECK (area IN ('comercial','cs')),
  user_id     uuid NOT NULL,
  user_name   text,
  read_ids    text[] NOT NULL DEFAULT '{}',
  fav_ids     text[] NOT NULL DEFAULT '{}',
  first_at    timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (area, user_id)
);
ALTER TABLE public.kb_progress ENABLE ROW LEVEL SECURITY;
