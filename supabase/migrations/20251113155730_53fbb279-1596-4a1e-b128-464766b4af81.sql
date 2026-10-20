-- Actualizar políticas RLS para permitir operaciones correctamente

-- ============================================
-- TABLA: reservas
-- ============================================
DROP POLICY IF EXISTS "Los usuarios pueden ver sus propias reservas" ON public.reservas;
DROP POLICY IF EXISTS "Los usuarios pueden insertar sus propias reservas" ON public.reservas;
DROP POLICY IF EXISTS "Los usuarios pueden actualizar sus propias reservas" ON public.reservas;
DROP POLICY IF EXISTS "Los usuarios pueden eliminar sus propias reservas" ON public.reservas;

CREATE POLICY "Los usuarios pueden ver sus propias reservas"
ON public.reservas FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden insertar sus propias reservas"
ON public.reservas FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden actualizar sus propias reservas"
ON public.reservas FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden eliminar sus propias reservas"
ON public.reservas FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- ============================================
-- TABLA: salas
-- ============================================
DROP POLICY IF EXISTS "Los usuarios pueden ver sus propias salas" ON public.salas;
DROP POLICY IF EXISTS "Los usuarios pueden insertar sus propias salas" ON public.salas;
DROP POLICY IF EXISTS "Los usuarios pueden actualizar sus propias salas" ON public.salas;
DROP POLICY IF EXISTS "Los usuarios pueden eliminar sus propias salas" ON public.salas;

CREATE POLICY "Los usuarios pueden ver sus propias salas"
ON public.salas FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden insertar sus propias salas"
ON public.salas FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden actualizar sus propias salas"
ON public.salas FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden eliminar sus propias salas"
ON public.salas FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- ============================================
-- TABLA: posiciones_sala
-- ============================================
DROP POLICY IF EXISTS "Los usuarios pueden ver posiciones de sus salas" ON public.posiciones_sala;
DROP POLICY IF EXISTS "Los usuarios pueden insertar posiciones en sus salas" ON public.posiciones_sala;
DROP POLICY IF EXISTS "Los usuarios pueden actualizar posiciones de sus salas" ON public.posiciones_sala;
DROP POLICY IF EXISTS "Los usuarios pueden eliminar posiciones de sus salas" ON public.posiciones_sala;

CREATE POLICY "Los usuarios pueden ver posiciones de sus salas"
ON public.posiciones_sala FOR SELECT
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.salas
  WHERE salas.id = posiciones_sala.sala_id
  AND salas.user_id = auth.uid()
));

CREATE POLICY "Los usuarios pueden insertar posiciones en sus salas"
ON public.posiciones_sala FOR INSERT
TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM public.salas
  WHERE salas.id = posiciones_sala.sala_id
  AND salas.user_id = auth.uid()
));

CREATE POLICY "Los usuarios pueden actualizar posiciones de sus salas"
ON public.posiciones_sala FOR UPDATE
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.salas
  WHERE salas.id = posiciones_sala.sala_id
  AND salas.user_id = auth.uid()
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.salas
  WHERE salas.id = posiciones_sala.sala_id
  AND salas.user_id = auth.uid()
));

CREATE POLICY "Los usuarios pueden eliminar posiciones de sus salas"
ON public.posiciones_sala FOR DELETE
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.salas
  WHERE salas.id = posiciones_sala.sala_id
  AND salas.user_id = auth.uid()
));

-- ============================================
-- TABLA: trabajadores
-- ============================================
DROP POLICY IF EXISTS "Los usuarios pueden ver sus propios trabajadores" ON public.trabajadores;
DROP POLICY IF EXISTS "Los usuarios pueden insertar sus propios trabajadores" ON public.trabajadores;
DROP POLICY IF EXISTS "Los usuarios pueden actualizar sus propios trabajadores" ON public.trabajadores;
DROP POLICY IF EXISTS "Los usuarios pueden eliminar sus propios trabajadores" ON public.trabajadores;

CREATE POLICY "Los usuarios pueden ver sus propios trabajadores"
ON public.trabajadores FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden insertar sus propios trabajadores"
ON public.trabajadores FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden actualizar sus propios trabajadores"
ON public.trabajadores FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden eliminar sus propios trabajadores"
ON public.trabajadores FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- ============================================
-- TABLA: turnos
-- ============================================
DROP POLICY IF EXISTS "Los usuarios pueden ver sus propios turnos" ON public.turnos;
DROP POLICY IF EXISTS "Los usuarios pueden insertar sus propios turnos" ON public.turnos;
DROP POLICY IF EXISTS "Los usuarios pueden actualizar sus propios turnos" ON public.turnos;
DROP POLICY IF EXISTS "Los usuarios pueden eliminar sus propios turnos" ON public.turnos;

CREATE POLICY "Los usuarios pueden ver sus propios turnos"
ON public.turnos FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden insertar sus propios turnos"
ON public.turnos FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden actualizar sus propios turnos"
ON public.turnos FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden eliminar sus propios turnos"
ON public.turnos FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- ============================================
-- TABLA: asignaciones_turno
-- ============================================
DROP POLICY IF EXISTS "Los usuarios pueden ver sus propias asignaciones" ON public.asignaciones_turno;
DROP POLICY IF EXISTS "Los usuarios pueden insertar sus propias asignaciones" ON public.asignaciones_turno;
DROP POLICY IF EXISTS "Los usuarios pueden actualizar sus propias asignaciones" ON public.asignaciones_turno;
DROP POLICY IF EXISTS "Los usuarios pueden eliminar sus propias asignaciones" ON public.asignaciones_turno;

CREATE POLICY "Los usuarios pueden ver sus propias asignaciones"
ON public.asignaciones_turno FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden insertar sus propias asignaciones"
ON public.asignaciones_turno FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden actualizar sus propias asignaciones"
ON public.asignaciones_turno FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden eliminar sus propias asignaciones"
ON public.asignaciones_turno FOR DELETE
TO authenticated
USING (auth.uid() = user_id);