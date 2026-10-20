-- Primero eliminar vista existente
DROP VIEW IF EXISTS public.vista_ocupacion CASCADE;

-- Modificar tabla de ocupación para incluir hora
ALTER TABLE public.ocupacion_diaria
ADD COLUMN IF NOT EXISTS hora time without time zone;

-- Eliminar constraint único anterior y crear uno nuevo con hora
ALTER TABLE public.ocupacion_diaria
DROP CONSTRAINT IF EXISTS ocupacion_diaria_fecha_sala_id_posicion_sala_id_key;

ALTER TABLE public.ocupacion_diaria
ADD CONSTRAINT ocupacion_diaria_fecha_hora_sala_posicion_key 
UNIQUE(fecha, hora, sala_id, posicion_sala_id);

-- Actualizar función para incluir hora
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
  v_user_id uuid;
BEGIN
  -- Obtener datos de la reserva
  IF TG_OP = 'DELETE' THEN
    v_fecha := OLD.fecha;
    v_hora := OLD.hora;
    v_sala_id := OLD.sala_id;
    v_posicion_id := OLD.posicion_sala_id;
    v_user_id := OLD.user_id;
  ELSE
    v_fecha := NEW.fecha;
    v_hora := NEW.hora;
    v_sala_id := NEW.sala_id;
    v_posicion_id := NEW.posicion_sala_id;
    v_user_id := NEW.user_id;
  END IF;

  -- Recalcular estadísticas para esa fecha/hora/sala/posición
  INSERT INTO public.ocupacion_diaria (
    fecha,
    hora,
    sala_id,
    posicion_sala_id,
    total_mesas_reservadas,
    total_comensales,
    total_reservas,
    user_id
  )
  SELECT 
    r.fecha,
    r.hora,
    r.sala_id,
    r.posicion_sala_id,
    COALESCE(SUM(r.numero_mesas), 0),
    COALESCE(SUM(r.numero_comensales), 0),
    COUNT(*),
    r.user_id
  FROM public.reservas r
  WHERE r.fecha = v_fecha
    AND r.hora = v_hora
    AND r.sala_id = v_sala_id
    AND (r.posicion_sala_id = v_posicion_id OR (r.posicion_sala_id IS NULL AND v_posicion_id IS NULL))
    AND r.estado IN ('confirmada', 'verificada', 'pendiente')
    AND r.user_id = v_user_id
  GROUP BY r.fecha, r.hora, r.sala_id, r.posicion_sala_id, r.user_id
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

-- Crear nueva vista de ocupación con estructura actualizada
CREATE OR REPLACE VIEW public.vista_ocupacion AS
SELECT 
  o.fecha,
  o.hora,
  s.id AS sala_id,
  s.nombre AS sala,
  p.id AS posicion_id,
  p.nombre AS posicion,
  o.total_mesas_reservadas,
  o.total_comensales,
  o.total_reservas,
  s.numero_mesas AS total_mesas_sala,
  CASE 
    WHEN p.id IS NOT NULL THEN 
      p.capacidad_comensales
    ELSE 
      s.capacidad_maxima
  END AS capacidad_maxima,
  CASE 
    WHEN p.id IS NOT NULL THEN 
      ROUND((o.total_comensales::numeric / NULLIF(p.capacidad_comensales, 0)) * 100, 2)
    ELSE 
      ROUND((o.total_comensales::numeric / NULLIF(s.capacidad_maxima, 0)) * 100, 2)
  END AS porcentaje_ocupacion,
  s.numero_mesas - o.total_mesas_reservadas AS mesas_disponibles
FROM public.ocupacion_diaria o
INNER JOIN public.salas s ON o.sala_id = s.id
LEFT JOIN public.posiciones_sala p ON o.posicion_sala_id = p.id
ORDER BY o.fecha DESC, o.hora, s.nombre, p.nombre;