-- ROLLBACK de 20261103090000_temp_pdfs_sin_subida_anonima.sql.
-- Aplicar a mano SOLO si un flujo externo necesitara de nuevo subir a
-- temp-pdfs con la clave pública (no hay ninguno conocido). Vuelve a abrir la
-- subida y la lectura anónimas tal como estaban.
begin;
drop policy if exists "Allow anon uploads to temp-pdfs" on storage.objects;
create policy "Allow anon uploads to temp-pdfs" on storage.objects
  for insert to anon with check (bucket_id = 'temp-pdfs');
drop policy if exists "Allow public read from temp-pdfs" on storage.objects;
create policy "Allow public read from temp-pdfs" on storage.objects
  for select to anon using (bucket_id = 'temp-pdfs');
commit;
