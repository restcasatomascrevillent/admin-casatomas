-- Agregar campos para trackear ocupación de mesas en reservas
ALTER TABLE public.reservas
ADD COLUMN IF NOT EXISTS posicion_sala_id uuid REFERENCES public.posiciones_sala(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS numero_mesas integer DEFAULT 1;

-- Crear tabla para almacenar estadísticas de ocupación por fecha/sala/posición
CREATE TABLE IF NOT EXISTS public.ocupacion_diaria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha date NOT NULL,
  sala_id uuid NOT NULL REFERENCES public.salas(id) ON DELETE CASCADE,
  posicion_sala_id uuid REFERENCES public.posiciones_sala(id) ON DELETE CASCADE,
  total_mesas_reservadas integer NOT NULL DEFAULT 0,
  total_comensales integer NOT NULL DEFAULT 0,
  total_reservas integer NOT NULL DEFAULT 0,
  user_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  UNIQUE(fecha, sala_id, posicion_sala_id)
);

-- Habilitar RLS en ocupacion_diaria
ALTER TABLE public.ocupacion_diaria ENABLE ROW LEVEL SECURITY;

-- Políticas RLS para ocupacion_diaria
CREATE POLICY "Los usuarios pueden ver su propia ocupación"
ON public.ocupacion_diaria FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden insertar su propia ocupación"
ON public.ocupacion_diaria FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden actualizar su propia ocupación"
ON public.ocupacion_diaria FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden eliminar su propia ocupación"
ON public.ocupacion_diaria FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- Función para calcular y actualizar ocupación diaria
CREATE OR REPLACE FUNCTION public.actualizar_ocupacion_diaria()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fecha date;
  v_sala_id uuid;
  v_posicion_id uuid;
  v_user_id uuid;
BEGIN
  -- Obtener datos de la reserva (NEW para INSERT/UPDATE, OLD para DELETE)
  IF TG_OP = 'DELETE' THEN
    v_fecha := OLD.fecha;
    v_sala_id := OLD.sala_id;
    v_posicion_id := OLD.posicion_sala_id;
    v_user_id := OLD.user_id;
  ELSE
    v_fecha := NEW.fecha;
    v_sala_id := NEW.sala_id;
    v_posicion_id := NEW.posicion_sala_id;
    v_user_id := NEW.user_id;
  END IF;

  -- Recalcular estadísticas para esa fecha/sala/posición
  INSERT INTO public.ocupacion_diaria (
    fecha,
    sala_id,
    posicion_sala_id,
    total_mesas_reservadas,
    total_comensales,
    total_reservas,
    user_id
  )
  SELECT 
    r.fecha,
    r.sala_id,
    r.posicion_sala_id,
    COALESCE(SUM(r.numero_mesas), 0),
    COALESCE(SUM(r.numero_comensales), 0),
    COUNT(*),
    r.user_id
  FROM public.reservas r
  WHERE r.fecha = v_fecha
    AND r.sala_id = v_sala_id
    AND (r.posicion_sala_id = v_posicion_id OR (r.posicion_sala_id IS NULL AND v_posicion_id IS NULL))
    AND r.estado IN ('confirmada', 'verificada', 'pendiente')
    AND r.user_id = v_user_id
  GROUP BY r.fecha, r.sala_id, r.posicion_sala_id, r.user_id
  ON CONFLICT (fecha, sala_id, posicion_sala_id)
  DO UPDATE SET
    total_mesas_reservadas = EXCLUDED.total_mesas_reservadas,
    total_comensales = EXCLUDED.total_comensales,
    total_reservas = EXCLUDED.total_reservas,
    updated_at = now();

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Trigger para actualizar ocupación cuando cambian las reservas
DROP TRIGGER IF EXISTS trigger_actualizar_ocupacion ON public.reservas;
CREATE TRIGGER trigger_actualizar_ocupacion
  AFTER INSERT OR UPDATE OR DELETE ON public.reservas
  FOR EACH ROW
  EXECUTE FUNCTION public.actualizar_ocupacion_diaria();

-- Vista para consultar ocupación fácilmente
CREATE OR REPLACE VIEW public.vista_ocupacion AS
SELECT 
  o.fecha,
  s.nombre AS sala,
  p.nombre AS posicion,
  o.total_mesas_reservadas,
  o.total_comensales,
  o.total_reservas,
  s.numero_mesas AS total_mesas_sala,
  CASE 
    WHEN p.id IS NOT NULL THEN 
      ROUND((o.total_mesas_reservadas::numeric / NULLIF(p.capacidad_comensales, 0)) * 100, 2)
    ELSE 
      ROUND((o.total_mesas_reservadas::numeric / NULLIF(s.numero_mesas, 0)) * 100, 2)
  END AS porcentaje_ocupacion
FROM public.ocupacion_diaria o
INNER JOIN public.salas s ON o.sala_id = s.id
LEFT JOIN public.posiciones_sala p ON o.posicion_sala_id = p.id
ORDER BY o.fecha DESC, s.nombre, p.nombre;