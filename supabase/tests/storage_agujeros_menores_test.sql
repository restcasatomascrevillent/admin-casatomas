set client_encoding = 'UTF8';
-- (Primera línea a propósito: psql en una consola de Windows puede arrancar
-- en WIN1252 y leer mal las tildes de los mensajes.)
-- ===========================================================================
-- Pruebas SQL de 20261001190000_storage_agujeros_menores.sql
-- ---------------------------------------------------------------------------
-- SQL plano (no pgTAP), como el resto de supabase/tests/: cada comprobación
-- es un ASSERT dentro de un DO; el primer fallo aborta con
-- "ASSERT FAILED: <caso>: ...". TODO va dentro de BEGIN … ROLLBACK: no deja
-- nada escrito (ni objetos de Storage, ni usuarios, ni permisos).
--
-- CUÁNDO: DESPUÉS de aplicar la migración (A0 lo comprueba y aborta si no).
--
-- DÓNDE Y CÓMO: vale contra producción (todo se deshace), como `postgres`:
--   npx supabase db query --linked -f supabase/tests/storage_agujeros_menores_test.sql
-- o
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/storage_agujeros_menores_test.sql
-- Si termina sin ERROR, todo ha pasado (lo último que devuelve es una fila
-- «storage_agujeros_menores: todas las comprobaciones han pasado…»).
--
-- NO en el SQL editor: si ahí falla un ASSERT, la transacción puede quedarse
-- abierta (abortada) con filas de prueba en storage.objects.
--
-- QUÉ SE PRUEBA (sobre storage.objects, que es lo que miran list(),
-- download(), createSignedUrl(), upload() y remove() de la API de Storage;
-- las URLs públicas /object/public/… no pasan por la RLS y no se pueden
-- probar desde SQL):
--   A1  catálogo: ni una política para anon/public; nada sobre salas ni
--       temp-pdfs salvo service_role; escritura de novedades/ecommerce solo
--       por las 3+3 nuevas; lectura solo contenido_lectura_autenticados y
--       facturas_originales_select; buckets sin cambios.
--   A2  anon: no lista NADA (ni salas, ni temp-pdfs, ni contenido); no sube
--       a temp-pdfs, salas, novedades, ecommerce ni platos.
--   A3  autenticado SIN gestion_web ni ecommerce (con gestor_carta, y
--       gestion_web con can_view = false, como el staff de hoy): sigue
--       leyendo los 7 buckets de contenido; no ve salas ni temp-pdfs; no
--       sube, ni cambia, ni borra en novedades, ecommerce, salas ni
--       temp-pdfs; y la carta (gestor_carta) le sigue funcionando: cambiar
--       una foto existente necesita SELECT + UPDATE. Y un sub fantasma.
--   A4  autenticado CON gestion_web: sube, cambia y borra en novedades
--       (Novedades y foto del menú del día); nada en ecommerce ni salas.
--   A5  autenticado CON ecommerce: ídem en ecommerce; nada en novedades.
--   A6  super admin sin filas en user_permissions: escribe en novedades y
--       ecommerce; salas y temp-pdfs siguen cerrados para él por API.
--   A7  service_role: lo ve todo y escribe en salas y temp-pdfs.
--
-- Storage: storage.protect_delete() prohíbe el DELETE directo salvo con
-- storage.allow_delete_query = 'true'; se pone con SET LOCAL para poder
-- probar el DELETE de verdad (si no, A3 pasaría por la razón equivocada).
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
set local storage.allow_delete_query = 'true';

-- ---------------------------------------------------------------------------
-- A0 la migración está aplicada
-- ---------------------------------------------------------------------------
do $$
begin
  assert exists (select 1 from pg_policies
                  where schemaname = 'storage' and tablename = 'objects'
                    and policyname = 'contenido_lectura_autenticados'),
    'A0: falta contenido_lectura_autenticados: aplicar antes la migración 20261001190000';
end;
$$;

