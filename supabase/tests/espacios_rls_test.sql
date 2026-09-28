-- ===========================================================================
-- Tests SQL de 20260928140000_espacios_reserva_rls_por_seccion.sql
-- ---------------------------------------------------------------------------
-- SQL plano (no pgTAP), como supabase/tests/mesas_rls_test.sql y
-- supabase/tests/trafico_web_test.sql: cada comprobacion es un ASSERT dentro
-- de un DO; el primer fallo aborta con "ASSERT FAILED: <mensaje>". Todo va en
-- una transaccion que termina en ROLLBACK: no deja nada escrito.
--
-- Ejecutar contra una base con la migracion aplicada:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/espacios_rls_test.sql
-- Si termina en ROLLBACK sin ERROR, todo ha pasado.
--
-- ESTADO: ESCRITO Y SIN EJECUTAR. El 2026-09-28 no hay base local contra la
-- que lanzarlo (Docker Desktop esta instalado pero APAGADO: `supabase start`
-- y `supabase db dump` fallan con "failed to inspect docker image"), y la
-- migracion que prueba **no esta aplicada en produccion** -- espera el OK del
-- dueno. Lo que SI esta verificado contra produccion, con SELECT y solo
-- SELECT, es todo lo que este test da por cierto del estado PREVIO y del
-- entorno: las 9 politicas viejas, los grants, relforcerowsecurity, los
-- prosecdef, las 7 FK que apuntan a la tabla, los 4 usuarios y sus permisos.
-- Este fichero no se ha ejecutado nunca.
--
-- Cubre: forma del catalogo (6 politicas, ninguna a `public`), grants (sin
-- TRUNCATE para authenticated, `anon` SOLO con SELECT), FORCE RLS apagado,
-- las funciones que leen la tabla siguen con el prosecdef que se supone,
-- authenticated sin la seccion no ve ni escribe, authenticated CON la seccion
-- lee y escribe pero NO borra, super admin sin user_permissions lo hace todo,
-- `anon` ve los espacios ACTIVOS y solo esos y no escribe, la via del CASCADE
-- queda cortada (y sigue existiendo para quien si puede borrar), y TRUNCATE
-- rechazado.
--
-- SI SE APLICA LA OPCION C (DELETE por seccion en vez de por super admin),
-- hay que tocar T1 (nombre de la politica) y T7d/T8c (quien puede borrar).
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- T1 catalogo: exactamente las 6 politicas nuevas, con su verbo y su rol
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'espacios_reserva';
  assert n = 6, format('T1a: se esperaban 6 politicas en espacios_reserva, hay %s', n);

  assert exists (select 1 from pg_policies where tablename='espacios_reserva'
                  and policyname='espacios_reserva_select_anon_activos' and cmd='SELECT'
                  and roles::text = '{anon}'),           'T1b: falta espacios_reserva_select_anon_activos (o no es TO anon)';
  assert exists (select 1 from pg_policies where tablename='espacios_reserva'
                  and policyname='espacios_reserva_select_seccion' and cmd='SELECT'
                  and roles::text = '{authenticated}'),  'T1c: falta espacios_reserva_select_seccion';
  assert exists (select 1 from pg_policies where tablename='espacios_reserva'
                  and policyname='espacios_reserva_insert_seccion' and cmd='INSERT'),  'T1d: falta espacios_reserva_insert_seccion';
  assert exists (select 1 from pg_policies where tablename='espacios_reserva'
                  and policyname='espacios_reserva_update_seccion' and cmd='UPDATE'),  'T1e: falta espacios_reserva_update_seccion';
  assert exists (select 1 from pg_policies where tablename='espacios_reserva'
                  and policyname='espacios_reserva_delete_super_admin' and cmd='DELETE'),
         'T1f: falta espacios_reserva_delete_super_admin (si se aplico la OPCION C, ajustar este test)';
  assert exists (select 1 from pg_policies where tablename='espacios_reserva'
                  and policyname='espacios_reserva_service_role' and cmd='ALL'),        'T1g: falta espacios_reserva_service_role';

  -- Ninguna de las 9 viejas debe sobrevivir: las permissive se suman con OR,
  -- asi que una sola que diga `true` deja todo lo demas de adorno.
  assert not exists (
    select 1 from pg_policies
     where schemaname='public' and tablename='espacios_reserva'
       and policyname not like 'espacios\_reserva\_%'
  ), 'T1h: sobrevive alguna politica vieja';
