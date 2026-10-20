-- Añadir columnas para mesas agrupadas
ALTER TABLE public.mesas
ADD COLUMN IF NOT EXISTS is_merged boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS original_mesas jsonb DEFAULT NULL;

-- Comentarios para documentación
COMMENT ON COLUMN public.mesas.is_merged IS 'Indica si esta mesa es resultado de fusionar otras mesas';
COMMENT ON COLUMN public.mesas.original_mesas IS 'JSON con los datos de las mesas originales para poder desagrupar';