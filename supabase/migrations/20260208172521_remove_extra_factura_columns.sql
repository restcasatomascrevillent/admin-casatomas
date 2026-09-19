-- Reconstruida desde supabase_migrations.schema_migrations (version 20260208172521).
-- Se aplico directamente sobre el proyecto (dashboard / MCP) y nunca se exporto a
-- este repositorio, lo que dejaba a `supabase db push` con una fila de historial sin
-- fichero local ('Remote migration versions not found in local migrations directory').
-- YA ESTA APLICADA: db push no la ejecuta. Existe para que `db reset` / una branch
-- nueva reproduzcan el esquema real. No editar a mano.

-- =====================================================
-- ELIMINAR COLUMNAS EXTRAS DE FACTURAS
-- =====================================================
-- Mantener solo drive_url y nombre_archivo

ALTER TABLE public.facturas
DROP COLUMN IF EXISTS estado,
DROP COLUMN IF EXISTS pagado,
DROP COLUMN IF EXISTS fecha_pago,
DROP COLUMN IF EXISTS metodo_pago,
DROP COLUMN IF EXISTS notas_internas;

-- Eliminar índice si existe
DROP INDEX IF EXISTS idx_facturas_nombre_archivo;

-- Crear índice solo para drive_url (más útil para búsquedas)
CREATE INDEX IF NOT EXISTS idx_facturas_drive_url 
ON public.facturas(drive_url) 
WHERE drive_url IS NOT NULL;

-- Actualizar comentarios
COMMENT ON COLUMN public.facturas.drive_url IS 'URL del documento en Google Drive para acceso directo';
COMMENT ON COLUMN public.facturas.nombre_archivo IS 'Nombre original del archivo subido a Drive';