-- ---------------------------------------------------------------------------
-- A1 catálogo
-- ---------------------------------------------------------------------------
do $$
declare b text; malas text; n int;
begin
  assert (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass),
    'A1a: RLS apagada en storage.objects';

  select string_agg(format('«%s» (%s, %s)', policyname, cmd, roles::text), '; ') into malas
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and ('anon' = any (roles) or 'public' = any (roles));
  assert malas is null, format('A1b: quedan políticas de Storage para anon/public: %s', malas);

  select string_agg(format('«%s» (%s, %s)', policyname, cmd, roles::text), '; ') into malas
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and roles <> array['service_role']::name[]
     and (coalesce(qual, '') || coalesce(with_check, '')) ~ '''(salas|temp-pdfs)''';
  assert malas is null, format('A1c: quedan políticas sobre salas/temp-pdfs para alguien que no es service_role: %s', malas);

  select string_agg(policyname, ', ' order by policyname) into malas
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
     and roles <> array['service_role']::name[]
     and (coalesce(qual, '') || coalesce(with_check, '')) ~ '''novedades''';
  assert malas = 'novedades_imagenes_delete_seccion, novedades_imagenes_insert_seccion, novedades_imagenes_update_seccion',
    format('A1d: la escritura de novedades no es exactamente la de las 3 nuevas: %s', malas);

  select string_agg(policyname, ', ' order by policyname) into malas
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
     and roles <> array['service_role']::name[]
     and (coalesce(qual, '') || coalesce(with_check, '')) ~ '''ecommerce''';
  assert malas = 'ecommerce_imagenes_delete_seccion, ecommerce_imagenes_insert_seccion, ecommerce_imagenes_update_seccion',
    format('A1e: la escritura de ecommerce no es exactamente la de las 3 nuevas: %s', malas);

  select count(*) into n from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and roles::text = '{authenticated}'
     and ((policyname like 'novedades\_imagenes\_%' and coalesce(qual, with_check) like '%can_write_section(''gestion_web''::text)%'
           and coalesce(with_check, qual) like '%can_write_section(''gestion_web''::text)%')
       or (policyname like 'ecommerce\_imagenes\_%' and coalesce(qual, with_check) like '%can_write_section(''ecommerce''::text)%'
           and coalesce(with_check, qual) like '%can_write_section(''ecommerce''::text)%'));
  assert n = 6, format('A1f: se esperaban 6 políticas de escritura con su sección (gestion_web / ecommerce), hay %s', n);

  select string_agg(policyname, ', ' order by policyname) into malas
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and cmd in ('SELECT', 'ALL')
     and roles <> array['service_role']::name[];
  assert malas = 'contenido_lectura_autenticados, facturas_originales_select',
    format('A1g: la lectura de Storage no es exactamente contenido_lectura_autenticados + facturas_originales_select: %s', malas);

  assert exists (select 1 from pg_policies
                  where schemaname = 'storage' and tablename = 'objects'
                    and policyname = 'Allow service role delete from temp-pdfs'
                    and roles::text = '{service_role}'),
    'A1h: ha desaparecido «Allow service role delete from temp-pdfs» (la migración no debía tocarla)';

  -- Buckets: la migración no los toca.
  assert (select public from storage.buckets where id = 'salas') = false, 'A1i: salas ha dejado de ser privado';
  assert (select public from storage.buckets where id = 'temp-pdfs') = true, 'A1j: temp-pdfs ha cambiado de public';
  assert (select public from storage.buckets where id = 'facturas-originales') = false, 'A1k: facturas-originales ha dejado de ser privado';
  foreach b in array array['platos', 'plato', 'vinos', 'bebidas', 'cocteles', 'ecommerce', 'novedades'] loop
    assert (select public from storage.buckets where id = b) = true,
      format('A1l %s: el bucket de contenido ya no es público (las fotos de las webs dejarían de verse)', b);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixture (como postgres)
