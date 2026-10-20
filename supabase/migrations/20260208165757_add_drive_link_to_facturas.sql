-- Reconstruida desde supabase_migrations.schema_migrations (version 20260208165757).
-- Se aplico directamente sobre el proyecto (dashboard / MCP) y nunca se exporto a
-- este repositorio, lo que dejaba a `supabase db push` con una fila de historial sin
-- fichero local ('Remote migration versions not found in local migrations directory').
-- YA ESTA APLICADA: db push no la ejecuta. Existe para que `db reset` / una branch
-- nueva reproduzcan el esquema real. No editar a mano.

-- =====================================================
-- AGREGAR ENLACE DE GOOGLE DRIVE A FACTURAS
-- =====================================================
-- Agregar campo para almacenar el enlace del documento en Drive

ALTER TABLE public.facturas
ADD COLUMN IF NOT EXISTS drive_url TEXT,
ADD COLUMN IF NOT EXISTS nombre_archivo TEXT;

-- Agregar comentarios descriptivos
COMMENT ON COLUMN public.facturas.drive_url IS 'URL del documento en Google Drive para acceso directo';
COMMENT ON COLUMN public.facturas.nombre_archivo IS 'Nombre original del archivo subido';

-- Crear índice para búsquedas rápidas por nombre de archivo
CREATE INDEX IF NOT EXISTS idx_facturas_nombre_archivo 
ON public.facturas(nombre_archivo);

-- Agregar campos adicionales útiles para mejor gestión
ALTER TABLE public.facturas
ADD COLUMN IF NOT EXISTS estado VARCHAR(50) DEFAULT 'pendiente',
ADD COLUMN IF NOT EXISTS pagado BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS fecha_pago DATE,
ADD COLUMN IF NOT EXISTS metodo_pago VARCHAR(100),
ADD COLUMN IF NOT EXISTS notas_internas TEXT;

-- Comentarios para los nuevos campos
COMMENT ON COLUMN public.facturas.estado IS 'Estado del documento: pendiente, procesado, pagado, cancelado';
COMMENT ON COLUMN public.facturas.pagado IS 'Indica si la factura ha sido pagada';
COMMENT ON COLUMN public.facturas.fecha_pago IS 'Fecha en que se realizó el pago';
COMMENT ON COLUMN public.facturas.metodo_pago IS 'Método de pago utilizado: transferencia, efectivo, tarjeta, etc.';
COMMENT ON COLUMN public.facturas.notas_internas IS 'Notas internas para el equipo (no visibles en el documento)';
