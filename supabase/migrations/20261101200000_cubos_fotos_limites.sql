-- Límites de tamaño y tipo en los cubos de fotos (revisión QA, tanda 1, A1).
--
-- Hasta ahora ningún cubo de contenido tenía file_size_limit ni
-- allowed_mime_types (ver nota 3 de 20261001190000): la UI validaba 5 MB e
-- imagen, la API no. Así llegó a producción un .exe de 30 MB como «foto» de
-- un plato. Con esto lo rechaza Storage, se suba por donde se suba.
--
--   vinos, bebidas, cocteles, novedades → JPG/PNG/WebP, 5 MB.
--   platos → JPG/PNG/WebP y los vídeos del plato, 50 MB.
--
-- POR QUÉ platos es distinto: en ese cubo también están los vídeos del plato
-- (`<id>-video.mp4|webm`, el original en `videos-originales/` y el bruto del
-- flujo «dispositivo potente» en `pendientes/`, ver 20261101120000 y
-- 20261101160000). El bruto puede pesar hasta 50 MB (MAX_BYTES_BRUTO en
-- colaPendientes.ts, el máximo del plan gratuito) y llega como mp4, mov,
-- m4v, webm, 3gp o mkv (tipoMimeBruto). Storage solo admite un límite por
-- cubo, así que limitar platos a 5 MB e imágenes rompería los vídeos. Aquí
-- se cierra lo que no es imagen ni vídeo (el .exe ya no entra) y el panel
-- valida los 5 MB de las fotos. Cerrar también el tamaño de las fotos de
-- platos en el servidor pide mover los vídeos a un cubo propio.
--
-- Idempotente; solo toca cubos que existan. No borra ni cambia ficheros:
-- los límites solo se aplican a las subidas nuevas.

update storage.buckets
   set file_size_limit    = 5242880,  -- 5 MB
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id in ('vinos', 'bebidas', 'cocteles', 'novedades');

update storage.buckets
   set file_size_limit    = 52428800, -- 50 MB (vídeo en bruto)
       allowed_mime_types = array[
         'image/jpeg', 'image/png', 'image/webp',
         'video/mp4', 'video/webm', 'video/quicktime', 'video/3gpp', 'video/x-matroska'
       ]
 where id = 'platos';

-- VERIFICACIÓN:
--   select id, file_size_limit, allowed_mime_types from storage.buckets
--    where id in ('platos','vinos','bebidas','cocteles','novedades') order by 1;
--   -- platos 52428800 (imágenes + vídeo); el resto 5242880 {image/jpeg,image/png,image/webp}
--
-- ROLLBACK (manual):
--   update storage.buckets set file_size_limit = null, allowed_mime_types = null
--    where id in ('platos','vinos','bebidas','cocteles','novedades');
