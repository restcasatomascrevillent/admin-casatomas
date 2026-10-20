-- Añadir columna tipo a novedades
ALTER TABLE novedades 
ADD COLUMN tipo TEXT NOT NULL DEFAULT 'anuncio' 
CHECK (tipo IN ('item_carta', 'anuncio'));

-- Actualizar novedades existentes que tengan asociación a plato/vino/bebida
UPDATE novedades 
SET tipo = 'item_carta' 
WHERE plato_id IS NOT NULL 
   OR vino_id IS NOT NULL 
   OR bebida_id IS NOT NULL;