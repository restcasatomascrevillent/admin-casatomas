set client_encoding = 'UTF8';
-- (Primera línea a propósito: casi todos los DROP de abajo llevan nombres
-- con tilde —«imágenes», «pública»— y psql en una consola de Windows puede
-- arrancar en WIN1252. Si aun así algún DROP no casara, el bloque 4 aborta
-- la transacción: la política vieja seguiría viva y se vería.)
-- ===========================================================================
-- ##                                                                       ##
-- ##          NO APLICADA: la aplica el dueño a mano (ver pasos)           ##
-- ##                                                                       ##
-- ##   Cierra los agujeros menores de Storage que quedaron a la vista al   ##
-- ##   quitar la lectura global (20261001180000):                          ##
-- ##     1. `salas` (privado) se podía listar y descargar con la anon key. ##
-- ##     2. `temp-pdfs`: cualquiera con la anon key podía SUBIR PDFs de    ##
-- ##        hasta 50 MB (y servirlos desde nuestro dominio de Supabase).   ##
-- ##     3. Cualquier autenticado, sin sección, podía subir/sobrescribir/  ##
-- ##        borrar fotos de `novedades` (web + menú del día), `ecommerce`  ##
-- ##        y `salas`.                                                     ##
-- ##     4. anon podía LISTAR por API el contenido de los buckets de       ##
-- ##        contenido (las webs no lo necesitan: usan URLs públicas).      ##
-- ##   Solo políticas de storage.objects. No toca ni un objeto, ni un      ##
-- ##   bucket, ni su flag public.                                          ##
-- ##                                                                       ##
-- ===========================================================================
--
-- ---------------------------------------------------------------------------
-- ESTADO ACTUAL VERIFICADO (producción, 2026-10-01, solo SELECT, DESPUÉS de
-- aplicar 20261001150000 y 20261001180000)
-- ---------------------------------------------------------------------------
--   storage.objects: RLS encendida, FORCE apagado; 35 políticas. Ninguna
--   política en storage.buckets. service_role tiene rolbypassrls y además
--   tres políticas genéricas «Service role puede insertar/actualizar/
--   eliminar» (USING/CHECK true, solo {service_role}) que NO se tocan.
--   can_write_section(s) = has_section_permission(auth.uid(), s, 'view'),
--   y has_section_permission devuelve true a los super admins (super_admins).
--
--   Buckets (public, límite, objetos):
--     bebidas    público   sin límite   0      cocteles   público  sin límite   0
--     ecommerce  público   sin límite   0      novedades  público  sin límite  22
--     plato      público   sin límite   0      platos     público  sin límite 105
--     vinos      público   sin límite   0      facturas-originales PRIVADO 10 MB 14
--     salas      PRIVADO   sin límite   0  (creado 2025-11-15, nunca un objeto)
--     temp-pdfs  público   50 MB, solo application/pdf   0  (creado 2026-05-21)
--
--   Lo que se cambia (25 políticas, nombres exactos de pg_policies):
--   salas (4):
--     SELECT {public}         «Acceso público a imágenes de salas»
--     INSERT {authenticated}  «Usuarios autenticados pueden subir imágenes de salas»
--     UPDATE {authenticated}  «Usuarios autenticados pueden actualizar imágenes de salas»
--     DELETE {authenticated}  «Usuarios autenticados pueden eliminar imágenes de salas»
--   temp-pdfs (2; «Allow service role delete from temp-pdfs» se queda):
--     INSERT {anon}           «Allow anon uploads to temp-pdfs»
--     SELECT {anon}           «Allow public read from temp-pdfs»
--   novedades, escritura sin sección (6, dos juegos duplicados):
--     INSERT «Usuarios autenticados pueden subir novedades» / «… pueden subir a novedades»
--     UPDATE «Usuarios autenticados pueden actualizar novedades» / «… pueden actualizar en novedades»
--     DELETE «Usuarios autenticados pueden eliminar novedades» / «… pueden eliminar de novedades»
--   ecommerce, escritura sin sección (6, dos juegos duplicados):
--     INSERT «Usuarios autenticados suben imágenes ecommerce» / «… pueden subir a ecommerce»
--     UPDATE «Usuarios autenticados actualizan imágenes ecommerce» / «… pueden actualizar en ecommerce»
--     DELETE «Usuarios autenticados eliminan imágenes ecommerce» / «… pueden eliminar de ecommerce»
--   Lectura de los buckets de contenido, rol {public} (7):
--     «Acceso público a imágenes de platos»   platos
--     «Public can view platos images»         platos, plato
--     «Allow public read vinos»               vinos
--     «Allow public read bebidas»             bebidas
--     «Público puede ver imágenes cocteles»   cocteles
--     «Imágenes ecommerce públicas»           ecommerce
--     «Lectura pública de novedades»          novedades
--
-- ---------------------------------------------------------------------------
-- DECISIÓN POR AGUJERO (grep en adminpanelct/src, supabase/functions,
-- casa-tomas-story, touza-restaurant-website, restaurante-phone, su historial
-- de git, ../docs y adminpanelct/docs)
-- ---------------------------------------------------------------------------
--   1. salas -> SE QUITAN SUS 4 POLÍTICAS (lectura y escritura). Queda
--      privado y solo accesible con service_role (dashboard / Edge Functions).
--      Por qué: 0 objetos desde que existe; ninguna referencia en código ni
--      en el historial de git de ningún repo; venía del intento de noviembre
--      de 2025 de montar «salas» en el panel, cuya tabla `salas` se jubiló el
--      23/11/2025 (docs/ESTADO-SISTEMA.md). Hoy las zonas son
--      espacios_reserva y no tienen imágenes; ninguna web muestra fotos de
--      salas, así que hacerlo público NO tiene sentido. Si algún día hace
--      falta, una migración nueva le pone políticas atadas a una sección.
--   2. temp-pdfs -> SE QUITAN el INSERT y el SELECT de anon. El bucket se
--      queda (borrar buckets queda fuera del encargo) junto con «Allow
--      service role delete from temp-pdfs». Por qué: 0 objetos; ninguna
--      referencia en los 4 repos ni en su historial de git. Es del OCR viejo
--      de n8n (docs/funcionalidades/07: «guarda facturas subidas para OCR»):
--      ese OCR se sacó de n8n a la Edge Function procesar-factura en junio de
--      2026, que recibe el documento en base64 y guarda el original en
--      `facturas-originales` con service role. Nadie sube ya a temp-pdfs.
--      NO se han podido mirar los logs de la API de Storage (sin permiso
--      desde aquí): ver paso 1b de «CÓMO SE APLICA».
--   3. Escritura por sección (INSERT + UPDATE + DELETE, mismo patrón que
--      carta_imagenes_*):
--        novedades -> can_write_section('gestion_web'). La usan
--          EditorNovedadesWeb (Gestor Web → pestaña Novedades: upload sin
--          upsert + remove) y src/lib/foto-menu-dia.ts desde
--          EditorSeccionesMenu (Gestor Web → Menús diarios / Tapas, vía
--          EditorMenuTapasWeb: upload sin upsert, nunca borra). Las tres
--          pestañas son `gestion_web` en pestanasGestorWeb.ts, y GestorWeb
--          las filtra con super_admins + can_view: el mismo criterio que
--          can_write_section.
--        ecommerce -> can_write_section('ecommerce'). Comida/BebidaVentaForm
--          (SeccionProductos) solo se montan en /super-admin/ecommerce
--          (SuperAdminRoute = fila en super_admins). `ecommerce` es la clave
--          de sección que ya existe en user_permissions; can_write_section
--          deja pasar a todo super admin, así que nadie que hoy vea esa
--          pantalla pierde nada.
--        salas -> sin escritura (punto 1).
--   4. Lectura de los buckets de contenido -> las 7 SELECT {public} se
--      sustituyen por UNA `contenido_lectura_autenticados` TO authenticated
--      (bucket_id IN platos, plato, vinos, bebidas, cocteles, ecommerce,
--      novedades), sin sección. Por qué es seguro:
--        · Las URLs /storage/v1/object/public/… (getPublicUrl y
--          /render/image/public/…) NO pasan por la RLS: la API de Storage
--          las sirve como superusuario si el bucket es public = true. Las
--          webs SOLO usan eso (CartaPlatos, CartaVinos, carta-ssg,
--          novedades vía tabla). Ni list, ni download, ni createSignedUrl en
--          casa-tomas-story ni en touza; restaurante-phone no usa Storage.
--        · El panel (siempre autenticado) sí necesita SELECT: upload con
--          upsert de la carta, remove() de carta y novedades, y list('') de
--          platos/bebidas/vinos en la galería de la newsletter
--          (SelectorImagenGaleria, sección marketing: por eso SIN sección).
--        · Edge Functions: service role (bypass).
--
-- ---------------------------------------------------------------------------
-- QUIÉN PIERDE QUÉ (auth.users + user_permissions + super_admins, hoy)
-- ---------------------------------------------------------------------------
--   14e53985… super admin           -> nada (sigue escribiendo novedades y ecommerce)
--   46a07ab7… super admin           -> nada
--   a5729ae9… admin, gestion_web    -> nada en novedades; pierde escribir en
--             ecommerce por API (no ve /super-admin/ecommerce de todas formas)
--   bf08f748… staff (dashboard + reservas; gestion_web con can_view=false)
--             -> pierde escribir en novedades y ecommerce por API (en el
--                panel no ve ni el Gestor Web ni el ecommerce).
--   Cualquier autenticado -> pierde subir/cambiar/borrar en salas.
--   anon (la anon key de las webs) -> pierde LISTAR/descargar por API salas,
--     temp-pdfs y los 7 buckets de contenido, y SUBIR a temp-pdfs. Las URLs
--     públicas de las fotos siguen funcionando igual.
--   service_role -> nada.
--
-- LO QUE NO CAMBIA
--   · Buckets: ni se crean, ni se borran, ni cambia su public / límites.
--   · carta_imagenes_* (gestor_carta), facturas_originales_* (facturas),
--     «Service role puede *», «Allow service role delete from temp-pdfs».
--   · Las tablas (novedades, menus_diarios, ComidaVENTA, BebidasVENTA…):
--     siguen con su RLS de hoy. Ver «LO QUE ESTE FICHERO NO TAPA».
--   · No hay que desplegar nada (ni panel, ni webs, ni Edge Functions).
--
-- ---------------------------------------------------------------------------
-- CÓMO SE APLICA (lo hace el dueño, a mano, desde adminpanelct/).
-- NO con `supabase db push` ni `migration repair`.
--   1. Que no haya transacciones largas abiertas (debe salir vacío):
--        npx supabase db query --linked "select pid, state, now() - xact_start as dura, left(query, 60) as consulta from pg_stat_activity where xact_start < now() - interval '1 minute' and pid <> pg_backend_pid();"
--   1b. (Recomendado) En el dashboard de Supabase → Logs → API, filtrar
--      por «temp-pdfs» y por «/object/list/» de los últimos días: si sale
--      algún POST a /object/temp-pdfs/… o algún list con la anon key desde
--      fuera del panel, PARAR y avisar (habría un flujo externo vivo).
--   2. Aplicarla:
--        npx supabase db query --linked -f supabase/migrations/20261001190000_storage_agujeros_menores.sql
--      Si falla con 55P03 (lock_not_available), NO se ha aplicado nada (todo
--      va en una transacción): reintentar desde el paso 1. Si falla en el
--      bloque 1 (precondiciones) o 4 (red de seguridad), tampoco se ha
--      aplicado nada: leer el mensaje.
--   3. Probarla (todo dentro de BEGIN … ROLLBACK, no deja nada escrito):
--        npx supabase db query --linked -f supabase/tests/storage_agujeros_menores_test.sql
--        npx supabase db query --linked -f supabase/tests/storage_lectura_test.sql
--        npx supabase db query --linked -f supabase/tests/carta_escritura_por_seccion_test.sql
--      y las consultas de VERIFICACIÓN del pie de este fichero.
--   4. Humo en el panel (no hay que desplegar nada):
--      · Gestor Web → Novedades: subir una imagen, guardar, quitarla.
--      · Gestor Web → Menús diarios: foto a un plato «A mano».
--      · Gestor Web → Carta: cambiar la foto de un plato (upsert + remove).
--      · Marketing → newsletter: «Imagen (opcional)» lista la galería.
--      · /super-admin/ecommerce: alta de un producto con foto (super admin).
--      · Una web pública: las fotos de la carta y de novedades cargan.
--   5. Humo desde fuera con la anon key (la de las webs):
--        curl -s -X POST "https://jeamoczmbfsnwkfjxcyo.supabase.co/storage/v1/object/list/novedades" \
--          -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" \
--          -d '{"prefix":"","limit":100}'
--      -> []  (antes: la carpeta novedades/ y menu-dia/). Igual con platos.
--        curl -s -X POST "https://jeamoczmbfsnwkfjxcyo.supabase.co/storage/v1/object/temp-pdfs/zz-humo.pdf" \
--          -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/pdf" --data-binary "%PDF-1.4"
--      -> error «new row violates row-level security policy» (403/400).
--      Y una URL pública de foto cualquiera de la web sigue dando 200:
--        curl -sI "https://jeamoczmbfsnwkfjxcyo.supabase.co/storage/v1/object/public/platos/<fichero>"
--
-- CANDADOS: DROP/CREATE POLICY piden ACCESS EXCLUSIVE sobre storage.objects
-- durante milisegundos (subidas, listados y también las URLs públicas, que
-- consultan storage.objects, esperan ese instante). `lock_timeout = 5s` para
-- no quedarse en cola detrás de algo largo.
--
-- OJO: el bloque 1 de 20261001180000 exige SELECT {public} en los buckets de
-- contenido; tras esta migración, re-ejecutar aquella abortaría «sin tocar
-- nada» (ya está aplicada: no hay por qué). Su test (storage_lectura_test)
-- se ha adaptado para valer antes y después de esta.
--
-- Rollback: supabase/rollbacks/20261001190000_storage_agujeros_menores_ROLLBACK.sql
-- (REABRE los cuatro agujeros: solo para deshacer un despliegue que salió mal).
-- ===========================================================================

