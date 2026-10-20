-- Añadir campo de ingredientes a Platos y Vinos
ALTER TABLE public."Platos"
ADD COLUMN IF NOT EXISTS ingredientes text;

ALTER TABLE public."Vinos"
ADD COLUMN IF NOT EXISTS ingredientes text;

COMMENT ON COLUMN public."Platos".ingredientes IS 'Ingredientes del plato';
COMMENT ON COLUMN public."Vinos".ingredientes IS 'Ingredientes del vino';
