-- Quem criou a reserva no HQ (created_by), preenchido pelo importador de comissões.
ALTER TABLE public.reservas ADD COLUMN IF NOT EXISTS seller_name text;