begin;

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. PRECONDICIONES: si algo ha cambiado desde el diagnóstico, abortar SIN
--    tocar nada.
-- ---------------------------------------------------------------------------
do $$
declare
  b text;
  n bigint;
  desconocidas text;
begin
  -- 1a. Las funciones de sección existen y los super admins pasan.
  if to_regprocedure('public.can_write_section(text)') is null then
    raise exception 'Abortado sin tocar nada: no existe public.can_write_section(text)';
  end if;
  if not exists (select 1 from pg_proc
                  where oid = to_regprocedure('public.has_section_permission(uuid,text,text)')
                    and prosrc like '%is_super_admin%') then
    raise exception 'Abortado sin tocar nada: has_section_permission ya no deja pasar a los super admins (el dueño perdería la escritura)';
  end if;

  -- 1b. Los buckets de contenido siguen siendo públicos: si alguno fuera
  --     privado, quitarle la SELECT de anon le cortaría la única vía de
  --     lectura a las webs (sus URLs públicas no funcionarían de todas formas).
  foreach b in array array['platos', 'plato', 'vinos', 'bebidas', 'cocteles', 'ecommerce', 'novedades'] loop
    if not exists (select 1 from storage.buckets where id = b and public) then
      raise exception 'Abortado sin tocar nada: el bucket % no existe o ya no es público', b;
    end if;
  end loop;

  -- 1c. salas sigue privado y vacío; temp-pdfs sigue vacío. Si alguien ha
  --     empezado a usarlos, hay un flujo que no conocemos: no cerrar a ciegas.
  if not exists (select 1 from storage.buckets where id = 'salas' and not public) then
    raise exception 'Abortado sin tocar nada: el bucket salas no existe o ha pasado a ser público';
  end if;
  select count(*) into n from storage.objects where bucket_id in ('salas', 'temp-pdfs');
  if n > 0 then
    raise exception 'Abortado sin tocar nada: salas/temp-pdfs ya tienen % objeto(s); alguien los usa: revisar antes de cerrarlos', n;
  end if;

  -- 1d. No hay políticas que no conozcamos sobre lo que se toca: escrituras
  --     de salas/temp-pdfs/novedades/ecommerce y lecturas de esos buckets o
  --     de los de contenido. Vale tanto antes (nombres viejos) como después
  --     (nombres nuevos) de aplicar: es idempotente.
  select string_agg(format('«%s» (%s, %s)', policyname, cmd, roles::text), '; ')
    into desconocidas
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and roles <> array['service_role']::name[]
     and ((cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
           and (coalesce(qual, '') || coalesce(with_check, '')) ~ '''(salas|temp-pdfs|novedades|ecommerce)''')
       or (cmd in ('SELECT', 'ALL')
           and coalesce(qual, '') ~ '''(salas|temp-pdfs|novedades|ecommerce|platos|plato|vinos|bebidas|cocteles)'''))
     and policyname not in (
       -- viejas (se borran)
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
       'Lectura pública de novedades',
       -- nuevas (las crea este fichero)
       'novedades_imagenes_insert_seccion', 'novedades_imagenes_update_seccion', 'novedades_imagenes_delete_seccion',
       'ecommerce_imagenes_insert_seccion', 'ecommerce_imagenes_update_seccion', 'ecommerce_imagenes_delete_seccion',
       'contenido_lectura_autenticados');
  if desconocidas is not null then
    raise exception 'Abortado sin tocar nada: hay políticas de Storage que este fichero no conoce sobre los buckets que toca: %', desconocidas;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. BORRAR LAS 25 POLÍTICAS VIEJAS (nombres exactos de pg_policies)
