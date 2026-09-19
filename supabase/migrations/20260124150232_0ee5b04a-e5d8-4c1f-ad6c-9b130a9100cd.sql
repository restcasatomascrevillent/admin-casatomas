-- Añadir columnas de visibilidad a Platos
ALTER TABLE public."Platos"
ADD COLUMN IF NOT EXISTS touza boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS restaurante boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS featured boolean DEFAULT false;

-- Añadir columnas de visibilidad a Cocteles (por defecto para Touza)
ALTER TABLE public."Cocteles"
ADD COLUMN IF NOT EXISTS touza boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS restaurante boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS featured boolean DEFAULT false;

-- Comentarios descriptivos
COMMENT ON COLUMN public."Platos".touza IS 'Visible en la web de Touza';
COMMENT ON COLUMN public."Platos".restaurante IS 'Visible en la web del Restaurante';
COMMENT ON COLUMN public."Platos".featured IS 'Destacado en la web';

COMMENT ON COLUMN public."Cocteles".touza IS 'Visible en la web de Touza';
COMMENT ON COLUMN public."Cocteles".restaurante IS 'Visible en la web del Restaurante';
COMMENT ON COLUMN public."Cocteles".featured IS 'Destacado en la web';