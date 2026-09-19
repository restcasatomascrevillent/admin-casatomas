-- Crear tabla para noticias del sector hostelería
CREATE TABLE public.noticias_hosteleria (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  titulo TEXT NOT NULL,
  fuente TEXT NOT NULL,
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  categoria TEXT NOT NULL,
  enlace TEXT NOT NULL,
  descripcion TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Habilitar RLS
ALTER TABLE public.noticias_hosteleria ENABLE ROW LEVEL SECURITY;

-- Política: cualquier usuario autenticado puede ver las noticias
CREATE POLICY "Usuarios autenticados pueden ver noticias"
ON public.noticias_hosteleria
FOR SELECT
USING (auth.uid() IS NOT NULL);

-- Política: solo el backend (service role) puede insertar/actualizar/eliminar
-- Las operaciones de escritura se harán desde el backend con service_role key

-- Trigger para updated_at
CREATE TRIGGER update_noticias_hosteleria_updated_at
BEFORE UPDATE ON public.noticias_hosteleria
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Índice para búsquedas por fecha (mejora rendimiento del filtro de 2 semanas)
CREATE INDEX idx_noticias_hosteleria_fecha ON public.noticias_hosteleria(fecha DESC);