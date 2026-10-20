-- Reconstruida desde supabase_migrations.schema_migrations (version 20260228151946).
-- Se aplico directamente sobre el proyecto (dashboard / MCP) y nunca se exporto a
-- este repositorio, lo que dejaba a `supabase db push` con una fila de historial sin
-- fichero local ('Remote migration versions not found in local migrations directory').
-- YA ESTA APLICADA: db push no la ejecuta. Existe para que `db reset` / una branch
-- nueva reproduzcan el esquema real. No editar a mano.

-- Añadir columna canal para identificar el origen de la reserva
ALTER TABLE public.reservas
  ADD COLUMN IF NOT EXISTS canal TEXT DEFAULT 'web' CHECK (canal IN ('web', 'telefono', 'manual'));

-- Comentario descriptivo
COMMENT ON COLUMN public.reservas.canal IS 'Origen de la reserva: web (formulario web), telefono (asistente voz IA), manual (creada por staff)';

-- Crear índice para facilitar filtrado/reporting por canal
CREATE INDEX IF NOT EXISTS idx_reservas_canal ON public.reservas(canal);
