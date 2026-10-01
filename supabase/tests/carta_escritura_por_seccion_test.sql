set client_encoding = 'UTF8';
-- (Primera línea a propósito: psql en una consola de Windows puede arrancar
-- en WIN1252 y leer mal las tildes de los mensajes.)
-- ===========================================================================
-- Pruebas SQL de 20261001150000_carta_escritura_por_seccion.sql
-- ---------------------------------------------------------------------------
-- SQL plano (no pgTAP), como el resto de supabase/tests/: cada comprobación
-- es un ASSERT dentro de un DO; el primer fallo aborta con
-- "ASSERT FAILED: <caso>: ...". TODO va dentro de BEGIN … ROLLBACK: no deja
-- nada escrito (ni filas de carta, ni objetos de Storage, ni usuarios).
--
-- CUÁNDO: DESPUÉS de aplicar la migración (T0 lo comprueba y aborta si no).
--
-- DÓNDE Y CÓMO: vale contra producción (todo se deshace), como `postgres`:
--   npx supabase db query --linked -f supabase/tests/carta_escritura_por_seccion_test.sql
-- o
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/carta_escritura_por_seccion_test.sql
-- Si termina sin ERROR, todo ha pasado (lo último que devuelve es una fila
-- «carta_escritura_por_seccion: todas las comprobaciones han pasado…»).
--
-- NO en el SQL editor: si ahí falla un ASSERT, la transacción puede quedarse
-- abierta (abortada) reteniendo candados sobre la carta.
--
-- QUÉ SE PRUEBA, en las 4 tablas (Platos, Vinos, Cocteles, Bebidas) y en los
-- 5 buckets de fotos (platos, plato, vinos, bebidas, cocteles):
--   T1  catálogo: políticas, grants (anon SOLO SELECT, sin TRUNCATE).
--   T2  anon: lee SOLO las filas con activado = true; no escribe nada.
--   T3  autenticado SIN gestor_carta (con gestion_web, y un sub fantasma):
--       sigue leyendo todo; INSERT rechazado; UPDATE/DELETE no alcanzan
--       ninguna fila; en Storage, ni sube, ni cambia, ni borra.
--   T4  autenticado CON gestor_carta (can_edit = false, como en producción):
--       crea, edita (precio + activado), borra; sube, cambia y borra fotos.
--   T5  super admin sin filas en user_permissions: igual que T4.
--   T6  service_role: crea, edita y borra.
--
-- Storage: storage.protect_delete() prohíbe el DELETE directo salvo con
-- storage.allow_delete_query = 'true'; se pone con SET LOCAL para poder
-- probar el DELETE de verdad (si no, T3 pasaría por la razón equivocada).
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
-- T0 la migración está aplicada
-- ---------------------------------------------------------------------------
do $$
begin
  assert exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'Platos'
                    and policyname = 'platos_insert_seccion'),
    'T0: falta platos_insert_seccion: aplicar antes la migración 20261001150000';
end;
$$;

-- ---------------------------------------------------------------------------
-- T1 catálogo
-- ---------------------------------------------------------------------------
do $$
declare
  t text; p text; privs text; n int; esperadas_select int;
