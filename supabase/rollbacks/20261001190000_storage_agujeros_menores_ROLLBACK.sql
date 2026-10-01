set client_encoding = 'UTF8';
-- (Primera línea a propósito: recrea políticas con tilde en el nombre.)
-- ===========================================================================
-- ROLLBACK de supabase/migrations/20261001190000_storage_agujeros_menores.sql
-- ===========================================================================
--
-- Este fichero NO es una migración y no debe copiarse a
-- supabase/migrations/ (ver supabase/rollbacks/README.md). Se ejecuta A MANO
-- y solo para deshacer un despliegue que salió mal:
--   npx supabase db query --linked -f supabase/rollbacks/20261001190000_storage_agujeros_menores_ROLLBACK.sql
--
-- AVISO: ESTO REABRE LOS CUATRO AGUJEROS:
--   · anon vuelve a poder LISTAR/descargar por API el bucket privado `salas`
--     y cualquier autenticado a subir/cambiar/borrar en él;
--   · anon vuelve a poder SUBIR PDFs de hasta 50 MB a `temp-pdfs` (bucket
--     público: se servirían desde nuestro dominio de Supabase) y a listarlos;
--   · cualquier autenticado, sin sección, vuelve a escribir en `novedades`
--     (fotos de la web y del menú del día) y en `ecommerce`;
--   · anon vuelve a poder LISTAR por API los buckets de contenido.
-- Antes de ejecutarlo, piensa si basta con añadir UNA política acotada al
-- flujo que se haya roto (p. ej. una SELECT TO anon de un bucket concreto, o
-- devolver solo «Allow anon uploads to temp-pdfs» si apareció un flujo
-- externo que lo usa).
--
-- Recrea EXACTAMENTE las 25 políticas de producción del 2026-10-01
-- (sentencias generadas desde pg_policies con format(), no reescritas a
-- mano) y borra las 7 que creó la migración. No hay datos que perder ni
-- recuperar: ni la migración ni esto tocan objetos ni buckets. No hace falta
-- revertir ningún frontend.
--
-- Idempotente: cada política se borra (if exists) y se vuelve a crear igual;
-- si la migración no estaba aplicada, el resultado es el estado de antes.
-- lock_timeout = 5s: un 55P03 significa que no se ha deshecho nada y se
-- reintenta.
-- ===========================================================================

begin;

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Borrar las 7 nuevas
-- ---------------------------------------------------------------------------
drop policy if exists novedades_imagenes_insert_seccion on storage.objects;
drop policy if exists novedades_imagenes_update_seccion on storage.objects;
drop policy if exists novedades_imagenes_delete_seccion on storage.objects;
drop policy if exists ecommerce_imagenes_insert_seccion on storage.objects;
drop policy if exists ecommerce_imagenes_update_seccion on storage.objects;
drop policy if exists ecommerce_imagenes_delete_seccion on storage.objects;
drop policy if exists contenido_lectura_autenticados   on storage.objects;

-- ---------------------------------------------------------------------------
-- 2. Recrear las 25 de antes, verbatim (drop if exists + create)
-- ---------------------------------------------------------------------------

-- salas
drop policy if exists "Acceso público a imágenes de salas" on storage.objects;
create policy "Acceso público a imágenes de salas" on storage.objects as PERMISSIVE for SELECT to public
  using ((bucket_id = 'salas'::text));
drop policy if exists "Usuarios autenticados pueden subir imágenes de salas" on storage.objects;
create policy "Usuarios autenticados pueden subir imágenes de salas" on storage.objects as PERMISSIVE for INSERT to authenticated
  with check ((bucket_id = 'salas'::text));
drop policy if exists "Usuarios autenticados pueden actualizar imágenes de salas" on storage.objects;
create policy "Usuarios autenticados pueden actualizar imágenes de salas" on storage.objects as PERMISSIVE for UPDATE to authenticated
  using ((bucket_id = 'salas'::text))
  with check ((bucket_id = 'salas'::text));
drop policy if exists "Usuarios autenticados pueden eliminar imágenes de salas" on storage.objects;
create policy "Usuarios autenticados pueden eliminar imágenes de salas" on storage.objects as PERMISSIVE for DELETE to authenticated
  using ((bucket_id = 'salas'::text));

