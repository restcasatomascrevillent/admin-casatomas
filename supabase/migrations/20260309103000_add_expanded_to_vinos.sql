-- Añadir columna expanded a la tabla Vinos para controlar foto expandida en la carta web
ALTER TABLE public."Vinos"
ADD COLUMN IF NOT EXISTS expanded boolean DEFAULT false;

COMMENT ON COLUMN public."Vinos".expanded IS 'Define si la foto del vino se muestra expandida en la carta web';