begin
  foreach t in array array['Platos', 'Vinos', 'Cocteles', 'Bebidas'] loop
    p := lower(t);

    assert (select relrowsecurity from pg_class where oid = format('public.%I', t)::regclass),
      format('T1a %s: RLS apagada', t);

    -- Escritura: EXACTAMENTE las 4 nuevas, ni una más (las permissive se suman con OR).
    select count(*) into n from pg_policies
     where schemaname = 'public' and tablename = t and cmd <> 'SELECT';
    assert n = 4, format('T1b %s: se esperaban 4 políticas de escritura, hay %s', t, n);

    assert exists (select 1 from pg_policies where schemaname = 'public' and tablename = t
                    and policyname = p || '_insert_seccion' and cmd = 'INSERT' and roles::text = '{authenticated}'
                    and with_check like '%can_write_section(''gestor_carta''::text)%'),
      format('T1c %s: falta o está mal %s_insert_seccion', t, p);
    assert exists (select 1 from pg_policies where schemaname = 'public' and tablename = t
                    and policyname = p || '_update_seccion' and cmd = 'UPDATE' and roles::text = '{authenticated}'
                    and qual like '%can_write_section(''gestor_carta''::text)%'
                    and with_check like '%can_write_section(''gestor_carta''::text)%'),
      format('T1d %s: falta o está mal %s_update_seccion', t, p);
    assert exists (select 1 from pg_policies where schemaname = 'public' and tablename = t
                    and policyname = p || '_delete_seccion' and cmd = 'DELETE' and roles::text = '{authenticated}'
                    and qual like '%can_write_section(''gestor_carta''::text)%'),
      format('T1e %s: falta o está mal %s_delete_seccion', t, p);
    assert exists (select 1 from pg_policies where schemaname = 'public' and tablename = t
                    and policyname = p || '_service_role' and cmd = 'ALL' and roles::text = '{service_role}'),
      format('T1f %s: falta %s_service_role', t, p);

    -- Lectura: las SELECT de siempre, intactas (3 por tabla; Cocteles 2),
    -- incluida la anónima de activados.
    esperadas_select := case when t = 'Cocteles' then 2 else 3 end;
    select count(*) into n from pg_policies
     where schemaname = 'public' and tablename = t and cmd = 'SELECT';
    assert n = esperadas_select,
      format('T1g %s: se esperaban %s políticas SELECT (las de antes), hay %s', t, esperadas_select, n);
    assert exists (select 1 from pg_policies where schemaname = 'public' and tablename = t
                    and cmd = 'SELECT' and roles::text = '{public}' and qual = '(activado = true)'),
      format('T1h %s: ha desaparecido la lectura pública de activados', t);

    -- Grants
    select coalesce(string_agg(privilege_type, ',' order by privilege_type), '(ninguno)') into privs
      from information_schema.role_table_grants
     where table_schema = 'public' and table_name = t and grantee = 'anon';
    assert privs = 'SELECT', format('T1i %s: anon debería tener SOLO SELECT, tiene: %s', t, privs);

    assert not has_table_privilege('authenticated', format('public.%I', t), 'TRUNCATE'),
      format('T1j %s: authenticated conserva TRUNCATE (no pasa por la RLS)', t);
    -- Uno a uno: con una lista separada por comas has_table_privilege
    -- devuelve true si tiene CUALQUIERA de ellos.
    assert has_table_privilege('authenticated', format('public.%I', t), 'SELECT')
       and has_table_privilege('authenticated', format('public.%I', t), 'INSERT')
       and has_table_privilege('authenticated', format('public.%I', t), 'UPDATE')
       and has_table_privilege('authenticated', format('public.%I', t), 'DELETE'),
      format('T1k %s: authenticated ha perdido algún privilegio que el panel necesita', t);
  end loop;

  -- Storage: las 3 nuevas y ninguna otra de escritura sobre los buckets de la carta.
  select count(*) into n from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname in ('carta_imagenes_insert_seccion', 'carta_imagenes_update_seccion', 'carta_imagenes_delete_seccion')
     and roles::text = '{authenticated}';
  assert n = 3, format('T1l: se esperaban las 3 políticas carta_imagenes_* de Storage, hay %s', n);

  select string_agg(policyname, ', ') into privs from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
     and policyname not like 'carta\_imagenes\_%'
     and (coalesce(qual, '') ~ '''(platos|plato|vinos|bebidas|cocteles|carta)'''
          or coalesce(with_check, '') ~ '''(platos|plato|vinos|bebidas|cocteles|carta)''');
  assert privs is null, format('T1m: sobreviven políticas de escritura viejas en Storage: %s', privs);

  select count(*) into n from storage.buckets where id in ('platos', 'plato', 'vinos', 'bebidas', 'cocteles');
  assert n = 5, format('T1n: se esperaban los 5 buckets de la carta, hay %s', n);
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixture (como postgres)
--   ca101 CON gestor_carta (can_edit = false, como todos en producción)
--   ca102 SIN gestor_carta, pero con gestion_web (ve Gestor Web, no la Carta)
--   ca103 super admin SIN filas en user_permissions (como el dueño)
--   ca1ff sub fantasma: no existe en auth.users (no se inserta)
-- En cada tabla, una fila activada y otra desactivada; en cada bucket, un
-- objeto. Y los recuentos que debe ver anon, guardados en GUCs locales.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000ca101', 'test-carta-con-seccion@rls.local'),
  ('00000000-0000-0000-0000-0000000ca102', 'test-carta-sin-seccion@rls.local'),
  ('00000000-0000-0000-0000-0000000ca103', 'test-carta-super@rls.local');

