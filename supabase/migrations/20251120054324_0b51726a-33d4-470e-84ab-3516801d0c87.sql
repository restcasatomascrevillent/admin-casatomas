-- Tabla para almacenar configuración de redes sociales
CREATE TABLE IF NOT EXISTS public.config_redes_sociales (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  red_social TEXT NOT NULL CHECK (red_social IN ('facebook', 'instagram')),
  access_token TEXT,
  page_id TEXT,
  account_id TEXT,
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, red_social)
);

-- Tabla para publicaciones en redes sociales
CREATE TABLE IF NOT EXISTS public.publicaciones_redes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  red_social TEXT NOT NULL CHECK (red_social IN ('facebook', 'instagram', 'ambas')),
  contenido TEXT NOT NULL,
  imagen_url TEXT,
  estado TEXT DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'publicado', 'error', 'programado')),
  fecha_publicacion TIMESTAMPTZ,
  fecha_programada TIMESTAMPTZ,
  post_id_facebook TEXT,
  post_id_instagram TEXT,
  error_mensaje TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Tabla para estadísticas de redes sociales
CREATE TABLE IF NOT EXISTS public.estadisticas_redes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  red_social TEXT NOT NULL CHECK (red_social IN ('facebook', 'instagram')),
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  seguidores INTEGER DEFAULT 0,
  alcance INTEGER DEFAULT 0,
  engagement_rate DECIMAL(5,2) DEFAULT 0,
  publicaciones_mes INTEGER DEFAULT 0,
  likes_totales INTEGER DEFAULT 0,
  comentarios_totales INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, red_social, fecha)
);

-- Habilitar RLS
ALTER TABLE public.config_redes_sociales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publicaciones_redes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estadisticas_redes ENABLE ROW LEVEL SECURITY;

-- Políticas RLS para config_redes_sociales
CREATE POLICY "Los usuarios pueden ver su propia configuración"
  ON public.config_redes_sociales FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden insertar su propia configuración"
  ON public.config_redes_sociales FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden actualizar su propia configuración"
  ON public.config_redes_sociales FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden eliminar su propia configuración"
  ON public.config_redes_sociales FOR DELETE
  USING (auth.uid() = user_id);

-- Políticas RLS para publicaciones_redes
CREATE POLICY "Los usuarios pueden ver sus propias publicaciones"
  ON public.publicaciones_redes FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden crear sus propias publicaciones"
  ON public.publicaciones_redes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden actualizar sus propias publicaciones"
  ON public.publicaciones_redes FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden eliminar sus propias publicaciones"
  ON public.publicaciones_redes FOR DELETE
  USING (auth.uid() = user_id);

-- Políticas RLS para estadisticas_redes
CREATE POLICY "Los usuarios pueden ver sus propias estadísticas"
  ON public.estadisticas_redes FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden insertar sus propias estadísticas"
  ON public.estadisticas_redes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Trigger para actualizar updated_at
CREATE TRIGGER update_config_redes_sociales_updated_at
  BEFORE UPDATE ON public.config_redes_sociales
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_publicaciones_redes_updated_at
  BEFORE UPDATE ON public.publicaciones_redes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_estadisticas_redes_updated_at
  BEFORE UPDATE ON public.estadisticas_redes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Índices para mejorar rendimiento
CREATE INDEX idx_publicaciones_redes_user_id ON public.publicaciones_redes(user_id);
CREATE INDEX idx_publicaciones_redes_estado ON public.publicaciones_redes(estado);
CREATE INDEX idx_estadisticas_redes_user_id ON public.estadisticas_redes(user_id);
CREATE INDEX idx_estadisticas_redes_fecha ON public.estadisticas_redes(fecha);