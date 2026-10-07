BEGIN;

ALTER TABLE public."Platos"
  ADD COLUMN IF NOT EXISTS sin_gluten_disponible boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public."Platos".sin_gluten_disponible IS
  'El restaurante ofrece una preparación sin gluten bajo petición. No altera los alérgenos de la receta original.';

NOTIFY pgrst, 'reload schema';

COMMIT;
