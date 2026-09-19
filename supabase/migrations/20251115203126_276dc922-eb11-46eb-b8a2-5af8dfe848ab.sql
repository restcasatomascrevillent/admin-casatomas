-- Crear políticas para permitir a usuarios autenticados subir/actualizar/eliminar imágenes en bucket 'platos'
CREATE POLICY "Usuarios autenticados pueden subir imágenes de platos"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'platos');

CREATE POLICY "Usuarios autenticados pueden actualizar imágenes de platos"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'platos')
WITH CHECK (bucket_id = 'platos');

CREATE POLICY "Usuarios autenticados pueden eliminar imágenes de platos"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'platos');

-- Crear políticas para permitir a usuarios autenticados subir/actualizar/eliminar imágenes en bucket 'salas'
CREATE POLICY "Usuarios autenticados pueden subir imágenes de salas"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'salas');

CREATE POLICY "Usuarios autenticados pueden actualizar imágenes de salas"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'salas')
WITH CHECK (bucket_id = 'salas');

CREATE POLICY "Usuarios autenticados pueden eliminar imágenes de salas"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'salas');

-- Permitir acceso público de lectura a las imágenes
CREATE POLICY "Acceso público a imágenes de platos"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'platos');

CREATE POLICY "Acceso público a imágenes de salas"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'salas');