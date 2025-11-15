-- Eliminar vista que depende de numero_mesas
DROP VIEW IF EXISTS public.vista_ocupacion CASCADE;

-- Eliminar columnas numero_mesas de las tablas
ALTER TABLE public.salas DROP COLUMN IF EXISTS numero_mesas;
ALTER TABLE public.espacios_reserva DROP COLUMN IF EXISTS numero_mesas;
ALTER TABLE public.reservas DROP COLUMN IF EXISTS numero_mesas;

-- Eliminar columna total_mesas_reservadas de ocupacion_diaria
ALTER TABLE public.ocupacion_diaria DROP COLUMN IF EXISTS total_mesas_reservadas;

-- Recrear vista_ocupacion sin referencias a numero_mesas
CREATE OR REPLACE VIEW public.vista_ocupacion AS
SELECT 
  od.fecha,
  od.hora,
  od.espacio_id,
  er.nombre AS espacio,
  od.total_reservas,
  od.total_comensales,
  er.capacidad_maxima,
  CASE 
    WHEN er.capacidad_maxima > 0 THEN 
      ROUND((od.total_comensales::numeric / er.capacidad_maxima::numeric) * 100, 2)
    ELSE 0 
  END AS porcentaje_ocupacion,
  GREATEST(0, er.capacidad_maxima - od.total_comensales) AS capacidad_disponible
FROM public.ocupacion_diaria od
JOIN public.espacios_reserva er ON od.espacio_id = er.id
ORDER BY od.fecha, od.hora, er.nombre;

-- Actualizar la función actualizar_ocupacion_diaria para no usar numero_mesas
CREATE OR REPLACE FUNCTION public.actualizar_ocupacion_diaria()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_fecha date;
  v_hora time;
  v_espacio_id uuid;
  v_sala_id uuid;
BEGIN
  -- Obtener datos de la reserva
  IF TG_OP = 'DELETE' THEN
    v_fecha := OLD.fecha;
    v_hora := OLD.hora;
    v_espacio_id := OLD.espacio_id;
    v_sala_id := OLD.sala_id;
  ELSE
    v_fecha := NEW.fecha;
    v_hora := NEW.hora;
    v_espacio_id := NEW.espacio_id;
    v_sala_id := NEW.sala_id;
  END IF;

  -- Recalcular estadísticas para esa fecha/hora/espacio (excluyendo canceladas)
  INSERT INTO public.ocupacion_diaria (
    fecha,
    hora,
    espacio_id,
    sala_id,
    total_comensales,
    total_reservas
  )
  SELECT 
    r.fecha,
    r.hora,
    r.espacio_id,
    r.sala_id,
    COALESCE(SUM(r.numero_comensales), 0),
    COUNT(*)
  FROM public.reservas r
  WHERE r.fecha = v_fecha
    AND r.hora = v_hora
    AND r.espacio_id = v_espacio_id
    AND r.estado != 'cancelada'
  GROUP BY r.fecha, r.hora, r.espacio_id, r.sala_id
  ON CONFLICT (fecha, hora, sala_id)
  DO UPDATE SET
    total_comensales = EXCLUDED.total_comensales,
    total_reservas = EXCLUDED.total_reservas,
    updated_at = now();

  -- Eliminar registro si no hay reservas
  DELETE FROM public.ocupacion_diaria
  WHERE fecha = v_fecha
    AND hora = v_hora
    AND espacio_id = v_espacio_id
    AND total_reservas = 0;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- Crear trigger para actualizar ocupación en INSERT
DROP TRIGGER IF EXISTS trigger_actualizar_ocupacion_insert ON public.reservas;
CREATE TRIGGER trigger_actualizar_ocupacion_insert
  AFTER INSERT ON public.reservas
  FOR EACH ROW
  EXECUTE FUNCTION public.actualizar_ocupacion_diaria();

-- Crear trigger para actualizar ocupación en UPDATE
DROP TRIGGER IF EXISTS trigger_actualizar_ocupacion_update ON public.reservas;
CREATE TRIGGER trigger_actualizar_ocupacion_update
  AFTER UPDATE ON public.reservas
  FOR EACH ROW
  EXECUTE FUNCTION public.actualizar_ocupacion_diaria();

-- Crear trigger para actualizar ocupación en DELETE
DROP TRIGGER IF EXISTS trigger_actualizar_ocupacion_delete ON public.reservas;
CREATE TRIGGER trigger_actualizar_ocupacion_delete
  AFTER DELETE ON public.reservas
  FOR EACH ROW
  EXECUTE FUNCTION public.actualizar_ocupacion_diaria();