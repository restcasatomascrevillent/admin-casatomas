-- Hacer públicos los storage buckets de imágenes del menú
UPDATE storage.buckets
SET public = true
WHERE name IN ('platos', 'plato');

-- Verificar políticas de storage para imágenes públicas
-- Las imágenes de platos/vinos/bebidas deben ser accesibles públicamente

-- Política para leer imágenes públicas de platos
DROP POLICY IF EXISTS "Public can view platos images" ON storage.objects;
CREATE POLICY "Public can view platos images"
ON storage.objects FOR SELECT
USING (bucket_id IN ('platos', 'plato'));

-- Solo usuarios autenticados pueden subir/modificar imágenes
DROP POLICY IF EXISTS "Authenticated users can upload platos images" ON storage.objects;
CREATE POLICY "Authenticated users can upload platos images"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id IN ('platos', 'plato') 
  AND auth.uid() IS NOT NULL
);

DROP POLICY IF EXISTS "Authenticated users can update platos images" ON storage.objects;
CREATE POLICY "Authenticated users can update platos images"
ON storage.objects FOR UPDATE
USING (
  bucket_id IN ('platos', 'plato') 
  AND auth.uid() IS NOT NULL
);

DROP POLICY IF EXISTS "Authenticated users can delete platos images" ON storage.objects;
CREATE POLICY "Authenticated users can delete platos images"
ON storage.objects FOR DELETE
USING (
  bucket_id IN ('platos', 'plato') 
  AND auth.uid() IS NOT NULL
);