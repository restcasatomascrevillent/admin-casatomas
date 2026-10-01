set client_encoding = 'UTF8';
-- (Primera línea a propósito: psql en una consola de Windows puede arrancar
-- en WIN1252 y leer mal las tildes de los mensajes.)
-- ===========================================================================
-- Pruebas SQL de 20261001180000_storage_sin_lectura_publica_global.sql
-- ---------------------------------------------------------------------------
-- SQL plano (no pgTAP), como el resto de supabase/tests/: cada comprobación
-- es un ASSERT dentro de un DO; el primer fallo aborta con
-- "ASSERT FAILED: <caso>: ...". TODO va dentro de BEGIN … ROLLBACK: no deja
-- nada escrito (ni objetos de Storage, ni usuarios, ni permisos).
--
-- CUÁNDO: DESPUÉS de aplicar la migración (S0 lo comprueba y aborta si no).
--
-- DÓNDE Y CÓMO: vale contra producción (todo se deshace), como `postgres`:
--   npx supabase db query --linked -f supabase/tests/storage_lectura_test.sql
-- o
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/storage_lectura_test.sql
-- Si termina sin ERROR, todo ha pasado (lo último que devuelve es una fila
-- «storage_lectura: todas las comprobaciones han pasado…»).
--
-- NO en el SQL editor: si ahí falla un ASSERT, la transacción puede quedarse
-- abierta (abortada) con filas de prueba en storage.objects.
--
-- QUÉ SE PRUEBA. Solo LECTURA (SELECT sobre storage.objects), que es lo que
-- la migración cambia y lo que necesitan list(), download(),
-- createSignedUrl(), remove() y upload({upsert:true}). Las URLs públicas
-- (/object/public/…) no pasan por la RLS y no se pueden probar desde SQL.
--   S1  catálogo: ni rastro de la global ni de ninguna SELECT sin bucket;
--       facturas_originales_select intacta; cada bucket de contenido
--       conserva su SELECT propia para anon y authenticated.
--   S2  anon: NO ve ningún objeto de facturas-originales (ni el de prueba ni
--       los reales); SÍ ve los de los 7 buckets de contenido y temp-pdfs.
--   S3  autenticado SIN la sección facturas (y un sub fantasma): no ve
--       facturas; sí ve los buckets de contenido (subir/borrar fotos,
--       galería de newsletter).
--   S4  autenticado CON la sección facturas (can_edit = false, como en
--       producción): ve TODAS las facturas (botón «ver original»).
--   S5  super admin sin filas en user_permissions: ídem.
--   S6  service_role (Edge Function procesar-factura): lo ve todo.
--
-- Buckets: contenido = platos, plato, vinos, bebidas, cocteles, ecommerce,
-- novedades. `salas` (privado con política pública propia) no se prueba: la
-- migración no la toca (ver «LO QUE ESTE FICHERO NO TAPA» en la migración).
--
-- NOTA sobre auth.users: el fixture inserta usuarios de prueba con solo
-- (id, email). Si GoTrue exigiera más columnas NOT NULL, el fallo saldrá en
-- ese INSERT y no en un ASSERT: es un problema del fixture, no de la RLS.
--
-- ESTADO: escrito el 2026-10-01 y SIN EJECUTAR (la migración tampoco está
-- aplicada).
-- ===========================================================================

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- S0 la migración está aplicada
-- ---------------------------------------------------------------------------
do $$
begin
  assert not exists (select 1 from pg_policies
                      where schemaname = 'storage' and tablename = 'objects'
                        and policyname = 'Lectura pública de buckets'),
    'S0: sigue existiendo «Lectura pública de buckets»: aplicar antes la migración 20261001180000';
end;
$$;

