-- Tabla para mesas de cada espacio
CREATE TABLE public.mesas (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  espacio_id UUID NOT NULL REFERENCES public.espacios_reserva(id) ON DELETE CASCADE,
  nombre VARCHAR(50) NOT NULL,
  capacidad INTEGER NOT NULL DEFAULT 4,
  forma VARCHAR(20) NOT NULL DEFAULT 'rectangular', -- rectangular, circular, cuadrada
  ancho NUMERIC(5,2) DEFAULT 100, -- en píxeles para el plano
  alto NUMERIC(5,2) DEFAULT 80,
  pos_x NUMERIC(8,2) DEFAULT 0,
  pos_y NUMERIC(8,2) DEFAULT 0,
  rotacion NUMERIC(5,2) DEFAULT 0, -- grados
  activa BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Tabla para asignaciones de reservas a mesas
CREATE TABLE public.asignaciones_mesa (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  reserva_id UUID NOT NULL REFERENCES public.reservas(id) ON DELETE CASCADE,
  mesa_id UUID NOT NULL REFERENCES public.mesas(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(reserva_id, mesa_id)
);

-- Tabla para configuración del plano de cada espacio
CREATE TABLE public.planos_espacio (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  espacio_id UUID NOT NULL REFERENCES public.espacios_reserva(id) ON DELETE CASCADE UNIQUE,
  ancho NUMERIC(8,2) DEFAULT 800, -- ancho del canvas
  alto NUMERIC(8,2) DEFAULT 600,  -- alto del canvas
  metros_cuadrados NUMERIC(8,2),
  configuracion JSONB DEFAULT '{}', -- configuración adicional (paredes, decoración, etc.)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Habilitar RLS
ALTER TABLE public.mesas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asignaciones_mesa ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planos_espacio ENABLE ROW LEVEL SECURITY;

-- Políticas para mesas
CREATE POLICY "Usuarios autenticados pueden ver mesas"
  ON public.mesas FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Usuarios autenticados pueden crear mesas"
  ON public.mesas FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Usuarios autenticados pueden actualizar mesas"
  ON public.mesas FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Usuarios autenticados pueden eliminar mesas"
  ON public.mesas FOR DELETE
  USING (auth.uid() IS NOT NULL);

-- Políticas para asignaciones_mesa
CREATE POLICY "Usuarios autenticados pueden ver asignaciones"
  ON public.asignaciones_mesa FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Usuarios autenticados pueden crear asignaciones"
  ON public.asignaciones_mesa FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Usuarios autenticados pueden actualizar asignaciones"
  ON public.asignaciones_mesa FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Usuarios autenticados pueden eliminar asignaciones"
  ON public.asignaciones_mesa FOR DELETE
  USING (auth.uid() IS NOT NULL);

-- Políticas para planos_espacio
CREATE POLICY "Usuarios autenticados pueden ver planos"
  ON public.planos_espacio FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Usuarios autenticados pueden crear planos"
  ON public.planos_espacio FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Usuarios autenticados pueden actualizar planos"
  ON public.planos_espacio FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Usuarios autenticados pueden eliminar planos"
  ON public.planos_espacio FOR DELETE
  USING (auth.uid() IS NOT NULL);

-- Triggers para updated_at
CREATE TRIGGER update_mesas_updated_at
  BEFORE UPDATE ON public.mesas
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_planos_espacio_updated_at
  BEFORE UPDATE ON public.planos_espacio
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Vista para ocupación por espacio hoy
CREATE OR REPLACE VIEW public.vista_ocupacion_hoy AS
SELECT 
  e.id as espacio_id,
  e.nombre as espacio_nombre,
  e.capacidad_maxima,
  COUNT(r.id) as total_reservas,
  COALESCE(SUM(r.numero_comensales), 0) as total_comensales,
  ROUND(
    CASE 
      WHEN e.capacidad_maxima > 0 
      THEN (COALESCE(SUM(r.numero_comensales), 0)::numeric / e.capacidad_maxima * 100)
      ELSE 0 
    END, 1
  ) as porcentaje_ocupacion
FROM public.espacios_reserva e
LEFT JOIN public.reservas r ON r.sala_id = e.id 
  AND r.fecha = CURRENT_DATE 
  AND r.estado NOT IN ('cancelada')
WHERE e.activa = true
GROUP BY e.id, e.nombre, e.capacidad_maxima;