--   a9101 CON gestion_web (can_edit = false, como en producción)
--   a9102 CON ecommerce
--   a9103 SIN gestion_web ni ecommerce: gestor_carta + reservas, y
--         gestion_web con can_view = false (el perfil del staff de hoy)
--   a9104 super admin SIN filas en user_permissions (como el dueño)
--   a91ff sub fantasma: no existe en auth.users (no se inserta)
-- Un objeto de prueba por bucket (7 de contenido + salas + temp-pdfs).
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000a9101', 'test-agujeros-gestion-web@rls.local'),
  ('00000000-0000-0000-0000-0000000a9102', 'test-agujeros-ecommerce@rls.local'),
  ('00000000-0000-0000-0000-0000000a9103', 'test-agujeros-sin-seccion@rls.local'),
  ('00000000-0000-0000-0000-0000000a9104', 'test-agujeros-super@rls.local');

insert into public.user_permissions (user_id, section_key, can_view, can_edit) values
  ('00000000-0000-0000-0000-0000000a9101', 'gestion_web',  true,  false),
  ('00000000-0000-0000-0000-0000000a9102', 'ecommerce',    true,  false),
  ('00000000-0000-0000-0000-0000000a9103', 'gestor_carta', true,  false),
  ('00000000-0000-0000-0000-0000000a9103', 'reservas',     true,  false),
  ('00000000-0000-0000-0000-0000000a9103', 'gestion_web',  false, false);

insert into public.super_admins (user_id, email) values
  ('00000000-0000-0000-0000-0000000a9104', 'test-agujeros-super@rls.local');

do $$
declare b text;
begin
  foreach b in array array['platos', 'plato', 'vinos', 'bebidas', 'cocteles', 'ecommerce', 'novedades',
                           'salas', 'temp-pdfs'] loop
    insert into storage.objects (bucket_id, name) values (b, 'zz-test-rls-agujeros/fixture.jpg');
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- A2 anon (la anon key de las webs): no lista nada y no sube nada
-- ---------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

do $$
declare b text; n bigint;
begin
  select count(*) into n from storage.objects;
  assert n = 0, format('A2a: anon ve %s objetos de Storage por API (debería ver 0: las webs usan URLs públicas)', n);

  foreach b in array array['temp-pdfs', 'salas', 'novedades', 'ecommerce', 'platos'] loop
    begin
      insert into storage.objects (bucket_id, name) values (b, 'zz-test-rls-agujeros/anon.pdf');
      raise exception 'A2b %: anon pudo SUBIR un objeto', b;
    exception when insufficient_privilege then null;
    end;
  end loop;
end;
$$;
reset role;

-- ---------------------------------------------------------------------------
-- A3 autenticado SIN gestion_web ni ecommerce (con gestor_carta)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000a9103","role":"authenticated"}';

do $$
declare b text; n bigint;
begin
  -- Lectura del panel (upsert/remove/galería de la newsletter): intacta.
  foreach b in array array['platos', 'plato', 'vinos', 'bebidas', 'cocteles', 'ecommerce', 'novedades'] loop
    assert exists (select 1 from storage.objects
                    where bucket_id = b and name = 'zz-test-rls-agujeros/fixture.jpg'),
      format('A3a %s: un autenticado ha dejado de ver un bucket de contenido (rompe upsert/remove/list)', b);
  end loop;

  select count(*) into n from storage.objects where bucket_id in ('salas', 'temp-pdfs');
  assert n = 0, format('A3b: un autenticado ve %s objetos de salas/temp-pdfs', n);

  foreach b in array array['novedades', 'ecommerce', 'salas', 'temp-pdfs'] loop
    begin
      insert into storage.objects (bucket_id, name) values (b, 'zz-test-rls-agujeros/sin.jpg');
      raise exception 'A3c %: un usuario SIN la sección pudo subir', b;
    exception when insufficient_privilege then null;
    end;

    update storage.objects set metadata = '{"test":"sin"}'
     where bucket_id = b and name = 'zz-test-rls-agujeros/fixture.jpg';
    get diagnostics n = row_count;
    assert n = 0, format('A3d %s: un usuario SIN la sección pudo sobrescribir', b);

    delete from storage.objects where bucket_id = b and name = 'zz-test-rls-agujeros/fixture.jpg';
    get diagnostics n = row_count;
    assert n = 0, format('A3e %s: un usuario SIN la sección pudo borrar', b);
  end loop;

  -- La carta le sigue funcionando: cambiar una foto existente (lo que hace
  -- upload con upsert) necesita SELECT (ahora contenido_lectura_autenticados)
  -- + UPDATE (carta_imagenes_update_seccion).
  update storage.objects set metadata = '{"test":"carta"}'
   where bucket_id = 'platos' and name = 'zz-test-rls-agujeros/fixture.jpg';
  get diagnostics n = row_count;
  assert n = 1, 'A3f: un usuario CON gestor_carta ya no puede cambiar una foto de la carta';
