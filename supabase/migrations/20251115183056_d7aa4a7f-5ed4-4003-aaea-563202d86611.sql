-- Añadir campo de imagen a Platos
ALTER TABLE public."Platos"
ADD COLUMN IF NOT EXISTS imagen_url TEXT;

-- Añadir campo de imagen a Bebidas
ALTER TABLE public."Bebidas"
ADD COLUMN IF NOT EXISTS imagen_url TEXT;

-- Añadir campo de imagen a Vinos
ALTER TABLE public."Vinos"
ADD COLUMN IF NOT EXISTS imagen_url TEXT;