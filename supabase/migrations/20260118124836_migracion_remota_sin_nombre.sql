-- Reconstruida desde supabase_migrations.schema_migrations (version 20260118124836).
-- Se aplico directamente sobre el proyecto (dashboard / MCP) y nunca se exporto a
-- este repositorio, lo que dejaba a `supabase db push` con una fila de historial sin
-- fichero local ('Remote migration versions not found in local migrations directory').
-- YA ESTA APLICADA: db push no la ejecuta. Existe para que `db reset` / una branch
-- nueva reproduzcan el esquema real. No editar a mano.

-- Añadir columnas de traducción para bullets, tags y badge_text
ALTER TABLE public.novedades 
ADD COLUMN IF NOT EXISTS bullets_en text[] DEFAULT NULL,
ADD COLUMN IF NOT EXISTS bullets_fr text[] DEFAULT NULL,
ADD COLUMN IF NOT EXISTS tags_en text[] DEFAULT NULL,
ADD COLUMN IF NOT EXISTS tags_fr text[] DEFAULT NULL,
ADD COLUMN IF NOT EXISTS badge_text_en text DEFAULT NULL,
ADD COLUMN IF NOT EXISTS badge_text_fr text DEFAULT NULL;
