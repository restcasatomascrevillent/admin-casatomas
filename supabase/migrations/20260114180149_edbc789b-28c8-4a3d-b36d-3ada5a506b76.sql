-- Crear tabla novedades
CREATE TABLE public.novedades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Información básica
  titulo TEXT NOT NULL,
  descripcion TEXT,
  imagen_url TEXT,
  
  -- Asociaciones (nullable - puede ser independiente)
  tipo_asociacion TEXT CHECK (tipo_asociacion IN ('plato', 'vino', 'bebida', 'seccion', NULL)),
  plato_id TEXT REFERENCES public."Platos"(id) ON DELETE SET NULL,
  vino_id TEXT REFERENCES public."Vinos"(id) ON DELETE SET NULL,
  bebida_id TEXT REFERENCES public."Bebidas"(id) ON DELETE SET NULL,
  seccion TEXT,
  
  -- Vigencia
  fecha_inicio DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_fin DATE,
  
  -- Estado
  activo BOOLEAN DEFAULT true,
  destacado BOOLEAN DEFAULT false,
  orden INTEGER DEFAULT 0,
  
  -- Traducciones
  titulo_en TEXT,
  titulo_fr TEXT,
  descripcion_en TEXT,
  descripcion_fr TEXT,
  
  -- Auditoría
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

-- Índices para rendimiento
CREATE INDEX idx_novedades_activo ON public.novedades(activo);
CREATE INDEX idx_novedades_fechas ON public.novedades(fecha_inicio, fecha_fin);
CREATE INDEX idx_novedades_tipo ON public.novedades(tipo_asociacion);

-- Habilitar RLS
ALTER TABLE public.novedades ENABLE ROW LEVEL SECURITY;

-- Políticas RLS
CREATE POLICY "Usuarios autenticados pueden ver novedades"
ON public.novedades FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Usuarios autenticados pueden crear novedades"
ON public.novedades FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Usuarios autenticados pueden actualizar novedades"
ON public.novedades FOR UPDATE
USING (auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Usuarios autenticados pueden eliminar novedades"
ON public.novedades FOR DELETE
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Público puede ver novedades activas vigentes"
ON public.novedades FOR SELECT
USING (
  activo = true 
  AND fecha_inicio <= CURRENT_DATE 
  AND (fecha_fin IS NULL OR fecha_fin >= CURRENT_DATE)
);

-- Trigger para updated_at
CREATE TRIGGER update_novedades_updated_at
BEFORE UPDATE ON public.novedades
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();