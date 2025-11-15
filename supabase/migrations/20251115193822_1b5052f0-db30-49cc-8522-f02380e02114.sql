-- Crear tabla para almacenar imágenes en base64
CREATE TABLE public.imagenes_base64 (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre TEXT NOT NULL,
  contenido_base64 TEXT NOT NULL,
  tipo_mime TEXT NOT NULL,
  tamano_bytes BIGINT,
  categoria TEXT,
  descripcion TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Habilitar Row Level Security
ALTER TABLE public.imagenes_base64 ENABLE ROW LEVEL SECURITY;

-- Políticas RLS: Usuarios autenticados pueden ver todas las imágenes
CREATE POLICY "Usuarios autenticados pueden ver imágenes"
ON public.imagenes_base64
FOR SELECT
USING (auth.uid() IS NOT NULL);

-- Usuarios autenticados pueden crear imágenes
CREATE POLICY "Usuarios autenticados pueden crear imágenes"
ON public.imagenes_base64
FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

-- Usuarios autenticados pueden actualizar imágenes
CREATE POLICY "Usuarios autenticados pueden actualizar imágenes"
ON public.imagenes_base64
FOR UPDATE
USING (auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() IS NOT NULL);

-- Usuarios autenticados pueden eliminar imágenes
CREATE POLICY "Usuarios autenticados pueden eliminar imágenes"
ON public.imagenes_base64
FOR DELETE
USING (auth.uid() IS NOT NULL);

-- Trigger para actualizar updated_at automáticamente
CREATE TRIGGER update_imagenes_base64_updated_at
BEFORE UPDATE ON public.imagenes_base64
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Índices para mejorar el rendimiento
CREATE INDEX idx_imagenes_base64_categoria ON public.imagenes_base64(categoria);
CREATE INDEX idx_imagenes_base64_created_at ON public.imagenes_base64(created_at DESC);