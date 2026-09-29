CREATE TABLE public.meta_ads_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL,
  campaign_name text NOT NULL,
  campaign_id text,
  spend numeric(12,2) NOT NULL DEFAULT 0,
  clicks integer NOT NULL DEFAULT 0,
  impressions integer NOT NULL DEFAULT 0,
  utm_campaign text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.google_ads_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL,
  campaign_name text NOT NULL,
  campaign_id text,
  spend numeric(12,2) NOT NULL DEFAULT 0,
  clicks integer NOT NULL DEFAULT 0,
  impressions integer NOT NULL DEFAULT 0,
  utm_campaign text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.crm_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id text,
  name text,
  email text,
  phone text,
  stage_name text,
  utm_source text,
  utm_campaign text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id text,
  customer_email text,
  customer_phone text,
  car_category text,
  rental_days integer NOT NULL DEFAULT 1,
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'confirmed',
  utm_campaign text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_meta_date ON public.meta_ads_metrics(date);
CREATE INDEX idx_meta_utm ON public.meta_ads_metrics(utm_campaign);
CREATE INDEX idx_google_date ON public.google_ads_metrics(date);
CREATE INDEX idx_google_utm ON public.google_ads_metrics(utm_campaign);
CREATE INDEX idx_leads_created ON public.crm_leads(created_at);
CREATE INDEX idx_leads_utm ON public.crm_leads(utm_campaign);
CREATE INDEX idx_res_created ON public.reservations(created_at);
CREATE INDEX idx_res_utm ON public.reservations(utm_campaign);

GRANT SELECT ON public.meta_ads_metrics TO anon;
GRANT SELECT ON public.google_ads_metrics TO anon;
GRANT SELECT ON public.crm_leads TO anon;
GRANT SELECT ON public.reservations TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meta_ads_metrics TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.google_ads_metrics TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_leads TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reservations TO authenticated;
GRANT ALL ON public.meta_ads_metrics TO service_role;
GRANT ALL ON public.google_ads_metrics TO service_role;
GRANT ALL ON public.crm_leads TO service_role;
GRANT ALL ON public.reservations TO service_role;

ALTER TABLE public.meta_ads_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_ads_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read meta" ON public.meta_ads_metrics FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "public read google" ON public.google_ads_metrics FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "public read leads" ON public.crm_leads FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "public read reservations" ON public.reservations FOR SELECT TO anon, authenticated USING (true);

INSERT INTO public.meta_ads_metrics (date, campaign_name, campaign_id, spend, clicks, impressions, utm_campaign)
SELECT d::date, c.name, c.id, (random()*300+120)::numeric(12,2), (random()*180+40)::int, (random()*9000+3000)::int, c.utm
FROM generate_series(current_date - interval '29 day', current_date, interval '1 day') d
CROSS JOIN (VALUES
  ('ORC | Aluguel Orlando - Conversao','M-1001','orc_orlando_conversao'),
  ('ORC | Remarketing Disney','M-1002','orc_remarketing_disney'),
  ('ORC | SUV Premium','M-1003','orc_suv_premium')
) AS c(name,id,utm);

INSERT INTO public.google_ads_metrics (date, campaign_name, campaign_id, spend, clicks, impressions, utm_campaign)
SELECT d::date, c.name, c.id, (random()*260+100)::numeric(12,2), (random()*150+30)::int, (random()*7000+2500)::int, c.utm
FROM generate_series(current_date - interval '29 day', current_date, interval '1 day') d
CROSS JOIN (VALUES
  ('ORC | Search - Aluguel de Carro Orlando','G-2001','orc_search_orlando'),
  ('ORC | Performance Max Brasil','G-2002','orc_pmax_brasil')
) AS c(name,id,utm);

INSERT INTO public.crm_leads (lead_id, name, email, phone, stage_name, utm_source, utm_campaign, created_at)
SELECT 'LD-'||g, 'Cliente '||g, 'cliente'||g||'@exemplo.com', '+55 85 9'||lpad((random()*99999999)::int::text,8,'0'),
  (ARRAY['Novo Lead','Em Atendimento','Proposta Enviada','Ganho','Perdido'])[1+floor(random()*5)],
  (ARRAY['meta','google'])[1+floor(random()*2)],
  (ARRAY['orc_orlando_conversao','orc_remarketing_disney','orc_suv_premium','orc_search_orlando','orc_pmax_brasil'])[1+floor(random()*5)],
  current_date - (floor(random()*30) || ' day')::interval
FROM generate_series(1,420) g;

INSERT INTO public.reservations (reservation_id, customer_email, customer_phone, car_category, rental_days, total_amount, status, utm_campaign, created_at)
SELECT 'RS-'||g, 'cliente'||g||'@exemplo.com', '+55 85 90000'||lpad(g::text,4,'0'),
  (ARRAY['Economy','Compact SUV','Full Size SUV','Minivan','Luxury'])[1+floor(random()*5)],
  (3+floor(random()*10))::int,
  (random()*1800+450)::numeric(12,2),
  'confirmed',
  (ARRAY['orc_orlando_conversao','orc_remarketing_disney','orc_suv_premium','orc_search_orlando','orc_pmax_brasil'])[1+floor(random()*5)],
  current_date - (floor(random()*30) || ' day')::interval
FROM generate_series(1,96) g;