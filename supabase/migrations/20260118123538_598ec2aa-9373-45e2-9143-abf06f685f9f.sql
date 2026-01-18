-- Añadir columnas para bullets y tags en novedades
ALTER TABLE public.novedades 
ADD COLUMN IF NOT EXISTS bullets text[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}';