end;
$$;

-- ---------------------------------------------------------------------------
-- T2 ni una politica al rol `public`, y ningun `true` suelto fuera de
--    service_role. La unica de `anon` es la de lectura acotada a activos.
-- ---------------------------------------------------------------------------
do $$
begin
  assert not exists (
    select 1 from pg_policies
     where schemaname='public' and tablename='espacios_reserva'
       and roles::text like '%public%'
  ), 'T2a: queda una politica con rol public (incluye a todo el mundo)';

  assert not exists (
    select 1 from pg_policies
     where schemaname='public' and tablename='espacios_reserva'
       and roles::text like '%anon%'
       and policyname <> 'espacios_reserva_select_anon_activos'
  ), 'T2b: hay una politica de anon que no es la de lectura de activos';

  assert (select cmd from pg_policies
           where tablename='espacios_reserva'
             and policyname='espacios_reserva_select_anon_activos') = 'SELECT',
         'T2c: la politica de anon ya no es solo de SELECT';

  assert (select coalesce(qual,'') from pg_policies
           where tablename='espacios_reserva'
             and policyname='espacios_reserva_select_anon_activos') ilike '%activa%',
         'T2d: la politica de anon ya no filtra por `activa` (leeria tambien los espacios desactivados)';

  -- `true` solo esta permitido en la de service_role.
  assert not exists (
    select 1 from pg_policies
     where schemaname='public' and tablename='espacios_reserva'
       and policyname <> 'espacios_reserva_service_role'
       and (coalesce(qual,'') = 'true' or coalesce(with_check,'') = 'true')
  ), 'T2e: hay una politica no-service_role con expresion `true`';
end;
$$;

-- ---------------------------------------------------------------------------
-- T3 grants: TRUNCATE no pasa por RLS, y `anon` solo debe conservar SELECT
-- ---------------------------------------------------------------------------
do $$
declare privs_anon text;
begin
  assert not exists (
    select 1 from information_schema.role_table_grants
     where table_schema='public' and table_name='espacios_reserva'
       and grantee='authenticated' and privilege_type='TRUNCATE'
  ), 'T3a: authenticated conserva TRUNCATE (vaciaria la tabla saltandose la RLS, y con CASCADE se llevaria reservas)';

  select coalesce(string_agg(privilege_type, ',' order by privilege_type), '(ninguno)')
    into privs_anon
    from information_schema.role_table_grants
   where table_schema='public' and table_name='espacios_reserva' and grantee='anon';
  assert privs_anon = 'SELECT',
    format('T3b: anon deberia tener SOLO SELECT sobre espacios_reserva, tiene: %s', privs_anon);

  -- El SELECT de anon es intencionado: lo necesitan los consumidores con anon
  -- key. Si desaparece, ese camino pasa de 0 filas a un 403.
  assert exists (
    select 1 from information_schema.role_table_grants
     where table_schema='public' and table_name='espacios_reserva'
       and grantee='anon' and privilege_type='SELECT'
  ), 'T3c: se ha revocado el SELECT de anon, que esta migracion conserva A PROPOSITO';
end;
$$;

-- ---------------------------------------------------------------------------
-- T4 FORCE RLS apagado y tabla de `postgres`. De eso depende que el trigger
--    SECURITY DEFINER `update_espacios_reserva_updated_at` siga escribiendo:
--    si alguien enciende FORCE, deja de hacerlo EN SILENCIO.
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  select c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) as owner
    into r
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname='espacios_reserva';

  assert r.relrowsecurity,          'T4a: RLS apagada en espacios_reserva';
  assert not r.relforcerowsecurity, 'T4b: FORCE RLS encendida: el trigger de updated_at dejara de escribir sin avisar';
  assert r.owner = 'postgres',      format('T4c: espacios_reserva ya no es de postgres (%s)', r.owner);

  assert exists (select 1 from pg_trigger
                  where tgrelid='public.espacios_reserva'::regclass
                    and tgname='update_espacios_reserva_updated_at'),
         'T4d: desaparecio update_espacios_reserva_updated_at';
end;
$$;