-- temp-pdfs
drop policy if exists "Allow anon uploads to temp-pdfs" on storage.objects;
create policy "Allow anon uploads to temp-pdfs" on storage.objects as PERMISSIVE for INSERT to anon
  with check ((bucket_id = 'temp-pdfs'::text));
drop policy if exists "Allow public read from temp-pdfs" on storage.objects;
create policy "Allow public read from temp-pdfs" on storage.objects as PERMISSIVE for SELECT to anon
  using ((bucket_id = 'temp-pdfs'::text));

-- novedades (dos juegos)
drop policy if exists "Usuarios autenticados pueden subir novedades" on storage.objects;
create policy "Usuarios autenticados pueden subir novedades" on storage.objects as PERMISSIVE for INSERT to authenticated
  with check ((bucket_id = 'novedades'::text));
drop policy if exists "Usuarios autenticados pueden subir a novedades" on storage.objects;
create policy "Usuarios autenticados pueden subir a novedades" on storage.objects as PERMISSIVE for INSERT to authenticated
  with check ((bucket_id = 'novedades'::text));
drop policy if exists "Usuarios autenticados pueden actualizar novedades" on storage.objects;
create policy "Usuarios autenticados pueden actualizar novedades" on storage.objects as PERMISSIVE for UPDATE to authenticated
  using ((bucket_id = 'novedades'::text));
drop policy if exists "Usuarios autenticados pueden actualizar en novedades" on storage.objects;
create policy "Usuarios autenticados pueden actualizar en novedades" on storage.objects as PERMISSIVE for UPDATE to authenticated
  using ((bucket_id = 'novedades'::text))
  with check ((bucket_id = 'novedades'::text));
drop policy if exists "Usuarios autenticados pueden eliminar novedades" on storage.objects;
create policy "Usuarios autenticados pueden eliminar novedades" on storage.objects as PERMISSIVE for DELETE to authenticated
  using ((bucket_id = 'novedades'::text));
drop policy if exists "Usuarios autenticados pueden eliminar de novedades" on storage.objects;
create policy "Usuarios autenticados pueden eliminar de novedades" on storage.objects as PERMISSIVE for DELETE to authenticated
  using ((bucket_id = 'novedades'::text));

-- ecommerce (dos juegos)
drop policy if exists "Usuarios autenticados suben imágenes ecommerce" on storage.objects;
create policy "Usuarios autenticados suben imágenes ecommerce" on storage.objects as PERMISSIVE for INSERT to authenticated
  with check ((bucket_id = 'ecommerce'::text));
drop policy if exists "Usuarios autenticados pueden subir a ecommerce" on storage.objects;
create policy "Usuarios autenticados pueden subir a ecommerce" on storage.objects as PERMISSIVE for INSERT to authenticated
  with check ((bucket_id = 'ecommerce'::text));
drop policy if exists "Usuarios autenticados actualizan imágenes ecommerce" on storage.objects;
create policy "Usuarios autenticados actualizan imágenes ecommerce" on storage.objects as PERMISSIVE for UPDATE to authenticated
  using ((bucket_id = 'ecommerce'::text));
drop policy if exists "Usuarios autenticados pueden actualizar en ecommerce" on storage.objects;
create policy "Usuarios autenticados pueden actualizar en ecommerce" on storage.objects as PERMISSIVE for UPDATE to authenticated
  using ((bucket_id = 'ecommerce'::text))
  with check ((bucket_id = 'ecommerce'::text));
drop policy if exists "Usuarios autenticados eliminan imágenes ecommerce" on storage.objects;
create policy "Usuarios autenticados eliminan imágenes ecommerce" on storage.objects as PERMISSIVE for DELETE to authenticated
  using ((bucket_id = 'ecommerce'::text));
drop policy if exists "Usuarios autenticados pueden eliminar de ecommerce" on storage.objects;
create policy "Usuarios autenticados pueden eliminar de ecommerce" on storage.objects as PERMISSIVE for DELETE to authenticated
  using ((bucket_id = 'ecommerce'::text));

