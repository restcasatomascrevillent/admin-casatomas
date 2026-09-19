-- SEGURIDAD CRÍTICA: Actualizar políticas RLS para proteger datos personales

-- 1. RESERVAS: El problema más crítico
-- Eliminar políticas inseguras actuales
DROP POLICY IF EXISTS "Admin puede ver todas las reservas" ON public.reservas;
DROP POLICY IF EXISTS "Admin puede actualizar reservas" ON public.reservas;
DROP POLICY IF EXISTS "Admin puede eliminar reservas" ON public.reservas;

-- Crear políticas seguras que requieren autenticación
CREATE POLICY "Solo usuarios autenticados pueden ver reservas"
ON public.reservas
FOR SELECT
TO authenticated
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Solo usuarios autenticados pueden actualizar reservas"
ON public.reservas
FOR UPDATE
TO authenticated
USING (auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Solo usuarios autenticados pueden eliminar reservas"
ON public.reservas
FOR DELETE
TO authenticated
USING (auth.uid() IS NOT NULL);

-- 2. SALAS: Proteger gestión administrativa
DROP POLICY IF EXISTS "Admin puede gestionar salas" ON public.salas;

CREATE POLICY "Solo usuarios autenticados pueden crear salas"
ON public.salas
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Solo usuarios autenticados pueden actualizar salas"
ON public.salas
FOR UPDATE
TO authenticated
USING (auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Solo usuarios autenticados pueden eliminar salas"
ON public.salas
FOR DELETE
TO authenticated
USING (auth.uid() IS NOT NULL);

-- 3. POSICIONES_SALA: Proteger gestión administrativa
DROP POLICY IF EXISTS "Admin puede gestionar posiciones" ON public.posiciones_sala;

CREATE POLICY "Solo usuarios autenticados pueden crear posiciones"
ON public.posiciones_sala
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Solo usuarios autenticados pueden actualizar posiciones"
ON public.posiciones_sala
FOR UPDATE
TO authenticated
USING (auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Solo usuarios autenticados pueden eliminar posiciones"
ON public.posiciones_sala
FOR DELETE
TO authenticated
USING (auth.uid() IS NOT NULL);

-- 4. OCUPACION_DIARIA: Proteger modificaciones
DROP POLICY IF EXISTS "Sistema puede gestionar ocupación" ON public.ocupacion_diaria;

CREATE POLICY "Solo usuarios autenticados pueden modificar ocupación"
ON public.ocupacion_diaria
FOR ALL
TO authenticated
USING (auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() IS NOT NULL);

-- Mantener acceso público de lectura para ocupacion_diaria (no contiene datos personales)
-- La política "Público puede ver ocupación" ya existe y es segura