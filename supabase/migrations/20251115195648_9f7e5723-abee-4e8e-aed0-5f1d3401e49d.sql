-- Hacer que espacio_id sea nullable en ocupacion_diaria
ALTER TABLE public.ocupacion_diaria 
ALTER COLUMN espacio_id DROP NOT NULL;

-- Actualizar función para no usar espacio_id cuando viene de reservas
CREATE OR REPLACE FUNCTION public.actualizar_ocupacion_diaria()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_fecha date;
  v_hora time;
  v_sala_id uuid;
BEGIN
  -- Obtener datos de la reserva
  IF TG_OP = 'DELETE' THEN
    v_fecha := OLD.fecha;
    v_hora := OLD.hora;
    v_sala_id := OLD.sala_id;
  ELSE
    v_fecha := NEW.fecha;
    v_hora := NEW.hora;
    v_sala_id := NEW.sala_id;
  END IF;

  -- Recalcular estadísticas para esa fecha/hora/sala (excluyendo canceladas)
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
    NULL as espacio_id, -- No usamos espacio_id para reservas de salas
    r.sala_id,
    COALESCE(SUM(r.numero_comensales), 0),
    COUNT(*)
  FROM public.reservas r
  WHERE r.fecha = v_fecha
    AND r.hora = v_hora
    AND r.sala_id = v_sala_id
    AND r.estado != 'cancelada'
  GROUP BY r.fecha, r.hora, r.sala_id
  ON CONFLICT (fecha, hora, sala_id)
  DO UPDATE SET
    total_comensales = EXCLUDED.total_comensales,
    total_reservas = EXCLUDED.total_reservas,
    updated_at = now();

  -- Eliminar registro si no hay reservas
  DELETE FROM public.ocupacion_diaria
  WHERE fecha = v_fecha
    AND hora = v_hora
    AND sala_id = v_sala_id
    AND total_reservas = 0;

  RETURN COALESCE(NEW, OLD);
END;
$function$;