insert into public.user_permissions (user_id, section_key, can_view, can_edit) values
  ('00000000-0000-0000-0000-0000000ca101', 'gestor_carta', true, false),
  ('00000000-0000-0000-0000-0000000ca102', 'gestion_web',  true, false);

insert into public.super_admins (user_id, email) values
  ('00000000-0000-0000-0000-0000000ca103', 'test-carta-super@rls.local');

do $$
declare t text; b text; n bigint;
begin
  foreach t in array array['Platos', 'Vinos', 'Cocteles', 'Bebidas'] loop
    execute format('insert into public.%I (id, nombre, activado) values
                      (''test-rls-carta-on'',  ''TEST RLS on'',  true),
                      (''test-rls-carta-off'', ''TEST RLS off'', false)', t);
    execute format('select count(*) from public.%I where activado = true', t) into n;
    perform set_config('carta_test.activos_' || lower(t), n::text, true);
  end loop;

  foreach b in array array['platos', 'plato', 'vinos', 'bebidas', 'cocteles'] loop
    insert into storage.objects (bucket_id, name) values (b, 'zz-test-rls-carta/fixture.jpg');
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- T2 anon: lee SOLO activados (igual que hoy) y no escribe nada
-- ---------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

do $$
declare t text; n bigint; esperado bigint;
begin
  foreach t in array array['Platos', 'Vinos', 'Cocteles', 'Bebidas'] loop
    esperado := current_setting('carta_test.activos_' || lower(t))::bigint;
    execute format('select count(*) from public.%I', t) into n;
    assert n = esperado, format('T2a %s: anon ve %s filas, debería ver las %s activadas', t, n, esperado);

    execute format('select count(*) from public.%I where id = ''test-rls-carta-on''', t) into n;
    assert n = 1, format('T2b %s: anon no ve una fila activada', t);
    execute format('select count(*) from public.%I where id = ''test-rls-carta-off''', t) into n;
    assert n = 0, format('T2c %s: anon ve una fila DESACTIVADA', t);

    begin
      execute format('insert into public.%I (id, nombre, activado) values (''test-rls-carta-anon'', ''x'', true)', t);
      raise exception 'T2d %: anon pudo hacer INSERT', t;
    exception when insufficient_privilege then null;
    end;
    begin
      execute format('update public.%I set precio_eur = 0.01 where id = ''test-rls-carta-on''', t);
      raise exception 'T2e %: anon pudo hacer UPDATE', t;
    exception when insufficient_privilege then null;
    end;
    begin
      execute format('delete from public.%I where id = ''test-rls-carta-on''', t);
      raise exception 'T2f %: anon pudo hacer DELETE', t;
    exception when insufficient_privilege then null;
    end;
  end loop;

  begin
    insert into storage.objects (bucket_id, name) values ('platos', 'zz-test-rls-carta/anon.jpg');
    raise exception 'T2g: anon pudo subir una foto al bucket platos';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

-- ---------------------------------------------------------------------------
-- T3 autenticado SIN gestor_carta: lee, pero no escribe ni en tablas ni en
--    Storage. Se repite con el sub fantasma (no existe en auth.users).
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000ca102","role":"authenticated"}';

do $$
declare t text; b text; n bigint;
begin
  foreach t in array array['Platos', 'Vinos', 'Cocteles', 'Bebidas'] loop
    -- La lectura del panel no cambia (Menús diarios / bot web leen Platos y Vinos).
    execute format('select count(*) from public.%I where id like ''test-rls-carta-%%''', t) into n;
    assert n = 2, format('T3a %s: un autenticado sin la sección ya no lee todo (ve %s de 2)', t, n);

    begin
      execute format('insert into public.%I (id, nombre, activado) values (''test-rls-carta-sin'', ''x'', true)', t);
      raise exception 'T3b %: un usuario SIN gestor_carta pudo hacer INSERT', t;
    exception when insufficient_privilege then null;
    end;

    execute format('update public.%I set precio_eur = 0.01 where id = ''test-rls-carta-on''', t);
    get diagnostics n = row_count;
    assert n = 0, format('T3c %s: un usuario SIN gestor_carta pudo cambiar un precio', t);

    execute format('update public.%I set activado = false where id = ''test-rls-carta-on''', t);
    get diagnostics n = row_count;
    assert n = 0, format('T3d %s: un usuario SIN gestor_carta pudo despublicar', t);

    execute format('delete from public.%I where id like ''test-rls-carta-%%''', t);
    get diagnostics n = row_count;
    assert n = 0, format('T3e %s: un usuario SIN gestor_carta pudo borrar', t);

    begin
      execute format('truncate public.%I', t);
      raise exception 'T3f %: un usuario SIN gestor_carta pudo hacer TRUNCATE', t;
    exception when insufficient_privilege then null;
    end;
  end loop;

  foreach b in array array['platos', 'plato', 'vinos', 'bebidas', 'cocteles'] loop
    begin
      insert into storage.objects (bucket_id, name) values (b, 'zz-test-rls-carta/sin.jpg');
      raise exception 'T3g %: un usuario SIN gestor_carta pudo subir una foto', b;
    exception when insufficient_privilege then null;
    end;

    update storage.objects set metadata = '{"test":"sin"}'
     where bucket_id = b and name = 'zz-test-rls-carta/fixture.jpg';
    get diagnostics n = row_count;
    assert n = 0, format('T3h %s: un usuario SIN gestor_carta pudo sobrescribir una foto', b);

    delete from storage.objects where bucket_id = b and name = 'zz-test-rls-carta/fixture.jpg';
    get diagnostics n = row_count;
    assert n = 0, format('T3i %s: un usuario SIN gestor_carta pudo borrar una foto', b);
  end loop;
end;
$$;
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000ca1ff","role":"authenticated"}';

do $$
declare t text; n bigint;
begin
  foreach t in array array['Platos', 'Vinos', 'Cocteles', 'Bebidas'] loop
    begin
      execute format('insert into public.%I (id, nombre, activado) values (''test-rls-carta-fantasma'', ''x'', true)', t);
      raise exception 'T3j %: un sub FANTASMA pudo hacer INSERT', t;
    exception when insufficient_privilege then null;
    end;
    execute format('update public.%I set precio_eur = 0.01 where id like ''test-rls-carta-%%''', t);
    get diagnostics n = row_count;
    assert n = 0, format('T3k %s: un sub FANTASMA pudo hacer UPDATE', t);
    execute format('delete from public.%I where id like ''test-rls-carta-%%''', t);
    get diagnostics n = row_count;
    assert n = 0, format('T3l %s: un sub FANTASMA pudo hacer DELETE', t);
  end loop;
end;
$$;
reset role;

-- ---------------------------------------------------------------------------
-- T4 autenticado CON gestor_carta: todos los flujos del panel
--    (crear con .select(), cambiar precio, activar/despublicar, borrar; y
--    subir / sobrescribir / borrar foto)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000ca101","role":"authenticated"}';

do $$
declare t text; b text; n bigint; nuevo text;
begin
  foreach t in array array['Platos', 'Vinos', 'Cocteles', 'Bebidas'] loop
    execute format('insert into public.%I (id, nombre, activado, precio_eur) values (''test-rls-carta-con'', ''TEST con'', true, 9.5) returning id', t)
      into nuevo;
    assert nuevo = 'test-rls-carta-con', format('T4a %s: un usuario CON gestor_carta no pudo crear (o no ve lo creado)', t);

    execute format('update public.%I set precio_eur = 12.3 where id = ''test-rls-carta-on''', t);
    get diagnostics n = row_count;
    assert n = 1, format('T4b %s: un usuario CON gestor_carta no pudo cambiar un precio', t);

    execute format('update public.%I set activado = true where id = ''test-rls-carta-off''', t);
    get diagnostics n = row_count;
    assert n = 1, format('T4c %s: un usuario CON gestor_carta no pudo publicar', t);
    execute format('update public.%I set activado = false where id = ''test-rls-carta-off''', t);
    get diagnostics n = row_count;
    assert n = 1, format('T4d %s: un usuario CON gestor_carta no pudo despublicar', t);

    execute format('delete from public.%I where id = ''test-rls-carta-con''', t);
    get diagnostics n = row_count;
    assert n = 1, format('T4e %s: un usuario CON gestor_carta no pudo borrar', t);
  end loop;

  foreach b in array array['platos', 'plato', 'vinos', 'bebidas', 'cocteles'] loop
    insert into storage.objects (bucket_id, name) values (b, 'zz-test-rls-carta/con.jpg');

    update storage.objects set metadata = '{"test":"con"}'
     where bucket_id = b and name = 'zz-test-rls-carta/fixture.jpg';
    get diagnostics n = row_count;
    assert n = 1, format('T4f %s: un usuario CON gestor_carta no pudo sobrescribir una foto', b);

    delete from storage.objects where bucket_id = b and name = 'zz-test-rls-carta/con.jpg';
    get diagnostics n = row_count;
    assert n = 1, format('T4g %s: un usuario CON gestor_carta no pudo borrar una foto', b);
  end loop;
end;
$$;
reset role;

-- ---------------------------------------------------------------------------
-- T5 super admin sin filas en user_permissions (el caso del dueño)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000ca103","role":"authenticated"}';

do $$
declare t text; n bigint;
begin
  foreach t in array array['Platos', 'Vinos', 'Cocteles', 'Bebidas'] loop
    execute format('insert into public.%I (id, nombre, activado) values (''test-rls-carta-super'', ''TEST super'', true)', t);
    execute format('update public.%I set precio_eur = 7.7 where id = ''test-rls-carta-super''', t);
    get diagnostics n = row_count;
    assert n = 1, format('T5a %s: el super admin no pudo editar', t);
    execute format('delete from public.%I where id = ''test-rls-carta-super''', t);
    get diagnostics n = row_count;
    assert n = 1, format('T5b %s: el super admin no pudo borrar', t);
  end loop;

  insert into storage.objects (bucket_id, name) values ('platos', 'zz-test-rls-carta/super.jpg');
  delete from storage.objects where bucket_id = 'platos' and name = 'zz-test-rls-carta/super.jpg';
  get diagnostics n = row_count;
  assert n = 1, 'T5c: el super admin no pudo borrar una foto';
end;
$$;
reset role;

-- ---------------------------------------------------------------------------
-- T6 service_role (Edge Functions, bots de teléfono): sigue escribiendo
-- ---------------------------------------------------------------------------
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

do $$
declare t text; n bigint;
begin
  foreach t in array array['Platos', 'Vinos', 'Cocteles', 'Bebidas'] loop
    execute format('insert into public.%I (id, nombre, activado) values (''test-rls-carta-sr'', ''TEST sr'', true)', t);
    execute format('update public.%I set precio_eur = 3.3 where id in (''test-rls-carta-sr'', ''test-rls-carta-off'')', t);
    get diagnostics n = row_count;
    assert n = 2, format('T6a %s: service_role no pudo editar (incluida una fila desactivada)', t);
    execute format('delete from public.%I where id = ''test-rls-carta-sr''', t);
    get diagnostics n = row_count;
    assert n = 1, format('T6b %s: service_role no pudo borrar', t);
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
  if exists (select 1 from auth.users where email like 'test-carta-%@rls.local') then
    raise exception 'LIMPIEZA: quedan usuarios test-carta-* tras el ROLLBACK: revisarlo a mano';
  end if;
  if exists (select 1 from public."Platos" where id like 'test-rls-carta-%') then
    raise exception 'LIMPIEZA: quedan filas test-rls-carta-* en Platos tras el ROLLBACK: revisarlo a mano';
  end if;
  if exists (select 1 from storage.objects where name like 'zz-test-rls-carta/%') then
    raise exception 'LIMPIEZA: quedan objetos zz-test-rls-carta/* en Storage tras el ROLLBACK: revisarlo a mano';
  end if;
end
$$;

select 'carta_escritura_por_seccion: todas las comprobaciones han pasado y no queda nada de la prueba' as resultado;