-- ---------------------------------------------------------------------------
-- T5 las funciones que leen la tabla siguen con el prosecdef que se supone.
--    `validar_capacidad_reserva` es INVOKER y lee espacios_reserva para el
--    aforo: si pasara a DEFINER dejaria de depender de esta RLS (no es un
--    fallo de seguridad, pero cambia el razonamiento de la cabecera). Si en
--    cambio `fn_capacidad_efectiva_marca` dejara de ser DEFINER, el aforo
--    empezaria a depender de quien llame.
-- ---------------------------------------------------------------------------
do $$
declare def bool;
begin
  select prosecdef into def from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='validar_capacidad_reserva';
  assert def = false, 'T5a: validar_capacidad_reserva ha pasado a SECURITY DEFINER';

  select prosecdef into def from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='fn_capacidad_efectiva_marca';
  assert def = true, 'T5b: fn_capacidad_efectiva_marca ha dejado de ser SECURITY DEFINER';

  -- Las cuatro de permisos, DEFINER y con search_path fijo.
  assert not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public'
       and p.proname in ('can_read_section','can_write_section','has_section_permission','is_super_admin')
       and (p.prosecdef = false or coalesce(array_to_string(p.proconfig,','),'') <> 'search_path=public')
  ), 'T5c: alguna funcion de permisos ya no es SECURITY DEFINER o perdio search_path=public';
end;
$$;

-- ---------------------------------------------------------------------------
-- T6 las 7 FK que cuelgan de espacios_reserva siguen donde estaban. Si
--    alguien cambiara un CASCADE por otra cosa, el razonamiento de la
--    migracion (cerrar el DELETE basta) dejaria de ser el mismo.
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from pg_constraint
   where confrelid='public.espacios_reserva'::regclass and contype='f';
  assert n = 7, format('T6a: se esperaban 7 FK apuntando a espacios_reserva, hay %s', n);

  assert (select count(*) from pg_constraint
           where confrelid='public.espacios_reserva'::regclass and contype='f'
             and confdeltype='c') = 4,
         'T6b: ya no son 4 las FK ON DELETE CASCADE (mesas, asignaciones_mesa, planos_espacio, configuracion_turnos)';
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
  ('00000000-0000-0000-0000-00000000cb01', 'test-espacios-con-permiso@rls.local'),
  ('00000000-0000-0000-0000-00000000cb02', 'test-espacios-super-admin@rls.local');

insert into public.user_permissions (user_id, section_key, can_view, can_edit)
values ('00000000-0000-0000-0000-00000000cb01', 'reservas', true, false);
-- can_edit = false A PROPOSITO: hoy NINGUNA fila de user_permissions tiene
-- can_edit = true (verificado en produccion) y `can_write_section` mira
-- 'view', no 'edit'. Si alguien cambia esa funcion a 'edit', T8 se pone roja
-- y avisa de que se acaba de bloquear a todo el mundo menos a los super
-- admins. Esa es justamente la gracia de este caso.

insert into public.super_admins (user_id, email)
values ('00000000-0000-0000-0000-00000000cb02', 'test-espacios-super-admin@rls.local');

-- Un espacio ACTIVO con una mesa dentro (para la prueba del CASCADE) y otro
-- DESACTIVADO (para comprobar que `anon` no lo ve).
insert into public.espacios_reserva (id, nombre, capacidad_maxima, activa)
values ('00000000-0000-0000-0000-0000000e5b01', 'Sala test RLS espacios', 50, true),
       ('00000000-0000-0000-0000-0000000e5b02', 'Sala test RLS apagada',  10, false);

insert into public.mesas (id, espacio_id, nombre, capacidad)
values ('00000000-0000-0000-0000-00000000eb01', '00000000-0000-0000-0000-0000000e5b01', 'RLS-ESP-TEST-1', 4);

-- ---------------------------------------------------------------------------
-- T7 authenticated SIN la seccion reservas -> no ve nada y no escribe
--    (sub inventado: ni user_permissions ni super_admins)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000fe","role":"authenticated"}';

