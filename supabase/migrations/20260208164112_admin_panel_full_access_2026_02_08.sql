-- Reconstruida desde supabase_migrations.schema_migrations (version 20260208164112).
-- Se aplico directamente sobre el proyecto (dashboard / MCP) y nunca se exporto a
-- este repositorio, lo que dejaba a `supabase db push` con una fila de historial sin
-- fichero local ('Remote migration versions not found in local migrations directory').
-- YA ESTA APLICADA: db push no la ejecuta. Existe para que `db reset` / una branch
-- nueva reproduzcan el esquema real. No editar a mano.

-- =====================================================
-- ACCESO COMPLETO PARA ADMIN PANEL
-- =====================================================
-- Asegurar que usuarios autenticados tengan acceso completo
-- a todas las tablas necesarias para el admin panel

-- 1. SECURITY_LOG - Agregar permisos de escritura
CREATE POLICY "Authenticated users can insert security logs"
ON public.security_log
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can update security logs"
ON public.security_log
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "Authenticated users can delete security logs"
ON public.security_log
FOR DELETE
TO authenticated
USING (true);

-- 2. RATE_LIMIT_LOG - Agregar acceso para autenticados
CREATE POLICY "Authenticated users can read rate limits"
ON public.rate_limit_log
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can insert rate limits"
ON public.rate_limit_log
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can update rate limits"
ON public.rate_limit_log
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "Authenticated users can delete rate limits"
ON public.rate_limit_log
FOR DELETE
TO authenticated
USING (true);

-- 3. CONSULTAS_CHATBOT - Agregar permisos de actualización/eliminación
CREATE POLICY "Authenticated users can update consultas_chatbot"
ON public.consultas_chatbot
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "Authenticated users can delete consultas_chatbot"
ON public.consultas_chatbot
FOR DELETE
TO authenticated
USING (true);

-- 4. SCOPE_PRICES - Agregar acceso para autenticados (lectura)
CREATE POLICY "Authenticated users can read scope_prices"
ON public.scope_prices
FOR SELECT
TO authenticated
USING (true);

-- 5. USAGE_EVENTS - Agregar acceso para autenticados (lectura)
CREATE POLICY "Authenticated users can read usage_events"
ON public.usage_events
FOR SELECT
TO authenticated
USING (true);

-- 6. Verificar tabla BEW (tiene RLS pero sin políticas)
-- Agregar políticas para usuarios autenticados
CREATE POLICY "Authenticated users can read bew"
ON public.bew
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can insert bew"
ON public.bew
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can update bew"
ON public.bew
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "Authenticated users can delete bew"
ON public.bew
FOR DELETE
TO authenticated
USING (true);
