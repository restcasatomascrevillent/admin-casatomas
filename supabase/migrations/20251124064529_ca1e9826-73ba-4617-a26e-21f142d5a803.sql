-- Tabla para configuraciones de dashboard por usuario
CREATE TABLE public.dashboard_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  nombre_vista TEXT NOT NULL,
  widgets_activos JSONB NOT NULL DEFAULT '[]'::jsonb,
  orden_widgets JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(user_id, nombre_vista)
);

-- Tabla para reseñas del restaurante
CREATE TABLE public.resenas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre_cliente TEXT NOT NULL,
  email TEXT,
  valoracion INTEGER NOT NULL CHECK (valoracion >= 1 AND valoracion <= 5),
  comentario TEXT,
  fuente TEXT DEFAULT 'web',
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  estado TEXT DEFAULT 'publicada' CHECK (estado IN ('publicada', 'pendiente', 'oculta')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Tabla para campañas de marketing
CREATE TABLE public.campanas_marketing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL,
  canal TEXT NOT NULL,
  estado TEXT DEFAULT 'activa' CHECK (estado IN ('activa', 'pausada', 'finalizada')),
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE,
  clics INTEGER DEFAULT 0,
  reservas_generadas INTEGER DEFAULT 0,
  visitas_web INTEGER DEFAULT 0,
  presupuesto NUMERIC(10,2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.dashboard_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resenas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campanas_marketing ENABLE ROW LEVEL SECURITY;

-- Policies para dashboard_config
CREATE POLICY "Usuarios pueden ver su propia configuración"
  ON public.dashboard_config FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Usuarios pueden crear su propia configuración"
  ON public.dashboard_config FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Usuarios pueden actualizar su propia configuración"
  ON public.dashboard_config FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Usuarios pueden eliminar su propia configuración"
  ON public.dashboard_config FOR DELETE
  USING (auth.uid() = user_id);

-- Policies para reseñas
CREATE POLICY "Usuarios autenticados pueden ver reseñas"
  ON public.resenas FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Usuarios autenticados pueden crear reseñas"
  ON public.resenas FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Usuarios autenticados pueden actualizar reseñas"
  ON public.resenas FOR UPDATE
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Usuarios autenticados pueden eliminar reseñas"
  ON public.resenas FOR DELETE
  USING (auth.uid() IS NOT NULL);

-- Policies para campañas
CREATE POLICY "Usuarios autenticados pueden ver campañas"
  ON public.campanas_marketing FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Usuarios autenticados pueden crear campañas"
  ON public.campanas_marketing FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Usuarios autenticados pueden actualizar campañas"
  ON public.campanas_marketing FOR UPDATE
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Usuarios autenticados pueden eliminar campañas"
  ON public.campanas_marketing FOR DELETE
  USING (auth.uid() IS NOT NULL);

-- Trigger para actualizar updated_at
CREATE TRIGGER update_dashboard_config_updated_at
  BEFORE UPDATE ON public.dashboard_config
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_resenas_updated_at
  BEFORE UPDATE ON public.resenas
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_campanas_marketing_updated_at
  BEFORE UPDATE ON public.campanas_marketing
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();