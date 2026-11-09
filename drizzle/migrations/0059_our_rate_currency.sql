-- A tarifa do HQ vem com moeda (as de hoje estão em USD): guardada junto, para só comparar com concorrentes na mesma moeda.
ALTER TABLE public.our_rate_snapshots ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USD';