-- ---------------------------------------------------------------------------

-- salas: todo (bucket muerto; queda solo para service_role)
drop policy if exists "Acceso público a imágenes de salas"                        on storage.objects;
drop policy if exists "Usuarios autenticados pueden subir imágenes de salas"      on storage.objects;
drop policy if exists "Usuarios autenticados pueden actualizar imágenes de salas" on storage.objects;
drop policy if exists "Usuarios autenticados pueden eliminar imágenes de salas"   on storage.objects;

-- temp-pdfs: lo de anon (se queda «Allow service role delete from temp-pdfs»)
drop policy if exists "Allow anon uploads to temp-pdfs"  on storage.objects;
drop policy if exists "Allow public read from temp-pdfs" on storage.objects;

-- novedades: escritura sin sección (dos juegos)
drop policy if exists "Usuarios autenticados pueden subir novedades"         on storage.objects;
drop policy if exists "Usuarios autenticados pueden subir a novedades"       on storage.objects;
drop policy if exists "Usuarios autenticados pueden actualizar novedades"    on storage.objects;
drop policy if exists "Usuarios autenticados pueden actualizar en novedades" on storage.objects;
drop policy if exists "Usuarios autenticados pueden eliminar novedades"      on storage.objects;
drop policy if exists "Usuarios autenticados pueden eliminar de novedades"   on storage.objects;

