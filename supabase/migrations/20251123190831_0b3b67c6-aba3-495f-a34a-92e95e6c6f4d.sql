-- Eliminar vistas que dependen de sala_id
DROP VIEW IF EXISTS public.vista_reservas_pendientes CASCADE;

-- Obtener un espacio válido de espacios_reserva para las reservas existentes
DO $$
DECLARE
  primer_espacio_id uuid;
BEGIN
  -- Obtener el primer espacio activo disponible
  SELECT id INTO primer_espacio_id FROM public.espacios_reserva WHERE activa = true LIMIT 1;
  
  -- Si no hay espacios activos, usar el primero que exista
  IF primer_espacio_id IS NULL THEN
    SELECT id INTO primer_espacio_id FROM public.espacios_reserva LIMIT 1;
  END IF;
  
  -- Si existe algún espacio, actualizar todas las reservas
  IF primer_espacio_id IS NOT NULL THEN
    -- Agregar columna temporal para espacio_id
    ALTER TABLE public.reservas ADD COLUMN IF NOT EXISTS espacio_id uuid;
    
    -- Actualizar todas las reservas con el espacio válido
    UPDATE public.reservas SET espacio_id = primer_espacio_id WHERE espacio_id IS NULL;
    
    -- Eliminar constraint de foreign key si existe
    ALTER TABLE public.reservas DROP CONSTRAINT IF EXISTS reservas_sala_id_fkey;
    
    -- Eliminar la columna sala_id
    ALTER TABLE public.reservas DROP COLUMN IF EXISTS sala_id;
    
    -- Renombrar espacio_id a sala_id para mantener compatibilidad
    ALTER TABLE public.reservas RENAME COLUMN espacio_id TO sala_id;
    
    -- Hacer la columna NOT NULL ahora que tiene datos
    ALTER TABLE public.reservas ALTER COLUMN sala_id SET NOT NULL;
    
    -- Agregar foreign key a espacios_reserva
    ALTER TABLE public.reservas 
      ADD CONSTRAINT reservas_sala_id_fkey 
      FOREIGN KEY (sala_id) 
      REFERENCES public.espacios_reserva(id) 
      ON DELETE RESTRICT;
  END IF;
END $$;

-- Recrear la vista vista_reservas_pendientes con el nuevo esquema
CREATE OR REPLACE VIEW public.vista_reservas_pendientes AS
SELECT 
  r.id,
  r.nombre AS nombre_cliente,
  r.telefono,
  r.email,
  r.fecha,
  r.hora,
  r.numero_comensales,
  e.nombre AS sala,
  r.estado,
  r.created_at AS fecha_solicitud
FROM public.reservas r
LEFT JOIN public.espacios_reserva e ON r.sala_id = e.id
WHERE r.estado = 'pendiente'
ORDER BY r.fecha, r.hora;

-- Actualizar el trigger para que use espacio_id en lugar de sala_id
DROP TRIGGER IF EXISTS trigger_actualizar_ocupacion ON public.reservas;

CREATE OR REPLACE FUNCTION public.actualizar_ocupacion_diaria_espacios()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_fecha date;
  v_hora time;
  v_espacio_id uuid;
BEGIN
  -- Obtener datos de la reserva
  IF TG_OP = 'DELETE' THEN
    v_fecha := OLD.fecha;
    v_hora := OLD.hora;
    v_espacio_id := OLD.sala_id;
  ELSE
    v_fecha := NEW.fecha;
    v_hora := NEW.hora;
    v_espacio_id := NEW.sala_id;
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
    r.sala_id as espacio_id,
    r.sala_id,
    COALESCE(SUM(r.numero_comensales), 0),
    COUNT(*)
  FROM public.reservas r
  WHERE r.fecha = v_fecha
    AND r.hora = v_hora
    AND r.sala_id = v_espacio_id
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
    AND sala_id = v_espacio_id
    AND total_reservas = 0;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

CREATE TRIGGER trigger_actualizar_ocupacion
  AFTER INSERT OR UPDATE OR DELETE ON public.reservas
  FOR EACH ROW
  EXECUTE FUNCTION public.actualizar_ocupacion_diaria_espacios();