-- Reconstruida desde supabase_migrations.schema_migrations (version 20260305170455).
-- Se aplico directamente sobre el proyecto (dashboard / MCP) y nunca se exporto a
-- este repositorio, lo que dejaba a `supabase db push` con una fila de historial sin
-- fichero local ('Remote migration versions not found in local migrations directory').
-- YA ESTA APLICADA: db push no la ejecuta. Existe para que `db reset` / una branch
-- nueva reproduzcan el esquema real. No editar a mano.

-- Añadir columna para registrar el uso de herramientas (consultas de bbdd, creación de reservas) de la IA
ALTER TABLE public.call_logs 
ADD COLUMN IF NOT EXISTS tool_calls JSONB DEFAULT '[]'::jsonb;