-- ecommerce: escritura sin sección (dos juegos)
drop policy if exists "Usuarios autenticados suben imágenes ecommerce"       on storage.objects;
drop policy if exists "Usuarios autenticados pueden subir a ecommerce"       on storage.objects;
drop policy if exists "Usuarios autenticados actualizan imágenes ecommerce"  on storage.objects;
drop policy if exists "Usuarios autenticados pueden actualizar en ecommerce" on storage.objects;
drop policy if exists "Usuarios autenticados eliminan imágenes ecommerce"    on storage.objects;
drop policy if exists "Usuarios autenticados pueden eliminar de ecommerce"   on storage.objects;

-- lectura {public} de los buckets de contenido
drop policy if exists "Acceso público a imágenes de platos"  on storage.objects;
drop policy if exists "Public can view platos images"        on storage.objects;
drop policy if exists "Allow public read vinos"              on storage.objects;
drop policy if exists "Allow public read bebidas"            on storage.objects;
drop policy if exists "Público puede ver imágenes cocteles"  on storage.objects;
drop policy if exists "Imágenes ecommerce públicas"          on storage.objects;
drop policy if exists "Lectura pública de novedades"         on storage.objects;

-- ---------------------------------------------------------------------------
-- 3. POLÍTICAS NUEVAS (idempotentes: drop if exists + create)
--    `(select …)` para que se evalúe una vez por consulta (InitPlan), como
--    carta_imagenes_*. upload() = INSERT (+ UPDATE si upsert); remove() =
--    DELETE … RETURNING (necesita también SELECT, que da 3d).
-- ---------------------------------------------------------------------------

