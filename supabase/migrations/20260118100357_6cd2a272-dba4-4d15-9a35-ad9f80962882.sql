-- Hacer el bucket novedades público
UPDATE storage.buckets 
SET public = true 
WHERE id = 'novedades';

-- Política para permitir a usuarios autenticados subir archivos
CREATE POLICY "Usuarios autenticados pueden subir novedades"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'novedades');

-- Política para permitir a usuarios autenticados actualizar sus archivos
CREATE POLICY "Usuarios autenticados pueden actualizar novedades"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'novedades');

-- Política para permitir a usuarios autenticados eliminar archivos
CREATE POLICY "Usuarios autenticados pueden eliminar novedades"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'novedades');

-- Política para lectura pública
CREATE POLICY "Lectura pública de novedades"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'novedades');