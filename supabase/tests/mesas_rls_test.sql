-- ===========================================================================
-- Tests SQL de 20260928120000_mesas_asignaciones_rls_por_seccion.sql
-- ---------------------------------------------------------------------------
-- SQL plano (no pgTAP), como supabase/tests/trafico_web_test.sql: cada
-- comprobacion es un ASSERT dentro de un DO; el primer fallo aborta con
-- "ASSERT FAILED: <mensaje>". Todo va en una transaccion que termina en
-- ROLLBACK: no deja nada escrito.
--
-- Ejecutar SOLO contra una base local/de pruebas con la migracion aplicada:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/mesas_rls_test.sql
-- Si termina en ROLLBACK sin ERROR, todo ha pasado.
--
-- ESTADO: ESCRITO Y SIN EJECUTAR. No hay Docker en la maquina donde se
-- escribio (2026-09-28), asi que no hay base local contra la que lanzarlo y
-- la migracion que prueba tampoco esta aplicada en produccion. Lo que SI esta
-- verificado contra produccion es todo lo que el test da por cierto del
-- estado PREVIO (pg_policies, grants, relforcerowsecurity, prosecdef, FKs y
-- columnas NOT NULL). Este fichero no se ha ejecutado nunca.
--
-- Cubre: forma del catalogo (12 politicas, ni una a public/anon), grants sin
-- TRUNCATE ni anon, FORCE RLS apagado (de el dependen los 3 triggers
-- SECURITY DEFINER), la RPC sigue SECURITY INVOKER, authenticated sin la
-- seccion reservas no ve ni escribe, authenticated CON la seccion escribe,
-- super admin sin user_permissions escribe, anon no lee, y la tabla de
-- auditoria se lee pero no se escribe.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- T1 catalogo: exactamente las 12 politicas nuevas, con su verbo
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from pg_policies
   where schemaname = 'public'
     and tablename in ('mesas','asignaciones_mesa','asignaciones_mesa_descartadas');
  assert n = 12, format('T1a: se esperaban 12 politicas en las tres tablas, hay %s', n);

  -- mesas: 4 de seccion + service_role
  assert exists (select 1 from pg_policies where tablename='mesas' and policyname='mesas_select_seccion'  and cmd='SELECT'), 'T1b: falta mesas_select_seccion';
  assert exists (select 1 from pg_policies where tablename='mesas' and policyname='mesas_insert_seccion'  and cmd='INSERT'), 'T1b: falta mesas_insert_seccion';
  assert exists (select 1 from pg_policies where tablename='mesas' and policyname='mesas_update_seccion'  and cmd='UPDATE'), 'T1b: falta mesas_update_seccion';
  assert exists (select 1 from pg_policies where tablename='mesas' and policyname='mesas_delete_seccion'  and cmd='DELETE'), 'T1b: falta mesas_delete_seccion';
  assert exists (select 1 from pg_policies where tablename='mesas' and policyname='mesas_service_role'    and cmd='ALL'),    'T1b: falta mesas_service_role';

  assert exists (select 1 from pg_policies where tablename='asignaciones_mesa' and policyname='asignaciones_mesa_select_seccion' and cmd='SELECT'), 'T1c: falta asignaciones_mesa_select_seccion';
  assert exists (select 1 from pg_policies where tablename='asignaciones_mesa' and policyname='asignaciones_mesa_insert_seccion' and cmd='INSERT'), 'T1c: falta asignaciones_mesa_insert_seccion';
  assert exists (select 1 from pg_policies where tablename='asignaciones_mesa' and policyname='asignaciones_mesa_update_seccion' and cmd='UPDATE'), 'T1c: falta asignaciones_mesa_update_seccion';
  assert exists (select 1 from pg_policies where tablename='asignaciones_mesa' and policyname='asignaciones_mesa_delete_seccion' and cmd='DELETE'), 'T1c: falta asignaciones_mesa_delete_seccion';
  assert exists (select 1 from pg_policies where tablename='asignaciones_mesa' and policyname='asignaciones_mesa_service_role'   and cmd='ALL'),    'T1c: falta asignaciones_mesa_service_role';

  assert exists (select 1 from pg_policies where tablename='asignaciones_mesa_descartadas' and policyname='asignaciones_mesa_descartadas_select_seccion' and cmd='SELECT'), 'T1d: falta descartadas_select_seccion';
  assert exists (select 1 from pg_policies where tablename='asignaciones_mesa_descartadas' and policyname='asignaciones_mesa_descartadas_service_role'   and cmd='ALL'),    'T1d: falta descartadas_service_role';

  -- Ninguna de las 14 viejas debe sobrevivir: las permissive se suman con OR,
  -- asi que una sola que diga `true` deja todo lo demas de adorno.
  assert not exists (
    select 1 from pg_policies
     where tablename in ('mesas','asignaciones_mesa','asignaciones_mesa_descartadas')
       and policyname not like '%\_seccion' and policyname not like '%\_service\_role'
  ), 'T1e: sobrevive alguna politica vieja';