-- 3a. novedades -> gestion_web (Novedades, Menús diarios y Tapas del Gestor Web)
drop policy if exists novedades_imagenes_insert_seccion on storage.objects;
create policy novedades_imagenes_insert_seccion on storage.objects
  for insert to authenticated
  with check ( bucket_id = 'novedades' and (select public.can_write_section('gestion_web')) );

drop policy if exists novedades_imagenes_update_seccion on storage.objects;
create policy novedades_imagenes_update_seccion on storage.objects
  for update to authenticated
  using      ( bucket_id = 'novedades' and (select public.can_write_section('gestion_web')) )
  with check ( bucket_id = 'novedades' and (select public.can_write_section('gestion_web')) );

drop policy if exists novedades_imagenes_delete_seccion on storage.objects;
create policy novedades_imagenes_delete_seccion on storage.objects
  for delete to authenticated
  using ( bucket_id = 'novedades' and (select public.can_write_section('gestion_web')) );

-- 3b. ecommerce -> ecommerce (pantalla solo en /super-admin/ecommerce)
drop policy if exists ecommerce_imagenes_insert_seccion on storage.objects;
create policy ecommerce_imagenes_insert_seccion on storage.objects
  for insert to authenticated
  with check ( bucket_id = 'ecommerce' and (select public.can_write_section('ecommerce')) );

