-- Añadir columna para escala en píxeles por metro
ALTER TABLE public.planos_espacio 
ADD COLUMN IF NOT EXISTS pixels_per_meter numeric DEFAULT 50;

COMMENT ON COLUMN public.planos_espacio.pixels_per_meter IS 'Escala de conversión: píxeles por cada metro real';