end;
$$;
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000a91ff","role":"authenticated"}';

do $$
declare b text; n bigint;
begin
  foreach b in array array['novedades', 'ecommerce', 'salas', 'temp-pdfs'] loop
    begin
      insert into storage.objects (bucket_id, name) values (b, 'zz-test-rls-agujeros/fantasma.jpg');
      raise exception 'A3g %: un sub FANTASMA pudo subir', b;
    exception when insufficient_privilege then null;
    end;
    update storage.objects set metadata = '{"test":"fantasma"}'
     where bucket_id = b and name = 'zz-test-rls-agujeros/fixture.jpg';
    get diagnostics n = row_count;
    assert n = 0, format('A3h %s: un sub FANTASMA pudo sobrescribir', b);
    delete from storage.objects where bucket_id = b and name = 'zz-test-rls-agujeros/fixture.jpg';
    get diagnostics n = row_count;
    assert n = 0, format('A3i %s: un sub FANTASMA pudo borrar', b);
  end loop;
end;
$$;
reset role;

-- ---------------------------------------------------------------------------
-- A4 autenticado CON gestion_web: Novedades y foto del menú del día
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000a9101","role":"authenticated"}';

do $$
declare b text; n bigint;
begin
  -- Las dos rutas reales: EditorNovedadesWeb (novedades/…) y foto-menu-dia (menu-dia/…).
  insert into storage.objects (bucket_id, name) values ('novedades', 'zz-test-rls-agujeros/novedades/con.jpg');
  insert into storage.objects (bucket_id, name) values ('novedades', 'zz-test-rls-agujeros/menu-dia/con.jpg');

  update storage.objects set metadata = '{"test":"con"}'
   where bucket_id = 'novedades' and name = 'zz-test-rls-agujeros/fixture.jpg';
  get diagnostics n = row_count;
  assert n = 1, 'A4a: un usuario CON gestion_web no pudo sobrescribir una imagen de novedades';

  delete from storage.objects where bucket_id = 'novedades' and name = 'zz-test-rls-agujeros/novedades/con.jpg';
  get diagnostics n = row_count;
  assert n = 1, 'A4b: un usuario CON gestion_web no pudo borrar una imagen de novedades';

  foreach b in array array['ecommerce', 'salas'] loop
    begin
      insert into storage.objects (bucket_id, name) values (b, 'zz-test-rls-agujeros/gw.jpg');
      raise exception 'A4c %: un usuario con gestion_web pudo subir fuera de novedades', b;
    exception when insufficient_privilege then null;
    end;
  end loop;
  update storage.objects set metadata = '{"test":"gw"}'
   where bucket_id = 'ecommerce' and name = 'zz-test-rls-agujeros/fixture.jpg';
  get diagnostics n = row_count;
  assert n = 0, 'A4d: un usuario con gestion_web pudo sobrescribir en ecommerce';
end;
$$;
reset role;

-- ---------------------------------------------------------------------------
-- A5 autenticado CON ecommerce
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000a9102","role":"authenticated"}';

