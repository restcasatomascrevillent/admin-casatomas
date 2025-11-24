-- Crear tabla para historial de ajustes de precios
CREATE TABLE IF NOT EXISTS public.historial_ajustes_precios (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  fecha timestamp with time zone NOT NULL DEFAULT now(),
  tipo_carta text NOT NULL, -- 'platos', 'bebidas', 'vinos'
  categoria text NOT NULL, -- nombre de categoría o 'todas'
  porcentaje numeric NOT NULL,
  items_afectados integer NOT NULL DEFAULT 0,
  snapshot jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{id, nombre, precio_anterior, precio_nuevo}]
  user_id uuid REFERENCES auth.users(id),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Índices para mejorar rendimiento
CREATE INDEX idx_historial_ajustes_fecha ON public.historial_ajustes_precios(fecha DESC);
CREATE INDEX idx_historial_ajustes_tipo ON public.historial_ajustes_precios(tipo_carta);
CREATE INDEX idx_historial_ajustes_user ON public.historial_ajustes_precios(user_id);

-- RLS policies
ALTER TABLE public.historial_ajustes_precios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuarios autenticados pueden ver historial"
  ON public.historial_ajustes_precios
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Usuarios autenticados pueden crear entradas en historial"
  ON public.historial_ajustes_precios
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Usuarios autenticados pueden eliminar historial"
  ON public.historial_ajustes_precios
  FOR DELETE
  USING (auth.uid() IS NOT NULL);