do $$
begin
  assert (select count(*) from public.espacios_reserva) = 0, 'T7a: espacios visibles sin permiso';

  begin
    insert into public.espacios_reserva (nombre, capacidad_maxima)
    values ('RLS-ESP-INTRUSO', 4);
    raise exception 'T7b: authenticated sin permiso pudo CREAR un espacio';
  exception when insufficient_privilege then null;   -- esperado (RLS)
  end;

  -- UPDATE y DELETE no fallan: no alcanzan ninguna fila, porque el USING de
  -- la politica las esconde. Se comprueba que no tocan nada.
  update public.espacios_reserva set capacidad_maxima = 99
   where id = '00000000-0000-0000-0000-0000000e5b01';
  assert not found, 'T7c: authenticated sin permiso pudo ACTUALIZAR un espacio';

  delete from public.espacios_reserva where id = '00000000-0000-0000-0000-0000000e5b01';
  assert not found, 'T7d: authenticated sin permiso pudo BORRAR un espacio';
end;
$$;
reset role;

-- ---------------------------------------------------------------------------
-- T8 authenticated CON reservas can_view -> lee y escribe, pero NO BORRA.
--    Es el caso de admin@staff.local y camarero1@staff.local en produccion.
--    T8d es EL TEST DEL ENCARGO: comprueba que la via indirecta al comedor
--    (borrar el espacio y dejar que el CASCADE se lleve mesas y
--    asignaciones) queda cortada.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000cb01","role":"authenticated"}';

do $$
begin
  assert (select count(*) from public.espacios_reserva
           where id = '00000000-0000-0000-0000-0000000e5b01') = 1,
    'T8a: con permiso de reservas no ve los espacios -- el panel de reservas se queda en blanco';

  -- Tambien ve los desactivados: la politica de seccion no filtra por activa.
  assert (select count(*) from public.espacios_reserva
           where id = '00000000-0000-0000-0000-0000000e5b02') = 1,
    'T8b: con permiso de reservas no ve los espacios desactivados (los necesita para reactivarlos)';

  insert into public.espacios_reserva (id, nombre, capacidad_maxima)
  values ('00000000-0000-0000-0000-0000000e5b03', 'RLS-ESP-TEST-2', 8);

  update public.espacios_reserva set capacidad_maxima = 9
   where id = '00000000-0000-0000-0000-0000000e5b03';
  assert found, 'T8c: con permiso no pudo actualizar';

  -- OPCION A: el DELETE es solo de super admin. No falla: no alcanza filas.
  delete from public.espacios_reserva where id = '00000000-0000-0000-0000-0000000e5b03';
  assert not found, 'T8d: un usuario de seccion (sin super admin) pudo BORRAR un espacio';
end;
$$;

-- EL TEST DEL ENCARGO. Intentar borrar el espacio que tiene mesas, y
-- comprobar que ni el espacio ni la mesa se mueven.
do $$
begin
  delete from public.espacios_reserva where id = '00000000-0000-0000-0000-0000000e5b01';
  assert not found, 'T8e: se pudo borrar un espacio CON MESAS sin ser super admin -- el CASCADE se habria llevado mesas y asignaciones';
end;
$$;
reset role;

do $$
begin
  assert exists (select 1 from public.espacios_reserva where id = '00000000-0000-0000-0000-0000000e5b01'),
    'T8f: el espacio desaparecio pese a que T8e decia que no';
  assert exists (select 1 from public.mesas where id = '00000000-0000-0000-0000-00000000eb01'),
    'T8g: LA MESA SE FUE POR EL CASCADE -- la via indirecta al comedor sigue abierta';
  assert exists (select 1 from public.espacios_reserva where id = '00000000-0000-0000-0000-0000000e5b03'),
    'T8h: el espacio creado en T8 desaparecio (el delete de T8d si alcanzo la fila)';
end;
$$;

-- ---------------------------------------------------------------------------
-- T9 super admin SIN fila en user_permissions -> lo hace todo, borrar
--    incluido. Es el caso del dueno, miguelbenito2003@gmail.com: esta en
--    super_admins y NO tiene fila de user_permissions. Si esto se pone rojo,
--    el dueno se ha quedado fuera de su propio panel de Espacios.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000cb02","role":"authenticated"}';

do $$
begin
  assert (select count(*) from public.espacios_reserva
           where id = '00000000-0000-0000-0000-0000000e5b01') = 1,
    'T9a: EL SUPER ADMIN NO VE LOS ESPACIOS';

  update public.espacios_reserva set descripcion = 'tocado por el super admin'
   where id = '00000000-0000-0000-0000-0000000e5b03';
  assert found, 'T9b: EL SUPER ADMIN NO PUEDE ACTUALIZAR ESPACIOS';

  delete from public.espacios_reserva where id = '00000000-0000-0000-0000-0000000e5b03';
  assert found, 'T9c: EL SUPER ADMIN NO PUEDE BORRAR ESPACIOS -- la pantalla /super-admin/espacios queda inutil';