drop policy if exists ecommerce_imagenes_update_seccion on storage.objects;
create policy ecommerce_imagenes_update_seccion on storage.objects
  for update to authenticated
  using      ( bucket_id = 'ecommerce' and (select public.can_write_section('ecommerce')) )
  with check ( bucket_id = 'ecommerce' and (select public.can_write_section('ecommerce')) );

drop policy if exists ecommerce_imagenes_delete_seccion on storage.objects;
create policy ecommerce_imagenes_delete_seccion on storage.objects
  for delete to authenticated
  using ( bucket_id = 'ecommerce' and (select public.can_write_section('ecommerce')) );

-- 3c. salas y temp-pdfs: ninguna política nueva (solo service_role).

-- 3d. Lectura por API de los buckets de contenido: SOLO autenticados, sin
--     sección (galería de la newsletter = marketing; upsert/remove de cada
--     editor). anon sigue teniendo las URLs públicas, que no pasan por aquí.
drop policy if exists contenido_lectura_autenticados on storage.objects;
create policy contenido_lectura_autenticados on storage.objects
  for select to authenticated
  using ( bucket_id = any (array['platos', 'plato', 'vinos', 'bebidas', 'cocteles', 'ecommerce', 'novedades']) );

-- ---------------------------------------------------------------------------
-- 4. RED DE SEGURIDAD sobre el catálogo: si algún DROP no casó (tilde,
--    encoding, alguien la renombró), `if exists` lo habría tapado en silencio
--    y la política vieja seguiría abriendo la puerta por OR. Se comprueban
--    los invariantes finales de storage.objects y, si alguno falla, se
--    aborta TODO. (Se excluyen las políticas cuyo único rol es service_role.)
-- ---------------------------------------------------------------------------
do $$
declare
  b text;
  malas text;
