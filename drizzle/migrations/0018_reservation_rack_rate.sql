ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS rack_rate numeric(12,2);
