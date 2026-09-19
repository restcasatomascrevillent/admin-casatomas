-- Eliminar sistema multi-usuario
-- Paso 1: Eliminar user_id de todas las tablas

ALTER TABLE public.salas
DROP COLUMN IF EXISTS user_id CASCADE;

ALTER TABLE public.reservas
DROP COLUMN IF EXISTS user_id CASCADE;

ALTER TABLE public.ocupacion_diaria
DROP COLUMN IF EXISTS user_id CASCADE;

-- Paso 2: Eliminar tabla profiles
DROP TABLE IF EXISTS public.profiles CASCADE;

-- Paso 3: Actualizar políticas RLS para permitir acceso público a lectura y escritura

-- SALAS: Admin puede gestionar, público puede leer
DROP POLICY IF EXISTS "Los usuarios pueden ver sus propias salas" ON public.salas;
DROP POLICY IF EXISTS "Los usuarios pueden insertar sus propias salas" ON public.salas;
DROP POLICY IF EXISTS "Los usuarios pueden actualizar sus propias salas" ON public.salas;
DROP POLICY IF EXISTS "Los usuarios pueden eliminar sus propias salas" ON public.salas;

CREATE POLICY "Público puede ver salas activas"
ON public.salas FOR SELECT
USING (activa = true);

CREATE POLICY "Admin puede gestionar salas"
ON public.salas FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- POSICIONES_SALA: Admin puede gestionar, público puede leer
DROP POLICY IF EXISTS "Los usuarios pueden ver posiciones de sus salas" ON public.posiciones_sala;
DROP POLICY IF EXISTS "Los usuarios pueden insertar posiciones en sus salas" ON public.posiciones_sala;
DROP POLICY IF EXISTS "Los usuarios pueden actualizar posiciones de sus salas" ON public.posiciones_sala;
DROP POLICY IF EXISTS "Los usuarios pueden eliminar posiciones de sus salas" ON public.posiciones_sala;

CREATE POLICY "Público puede ver posiciones activas"
ON public.posiciones_sala FOR SELECT
USING (activa = true);

CREATE POLICY "Admin puede gestionar posiciones"
ON public.posiciones_sala FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- RESERVAS: Público puede crear, admin puede gestionar todo
DROP POLICY IF EXISTS "Los usuarios pueden ver sus propias reservas" ON public.reservas;
DROP POLICY IF EXISTS "Los usuarios pueden insertar sus propias reservas" ON public.reservas;
DROP POLICY IF EXISTS "Los usuarios pueden actualizar sus propias reservas" ON public.reservas;
DROP POLICY IF EXISTS "Los usuarios pueden eliminar sus propias reservas" ON public.reservas;

CREATE POLICY "Público puede crear reservas"
ON public.reservas FOR INSERT
WITH CHECK (true);

CREATE POLICY "Admin puede ver todas las reservas"
ON public.reservas FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Admin puede actualizar reservas"
ON public.reservas FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "Admin puede eliminar reservas"
ON public.reservas FOR DELETE
TO authenticated
USING (true);

-- OCUPACION_DIARIA: Público puede leer, sistema puede escribir
DROP POLICY IF EXISTS "Los usuarios pueden ver su propia ocupación" ON public.ocupacion_diaria;
DROP POLICY IF EXISTS "Los usuarios pueden insertar su propia ocupación" ON public.ocupacion_diaria;
DROP POLICY IF EXISTS "Los usuarios pueden actualizar su propia ocupación" ON public.ocupacion_diaria;
DROP POLICY IF EXISTS "Los usuarios pueden eliminar su propia ocupación" ON public.ocupacion_diaria;

CREATE POLICY "Público puede ver ocupación"
ON public.ocupacion_diaria FOR SELECT
USING (true);

CREATE POLICY "Sistema puede gestionar ocupación"
ON public.ocupacion_diaria FOR ALL
USING (true)
WITH CHECK (true);

-- Paso 4: Actualizar función de trigger para no usar user_id
CREATE OR REPLACE FUNCTION public.actualizar_ocupacion_diaria()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fecha date;
  v_hora time;
  v_sala_id uuid;
  v_posicion_id uuid;
BEGIN
  -- Obtener datos de la reserva
  IF TG_OP = 'DELETE' THEN
    v_fecha := OLD.fecha;
    v_hora := OLD.hora;
    v_sala_id := OLD.sala_id;
    v_posicion_id := OLD.posicion_sala_id;
  ELSE
    v_fecha := NEW.fecha;
    v_hora := NEW.hora;
    v_sala_id := NEW.sala_id;
    v_posicion_id := NEW.posicion_sala_id;
  END IF;

  -- Recalcular estadísticas para esa fecha/hora/sala/posición
  INSERT INTO public.ocupacion_diaria (
    fecha,
    hora,
    sala_id,
    posicion_sala_id,
    total_mesas_reservadas,
    total_comensales,
    total_reservas
  )
  SELECT 
    r.fecha,
    r.hora,
    r.sala_id,
    r.posicion_sala_id,
    COALESCE(SUM(r.numero_mesas), 0),
    COALESCE(SUM(r.numero_comensales), 0),
    COUNT(*)
  FROM public.reservas r
  WHERE r.fecha = v_fecha
    AND r.hora = v_hora
    AND r.sala_id = v_sala_id
    AND (r.posicion_sala_id = v_posicion_id OR (r.posicion_sala_id IS NULL AND v_posicion_id IS NULL))
    AND r.estado IN ('confirmada', 'verificada', 'pendiente')
  GROUP BY r.fecha, r.hora, r.sala_id, r.posicion_sala_id
  ON CONFLICT (fecha, hora, sala_id, posicion_sala_id)
  DO UPDATE SET
    total_mesas_reservadas = EXCLUDED.total_mesas_reservadas,
    total_comensales = EXCLUDED.total_comensales,
    total_reservas = EXCLUDED.total_reservas,
    updated_at = now();

  -- Eliminar registro si no hay reservas
  DELETE FROM public.ocupacion_diaria
  WHERE fecha = v_fecha
    AND hora = v_hora
    AND sala_id = v_sala_id
    AND (posicion_sala_id = v_posicion_id OR (posicion_sala_id IS NULL AND v_posicion_id IS NULL))
    AND total_reservas = 0;

  RETURN COALESCE(NEW, OLD);
END;
$$;