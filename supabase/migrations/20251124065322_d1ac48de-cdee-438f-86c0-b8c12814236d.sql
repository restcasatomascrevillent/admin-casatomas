-- Añadir campos para integración con Google Reviews
ALTER TABLE public.resenas
ADD COLUMN google_review_id TEXT,
ADD COLUMN google_rating NUMERIC(2,1),
ADD COLUMN respuesta TEXT,
ADD COLUMN fecha_respuesta TIMESTAMP WITH TIME ZONE;

-- Crear índice para búsquedas más rápidas
CREATE INDEX idx_resenas_google_review_id ON public.resenas(google_review_id);

-- Añadir configuración para Google Places
CREATE TABLE public.config_google_places (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id TEXT NOT NULL,
  place_name TEXT NOT NULL,
  direccion TEXT,
  telefono TEXT,
  website TEXT,
  rating_promedio NUMERIC(2,1),
  total_resenas INTEGER DEFAULT 0,
  ultima_sincronizacion TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.config_google_places ENABLE ROW LEVEL SECURITY;

-- Policies para config_google_places
CREATE POLICY "Usuarios autenticados pueden ver configuración Google"
  ON public.config_google_places FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Usuarios autenticados pueden crear configuración Google"
  ON public.config_google_places FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Usuarios autenticados pueden actualizar configuración Google"
  ON public.config_google_places FOR UPDATE
  USING (auth.uid() IS NOT NULL);

-- Trigger para actualizar updated_at
CREATE TRIGGER update_config_google_places_updated_at
  BEFORE UPDATE ON public.config_google_places
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();