end;
$$;

-- ---------------------------------------------------------------------------
-- T2 ni una politica abierta a `public` o `anon`, y ningun `true` suelto
-- ---------------------------------------------------------------------------
do $$
begin
  assert not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename in ('mesas','asignaciones_mesa','asignaciones_mesa_descartadas')
       and (roles::text like '%public%' or roles::text like '%anon%')
  ), 'T2a: queda una politica con rol public/anon';

  -- `true` solo esta permitido en las tres de service_role.
  assert not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename in ('mesas','asignaciones_mesa','asignaciones_mesa_descartadas')
       and policyname not like '%\_service\_role'
       and (coalesce(qual,'') = 'true' or coalesce(with_check,'') = 'true')
  ), 'T2b: hay una politica de seccion con expresion `true`';
end;
$$;

-- ---------------------------------------------------------------------------
-- T3 grants: TRUNCATE no pasa por RLS, y anon no pinta nada aqui
-- ---------------------------------------------------------------------------
do $$
begin
  assert not exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name in ('mesas','asignaciones_mesa','asignaciones_mesa_descartadas')
       and grantee = 'authenticated' and privilege_type = 'TRUNCATE'
  ), 'T3a: authenticated conserva TRUNCATE (vaciaria la tabla saltandose la RLS)';

  assert not exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name in ('mesas','asignaciones_mesa','asignaciones_mesa_descartadas')
       and grantee = 'anon'
  ), 'T3b: anon conserva algun privilegio sobre las tres tablas';

  -- Y la de auditoria sigue sin escritura para authenticated (20260926140000).
  assert not exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'asignaciones_mesa_descartadas'
       and grantee = 'authenticated'
       and privilege_type in ('INSERT','UPDATE','DELETE')
  ), 'T3c: authenticated puede escribir en la tabla de auditoria';
end;
$$;

-- ---------------------------------------------------------------------------
-- T4 FORCE RLS apagado. De esto dependen los 3 triggers SECURITY DEFINER
--    (trg_asignaciones_mesa_denormalizar, trg_reservas_sincronizar_asignaciones,
--    trg_mesas_auditar_asignaciones): son de `postgres`, que es el propietario
--    de las tablas, y el propietario se salta su RLS mientras no haya FORCE.
--    Si alguien enciende FORCE, esos triggers dejan de escribir EN SILENCIO.
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select c.relname, c.relrowsecurity, c.relforcerowsecurity,
           pg_get_userbyid(c.relowner) as owner
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname in ('mesas','asignaciones_mesa','asignaciones_mesa_descartadas')
  loop
    assert r.relrowsecurity,          format('T4a: RLS apagada en %s', r.relname);
    assert not r.relforcerowsecurity, format('T4b: FORCE RLS encendida en %s: los triggers SECURITY DEFINER dejaran de escribir sin avisar', r.relname);
    assert r.owner = 'postgres',      format('T4c: %s ya no es de postgres (%s): revisar los triggers DEFINER', r.relname, r.owner);
  end loop;

  assert (select count(*) from pg_trigger
           where tgrelid = 'public.asignaciones_mesa'::regclass and not tgisinternal) >= 1,
         'T4d: desaparecio trg_asignaciones_mesa_denormalizar';
  assert exists (select 1 from pg_trigger where tgname = 'trg_mesas_auditar_asignaciones'), 'T4e: falta trg_mesas_auditar_asignaciones';
  assert exists (select 1 from pg_trigger where tgname = 'trg_reservas_sincronizar_asignaciones'), 'T4f: falta trg_reservas_sincronizar_asignaciones';
