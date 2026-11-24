-- Base de Conhecimento: áreas Comercial e CS, visualizações e votos por artigo.
-- Rodar depois de base_conhecimento.sql.

-- 1) Área e categoria (subpasta) de cada arquivo indexado ---------------------------------------
ALTER TABLE public.kb_files ADD COLUMN IF NOT EXISTS area text NOT NULL DEFAULT 'compartilhado'
  CHECK (area IN ('comercial','cs','compartilhado'));
ALTER TABLE public.kb_files ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'Geral';
CREATE INDEX IF NOT EXISTS kb_files_area_idx ON public.kb_files (area);

-- 2) Visualizações por artigo (um contador por artigo) -------------------------------------------
CREATE TABLE IF NOT EXISTS public.kb_article_views (
  article_id  text PRIMARY KEY,
  views       integer NOT NULL DEFAULT 0,
  last_view   timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.kb_register_view(p_article text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.kb_article_views (article_id, views, last_view) VALUES (p_article, 1, now())
  ON CONFLICT (article_id) DO UPDATE SET views = kb_article_views.views + 1, last_view = now();
$$;
REVOKE ALL ON FUNCTION public.kb_register_view(text) FROM PUBLIC, anon, authenticated;

-- 3) "Isso ajudou?": um voto por usuário e artigo (pode trocar) -----------------------------------
CREATE TABLE IF NOT EXISTS public.kb_article_votes (
  article_id  text NOT NULL,
  user_id     uuid NOT NULL,
  vote        smallint NOT NULL CHECK (vote IN (-1, 1)),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (article_id, user_id)
);

ALTER TABLE public.kb_article_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kb_article_votes ENABLE ROW LEVEL SECURITY;

-- 4) Módulos: 'base-conhecimento' vira 'kb-comercial' e 'kb-cs' ------------------------------------
-- Ninguém recebe as áreas novas automaticamente (Admin já vê tudo pelo is_admin);
-- o módulo antigo é retirado de quem o tiver.
UPDATE public.user_access SET modules = array_remove(modules, 'base-conhecimento')
WHERE 'base-conhecimento' = ANY (modules);

ALTER TABLE public.user_access DROP CONSTRAINT IF EXISTS user_access_modules_validos;
ALTER TABLE public.user_access ADD CONSTRAINT user_access_modules_validos CHECK (
  modules <@ ARRAY['dashboard','comercial','comercial-operacional','comissoes','fila-leads','frota','kb-comercial','kb-cs']::text[]
);
