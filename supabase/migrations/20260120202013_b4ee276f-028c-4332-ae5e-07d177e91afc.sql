-- Crear tabla Cocteles
CREATE TABLE public."Cocteles" (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  nombre text,
  categoria text,
  precio_eur double precision,
  descripcion text,
  ingredientes text,
  preparacion text,
  alergenos_oficiales jsonb,
  alergenos_notas text,
  activado boolean DEFAULT true,
  orden bigint,
  imagen_url text,
  traducciones jsonb DEFAULT '{}'::jsonb,
  nombre_en text,
  categoria_en text,
  descripcion_en text,
  ingredientes_en text,
  nombre_fr text,
  categoria_fr text,
  descripcion_fr text,
  ingredientes_fr text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Trigger para updated_at
CREATE TRIGGER update_cocteles_updated_at
  BEFORE UPDATE ON public."Cocteles"
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Habilitar RLS
ALTER TABLE public."Cocteles" ENABLE ROW LEVEL SECURITY;

-- Público puede ver cócteles activos (para web externa Touza)
CREATE POLICY "Público puede ver cocteles activos" 
  ON public."Cocteles" FOR SELECT 
  USING (activado = true);

-- Usuarios autenticados pueden ver todos
CREATE POLICY "Usuarios autenticados pueden ver todos los cocteles" 
  ON public."Cocteles" FOR SELECT 
  TO authenticated
  USING (true);

-- CRUD para autenticados
CREATE POLICY "Usuarios autenticados pueden crear cocteles" 
  ON public."Cocteles" FOR INSERT 
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Usuarios autenticados pueden actualizar cocteles" 
  ON public."Cocteles" FOR UPDATE 
  TO authenticated
  USING (true);

CREATE POLICY "Usuarios autenticados pueden eliminar cocteles" 
  ON public."Cocteles" FOR DELETE 
  TO authenticated
  USING (true);

-- Crear bucket de storage para cocteles
INSERT INTO storage.buckets (id, name, public)
VALUES ('cocteles', 'cocteles', true);

-- Políticas de storage
CREATE POLICY "Público puede ver imágenes cocteles"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'cocteles');

CREATE POLICY "Autenticados pueden subir imágenes cocteles"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'cocteles');

CREATE POLICY "Autenticados pueden actualizar imágenes cocteles"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'cocteles');

CREATE POLICY "Autenticados pueden eliminar imágenes cocteles"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'cocteles');