-- Reconstruida desde supabase_migrations.schema_migrations (version 20260305172015).
-- Se aplico directamente sobre el proyecto (dashboard / MCP) y nunca se exporto a
-- este repositorio, lo que dejaba a `supabase db push` con una fila de historial sin
-- fichero local ('Remote migration versions not found in local migrations directory').
-- YA ESTA APLICADA: db push no la ejecuta. Existe para que `db reset` / una branch
-- nueva reproduzcan el esquema real. No editar a mano.

-- 1. Restaurar `search_path` en función RPC para evitar ataques de manipulación
CREATE OR REPLACE FUNCTION append_tool_call_log(p_call_id TEXT, p_new_tools JSONB)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE call_logs
  SET tool_calls = COALESCE(tool_calls, '[]'::jsonb) || p_new_tools
  WHERE vapi_call_id = p_call_id;
END;
$$;

-- 2. Eliminar las políticas permisivas (públicas) creadas temporalmente
DROP POLICY IF EXISTS "Allow update phone config" ON phone_system_config;
DROP POLICY IF EXISTS "Allow service insert" ON call_logs;
DROP POLICY IF EXISTS "Allow service update" ON call_logs;
DROP POLICY IF EXISTS "Allow public select" ON call_logs;

-- 3. Crear políticas seguras (solo authenticated) para el nuevo Admin Panel
CREATE POLICY "Auth can manage phone_system_config"
ON phone_system_config FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "Auth can view call_logs"
ON call_logs FOR SELECT
TO authenticated
USING (true);
