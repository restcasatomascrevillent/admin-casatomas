-- temp-pdfs: sin subida ni lectura anónimas — 03/11/2026
-- ---------------------------------------------------------------------------
-- La auditoría de QA del 02/11/2026 vio que en la demo y en producción
-- cualquiera, solo con la clave pública (anon), podía SUBIR ficheros de hasta
-- 50 MB al bucket público `temp-pdfs` y leerlos. Nadie lo usa: 0 objetos y
-- ninguna referencia en el código de la web ni del panel (era del OCR viejo de
-- n8n; hoy procesar-factura guarda en `facturas-originales` con service role).
-- Abierto así, servía para gastar el cupo gratuito de almacenamiento y de
-- descarga de Supabase o para alojar ficheros ajenos en nuestro dominio.
--
-- Es la parte `temp-pdfs` de 20261001190000_storage_agujeros_menores.sql, que
-- nunca se aplicó en los proyectos nuevos; esta migración la aplica sola, sin
-- tocar el resto. Solo quita dos políticas de storage.objects: no borra el
-- bucket ni objetos, ni cambia su flag public. «Allow service role delete from
-- temp-pdfs» se queda.
--
-- Idempotente. ROLLBACK: supabase/rollbacks/20261103090000_temp_pdfs_sin_subida_anonima_ROLLBACK.sql
-- ---------------------------------------------------------------------------

drop policy if exists "Allow anon uploads to temp-pdfs" on storage.objects;
drop policy if exists "Allow public read from temp-pdfs" on storage.objects;
