set client_encoding = 'UTF8';
-- (Primera línea a propósito: el DROP de abajo lleva un nombre con tilde
-- —«Lectura pública de buckets»— y psql en una consola de Windows puede
-- arrancar en WIN1252. Si aun así el DROP no casara, el bloque 3 aborta la
-- transacción: la política seguiría viva y se vería.)
-- ===========================================================================
-- ##                                                                       ##
-- ##          NO APLICADA: la aplica el dueño a mano (ver pasos)           ##
-- ##                                                                       ##
-- ##   Cierra la fuga de Storage: hoy CUALQUIERA con la anon key (que va   ##
-- ##   publicada en las webs) puede LISTAR y DESCARGAR los objetos de      ##
-- ##   TODOS los buckets, también del privado `facturas-originales`        ##
-- ##   (las facturas originales de proveedores).                           ##
-- ##   Solo borra UNA política. No toca ni un objeto ni un bucket.         ##
-- ##                                                                       ##
-- ===========================================================================
--
-- PROBLEMA (diagnóstico del 2026-10-01)
--   En storage.objects hay una política creada a mano (no está en ninguna
--   migración del repo):
--     «Lectura pública de buckets»  PERMISSIVE  FOR SELECT
--       TO anon, authenticated, service_role   USING (true)
--   Las políticas PERMISSIVE se suman con OR: una sola `true` basta, así que
--   anula todas las demás políticas SELECT de Storage, en particular
--   facturas_originales_select (bucket privado, solo con la sección
--   `facturas`). Comprobado con `set role anon`: anon ve los 14 objetos de
--   `facturas-originales` (además de los 22 de novedades y 105 de platos).
--   Con la anon key basta un POST /storage/v1/object/list/facturas-originales
--   para listar y un GET /storage/v1/object/authenticated/... (o un
--   createSignedUrl) para descargar.
--
-- ---------------------------------------------------------------------------
-- ESTADO ACTUAL VERIFICADO (producción, 2026-10-01, solo SELECT)
-- ---------------------------------------------------------------------------
--   storage.objects: RLS encendida, FORCE apagado, propietario
--   supabase_storage_admin. `postgres` puede crear/borrar sus políticas por
--   supautils.policy_grants (incluye storage.objects). service_role tiene
--   rolbypassrls = true. Ninguna política en storage.buckets.
--
--   Buckets (public, objetos) y su lectura SELECT SIN contar la global:
--     bebidas              público   0   «Allow public read bebidas»            {public}  bucket_id = 'bebidas'
--     cocteles             público   0   «Público puede ver imágenes cocteles»  {public}  bucket_id = 'cocteles'
--     ecommerce            público   0   «Imágenes ecommerce públicas»          {public}  bucket_id = 'ecommerce'
--     facturas-originales  PRIVADO  14   facturas_originales_select   {authenticated}  bucket + can_read_section('facturas')
--     novedades            público  22   «Lectura pública de novedades»         {public}  bucket_id = 'novedades'
--     plato                público   0   «Public can view platos images»        {public}  bucket_id IN (platos, plato)
--     platos               público 105   ídem + «Acceso público a imágenes de platos» {public}
--     salas                PRIVADO   0   «Acceso público a imágenes de salas»   {public}  bucket_id = 'salas'
--     temp-pdfs            público   0   «Allow public read from temp-pdfs»     {anon}    bucket_id = 'temp-pdfs'
--     vinos                público   0   «Allow public read vinos»              {public}  bucket_id = 'vinos'
--   Es decir: TODOS los buckets ya tienen su propia política SELECT acotada
--   por bucket_id. La global solo aporta (a) anon/authenticated sobre
--   `facturas-originales` sin sección —la fuga— y (b) authenticated sobre
--   `temp-pdfs`, que no usa nadie (0 objetos, ninguna referencia en los 4
--   repos ni en las Edge Functions).
--
-- ---------------------------------------------------------------------------
-- QUIÉN LEE CADA BUCKET Y CÓMO (grep en adminpanelct/src, supabase/functions,
-- casa-tomas-story, touza-restaurant-website y restaurante-phone)
-- ---------------------------------------------------------------------------
--   Recordatorio de lo que necesita SELECT en storage.objects:
--     · URL pública /storage/v1/object/public/<bucket>/… (getPublicUrl, y la
--       transformación /render/image/public/…): NO pasa por la RLS; basta
--       con que el bucket sea public = true.
--     · list(), download(), createSignedUrl(), remove() (DELETE … RETURNING),
--       upload({upsert:true}) (INSERT … ON CONFLICT DO UPDATE), move/copy:
--       SÍ necesitan SELECT del rol que llama.
--     · upload() sin upsert: solo INSERT.
--     · Edge Functions con SERVICE_ROLE_KEY: bypass de RLS.
--
--   Webs (casa-tomas-story, touza; anon key): SOLO URLs públicas de platos /
--     vinos / novedades (CartaPlatos, CartaVinos, carta-ssg). Ni list ni
--     download. No les afecta nada.
--   restaurante-phone: no usa Storage.
--   Panel (authenticated):
--     platos/vinos/bebidas/cocteles  upload({upsert:true}) + remove() +
--         getPublicUrl (PlatoForm, VinoForm, BebidaForm, CoctelForm,
--         Editar*Modal, use{Platos,Vinos,Bebidas,Cocteles}).   -> SELECT propia {public}
--     platos/bebidas/vinos  list('') en marketing/SelectorImagenGaleria
--         (galería del creador de newsletter).                 -> SELECT propia {public}
--     novedades  upload sin upsert + remove() (EditorNovedadesWeb) y
--         upload de foto-menu-dia (menu-dia/).                 -> SELECT propia {public}
--     ecommerce  upload sin upsert + getPublicUrl (Comida/BebidaVentaForm). -> no necesita SELECT (la tiene)
--     facturas-originales  createSignedUrl (facturas/shared/BotonOriginal),
--         requiere SELECT                                      -> facturas_originales_select (sección facturas)
--   Edge Functions: procesar-factura sube a facturas-originales con
--     SERVICE_ROLE_KEY (upsert) -> bypass. Ninguna otra toca Storage.
--   temp-pdfs / salas / plato: ninguna referencia en código.
--
--   QUIÉN PIERDE QUÉ (auth.users + user_permissions + super_admins, hoy):
--     14e53985… super admin        -> sigue viendo facturas originales
--     46a07ab7… super admin        -> ídem
--     a5729ae9… admin, sección facturas -> ídem
--     bf08f748… staff (dashboard + reservas) -> deja de poder listarlas o
--         firmarlas por API (en el panel ni siquiera ve la pantalla).
--     anon (cualquiera con la anon key) -> deja de verlas. ES EL OBJETIVO.
--     authenticated en temp-pdfs -> deja de poder listar/descargar por API
--         (vacío y sin uso; anon conserva su política y la URL pública).
--
-- ---------------------------------------------------------------------------
-- QUÉ HACE
-- ---------------------------------------------------------------------------
--   1. Comprueba ANTES de borrar que cada bucket de contenido público que el
--      panel usa con list/remove/upsert conserva su propia política SELECT
--      para anon y authenticated, y que facturas_originales_select sigue en
--      pie. Si faltara alguna, aborta SIN tocar nada (quitar la global
--      rompería la subida/borrado de fotos o el botón «ver original»).
--   2. DROP de «Lectura pública de buckets». No hace falta crear ninguna
--      política nueva: ningún flujo legítimo dependía SOLO de la global.
--   3. Red de seguridad sobre el catálogo: aborta TODO si queda cualquier
--      política SELECT/ALL de storage.objects (para un rol que no sea solo
--      service_role) sin restricción de bucket_id, o con un OR que pudiera
--      saltársela.
--   Idempotente: se puede ejecutar dos veces (la segunda no encuentra nada
--   que borrar y las comprobaciones vuelven a pasar).
--
-- LO QUE NO CAMBIA
--   · Ninguna otra política (las SELECT por bucket, las de escritura, las de
--     service_role). Ni buckets, ni su flag public, ni objetos.
--   · Las URLs públicas de las webs y del panel: no pasan por la RLS.
--   · No hay que desplegar nada (ni panel, ni webs, ni Edge Functions).
--
-- ---------------------------------------------------------------------------
-- CÓMO SE APLICA (lo hace el dueño, a mano, desde adminpanelct/).
-- NO con `supabase db push` ni `migration repair`.
--   1. Que no haya transacciones largas abiertas (debe salir vacío):
--        npx supabase db query --linked "select pid, state, now() - xact_start as dura, left(query, 60) as consulta from pg_stat_activity where xact_start < now() - interval '1 minute' and pid <> pg_backend_pid();"
--   2. Aplicarla:
--        npx supabase db query --linked -f supabase/migrations/20261001180000_storage_sin_lectura_publica_global.sql
--      Si falla con 55P03 (lock_not_available), NO se ha aplicado nada (todo
--      va en una transacción): reintentar desde el paso 1. Si falla en el
--      bloque 1 o 3, tampoco se ha aplicado nada: leer el mensaje.
--   3. Probarla (todo dentro de BEGIN … ROLLBACK, no deja nada escrito):
--        npx supabase db query --linked -f supabase/tests/storage_lectura_test.sql
--      y las consultas de VERIFICACIÓN del pie de este fichero.
--   4. Humo en el panel (no hay que desplegar nada):
--      · Con un usuario con la sección facturas: abrir el original de una
--        factura guardada en Storage (botón «ver original») -> abre.
--      · Gestor Web → Carta: cambiar la foto de un plato (upsert + remove).
--      · Marketing → newsletter: «Imagen (opcional)» lista la galería.
--      · Gestor Web → Novedades: subir y quitar una imagen.
--      · Una web pública (casa-tomas-story): las fotos de la carta cargan.
--   5. Humo desde fuera con la anon key (la de las webs), debe devolver []:
--        curl -s -X POST "https://jeamoczmbfsnwkfjxcyo.supabase.co/storage/v1/object/list/facturas-originales" \
--          -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" \
--          -d '{"prefix":"","limit":100}'
--      (antes de aplicar devuelve las carpetas de año de las facturas).
--
-- CANDADOS: DROP POLICY pide ACCESS EXCLUSIVE sobre storage.objects durante
-- milisegundos (subidas, listados y descargas por API esperan ese instante;
-- las URLs públicas también consultan storage.objects y esperan igual).
-- `lock_timeout = 5s` para no quedarse en cola detrás de algo largo.
--
-- Rollback: supabase/rollbacks/20261001180000_storage_sin_lectura_publica_global_ROLLBACK.sql
-- (REABRE LA FUGA: solo para deshacer un despliegue que salió mal).
-- ===========================================================================

