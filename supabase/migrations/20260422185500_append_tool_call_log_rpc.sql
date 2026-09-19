-- ⚠️ ANTES DE APLICAR:
-- 1. Conectarse al Supabase Studio
-- 2. Ejecutar: SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'append_tool_call_log';
-- 3. Comparar con este archivo y ajustar si es necesario.
-- Esta función YA EXISTE en producción pero no estaba versionada.

-- RPC: append_tool_call_log
-- Añade entries al array jsonb call_logs.tool_calls de forma idempotente.
-- Se usa desde los webhooks de VAPI y ElevenLabs para loguear ejecuciones
-- de tools sin sufrir race conditions con el end-of-call report.
--
-- NOTA: esta función ya existía en Supabase Studio sin versionar.
-- Este archivo la versiona. Si existe una versión distinta en producción,
-- revisar antes de aplicar (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION public.append_tool_call_log(
  p_call_id text,
  p_new_tools jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Si no existe el call_log aún (la llamada acaba de empezar), lo creamos mínimo
  INSERT INTO call_logs (vapi_call_id, restaurant_id, call_type, status, started_at, tool_calls)
  VALUES (p_call_id, 'default', 'bot', 'active', now(), p_new_tools)
  ON CONFLICT (vapi_call_id) DO UPDATE
  SET tool_calls = COALESCE(call_logs.tool_calls, '[]'::jsonb) || p_new_tools;
END;
$$;

COMMENT ON FUNCTION public.append_tool_call_log IS
  'Append tool executions to call_logs.tool_calls array. Used by phone bot webhooks.';

-- Permiso para el rol que usa Supabase JS client
GRANT EXECUTE ON FUNCTION public.append_tool_call_log TO service_role, authenticated, anon;
