-- Crear bucket para bebidas
INSERT INTO storage.buckets (id, name, public)
VALUES ('bebidas', 'bebidas', true)
ON CONFLICT (id) DO NOTHING;

-- Crear bucket para vinos
INSERT INTO storage.buckets (id, name, public)
VALUES ('vinos', 'vinos', true)
ON CONFLICT (id) DO NOTHING;

-- Políticas RLS para bebidas
CREATE POLICY "Allow public read bebidas" ON storage.objects
  FOR SELECT USING (bucket_id = 'bebidas');

CREATE POLICY "Allow authenticated upload bebidas" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'bebidas' AND auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated update bebidas" ON storage.objects
  FOR UPDATE USING (bucket_id = 'bebidas' AND auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated delete bebidas" ON storage.objects
  FOR DELETE USING (bucket_id = 'bebidas' AND auth.role() = 'authenticated');

-- Políticas RLS para vinos
CREATE POLICY "Allow public read vinos" ON storage.objects
  FOR SELECT USING (bucket_id = 'vinos');

CREATE POLICY "Allow authenticated upload vinos" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'vinos' AND auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated update vinos" ON storage.objects
  FOR UPDATE USING (bucket_id = 'vinos' AND auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated delete vinos" ON storage.objects
  FOR DELETE USING (bucket_id = 'vinos' AND auth.role() = 'authenticated');