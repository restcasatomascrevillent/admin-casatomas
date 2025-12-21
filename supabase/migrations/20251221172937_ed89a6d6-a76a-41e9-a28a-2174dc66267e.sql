-- Add blacklist flag to reservas table
ALTER TABLE public.reservas ADD COLUMN IF NOT EXISTS en_blacklist BOOLEAN DEFAULT false;