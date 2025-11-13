-- Sistema de gestión de trabajadores y turnos

-- Tipo de puesto de trabajo
CREATE TYPE public.puesto_trabajo AS ENUM (
  'gerente',
  'camarero',
  'ayudante_camarero',
  'cocinero',
  'ayudante_cocina',
  'recepcionista',
  'limpieza'
);

-- Tipo de estado de turno
CREATE TYPE public.estado_turno AS ENUM (
  'programado',
  'activo',
  'completado',
  'cancelado'
);

-- Tabla de trabajadores
CREATE TABLE public.trabajadores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre VARCHAR NOT NULL,
  apellidos VARCHAR NOT NULL,
  telefono VARCHAR NOT NULL,
  email VARCHAR UNIQUE,
  puesto puesto_trabajo NOT NULL,
  fecha_contratacion DATE NOT NULL DEFAULT CURRENT_DATE,
  activo BOOLEAN DEFAULT true,
  salario_hora DECIMAL(10,2),
  notas TEXT,
  foto_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Tabla de turnos
CREATE TABLE public.turnos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trabajador_id UUID NOT NULL REFERENCES public.trabajadores(id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  hora_inicio TIME NOT NULL,
  hora_fin TIME NOT NULL,
  estado estado_turno DEFAULT 'programado',
  notas TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT turnos_hora_valida CHECK (hora_fin > hora_inicio)
);

-- Tabla de asignaciones de trabajadores a salas
CREATE TABLE public.asignaciones_sala (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  turno_id UUID NOT NULL REFERENCES public.turnos(id) ON DELETE CASCADE,
  sala_id UUID NOT NULL REFERENCES public.salas(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(turno_id, sala_id)
);

-- Tabla de registro de horas trabajadas (para calcular nómina)
CREATE TABLE public.registro_horas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trabajador_id UUID NOT NULL REFERENCES public.trabajadores(id) ON DELETE CASCADE,
  turno_id UUID REFERENCES public.turnos(id) ON DELETE SET NULL,
  fecha DATE NOT NULL,
  hora_entrada TIMESTAMPTZ NOT NULL,
  hora_salida TIMESTAMPTZ,
  horas_trabajadas DECIMAL(10,2),
  notas TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Índices para mejorar rendimiento
CREATE INDEX idx_turnos_trabajador ON public.turnos(trabajador_id);
CREATE INDEX idx_turnos_fecha ON public.turnos(fecha);
CREATE INDEX idx_asignaciones_turno ON public.asignaciones_sala(turno_id);
CREATE INDEX idx_asignaciones_sala ON public.asignaciones_sala(sala_id);
CREATE INDEX idx_registro_trabajador ON public.registro_horas(trabajador_id);
CREATE INDEX idx_registro_fecha ON public.registro_horas(fecha);

-- Trigger para actualizar updated_at en trabajadores
CREATE TRIGGER update_trabajadores_updated_at
  BEFORE UPDATE ON public.trabajadores
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Trigger para actualizar updated_at en turnos
CREATE TRIGGER update_turnos_updated_at
  BEFORE UPDATE ON public.turnos
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Función para calcular horas trabajadas automáticamente
CREATE OR REPLACE FUNCTION public.calcular_horas_trabajadas()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.hora_salida IS NOT NULL THEN
    NEW.horas_trabajadas := EXTRACT(EPOCH FROM (NEW.hora_salida - NEW.hora_entrada)) / 3600;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_calcular_horas
  BEFORE INSERT OR UPDATE ON public.registro_horas
  FOR EACH ROW
  EXECUTE FUNCTION public.calcular_horas_trabajadas();

-- RLS Policies
ALTER TABLE public.trabajadores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.turnos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asignaciones_sala ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registro_horas ENABLE ROW LEVEL SECURITY;

-- Políticas para trabajadores
CREATE POLICY "Solo usuarios autenticados pueden ver trabajadores"
ON public.trabajadores FOR SELECT
TO authenticated
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Solo usuarios autenticados pueden crear trabajadores"
ON public.trabajadores FOR INSERT
TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Solo usuarios autenticados pueden actualizar trabajadores"
ON public.trabajadores FOR UPDATE
TO authenticated
USING (auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Solo usuarios autenticados pueden eliminar trabajadores"
ON public.trabajadores FOR DELETE
TO authenticated
USING (auth.uid() IS NOT NULL);

-- Políticas para turnos
CREATE POLICY "Solo usuarios autenticados pueden ver turnos"
ON public.turnos FOR SELECT
TO authenticated
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Solo usuarios autenticados pueden crear turnos"
ON public.turnos FOR INSERT
TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Solo usuarios autenticados pueden actualizar turnos"
ON public.turnos FOR UPDATE
TO authenticated
USING (auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Solo usuarios autenticados pueden eliminar turnos"
ON public.turnos FOR DELETE
TO authenticated
USING (auth.uid() IS NOT NULL);

-- Políticas para asignaciones_sala
CREATE POLICY "Solo usuarios autenticados pueden ver asignaciones"
ON public.asignaciones_sala FOR SELECT
TO authenticated
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Solo usuarios autenticados pueden crear asignaciones"
ON public.asignaciones_sala FOR INSERT
TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Solo usuarios autenticados pueden eliminar asignaciones"
ON public.asignaciones_sala FOR DELETE
TO authenticated
USING (auth.uid() IS NOT NULL);

-- Políticas para registro_horas
CREATE POLICY "Solo usuarios autenticados pueden ver registro de horas"
ON public.registro_horas FOR SELECT
TO authenticated
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Solo usuarios autenticados pueden crear registros"
ON public.registro_horas FOR INSERT
TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Solo usuarios autenticados pueden actualizar registros"
ON public.registro_horas FOR UPDATE
TO authenticated
USING (auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() IS NOT NULL);

-- Vista para turnos con información completa
CREATE VIEW public.vista_turnos_completa AS
SELECT 
  t.id,
  t.fecha,
  t.hora_inicio,
  t.hora_fin,
  t.estado,
  t.notas,
  tr.nombre || ' ' || tr.apellidos AS trabajador_nombre,
  tr.puesto,
  tr.id AS trabajador_id,
  ARRAY_AGG(s.nombre) FILTER (WHERE s.nombre IS NOT NULL) AS salas_asignadas,
  ARRAY_AGG(s.id) FILTER (WHERE s.id IS NOT NULL) AS salas_ids
FROM public.turnos t
JOIN public.trabajadores tr ON t.trabajador_id = tr.id
LEFT JOIN public.asignaciones_sala a ON t.id = a.turno_id
LEFT JOIN public.salas s ON a.sala_id = s.id
GROUP BY t.id, tr.id, tr.nombre, tr.apellidos, tr.puesto;

ALTER VIEW public.vista_turnos_completa SET (security_invoker = true);