end;
$$;

-- Y el CASCADE sigue existiendo para quien SI puede borrar: no se ha tocado
-- ninguna FK, solo quien puede apretar el gatillo.
do $$
begin
  delete from public.espacios_reserva where id = '00000000-0000-0000-0000-0000000e5b01';
  assert found, 'T9d: el super admin no pudo borrar el espacio con mesas';
end;
$$;
reset role;

do $$
begin
  assert not exists (select 1 from public.mesas where id = '00000000-0000-0000-0000-00000000eb01'),
    'T9e: el CASCADE ya no funciona para quien SI puede borrar -- se habria cambiado una FK, que no es lo que pide el encargo';
end;
$$;

-- Reponer el fixture para T10 (el super admin acaba de borrarlo).
insert into public.espacios_reserva (id, nombre, capacidad_maxima, activa)
values ('00000000-0000-0000-0000-0000000e5b01', 'Sala test RLS espacios', 50, true);

-- ---------------------------------------------------------------------------
-- T10 anon: LEE los espacios activos (esto es lo que NO se cierra aqui, al
--     contrario que en `mesas`), no ve los desactivados, y no escribe.
-- ---------------------------------------------------------------------------
-- Claims de anonimo: sin `sub`, como en una peticion con la anon key.
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
declare insertado boolean := false;
begin
  assert (select count(*) from public.espacios_reserva
           where id = '00000000-0000-0000-0000-0000000e5b01') = 1,
         'T10a: anon NO puede leer los espacios activos -- se ha roto el camino con anon key';

  assert (select count(*) from public.espacios_reserva
           where id = '00000000-0000-0000-0000-0000000e5b02') = 0,
         'T10b: anon ve un espacio DESACTIVADO';

  assert (select count(*) from public.espacios_reserva where activa is not true) = 0,
         'T10c: anon ve filas con activa distinto de true';

  -- Con un flag, no con `raise` dentro del bloque: un `raise` propio lo
  -- tragaria el `when others` de aqui abajo y el test pasaria en falso.
  -- Puede fallar por falta de GRANT o por la politica; da igual cual de las
  -- dos, lo que se prueba es que NO entra la fila.
  begin
    insert into public.espacios_reserva (nombre, capacidad_maxima) values ('RLS-ESP-ANON', 2);
    insertado := true;
  exception when others then null;
  end;
  assert not insertado, 'T10d: anon pudo CREAR un espacio';

  begin
    delete from public.espacios_reserva where id = '00000000-0000-0000-0000-0000000e5b01';
    assert not found, 'T10e: anon pudo BORRAR un espacio';
  exception when insufficient_privilege then null;   -- esperado (sin GRANT)
  end;
end;
$$;
reset role;

do $$
begin
  assert exists (select 1 from public.espacios_reserva where id = '00000000-0000-0000-0000-0000000e5b01'),
    'T10f: el espacio desaparecio durante las pruebas de anon';
end;
$$;

-- ---------------------------------------------------------------------------
-- T11 TRUNCATE. Va EL ULTIMO a proposito: si por lo que sea pasara, toma un
--     ACCESS EXCLUSIVE sobre la tabla hasta el ROLLBACK. Debe fallar ANTES,
--     en la comprobacion de privilegios, porque la migracion revoca el
--     TRUNCATE de `authenticated`. (TRUNCATE es transaccional en PostgreSQL:
--     aunque pasara, el ROLLBACK final lo deshace.)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000cb01","role":"authenticated"}';
do $$
begin
  begin
    truncate public.espacios_reserva;
    raise exception 'T11a: authenticated pudo TRUNCATE espacios_reserva -- TRUNCATE NO pasa por la RLS, asi que todas las politicas de arriba son decorativas';
  exception when insufficient_privilege then null;   -- esperado (sin GRANT)
  end;
end;
$$;
reset role;

do $$
begin
  assert (select count(*) from public.espacios_reserva) >= 2,
    'T11b: la tabla se vacio -- el TRUNCATE de T11a llego a ejecutarse';
end;
$$;

rollback;