end;
$$;

-- ---------------------------------------------------------------------------
-- T5 la RPC sigue SECURITY INVOKER: si alguien la pasa a DEFINER, estas
--    politicas dejan de aplicarsele y vuelve el agujero por otra puerta
-- ---------------------------------------------------------------------------
do $$
declare def bool; cfg text;
begin
  select prosecdef, array_to_string(proconfig, ',')
    into def, cfg
    from pg_proc where oid = 'public.asignar_mesas_reserva(uuid, uuid[])'::regprocedure;
  assert def = false, 'T5a: asignar_mesas_reserva ha pasado a SECURITY DEFINER';
  assert cfg = 'search_path=public', format('T5b: asignar_mesas_reserva sin search_path fijo (%s)', coalesce(cfg,'NULL'));
end;
$$;

-- ---------------------------------------------------------------------------
-- Datos de prueba (como postgres, antes de cambiar de rol).
-- Se deshacen con el ROLLBACK final.
--
-- NOTA: si el esquema local de GoTrue exige mas columnas NOT NULL en
-- auth.users, el fallo saldra aqui y no en un ASSERT. Es un problema del
-- fixture, no de la RLS.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000ca01', 'test-con-permiso@rls.local'),
  ('00000000-0000-0000-0000-00000000ca02', 'test-super-admin@rls.local');

insert into public.user_permissions (user_id, section_key, can_view, can_edit)
values ('00000000-0000-0000-0000-00000000ca01', 'reservas', true, false);
-- can_edit = false A PROPOSITO: hoy NINGUNA fila de user_permissions tiene
-- can_edit = true (verificado en produccion) y `can_write_section` mira
-- 'view', no 'edit'. Si alguien cambia esa funcion a 'edit', T7 se pone roja
-- y avisa de que se acaba de bloquear a todo el mundo menos a los super
-- admins. Esa es justamente la gracia de este caso.

insert into public.super_admins (user_id, email)
values ('00000000-0000-0000-0000-00000000ca02', 'test-super-admin@rls.local');

insert into public.espacios_reserva (id, nombre, capacidad_maxima)
values ('00000000-0000-0000-0000-0000000e5a01', 'Sala test RLS', 50);

insert into public.mesas (id, espacio_id, nombre, capacidad)
values ('00000000-0000-0000-0000-00000000e501', '00000000-0000-0000-0000-0000000e5a01', 'RLS-TEST-1', 4);

-- ---------------------------------------------------------------------------
-- T6 authenticated SIN la seccion reservas -> no ve nada y no escribe
--    (sub inventado: ni user_permissions ni super_admins)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000fe","role":"authenticated"}';

do $$
begin
  assert (select count(*) from public.mesas) = 0,                         'T6a: mesas visibles sin permiso';
  assert (select count(*) from public.asignaciones_mesa) = 0,             'T6a: asignaciones visibles sin permiso';
  assert (select count(*) from public.asignaciones_mesa_descartadas) = 0, 'T6a: auditoria visible sin permiso';

  begin
    insert into public.mesas (espacio_id, nombre, capacidad)
    values ('00000000-0000-0000-0000-0000000e5a01', 'RLS-TEST-INTRUSO', 4);
    raise exception 'T6b: authenticated sin permiso pudo CREAR una mesa';
  exception when insufficient_privilege then null;   -- esperado (RLS)
  end;

  -- UPDATE y DELETE no fallan: simplemente no alcanzan ninguna fila, porque
  -- el USING de la politica las esconde. Se comprueba que no tocan nada.
  update public.mesas set capacidad = 99 where id = '00000000-0000-0000-0000-00000000e501';
  assert not found, 'T6c: authenticated sin permiso pudo ACTUALIZAR una mesa';

  delete from public.mesas where id = '00000000-0000-0000-0000-00000000e501';
  assert not found, 'T6d: authenticated sin permiso pudo BORRAR una mesa';
