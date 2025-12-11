-- Añadir columnas para dimensiones reales en metros
ALTER TABLE public.planos_espacio 
ADD COLUMN IF NOT EXISTS ancho_metros numeric DEFAULT 12,
ADD COLUMN IF NOT EXISTS alto_metros numeric DEFAULT 8;

-- Comentarios para documentar
COMMENT ON COLUMN public.planos_espacio.ancho_metros IS 'Ancho real del espacio en metros';
COMMENT ON COLUMN public.planos_espacio.alto_metros IS 'Alto real del espacio en metros';