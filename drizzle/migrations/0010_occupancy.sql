ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS pick_up_at timestamptz, ADD COLUMN IF NOT EXISTS return_at timestamptz;
CREATE INDEX IF NOT EXISTS reservations_pickup_return_idx ON public.reservations (pick_up_at, return_at);
CREATE TABLE public.fleet_stats (id int PRIMARY KEY DEFAULT 1, vehicles int NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.fleet_stats TO authenticated;
GRANT ALL ON public.fleet_stats TO service_role;
ALTER TABLE public.fleet_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read fleet" ON public.fleet_stats FOR SELECT TO authenticated USING (true);