do $$
declare n bigint;
begin
  insert into storage.objects (bucket_id, name) values ('ecommerce', 'zz-test-rls-agujeros/con.jpg');

  update storage.objects set metadata = '{"test":"con"}'
   where bucket_id = 'ecommerce' and name = 'zz-test-rls-agujeros/fixture.jpg';
  get diagnostics n = row_count;
  assert n = 1, 'A5a: un usuario CON ecommerce no pudo sobrescribir una imagen de ecommerce';

  delete from storage.objects where bucket_id = 'ecommerce' and name = 'zz-test-rls-agujeros/con.jpg';
  get diagnostics n = row_count;
  assert n = 1, 'A5b: un usuario CON ecommerce no pudo borrar una imagen de ecommerce';

  begin
    insert into storage.objects (bucket_id, name) values ('novedades', 'zz-test-rls-agujeros/ec.jpg');
    raise exception 'A5c: un usuario con ecommerce pudo subir a novedades';
  exception when insufficient_privilege then null;
  end;
  delete from storage.objects where bucket_id = 'novedades' and name = 'zz-test-rls-agujeros/fixture.jpg';
  get diagnostics n = row_count;
  assert n = 0, 'A5d: un usuario con ecommerce pudo borrar en novedades';
end;
$$;
reset role;

-- ---------------------------------------------------------------------------
-- A6 super admin sin filas en user_permissions (el caso del dueño)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000a9104","role":"authenticated"}';

do $$
declare b text; n bigint;
begin
  foreach b in array array['novedades', 'ecommerce'] loop
    insert into storage.objects (bucket_id, name) values (b, 'zz-test-rls-agujeros/super.jpg');
    update storage.objects set metadata = '{"test":"super"}'
     where bucket_id = b and name = 'zz-test-rls-agujeros/super.jpg';
    get diagnostics n = row_count;
    assert n = 1, format('A6a %s: el super admin no pudo sobrescribir', b);
    delete from storage.objects where bucket_id = b and name = 'zz-test-rls-agujeros/super.jpg';
    get diagnostics n = row_count;
    assert n = 1, format('A6b %s: el super admin no pudo borrar', b);
  end loop;

  -- salas y temp-pdfs: cerrados por API también para él (solo service_role).
  select count(*) into n from storage.objects where bucket_id in ('salas', 'temp-pdfs');
  assert n = 0, format('A6c: el super admin ve %s objetos de salas/temp-pdfs por API', n);
  foreach b in array array['salas', 'temp-pdfs'] loop
    begin
      insert into storage.objects (bucket_id, name) values (b, 'zz-test-rls-agujeros/super.jpg');
      raise exception 'A6d %: el super admin pudo subir por API', b;
    exception when insufficient_privilege then null;
    end;
  end loop;
end;
$$;
reset role;

-- ---------------------------------------------------------------------------
-- A7 service_role (dashboard / Edge Functions; rolbypassrls)
-- ---------------------------------------------------------------------------
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

do $$
declare b text; n bigint;
begin
  foreach b in array array['platos', 'plato', 'vinos', 'bebidas', 'cocteles', 'ecommerce', 'novedades', 'salas', 'temp-pdfs'] loop
    assert exists (select 1 from storage.objects
                    where bucket_id = b and name = 'zz-test-rls-agujeros/fixture.jpg'),
      format('A7a %s: service_role no ve el objeto de prueba', b);
  end loop;

  foreach b in array array['salas', 'temp-pdfs', 'novedades', 'ecommerce'] loop
    insert into storage.objects (bucket_id, name) values (b, 'zz-test-rls-agujeros/sr.pdf');
    delete from storage.objects where bucket_id = b and name = 'zz-test-rls-agujeros/sr.pdf';
    get diagnostics n = row_count;
    assert n = 1, format('A7b %s: service_role no pudo subir y borrar', b);
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
  if exists (select 1 from auth.users where email like 'test-agujeros-%@rls.local') then
    raise exception 'LIMPIEZA: quedan usuarios test-agujeros-* tras el ROLLBACK: revisarlo a mano';
  end if;
  if exists (select 1 from storage.objects where name like 'zz-test-rls-agujeros/%') then
    raise exception 'LIMPIEZA: quedan objetos zz-test-rls-agujeros/* en Storage tras el ROLLBACK: revisarlo a mano';
  end if;
end
$$;

select 'storage_agujeros_menores: todas las comprobaciones han pasado y no queda nada de la prueba' as resultado;
