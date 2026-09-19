-- Reconstruida desde supabase_migrations.schema_migrations (version 20260305165257).
-- Se aplico directamente sobre el proyecto (dashboard / MCP) y nunca se exporto a
-- este repositorio, lo que dejaba a `supabase db push` con una fila de historial sin
-- fichero local ('Remote migration versions not found in local migrations directory').
-- YA ESTA APLICADA: db push no la ejecuta. Existe para que `db reset` / una branch
-- nueva reproduzcan el esquema real. No editar a mano.


-- Problema: la interfaz de restaurante-phone usa anon key (sin login)
-- pero las políticas RLS requieren 'authenticated'.
-- Esto hace que:
--   1. call_logs SELECT falle (no aparecen llamadas)
--   2. phone_system_config UPDATE falle (no se puede cambiar el modo)

-- FIX 1: Permitir lectura de call_logs a usuarios anon
-- (La tabla es interna, el panel es interno, no hay datos sensibles que no puedan leerse)
DROP POLICY IF EXISTS "Only authenticated can read call_logs" ON call_logs;
CREATE POLICY "Allow read call_logs" ON call_logs
  FOR SELECT TO public USING (true);

-- FIX 2: Permitir actualización de phone_system_config a usuarios anon
-- (El panel es interno y solo tiene un registro por restaurante)
DROP POLICY IF EXISTS "Only authenticated can update phone config" ON phone_system_config;
CREATE POLICY "Allow update phone config" ON phone_system_config
  FOR UPDATE TO public USING (true) WITH CHECK (true);
