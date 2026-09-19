-- Crear tabla para áreas de trabajo de empleados
CREATE TABLE IF NOT EXISTS public.areas_trabajo (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre VARCHAR NOT NULL,
  descripcion TEXT,
  tipo VARCHAR, -- 'cocina', 'barra', 'comedor', 'terraza', etc.
  activa BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Habilitar RLS
ALTER TABLE public.areas_trabajo ENABLE ROW LEVEL SECURITY;

-- Políticas RLS para areas_trabajo
CREATE POLICY "Solo usuarios autenticados pueden ver áreas de trabajo"
  ON public.areas_trabajo
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Solo usuarios autenticados pueden crear áreas de trabajo"
  ON public.areas_trabajo
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Solo usuarios autenticados pueden actualizar áreas de trabajo"
  ON public.areas_trabajo
  FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Solo usuarios autenticados pueden eliminar áreas de trabajo"
  ON public.areas_trabajo
  FOR DELETE
  USING (auth.uid() IS NOT NULL);

-- Crear tabla para asignaciones de áreas a turnos
CREATE TABLE IF NOT EXISTS public.asignaciones_area (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  turno_id UUID NOT NULL REFERENCES public.turnos(id) ON DELETE CASCADE,
  area_id UUID NOT NULL REFERENCES public.areas_trabajo(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(turno_id, area_id)
);

-- Habilitar RLS
ALTER TABLE public.asignaciones_area ENABLE ROW LEVEL SECURITY;

-- Políticas RLS para asignaciones_area
CREATE POLICY "Solo usuarios autenticados pueden ver asignaciones de área"
  ON public.asignaciones_area
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Solo usuarios autenticados pueden crear asignaciones de área"
  ON public.asignaciones_area
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Solo usuarios autenticados pueden eliminar asignaciones de área"
  ON public.asignaciones_area
  FOR DELETE
  USING (auth.uid() IS NOT NULL);

-- Trigger para updated_at
CREATE TRIGGER update_areas_trabajo_updated_at
  BEFORE UPDATE ON public.areas_trabajo
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Crear vista actualizada para turnos con áreas de trabajo
CREATE OR REPLACE VIEW public.vista_turnos_con_areas AS
SELECT 
  t.id,
  t.trabajador_id,
  t.fecha,
  t.hora_inicio,
  t.hora_fin,
  t.estado,
  t.notas,
  t.created_at,
  t.updated_at,
  tr.nombre || ' ' || tr.apellidos AS trabajador_nombre,
  tr.puesto,
  COALESCE(ARRAY_AGG(a.nombre) FILTER (WHERE a.nombre IS NOT NULL), ARRAY[]::VARCHAR[]) AS areas_asignadas,
  COALESCE(ARRAY_AGG(aa.area_id) FILTER (WHERE aa.area_id IS NOT NULL), ARRAY[]::UUID[]) AS areas_ids
FROM public.turnos t
LEFT JOIN public.trabajadores tr ON t.trabajador_id = tr.id
LEFT JOIN public.asignaciones_area aa ON t.id = aa.turno_id
LEFT JOIN public.areas_trabajo a ON aa.area_id = a.id
GROUP BY t.id, t.trabajador_id, t.fecha, t.hora_inicio, t.hora_fin, t.estado, t.notas, t.created_at, t.updated_at, tr.nombre, tr.apellidos, tr.puesto;