-- Añadir columna traducciones a las tablas de carta
ALTER TABLE "Platos" ADD COLUMN IF NOT EXISTS traducciones jsonb DEFAULT '{}';
ALTER TABLE "Bebidas" ADD COLUMN IF NOT EXISTS traducciones jsonb DEFAULT '{}';
ALTER TABLE "Vinos" ADD COLUMN IF NOT EXISTS traducciones jsonb DEFAULT '{}';