-- lectura {public} de los buckets de contenido
drop policy if exists "Acceso público a imágenes de platos" on storage.objects;
create policy "Acceso público a imágenes de platos" on storage.objects as PERMISSIVE for SELECT to public
  using ((bucket_id = 'platos'::text));
drop policy if exists "Public can view platos images" on storage.objects;
create policy "Public can view platos images" on storage.objects as PERMISSIVE for SELECT to public
  using ((bucket_id = ANY (ARRAY['platos'::text, 'plato'::text])));
drop policy if exists "Allow public read vinos" on storage.objects;
create policy "Allow public read vinos" on storage.objects as PERMISSIVE for SELECT to public
  using ((bucket_id = 'vinos'::text));
drop policy if exists "Allow public read bebidas" on storage.objects;
create policy "Allow public read bebidas" on storage.objects as PERMISSIVE for SELECT to public
  using ((bucket_id = 'bebidas'::text));
drop policy if exists "Público puede ver imágenes cocteles" on storage.objects;
create policy "Público puede ver imágenes cocteles" on storage.objects as PERMISSIVE for SELECT to public
  using ((bucket_id = 'cocteles'::text));
drop policy if exists "Imágenes ecommerce públicas" on storage.objects;
create policy "Imágenes ecommerce públicas" on storage.objects as PERMISSIVE for SELECT to public
  using ((bucket_id = 'ecommerce'::text));
drop policy if exists "Lectura pública de novedades" on storage.objects;
create policy "Lectura pública de novedades" on storage.objects as PERMISSIVE for SELECT to public
  using ((bucket_id = 'novedades'::text));

-- ---------------------------------------------------------------------------
-- 3. Comprobación: las 25 están (por nombre, con tilde bien escrita) y no
--    queda ninguna de las 7 nuevas. Si no, se aborta TODO.
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname in (
       'Acceso público a imágenes de salas',
       'Usuarios autenticados pueden subir imágenes de salas',
       'Usuarios autenticados pueden actualizar imágenes de salas',
       'Usuarios autenticados pueden eliminar imágenes de salas',
       'Allow anon uploads to temp-pdfs',
       'Allow public read from temp-pdfs',
       'Usuarios autenticados pueden subir novedades',
       'Usuarios autenticados pueden subir a novedades',
       'Usuarios autenticados pueden actualizar novedades',
       'Usuarios autenticados pueden actualizar en novedades',
       'Usuarios autenticados pueden eliminar novedades',
       'Usuarios autenticados pueden eliminar de novedades',
       'Usuarios autenticados suben imágenes ecommerce',
       'Usuarios autenticados pueden subir a ecommerce',
       'Usuarios autenticados actualizan imágenes ecommerce',
       'Usuarios autenticados pueden actualizar en ecommerce',
       'Usuarios autenticados eliminan imágenes ecommerce',
       'Usuarios autenticados pueden eliminar de ecommerce',
       'Acceso público a imágenes de platos',
       'Public can view platos images',
       'Allow public read vinos',
       'Allow public read bebidas',
       'Público puede ver imágenes cocteles',
       'Imágenes ecommerce públicas',
       'Lectura pública de novedades');
  if n <> 25 then
    raise exception 'ROLLBACK: se esperaban las 25 políticas de antes, hay % (¿encoding de algún nombre?)', n;
  end if;

  if exists (select 1 from pg_policies
              where schemaname = 'storage' and tablename = 'objects'
                and policyname in ('novedades_imagenes_insert_seccion', 'novedades_imagenes_update_seccion',
                                   'novedades_imagenes_delete_seccion', 'ecommerce_imagenes_insert_seccion',
                                   'ecommerce_imagenes_update_seccion', 'ecommerce_imagenes_delete_seccion',
                                   'contenido_lectura_autenticados')) then
    raise exception 'ROLLBACK: queda alguna de las políticas nuevas';
  end if;
end;
$$;

commit;

-- VERIFICACIÓN:
--   select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects';
--   -- -> 35 (el estado del 2026-10-01 tras 20261001180000)
--
--   begin; set local role anon;
--   select bucket_id, count(*) from storage.objects group by 1 order by 1;
--   rollback;
--   -- -> vuelven a salir novedades y platos (listado anónimo otra vez abierto)
