-- Reconstruida desde supabase_migrations.schema_migrations (version 20260228152927).
-- Se aplico directamente sobre el proyecto (dashboard / MCP) y nunca se exporto a
-- este repositorio, lo que dejaba a `supabase db push` con una fila de historial sin
-- fichero local ('Remote migration versions not found in local migrations directory').
-- YA ESTA APLICADA: db push no la ejecuta. Existe para que `db reset` / una branch
-- nueva reproduzcan el esquema real. No editar a mano.


-- =============================================================
-- CORRECCIONES DE SEGURIDAD RLS - restaurante-phone
-- =============================================================

-- 1. PHONE_SYSTEM_CONFIG: eliminar la política que permite
--    UPDATE públicamente sin autenticación (CRÍTICO)
DROP POLICY IF EXISTS "Allow public update" ON public.phone_system_config;

-- Solo usuarios autenticados (admin panel) pueden modificar la config
CREATE POLICY "Only authenticated can update phone config"
  ON public.phone_system_config
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 2. RESERVAS: la política de INSERT pública era necesaria para el formulario
--    web. La mantenemos pero añadimos campo-level constraints ya existentes.
--    Adicionalmente, bloqueamos SELECT anónimo sobre datos personales:
--    ya existe RLS en reservas, verificamos que anon no puede hacer SELECT:
DROP POLICY IF EXISTS "Anon can read reservas" ON public.reservas;

-- Asegurar que únicamente autenticados pueden leer todas las reservas
-- (el webhook usa service_role que bypassa RLS — eso es correcto)
CREATE POLICY "Only authenticated can read reservas"
  ON public.reservas
  FOR SELECT
  TO authenticated
  USING (true);

-- 3. CALL_LOGS: anon no debe poder leer logs de llamadas (PII: teléfonos)
DROP POLICY IF EXISTS "Allow public read" ON public.call_logs;
DROP POLICY IF EXISTS "Anon can read call_logs" ON public.call_logs;

CREATE POLICY "Only authenticated can read call_logs"
  ON public.call_logs
  FOR SELECT
  TO authenticated
  USING (true);

-- 4. BLACKLIST: anon no debe poder leer la lista negra
DROP POLICY IF EXISTS "Anon can read blacklist" ON public.blacklist;

CREATE POLICY "Only authenticated can read blacklist"
  ON public.blacklist
  FOR SELECT
  TO authenticated
  USING (true);