begin
  -- 4a. (invariante de 20261001180000) ninguna lectura sin acotar por bucket.
  select string_agg(format('«%s» (%s, %s, using %s)', policyname, cmd, roles::text, coalesce(qual, 'NULL')), '; ')
    into malas
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and cmd in ('SELECT', 'ALL')
     and roles <> array['service_role']::name[]
     and (qual is null
          or qual !~ 'bucket_id = (''[^'']+''|ANY \(ARRAY\[)'
          or qual ~* '\mOR\M');
  if malas is not null then
    raise exception 'Queda lectura de Storage sin acotar por bucket: %', malas;
  end if;

  -- 4b. Ninguna política (de ningún tipo) para anon ni para public.
  select string_agg(format('«%s» (%s, %s)', policyname, cmd, roles::text), '; ')
    into malas
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and ('anon' = any (roles) or 'public' = any (roles));
  if malas is not null then
    raise exception 'Sigue habiendo políticas de Storage para anon/public: %', malas;
  end if;

  -- 4c. Toda escritura (no service_role) está acotada por bucket Y exige
  --     una sección (can_write_section / can_read_section…) en cada
  --     expresión que tenga.
  select string_agg(format('«%s» (%s, %s)', policyname, cmd, roles::text), '; ')
    into malas
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
     and roles <> array['service_role']::name[]
     and ((qual is not null
           and (qual !~ 'bucket_id = (''[^'']+''|ANY \(ARRAY\[)' or qual !~ '_section\(' or qual ~* '\mOR\M'))
       or (with_check is not null
           and (with_check !~ 'bucket_id = (''[^'']+''|ANY \(ARRAY\[)' or with_check !~ '_section\(' or with_check ~* '\mOR\M'))
       or (qual is null and with_check is null));
  if malas is not null then
    raise exception 'Queda escritura de Storage sin sección o sin bucket: %', malas;
  end if;

  -- 4d. salas y temp-pdfs: nada para quien no sea service_role.
  select string_agg(format('«%s» (%s, %s)', policyname, cmd, roles::text), '; ')
    into malas
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and roles <> array['service_role']::name[]
     and (coalesce(qual, '') || coalesce(with_check, '')) ~ '''(salas|temp-pdfs)''';
  if malas is not null then
    raise exception 'Sobrevive una política sobre salas/temp-pdfs: %', malas;
  end if;

  -- 4e. Las 7 nuevas están, con su forma exacta.
  if (select count(*) from pg_policies
       where schemaname = 'storage' and tablename = 'objects'
         and roles::text = '{authenticated}'
         and ((policyname = 'novedades_imagenes_insert_seccion' and cmd = 'INSERT'
               and with_check like '%''novedades''%' and with_check like '%can_write_section(''gestion_web''::text)%')
           or (policyname = 'novedades_imagenes_update_seccion' and cmd = 'UPDATE'
               and qual like '%''novedades''%' and qual like '%can_write_section(''gestion_web''::text)%'
               and with_check like '%''novedades''%' and with_check like '%can_write_section(''gestion_web''::text)%')
           or (policyname = 'novedades_imagenes_delete_seccion' and cmd = 'DELETE'
               and qual like '%''novedades''%' and qual like '%can_write_section(''gestion_web''::text)%')
           or (policyname = 'ecommerce_imagenes_insert_seccion' and cmd = 'INSERT'
               and with_check like '%''ecommerce''%' and with_check like '%can_write_section(''ecommerce''::text)%')
           or (policyname = 'ecommerce_imagenes_update_seccion' and cmd = 'UPDATE'
               and qual like '%''ecommerce''%' and qual like '%can_write_section(''ecommerce''::text)%'
               and with_check like '%''ecommerce''%' and with_check like '%can_write_section(''ecommerce''::text)%')
           or (policyname = 'ecommerce_imagenes_delete_seccion' and cmd = 'DELETE'
               and qual like '%''ecommerce''%' and qual like '%can_write_section(''ecommerce''::text)%')
           or (policyname = 'contenido_lectura_autenticados' and cmd = 'SELECT'))) <> 7 then
    raise exception 'Las 7 políticas nuevas no han quedado como deben';
  end if;

  -- 4f. Cada bucket de contenido conserva lectura para authenticated
  --     (upsert/remove/list del panel) y facturas_originales_select sigue.
  foreach b in array array['platos', 'plato', 'vinos', 'bebidas', 'cocteles', 'ecommerce', 'novedades'] loop
    if not exists (
      select 1 from pg_policies p
       where p.schemaname = 'storage' and p.tablename = 'objects'
         and p.cmd in ('SELECT', 'ALL') and p.permissive = 'PERMISSIVE'
         and 'authenticated' = any (p.roles)
         and p.qual ~ ('bucket_id = (''' || b || '''|ANY \(ARRAY\[[^]]*''' || b || ''')')
         and p.qual !~ '_section\(') then
      raise exception 'El bucket % se ha quedado sin lectura para authenticated (rompería subir/borrar fotos o la galería)', b;
    end if;
  end loop;
  if not exists (select 1 from pg_policies
                  where schemaname = 'storage' and tablename = 'objects'
                    and policyname = 'facturas_originales_select' and cmd = 'SELECT'
                    and roles::text = '{authenticated}'
                    and qual like '%can_read_section(''facturas''::text)%') then
    raise exception 'Falta o ha cambiado facturas_originales_select';
  end if;
end;
$$;

commit;

-- ===========================================================================
-- LO QUE ESTE FICHERO NO TAPA (fuera del encargo, visto al diagnosticar)
-- ===========================================================================
--   1. Las TABLAS que van con estas fotos siguen abiertas a cualquier
--      autenticado sin sección: public.novedades (6 políticas true /
--      auth.uid() IS NOT NULL), menus_diarios y tapas («Authenticated
--      gestiona …» ALL true), ComidaVENTA y BebidasVENTA (true), y
--      espacios_reserva / planos_espacio. Cerrar la foto sin cerrar la fila
--      deja el agujero a medias: piden su propia migración
--      (gestion_web / ecommerce / espacios), como hizo 20261001150000 con la
--      carta.
--   2. temp-pdfs y salas siguen existiendo (vacíos). temp-pdfs además sigue
--      con public = true: si service_role subiera algo ahí, se serviría por
--      URL pública. Candidatos a borrarse desde el dashboard cuando el dueño
--      lo decida (borrar buckets quedaba fuera del encargo).
--   3. Ningún bucket de contenido define file_size_limit ni
--      allowed_mime_types (la UI valida 5 MB e imagen, la API no).
--   4. can_write_section sigue mirando 'view' (ver Fase 2).
--
-- ===========================================================================
-- VERIFICACIÓN tras aplicar (el juego completo: supabase/tests/storage_agujeros_menores_test.sql)
-- ===========================================================================
--   select policyname, cmd, roles::text, qual, with_check
--   from pg_policies
--   where schemaname = 'storage' and tablename = 'objects'
--   order by roles::text, cmd, policyname;
--   -- -> 17 filas (35 - 25 + 7): ninguna {anon} ni {public}; SELECT solo
--   --    contenido_lectura_autenticados y facturas_originales_select; toda
--   --    escritura {authenticated} con *_section(...); 4 {service_role}.
--
--   Lo que ve anon por API (antes: novedades 22, platos 105):
--   begin; set local role anon;
--   select bucket_id, count(*) from storage.objects group by 1 order by 1;
--   rollback;
--   -- -> 0 filas.
-- ===========================================================================