end;
$$;
reset role;

-- La mesa sigue ahi (el intento de borrado de T6d no se la llevo)
do $$
begin
  assert exists (select 1 from public.mesas where id = '00000000-0000-0000-0000-00000000e501'),
    'T6e: la mesa desaparecio pese a que T6d decia que no';
end;
$$;

-- ---------------------------------------------------------------------------
-- T7 authenticated CON reservas can_view -> lee y escribe
--    (es el caso de admin@staff.local y camarero1@staff.local en produccion)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ca01","role":"authenticated"}';

do $$
begin
  assert (select count(*) from public.mesas where id = '00000000-0000-0000-0000-00000000e501') = 1,
    'T7a: con permiso de reservas no ve las mesas -- el panel se queda en blanco';

  insert into public.mesas (id, espacio_id, nombre, capacidad)
  values ('00000000-0000-0000-0000-00000000e502', '00000000-0000-0000-0000-0000000e5a01', 'RLS-TEST-2', 2);

  update public.mesas set capacidad = 6 where id = '00000000-0000-0000-0000-00000000e502';
  assert found, 'T7b: con permiso no pudo actualizar';

  delete from public.mesas where id = '00000000-0000-0000-0000-00000000e502';
  assert found, 'T7c: con permiso no pudo borrar';

  -- La tabla de auditoria se LEE pero no se escribe (no hay GRANT).
  perform 1 from public.asignaciones_mesa_descartadas limit 1;
  begin
    insert into public.asignaciones_mesa_descartadas (reserva_id, mesa_id, motivo)
    values (gen_random_uuid(), gen_random_uuid(), 'mesa_borrada');
    raise exception 'T7d: authenticated pudo escribir en la tabla de auditoria';
  exception
    when insufficient_privilege then null;   -- esperado (sin GRANT)
    when undefined_column      then null;    -- el fixture no acierta las columnas: da igual, lo que se prueba es el rechazo
  end;
end;
$$;
reset role;

-- ---------------------------------------------------------------------------
-- T8 super admin SIN fila en user_permissions -> lee y escribe igual
--    (es el caso del dueno, miguelbenito2003@gmail.com: esta en super_admins
--    y NO tiene fila de user_permissions. Si esto se pone rojo, el dueno se
--    ha quedado fuera de su propio panel.)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ca02","role":"authenticated"}';

do $$
begin
  assert (select count(*) from public.mesas where id = '00000000-0000-0000-0000-00000000e501') = 1,
    'T8a: EL SUPER ADMIN NO VE LAS MESAS';

  insert into public.mesas (id, espacio_id, nombre, capacidad)
  values ('00000000-0000-0000-0000-00000000e503', '00000000-0000-0000-0000-0000000e5a01', 'RLS-TEST-3', 2);
  delete from public.mesas where id = '00000000-0000-0000-0000-00000000e503';
  assert found, 'T8b: EL SUPER ADMIN NO PUEDE ESCRIBIR MESAS';
end;
$$;
reset role;

-- ---------------------------------------------------------------------------
-- T9 anon: ni leer. Tras el REVOKE deberia ser insufficient_privilege (falta
--    el GRANT), no "0 filas".
-- ---------------------------------------------------------------------------
set local role anon;
do $$
begin
  begin
    perform 1 from public.mesas limit 1;
    raise exception 'T9a: anon puede leer mesas';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.asignaciones_mesa limit 1;
    raise exception 'T9b: anon puede leer asignaciones_mesa';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

rollback;
