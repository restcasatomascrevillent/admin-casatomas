-- Reconstruida desde supabase_migrations.schema_migrations (version 20260305170513).
-- Se aplico directamente sobre el proyecto (dashboard / MCP) y nunca se exporto a
-- este repositorio, lo que dejaba a `supabase db push` con una fila de historial sin
-- fichero local ('Remote migration versions not found in local migrations directory').
-- YA ESTA APLICADA: db push no la ejecuta. Existe para que `db reset` / una branch
-- nueva reproduzcan el esquema real. No editar a mano.

CREATE OR REPLACE FUNCTION append_tool_call_log(p_call_id TEXT, p_new_tools JSONB)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE call_logs
  SET tool_calls = COALESCE(tool_calls, '[]'::jsonb) || p_new_tools
  WHERE vapi_call_id = p_call_id;
END;
$$;
