-- Reconstruida desde supabase_migrations.schema_migrations (version 20260228173300).
-- Se aplico directamente sobre el proyecto (dashboard / MCP) y nunca se exporto a
-- este repositorio, lo que dejaba a `supabase db push` con una fila de historial sin
-- fichero local ('Remote migration versions not found in local migrations directory').
-- YA ESTA APLICADA: db push no la ejecuta. Existe para que `db reset` / una branch
-- nueva reproduzcan el esquema real. No editar a mano.


-- =================================================================
-- HARDENING DE SEGURIDAD COMPLETO — Casa Tomás
-- =================================================================

-- ----------------------------------------------------------------
-- 1. TABLAS SIN RLS: conversaciones, mensajes_chat, n8n_chat_histories
-- ----------------------------------------------------------------

-- Activar RLS
ALTER TABLE public.conversaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mensajes_chat ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.n8n_chat_histories ENABLE ROW LEVEL SECURITY;

-- conversaciones: solo usuarios autenticados del panel admin
CREATE POLICY "conversaciones_auth_only"
  ON public.conversaciones
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- mensajes_chat: solo usuarios autenticados del panel admin
CREATE POLICY "mensajes_chat_auth_only"
  ON public.mensajes_chat
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- n8n_chat_histories: solo autenticados (historial de n8n, interno)
CREATE POLICY "n8n_chat_auth_only"
  ON public.n8n_chat_histories
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ----------------------------------------------------------------
-- 2. CONFIGURACION_RESERVAS: bloquear SELECT anónimo
--    (contiene parámetros de negocio como teléfono obligatorio, máx. comensales...)
-- ----------------------------------------------------------------
DROP POLICY IF EXISTS "Anon can read configuracion_reservas" ON public.configuracion_reservas;

-- Solo autenticados pueden leer la configuración del panel
-- El webhook usa service_role (bypassa RLS) → sigue funcionando
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'configuracion_reservas'
      AND policyname = 'Only authenticated can read config'
  ) THEN
    CREATE POLICY "Only authenticated can read config"
      ON public.configuracion_reservas
      FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;

-- ----------------------------------------------------------------
-- 3. ESPACIOS_RESERVA: bloquear SELECT anónimo
--    (contiene nombres y capacidades de espacios del restaurante)
-- ----------------------------------------------------------------
DROP POLICY IF EXISTS "Anon can read espacios_reserva" ON public.espacios_reserva;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'espacios_reserva'
      AND policyname = 'Only authenticated can read espacios'
  ) THEN
    CREATE POLICY "Only authenticated can read espacios"
      ON public.espacios_reserva
      FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;

-- ----------------------------------------------------------------
-- 4. PHONE_SYSTEM_CONFIG: eliminar INSERT anónimo si existiera
-- ----------------------------------------------------------------
DROP POLICY IF EXISTS "Allow public insert" ON public.phone_system_config;
DROP POLICY IF EXISTS "Allow anon insert" ON public.phone_system_config;
DROP POLICY IF EXISTS "Anon can read phone_system_config" ON public.phone_system_config;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'phone_system_config'
      AND policyname = 'Only authenticated can read phone config'
  ) THEN
    CREATE POLICY "Only authenticated can read phone config"
      ON public.phone_system_config
      FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;

-- ----------------------------------------------------------------
-- 5. FUNCIONES: fijar search_path para las funciones críticas
--    del sistema de reservas (evita search_path hijacking)
-- ----------------------------------------------------------------
ALTER FUNCTION public.cleanup_rate_limit_log() SET search_path = public;
ALTER FUNCTION public.actualizar_updated_at() SET search_path = public;