begin;

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. PRECONDICIONES: los flujos legítimos no dependen de la global
-- ---------------------------------------------------------------------------
do $$
declare
  b text;
  faltan text := '';
begin
  -- Buckets de contenido público que el panel usa con list / remove /
  -- upsert (y que las webs sirven por URL pública). Cada uno debe tener una
  -- política SELECT acotada a él que valga para anon Y para authenticated
  -- (rol public, o los dos explícitos), distinta de la global.
  foreach b in array array['platos', 'plato', 'vinos', 'bebidas', 'cocteles', 'ecommerce', 'novedades'] loop
    if not exists (
      select 1
        from pg_policies p
       where p.schemaname = 'storage' and p.tablename = 'objects'
         and p.cmd in ('SELECT', 'ALL')
         and p.permissive = 'PERMISSIVE'
         and p.policyname <> 'Lectura pública de buckets'
         and ('public' = any (p.roles)
              or ('anon' = any (p.roles) and 'authenticated' = any (p.roles)))
         and p.qual ~ ('bucket_id = (''' || b || '''|ANY \(ARRAY\[[^]]*''' || b || ''')')
    ) then
      faltan := faltan || b || ' ';
    end if;
  end loop;
  if faltan <> '' then
    raise exception 'Abortado sin tocar nada: estos buckets se quedarían sin lectura propia para anon/authenticated (rompería subir/borrar fotos o la galería): %', faltan;
  end if;

  -- El bucket privado de facturas conserva su lectura por sección.
  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'facturas_originales_select'
       and cmd = 'SELECT'
       and roles::text = '{authenticated}'
       and qual like '%facturas-originales%'
       and qual like '%can_read_section(''facturas''::text)%'
  ) then
    raise exception 'Abortado sin tocar nada: falta o ha cambiado facturas_originales_select (el botón «ver original» dejaría de funcionar para todos)';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. QUITAR LA LECTURA GLOBAL
-- ---------------------------------------------------------------------------
drop policy if exists "Lectura pública de buckets" on storage.objects;

-- ---------------------------------------------------------------------------
-- 3. RED DE SEGURIDAD: si el DROP no casó (tilde, encoding, alguien la
--    renombró) o existe otra política global equivalente, `if exists` lo
--    habría tapado en silencio y la fuga seguiría abierta. Se comprueba
--    contra el catálogo y, si queda alguna, se aborta TODO.
--    Cuenta como «sin restricción de bucket»: qual nulo, qual que no fija
--    bucket_id = '<x>' / bucket_id = ANY (ARRAY['<x>', …]), o qual con un OR
--    (que podría saltarse el bucket). Se excluyen las políticas cuyo único
--    rol es service_role (tiene rolbypassrls: no le cambian nada).
-- ---------------------------------------------------------------------------
do $$
declare sobrantes text;
begin
  select string_agg(format('«%s» (%s, %s, using %s)', policyname, cmd, roles::text, coalesce(qual, 'NULL')), '; ')
    into sobrantes
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and cmd in ('SELECT', 'ALL')
     and roles <> array['service_role']::name[]
     and (qual is null
          or qual !~ 'bucket_id = (''[^'']+''|ANY \(ARRAY\[)'
          or qual ~* '\mOR\M');
  if sobrantes is not null then
    raise exception 'Sigue habiendo lectura de Storage sin acotar por bucket: %', sobrantes;
  end if;
end;
$$;

commit;

-- ===========================================================================
-- LO QUE ESTE FICHERO NO TAPA (fuera del encargo, visto al diagnosticar)
-- ===========================================================================
--   1. `salas` es un bucket PRIVADO (public = false) pero tiene «Acceso
--      público a imágenes de salas» (SELECT TO public, bucket_id = 'salas'):
--      anon puede listar y descargar por API lo que se suba ahí. Hoy está
--      vacío y ningún código lo usa. Decidir: o hacerlo público de verdad o
--      quitar esa política (o borrar el bucket).
--   2. `temp-pdfs`: público, 50 MB, y con «Allow anon uploads to temp-pdfs»
--      (INSERT TO anon): cualquiera con la anon key puede subir PDFs de hasta
--      50 MB y servirlos desde nuestro dominio de Supabase. Vacío y sin uso
--      en los 4 repos (era del OCR viejo de n8n). Candidato a borrarse.
--   3. Las SELECT por bucket de los buckets públicos (rol public) dejan a
--      anon LISTAR su contenido por API (lint de Supabase «public bucket
--      allows listing»). Las webs no lo necesitan (solo URLs públicas), pero
--      el panel sí (list/remove/upsert como authenticated). Se podrían
--      pasar a `TO authenticated` sin romper las webs; se deja para otra
--      migración para no mover nada más aquí.
--   4. Las escrituras de `novedades` y `ecommerce` (y `salas`) siguen sin
--      exigir sección: cualquier autenticado sube/borra. Las de la carta las
--      cierra 20261001150000_carta_escritura_por_seccion (aún sin aplicar).
--   5. Políticas duplicadas en Storage (dos SELECT para platos, dos juegos de
--      escritura en novedades y ecommerce). Inofensivas; consolidables.
--
-- ===========================================================================
-- VERIFICACIÓN tras aplicar (el juego completo: supabase/tests/storage_lectura_test.sql)
-- ===========================================================================
--   select policyname, cmd, roles::text, qual
--   from pg_policies
--   where schemaname = 'storage' and tablename = 'objects' and cmd in ('SELECT', 'ALL')
--   order by policyname;
--   -- -> 10 filas, todas con bucket_id en el USING; ninguna «Lectura pública de buckets».
--
--   Lo que ve anon (antes: facturas-originales 14, novedades 22, platos 105):
--   begin; set local role anon;
--   select bucket_id, count(*) from storage.objects group by 1 order by 1;
--   rollback;
--   -- -> novedades 22, platos 105. SIN facturas-originales.
-- ===========================================================================
