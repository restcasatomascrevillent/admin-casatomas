-- Crear tabla de espacios de reserva
CREATE TABLE public.espacios_reserva (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre VARCHAR NOT NULL,
  descripcion TEXT,
  numero_mesas INTEGER NOT NULL,
  capacidad_maxima INTEGER NOT NULL,
  activa BOOLEAN DEFAULT true,
  caracteristicas JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Habilitar RLS en espacios_reserva
ALTER TABLE public.espacios_reserva ENABLE ROW LEVEL SECURITY;

-- Políticas RLS para espacios_reserva
CREATE POLICY "Público puede ver espacios activos"
ON public.espacios_reserva
FOR SELECT
USING (activa = true);

CREATE POLICY "Solo usuarios autenticados pueden crear espacios"
ON public.espacios_reserva
FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Solo usuarios autenticados pueden actualizar espacios"
ON public.espacios_reserva
FOR UPDATE
USING (auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Solo usuarios autenticados pueden eliminar espacios"
ON public.espacios_reserva
FOR DELETE
USING (auth.uid() IS NOT NULL);

-- Migrar datos de salas a espacios_reserva
INSERT INTO public.espacios_reserva (nombre, descripcion, numero_mesas, capacidad_maxima, activa, caracteristicas)
SELECT nombre, descripcion, numero_mesas, capacidad_maxima, activa, caracteristicas
FROM public.salas;

-- Añadir columna espacio_id a reservas
ALTER TABLE public.reservas ADD COLUMN espacio_id UUID REFERENCES public.espacios_reserva(id);

-- Migrar las referencias de sala_id a espacio_id en reservas
UPDATE public.reservas r
SET espacio_id = e.id
FROM public.salas s
JOIN public.espacios_reserva e ON s.nombre = e.nombre
WHERE r.sala_id = s.id;

-- Hacer espacio_id NOT NULL después de la migración
ALTER TABLE public.reservas ALTER COLUMN espacio_id SET NOT NULL;

-- Añadir columna espacio_id a ocupacion_diaria
ALTER TABLE public.ocupacion_diaria ADD COLUMN espacio_id UUID REFERENCES public.espacios_reserva(id);

-- Migrar las referencias en ocupacion_diaria
UPDATE public.ocupacion_diaria od
SET espacio_id = e.id
FROM public.salas s
JOIN public.espacios_reserva e ON s.nombre = e.nombre
WHERE od.sala_id = s.id;

-- Hacer espacio_id NOT NULL
ALTER TABLE public.ocupacion_diaria ALTER COLUMN espacio_id SET NOT NULL;

-- Recrear vista_ocupacion con espacio_id
DROP VIEW IF EXISTS public.vista_ocupacion;

CREATE VIEW public.vista_ocupacion AS
SELECT 
  od.fecha,
  od.hora,
  od.espacio_id,
  e.nombre as espacio,
  od.total_mesas_reservadas,
  od.total_comensales,
  od.total_reservas,
  e.numero_mesas as total_mesas_espacio,
  e.capacidad_maxima,
  (e.numero_mesas - od.total_mesas_reservadas) as mesas_disponibles,
  ROUND((od.total_mesas_reservadas::numeric / e.numero_mesas::numeric) * 100, 2) as porcentaje_ocupacion
FROM public.ocupacion_diaria od
JOIN public.espacios_reserva e ON od.espacio_id = e.id;

-- Actualizar función actualizar_ocupacion_diaria para usar espacio_id
CREATE OR REPLACE FUNCTION public.actualizar_ocupacion_diaria()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
    v_espacio_id := OLD.espacio_id;
  ELSE
    v_fecha := NEW.fecha;
    v_hora := NEW.hora;
    v_espacio_id := NEW.espacio_id;
  END IF;

  -- Recalcular estadísticas para esa fecha/hora/espacio
  INSERT INTO public.ocupacion_diaria (
    fecha,
    hora,
    espacio_id,
    sala_id,
    total_mesas_reservadas,
    total_comensales,
    total_reservas
  )
  SELECT 
    r.fecha,
    r.hora,
    r.espacio_id,
    r.sala_id,
    COALESCE(SUM(r.numero_mesas), 0),
    COALESCE(SUM(r.numero_comensales), 0),
    COUNT(*)
  FROM public.reservas r
  WHERE r.fecha = v_fecha
    AND r.hora = v_hora
    AND r.espacio_id = v_espacio_id
    AND r.estado IN ('confirmada', 'verificada', 'pendiente')
  GROUP BY r.fecha, r.hora, r.espacio_id, r.sala_id
  ON CONFLICT (fecha, hora, sala_id)
  DO UPDATE SET
    total_mesas_reservadas = EXCLUDED.total_mesas_reservadas,
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

-- Trigger para actualizar updated_at en espacios_reserva
CREATE TRIGGER update_espacios_reserva_updated_at
  BEFORE UPDATE ON public.espacios_reserva
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();