-- ---------------------------------------------------------------------------
-- S1 catálogo
-- ---------------------------------------------------------------------------
do $$
declare b text; sobrantes text;
begin
  assert (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass),
    'S1a: RLS apagada en storage.objects';

  select string_agg(format('«%s» (%s, %s, using %s)', policyname, cmd, roles::text, coalesce(qual, 'NULL')), '; ')
    into sobrantes
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and cmd in ('SELECT', 'ALL')
     and roles <> array['service_role']::name[]
     and (qual is null
          or qual !~ 'bucket_id = (''[^'']+''|ANY \(ARRAY\[)'
          or qual ~* '\mOR\M');
  assert sobrantes is null, format('S1b: queda lectura de Storage sin acotar por bucket: %s', sobrantes);

  assert exists (select 1 from pg_policies
                  where schemaname = 'storage' and tablename = 'objects'
                    and policyname = 'facturas_originales_select' and cmd = 'SELECT'
                    and roles::text = '{authenticated}'
                    and qual like '%facturas-originales%'
                    and qual like '%can_read_section(''facturas''::text)%'),
    'S1c: falta o ha cambiado facturas_originales_select';

  assert (select public from storage.buckets where id = 'facturas-originales') = false,
    'S1d: el bucket facturas-originales ha dejado de ser privado (sus objetos se servirían por URL pública sin RLS)';

  foreach b in array array['platos', 'plato', 'vinos', 'bebidas', 'cocteles', 'ecommerce', 'novedades'] loop
    assert exists (
      select 1 from pg_policies p
       where p.schemaname = 'storage' and p.tablename = 'objects'
         and p.cmd in ('SELECT', 'ALL') and p.permissive = 'PERMISSIVE'
         and ('public' = any (p.roles)
              or ('anon' = any (p.roles) and 'authenticated' = any (p.roles)))
         and p.qual ~ ('bucket_id = (''' || b || '''|ANY \(ARRAY\[[^]]*''' || b || ''')')),
      format('S1e %s: el bucket se ha quedado sin SELECT propia para anon/authenticated', b);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixture (como postgres)
--   5e101 CON la sección facturas (can_edit = false, como en producción)
--   5e102 SIN facturas (con reservas: el perfil del staff de hoy)
--   5e103 super admin SIN filas en user_permissions (como el dueño)
--   5e1ff sub fantasma: no existe en auth.users (no se inserta)
-- Un objeto de prueba por bucket (contenido + facturas-originales +
-- temp-pdfs) y el total real de facturas-originales, guardado en un GUC
-- local, para comprobar que quien debe verlas las ve TODAS.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000005e101', 'test-storage-con-facturas@rls.local'),
  ('00000000-0000-0000-0000-00000005e102', 'test-storage-sin-facturas@rls.local'),
  ('00000000-0000-0000-0000-00000005e103', 'test-storage-super@rls.local');

insert into public.user_permissions (user_id, section_key, can_view, can_edit) values
  ('00000000-0000-0000-0000-00000005e101', 'facturas', true, false),
  ('00000000-0000-0000-0000-00000005e102', 'reservas', true, false);

insert into public.super_admins (user_id, email) values
  ('00000000-0000-0000-0000-00000005e103', 'test-storage-super@rls.local');

do $$
declare b text; n bigint;
begin
  foreach b in array array['platos', 'plato', 'vinos', 'bebidas', 'cocteles', 'ecommerce', 'novedades',
                           'facturas-originales', 'temp-pdfs'] loop
    insert into storage.objects (bucket_id, name) values (b, 'zz-test-rls-storage/fixture.pdf');
  end loop;

  select count(*) into n from storage.objects where bucket_id = 'facturas-originales';
  assert n >= 1, 'fixture: no se ha podido crear el objeto de prueba en facturas-originales';
  perform set_config('storage_test.total_facturas', n::text, true);
end;
$$;

-- ---------------------------------------------------------------------------
-- S2 anon (la anon key de las webs)
-- ---------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

do $$
declare b text; n bigint;
begin
  -- Ni el objeto de prueba ni NINGUNO de los reales (hoy 14 facturas).
  select count(*) into n from storage.objects where bucket_id = 'facturas-originales';
  assert n = 0, format('S2a: anon ve %s objetos de facturas-originales (LA FUGA SIGUE ABIERTA)', n);

  foreach b in array array['platos', 'plato', 'vinos', 'bebidas', 'cocteles', 'ecommerce', 'novedades', 'temp-pdfs'] loop
    assert exists (select 1 from storage.objects
                    where bucket_id = b and name = 'zz-test-rls-storage/fixture.pdf'),
      format('S2b %s: anon ha dejado de ver los objetos de un bucket público', b);
  end loop;
end;
$$;
reset role;

-- ---------------------------------------------------------------------------
-- S3 autenticado SIN la sección facturas; y un sub fantasma
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000005e102","role":"authenticated"}';

do $$
declare b text; n bigint;
begin
  select count(*) into n from storage.objects where bucket_id = 'facturas-originales';
  assert n = 0, format('S3a: un autenticado SIN la sección facturas ve %s facturas originales', n);

  -- Lo que necesita el panel para subir con upsert, borrar fotos y la galería.
  foreach b in array array['platos', 'plato', 'vinos', 'bebidas', 'cocteles', 'ecommerce', 'novedades'] loop
    assert exists (select 1 from storage.objects
                    where bucket_id = b and name = 'zz-test-rls-storage/fixture.pdf'),
      format('S3b %s: un autenticado ha dejado de ver un bucket de contenido (rompe upsert/remove/list)', b);
  end loop;

  -- Cambio buscado: temp-pdfs solo lo leía authenticated a través de la global.
  select count(*) into n from storage.objects where bucket_id = 'temp-pdfs';
  assert n = 0, format('S3c: un autenticado sigue viendo temp-pdfs (%s): ¿queda alguna lectura global?', n);
end;
$$;
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000005e1ff","role":"authenticated"}';

do $$
declare n bigint;
begin
  select count(*) into n from storage.objects where bucket_id = 'facturas-originales';
  assert n = 0, format('S3d: un sub FANTASMA ve %s facturas originales', n);
end;
$$;
reset role;

-- ---------------------------------------------------------------------------
-- S4 autenticado CON la sección facturas: botón «ver original»
--    (createSignedUrl hace SELECT del objeto) — las ve TODAS
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000005e101","role":"authenticated"}';

do $$
declare b text; n bigint; total bigint := current_setting('storage_test.total_facturas')::bigint;
begin
  assert exists (select 1 from storage.objects
                  where bucket_id = 'facturas-originales' and name = 'zz-test-rls-storage/fixture.pdf'),
    'S4a: un usuario CON la sección facturas no ve el original de prueba';
  select count(*) into n from storage.objects where bucket_id = 'facturas-originales';
  assert n = total, format('S4b: un usuario CON la sección facturas ve %s de %s originales', n, total);

  foreach b in array array['platos', 'plato', 'vinos', 'bebidas', 'cocteles', 'ecommerce', 'novedades'] loop
    assert exists (select 1 from storage.objects
                    where bucket_id = b and name = 'zz-test-rls-storage/fixture.pdf'),
      format('S4c %s: un usuario CON la sección facturas ha dejado de ver un bucket de contenido', b);
  end loop;
end;
$$;
reset role;

-- ---------------------------------------------------------------------------
-- S5 super admin sin filas en user_permissions (el caso del dueño)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000005e103","role":"authenticated"}';

do $$
declare n bigint; total bigint := current_setting('storage_test.total_facturas')::bigint;
begin
  select count(*) into n from storage.objects where bucket_id = 'facturas-originales';
  assert n = total, format('S5a: el super admin ve %s de %s originales', n, total);
end;
$$;
reset role;

-- ---------------------------------------------------------------------------
-- S6 service_role (Edge Function procesar-factura; rolbypassrls)
-- ---------------------------------------------------------------------------
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

do $$
declare b text; n bigint; total bigint := current_setting('storage_test.total_facturas')::bigint;
begin
  select count(*) into n from storage.objects where bucket_id = 'facturas-originales';
  assert n = total, format('S6a: service_role ve %s de %s originales', n, total);

  foreach b in array array['platos', 'plato', 'vinos', 'bebidas', 'cocteles', 'ecommerce', 'novedades', 'temp-pdfs'] loop
    assert exists (select 1 from storage.objects
                    where bucket_id = b and name = 'zz-test-rls-storage/fixture.pdf'),
      format('S6b %s: service_role no ve el objeto de prueba', b);
  end loop;
end;
$$;
reset role;

rollback;

-- ---------------------------------------------------------------------------
-- LIMPIEZA (después del ROLLBACK)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from auth.users where email like 'test-storage-%@rls.local') then
    raise exception 'LIMPIEZA: quedan usuarios test-storage-* tras el ROLLBACK: revisarlo a mano';
  end if;
  if exists (select 1 from storage.objects where name like 'zz-test-rls-storage/%') then
    raise exception 'LIMPIEZA: quedan objetos zz-test-rls-storage/* en Storage tras el ROLLBACK: revisarlo a mano';
  end if;
end
$$;

select 'storage_lectura: todas las comprobaciones han pasado y no queda nada de la prueba' as resultado;
