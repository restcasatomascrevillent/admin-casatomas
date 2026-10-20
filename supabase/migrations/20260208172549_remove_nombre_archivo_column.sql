-- Reconstruida desde supabase_migrations.schema_migrations (version 20260208172549).
-- Se aplico directamente sobre el proyecto (dashboard / MCP) y nunca se exporto a
-- este repositorio, lo que dejaba a `supabase db push` con una fila de historial sin
-- fichero local ('Remote migration versions not found in local migrations directory').
-- YA ESTA APLICADA: db push no la ejecuta. Existe para que `db reset` / una branch
-- nueva reproduzcan el esquema real. No editar a mano.

-- =====================================================
-- ELIMINAR COLUMNA nombre_archivo
-- =====================================================
-- Dejar solo drive_url

ALTER TABLE public.facturas
DROP COLUMN IF EXISTS nombre_archivo;

-- Actualizar comentario
COMMENT ON COLUMN public.facturas.drive_url IS 'URL del documento en Google Drive para acceso directo desde el admin panel';
