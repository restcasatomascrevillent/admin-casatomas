begin;
set local client_encoding = 'UTF8';
-- (begin va PRIMERO a proposito: ver la cabecera, punto "TRANSACCION".)
-- ===========================================================================
-- Pruebas SQL de 20261001170000_rls_reservas_exige_edicion.sql
-- ---------------------------------------------------------------------------
-- SQL plano (no pgTAP), como el resto de supabase/tests/: cada comprobación
-- es un ASSERT dentro de un DO; el primer fallo aborta con «T…: …».
--
-- CUÁNDO: DESPUÉS de aplicar la migración (T0 lo comprueba y aborta si no).
--
-- CÓMO (vale contra producción: todo se deshace), como `postgres`:
--   npx supabase db query --linked -f supabase/tests/rls_reservas_edicion.sql
-- o
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_reservas_edicion.sql
-- Si termina sin ERROR, todo ha pasado: lo último que devuelve es una fila
-- «rls_reservas_edicion: OK …».
-- NO en el SQL editor: si ahí falla un ASSERT, la transacción puede quedarse
-- abierta (abortada) reteniendo candados sobre `reservas`.
--
-- TRANSACCIÓN: con `npx supabase db query --linked -f` el fichero entero
-- viaja en UN solo mensaje, y un `set` escrito antes del `begin` entraría en
-- la misma transacción y el ROLLBACK lo desharía. Por eso `begin` es la
-- primera línea, todo lo demás es `set local` dentro de la transacción, y lo
-- que va después del ROLLBACK (la comprobación de limpieza) solo lee tablas
-- por ids fijos: ni parámetros de sesión ni tildes.
--
-- QUÉ COMPRUEBA
--   T0  la migración está aplicada: huella exacta de las 5 políticas de
--       reservas, can_edit_section() SECURITY DEFINER, EXECUTE solo para
--       authenticated y service_role; authenticated tiene los privilegios de
--       tabla, así que un 42501 en T2-T3 solo puede venir de la RLS.
--   T1  anon: no ve, no inserta, no cambia, no borra.
--   T2  autenticado SIN la sección: no ve, no inserta, no cambia, no borra.
--   T3  autenticado SOLO VISTA (can_view sin can_edit): ve, y NO inserta,
--       NO cambia, NO borra. La reserva queda intacta.
--   T4  autenticado CON EDICIÓN (can_view + can_edit): inserta, cambia, borra.
--   T5  super admin sin filas de permisos en reservas: inserta, cambia, borra.
--   T6  service_role: inserta, cambia, borra.
--   T7  estado final de la reserva base (como postgres).
--   T8  las demás tablas no cambian: can_read_section, can_write_section,
--       has_section_permission e is_super_admin con el mismo cuerpo (md5 del
--       2026-10-01; de las dos primeras cuelgan las políticas de 29 tablas);
--       can_edit_section solo la usan las 3 políticas de escritura de
--       reservas; y las otras 5 tablas de la sección `reservas` tienen
--       exactamente las políticas del 2026-10-01. (No se compara un hash de
--       TODAS las políticas del esquema: otras migraciones pendientes, como
--       20261001113700 o 20260928140000, lo cambiarían sin que esta tenga
--       culpa.)
--
-- DATOS DE PRUEBA (todo dentro de la transacción; el ROLLBACK lo deshace):
--   · 4 usuarios en auth.users (ids …0e5a01-04, emails
--     test-rls-reservas-*@rls.local). Sus triggers (on_auth_user_created*,
--     revisados el 2026-10-01) crean user_roles 'staff', el permiso
--     'dashboard', inventory.profiles y sell_users.
--   · 2 filas de user_permissions (reservas) y 1 de super_admins.
--   · Reservas con fecha 2099-12-31 y estado 'cancelada': así
--     trg_validar_capacidad no se dispara (solo mira pendiente, verificada y
--     confirmada) y la RLS es lo único que puede rechazar el INSERT.
--   Revisado el 2026-10-01: ningún trigger de las tablas tocadas ni de su
--   cascada (ocupacion_diaria, newsletter_suscriptores, asignaciones_mesa…)
--   usa pg_net, http, pg_notify, pgmq ni realtime; ninguna está en una
--   publicación de Realtime; ninguna usa secuencias. Y aunque lo hicieran,
--   nada de eso sale de una transacción que termina en ROLLBACK.
--
-- ESTADO: escrito el 2026-10-01 y SIN EJECUTAR (la migración tampoco está
-- aplicada). Lo que sí se validó en producción, solo con SELECT: el cuerpo
-- de can_edit_section() con los claims del usuario `staff` real da false y
-- can_read_section() true; los 2 super admins dan true; y la huella «antes»
-- de T0/rollback es la de pg_policies de ese día.
-- ===========================================================================

set local lock_timeout = '5s';
set local statement_timeout = '60s';
set local plpgsql.check_asserts = on;

-- ---------------------------------------------------------------------------
-- T0 la migración está aplicada
-- ---------------------------------------------------------------------------
do $t0$
declare
  v_huella text;
  v_despues constant text :=
       $h$reservas_delete_seccion|d|permissive|authenticated|can_edit_section('reservas'::text)|-$h$
    || ';' || $h$reservas_insert_seccion|a|permissive|authenticated|-|can_edit_section('reservas'::text)$h$
    || ';' || $h$reservas_select_seccion|r|permissive|authenticated|can_read_section('reservas'::text)|-$h$
    || ';' || $h$reservas_service_role|*|permissive|service_role|true|true$h$
    || ';' || $h$reservas_update_seccion|w|permissive|authenticated|can_edit_section('reservas'::text)|can_edit_section('reservas'::text)$h$;
  v_fn regprocedure := to_regprocedure('public.can_edit_section(text)');
begin
  select string_agg(
           p.polname || '|' || p.polcmd::text || '|'
           || case when p.polpermissive then 'permissive' else 'restrictive' end || '|'
           || coalesce((select string_agg(x.rol, ',' order by x.rol collate "C")
                          from (select case when r = 0 then 'public' else r::regrole::text end as rol
                                  from unnest(p.polroles) as r) as x), '') || '|'
           || coalesce(regexp_replace(pg_get_expr(p.polqual, p.polrelid), '\s+|public\.', '', 'g'), '-') || '|'
           || coalesce(regexp_replace(pg_get_expr(p.polwithcheck, p.polrelid), '\s+|public\.', '', 'g'), '-'),
           ';' order by p.polname collate "C")
    into v_huella
    from pg_policy p
   where p.polrelid = 'public.reservas'::regclass;

  assert v_huella = v_despues,
    format('T0a: las políticas de reservas no son las de 20261001170000 (¿no está aplicada?). Huella: %s', v_huella);
  assert v_fn is not null, 'T0b: no existe public.can_edit_section(text): aplicar antes la migración';
  assert (select pr.prosecdef from pg_proc pr where pr.oid = v_fn), 'T0c: can_edit_section() no es SECURITY DEFINER';
  assert not has_function_privilege('anon', v_fn, 'EXECUTE'), 'T0d: anon puede ejecutar can_edit_section()';
  assert has_function_privilege('authenticated', v_fn, 'EXECUTE'), 'T0e: authenticated no puede ejecutar can_edit_section()';
  assert has_function_privilege('service_role', v_fn, 'EXECUTE'), 'T0f: service_role no puede ejecutar can_edit_section()';
  assert (select c.relrowsecurity from pg_class c where c.oid = 'public.reservas'::regclass), 'T0g: la RLS de reservas está apagada';
  assert has_table_privilege('authenticated', 'public.reservas', 'INSERT')
     and has_table_privilege('authenticated', 'public.reservas', 'UPDATE')
     and has_table_privilege('authenticated', 'public.reservas', 'DELETE'),
    'T0h: authenticated no tiene INSERT/UPDATE/DELETE de tabla: un 42501 no probaría nada de la RLS';
end
$t0$;

-- ---------------------------------------------------------------------------
-- Datos de prueba (como postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000e5a01', 'test-rls-reservas-vista@rls.local'),
  ('00000000-0000-0000-0000-0000000e5a02', 'test-rls-reservas-edicion@rls.local'),
  ('00000000-0000-0000-0000-0000000e5a03', 'test-rls-reservas-sin-seccion@rls.local'),
  ('00000000-0000-0000-0000-0000000e5a04', 'test-rls-reservas-super@rls.local');

insert into public.user_permissions (user_id, section_key, can_view, can_edit) values
  ('00000000-0000-0000-0000-0000000e5a01', 'reservas', true, false),  -- solo vista
  ('00000000-0000-0000-0000-0000000e5a02', 'reservas', true, true);   -- vista + edición

insert into public.super_admins (user_id, email) values
  ('00000000-0000-0000-0000-0000000e5a04', 'test-rls-reservas-super@rls.local');

-- La reserva base, sobre la que se prueban UPDATE y DELETE.
insert into public.reservas (id, fecha, hora, numero_comensales, estado, canal, marca,
                             nombre, notas_cliente, consentimiento_newsletter)
values ('00000000-0000-0000-0000-0000000e5b00', date '2099-12-31', time '13:00', 1, 'cancelada', 'manual',
        'casa_tomas', '[RLS-TEST] reserva base', '[RLS-TEST] base', false);

-- ---------------------------------------------------------------------------
-- T1 anon
-- ---------------------------------------------------------------------------
set local role anon;
set local request.jwt.claim.sub = '';
set local request.jwt.claims = '{"role":"anon"}';

do $t1$
begin
  assert (select count(*) from public.reservas where id = '00000000-0000-0000-0000-0000000e5b00') = 0,
    'T1a: anon ve reservas';
  begin
    insert into public.reservas (fecha, hora, numero_comensales, estado, canal, marca, nombre, notas_cliente)
    values (date '2099-12-31', time '13:00', 1, 'cancelada', 'manual', 'casa_tomas', '[RLS-TEST] anon', '[RLS-TEST]');
    raise exception 'T1b: anon pudo hacer INSERT en reservas';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.reservas set importante = true where id = '00000000-0000-0000-0000-0000000e5b00';
    raise exception 'T1c: anon pudo hacer UPDATE en reservas';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.reservas where id = '00000000-0000-0000-0000-0000000e5b00';
    raise exception 'T1d: anon pudo hacer DELETE en reservas';
  exception when insufficient_privilege then null;
  end;
end
$t1$;

set local role none;

-- ---------------------------------------------------------------------------
-- T2 autenticado SIN la sección reservas (solo el 'dashboard' del trigger)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000e5a03';
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000e5a03","role":"authenticated"}';

do $t2$
begin
  assert auth.uid() = '00000000-0000-0000-0000-0000000e5a03'::uuid, 'T2a: auth.uid() no es el usuario de prueba';
  assert not public.can_edit_section('reservas'), 'T2b: can_edit_section() da true a un usuario sin la sección';
  assert (select count(*) from public.reservas where id = '00000000-0000-0000-0000-0000000e5b00') = 0,
    'T2c: un usuario sin la sección ve reservas';
  begin
    insert into public.reservas (fecha, hora, numero_comensales, estado, canal, marca, nombre, notas_cliente)
    values (date '2099-12-31', time '13:00', 1, 'cancelada', 'manual', 'casa_tomas', '[RLS-TEST] sin seccion', '[RLS-TEST]');
    raise exception 'T2d: un usuario sin la sección pudo hacer INSERT en reservas';
  exception when insufficient_privilege then null;
  end;
  update public.reservas set importante = true where id = '00000000-0000-0000-0000-0000000e5b00';
  assert not found, 'T2e: un usuario sin la sección pudo hacer UPDATE en reservas';
  delete from public.reservas where id = '00000000-0000-0000-0000-0000000e5b00';
  assert not found, 'T2f: un usuario sin la sección pudo hacer DELETE en reservas';
end
$t2$;

set local role none;

-- ---------------------------------------------------------------------------
-- T3 autenticado SOLO VISTA (can_view = true, can_edit = false)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000e5a01';
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000e5a01","role":"authenticated"}';

do $t3$
declare
  v_importante boolean;
begin
  assert auth.uid() = '00000000-0000-0000-0000-0000000e5a01'::uuid, 'T3a: auth.uid() no es el usuario de prueba';
  assert public.can_read_section('reservas'), 'T3b: el usuario solo-vista no puede ver la sección (datos de prueba mal)';
  assert public.can_write_section('reservas'),
    'T3c: can_write_section() ya no es la de antes (solo vista): habría cambiado la escritura de las demás tablas';
  assert not public.can_edit_section('reservas'), 'T3d: can_edit_section() da true a un usuario solo-vista';
  assert (select count(*) from public.reservas where id = '00000000-0000-0000-0000-0000000e5b00') = 1,
    'T3e: el usuario solo-vista ya no ve la reserva: el SELECT no debía cambiar';
  begin
    insert into public.reservas (fecha, hora, numero_comensales, estado, canal, marca, nombre, notas_cliente)
    values (date '2099-12-31', time '13:00', 1, 'cancelada', 'manual', 'casa_tomas', '[RLS-TEST] solo vista', '[RLS-TEST]');
    raise exception 'T3f: el usuario solo-vista pudo hacer INSERT en reservas';
  exception when insufficient_privilege then null;
  end;
  update public.reservas set importante = true where id = '00000000-0000-0000-0000-0000000e5b00';
  assert not found, 'T3g: el usuario solo-vista pudo hacer UPDATE en reservas';
  delete from public.reservas where id = '00000000-0000-0000-0000-0000000e5b00';
  assert not found, 'T3h: el usuario solo-vista pudo hacer DELETE en reservas';
  select r.importante into v_importante from public.reservas r where r.id = '00000000-0000-0000-0000-0000000e5b00';
  assert found and v_importante = false,
    'T3i: la reserva base ha cambiado o ha desaparecido tras los intentos del usuario solo-vista';
end
$t3$;

set local role none;

-- ---------------------------------------------------------------------------
-- T4 autenticado CON EDICIÓN (can_view + can_edit), sin ser super admin
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000e5a02';
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000e5a02","role":"authenticated"}';

do $t4$
declare
  v_id uuid;
begin
  assert auth.uid() = '00000000-0000-0000-0000-0000000e5a02'::uuid, 'T4a: auth.uid() no es el usuario de prueba';
  assert public.can_edit_section('reservas'), 'T4b: can_edit_section() da false a un usuario con edición';
  begin
    insert into public.reservas (fecha, hora, numero_comensales, estado, canal, marca, nombre, notas_cliente)
    values (date '2099-12-31', time '13:00', 1, 'cancelada', 'manual', 'casa_tomas', '[RLS-TEST] con edicion', '[RLS-TEST]')
    returning id into v_id;
  exception when insufficient_privilege then
    raise exception 'T4c: el usuario con edición NO pudo hacer INSERT en reservas (%)', sqlerrm;
  end;
  update public.reservas set importante = true where id = '00000000-0000-0000-0000-0000000e5b00';
  assert found, 'T4d: el usuario con edición NO pudo hacer UPDATE en reservas';
  delete from public.reservas where id = v_id;
  assert found, 'T4e: el usuario con edición NO pudo hacer DELETE en reservas';
end
$t4$;

set local role none;

-- ---------------------------------------------------------------------------
-- T5 super admin (tabla super_admins) sin fila de permisos en reservas
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000e5a04';
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000e5a04","role":"authenticated"}';

do $t5$
declare
  v_id uuid;
begin
  assert public.can_edit_section('reservas'), 'T5a: can_edit_section() da false a un super admin';
  begin
    insert into public.reservas (fecha, hora, numero_comensales, estado, canal, marca, nombre, notas_cliente)
    values (date '2099-12-31', time '13:00', 1, 'cancelada', 'manual', 'casa_tomas', '[RLS-TEST] super admin', '[RLS-TEST]')
    returning id into v_id;
  exception when insufficient_privilege then
    raise exception 'T5b: el super admin NO pudo hacer INSERT en reservas (%)', sqlerrm;
  end;
  update public.reservas set notas_cliente = '[RLS-TEST] tocada por super admin'
   where id = '00000000-0000-0000-0000-0000000e5b00';
  assert found, 'T5c: el super admin NO pudo hacer UPDATE en reservas';
  delete from public.reservas where id = v_id;
  assert found, 'T5d: el super admin NO pudo hacer DELETE en reservas';
end
$t5$;

set local role none;

-- ---------------------------------------------------------------------------
-- T6 service_role (Edge Functions, webhooks del bot)
-- ---------------------------------------------------------------------------
set local role service_role;
set local request.jwt.claim.sub = '';
set local request.jwt.claims = '{"role":"service_role"}';

do $t6$
declare
  v_id uuid;
begin
  insert into public.reservas (fecha, hora, numero_comensales, estado, canal, marca, nombre, notas_cliente)
  values (date '2099-12-31', time '13:00', 1, 'cancelada', 'manual', 'casa_tomas', '[RLS-TEST] service role', '[RLS-TEST]')
  returning id into v_id;
  assert v_id is not null, 'T6a: service_role NO pudo hacer INSERT en reservas';
  update public.reservas set notas_cliente = '[RLS-TEST] service role (cambiada)' where id = v_id;
  assert found, 'T6b: service_role NO pudo hacer UPDATE en reservas';
  delete from public.reservas where id = v_id;
  assert found, 'T6c: service_role NO pudo hacer DELETE en reservas';
end
$t6$;

set local role none;

-- ---------------------------------------------------------------------------
-- T7 estado final de la reserva base (como postgres)
-- ---------------------------------------------------------------------------
do $t7$
declare
  v_importante boolean;
  v_notas text;
begin
  select r.importante, r.notas_cliente into v_importante, v_notas
    from public.reservas r where r.id = '00000000-0000-0000-0000-0000000e5b00';
  assert found, 'T7a: la reserva base ha desaparecido: alguien sin edición pudo borrarla';
  assert v_importante, 'T7b: el UPDATE del usuario con edición no se guardó';
  assert v_notas = '[RLS-TEST] tocada por super admin', format('T7c: el UPDATE del super admin no se guardó (%s)', v_notas);
  assert (select count(*) from public.reservas where nombre like '[RLS-TEST]%') = 1,
    'T7d: quedan altas de prueba que se tenían que haber borrado (o se coló un INSERT denegado)';
end
$t7$;

-- ---------------------------------------------------------------------------
-- T8 las demás tablas no cambian (como postgres)
-- ---------------------------------------------------------------------------
do $t8$
declare
  v_fn regprocedure := to_regprocedure('public.can_edit_section(text)');
  v_distintas text;
begin
  -- Mismo cuerpo que el 2026-10-01 (md5 de prosrc sin \r).
  assert (select md5(replace(pr.prosrc, E'\r', '')) from pg_proc pr
           where pr.oid = 'public.can_write_section(text)'::regprocedure) = '7ff37a91b8da953d895f8f5f42de3ac9',
    'T8a: can_write_section() ha cambiado: cambiaría la escritura de las otras 28 tablas que la usan';
  assert (select md5(replace(pr.prosrc, E'\r', '')) from pg_proc pr
           where pr.oid = 'public.can_read_section(text)'::regprocedure) = '6e495ef0b11a55c9246029de3a73e1c6',
    'T8b: can_read_section() ha cambiado';
  assert (select md5(replace(pr.prosrc, E'\r', '')) from pg_proc pr
           where pr.oid = 'public.has_section_permission(uuid,text,text)'::regprocedure) = '29dd3783a65de8c9dbf5f68a857641d5',
    'T8c: has_section_permission() ha cambiado';
  assert (select md5(replace(pr.prosrc, E'\r', '')) from pg_proc pr
           where pr.oid = 'public.is_super_admin(uuid)'::regprocedure) = '010c540f860a8475a8713c623e69b3eb',
    'T8d: is_super_admin() ha cambiado';

  -- can_edit_section solo la usan las tres políticas de escritura de reservas.
  assert not exists (
      select 1
        from pg_depend d
        left join pg_policy pol on d.classid = 'pg_policy'::regclass and pol.oid = d.objid
       where d.refclassid = 'pg_proc'::regclass
         and d.refobjid = v_fn
         and (pol.oid is null
              or pol.polrelid <> 'public.reservas'::regclass
              or pol.polname not in ('reservas_insert_seccion', 'reservas_update_seccion', 'reservas_delete_seccion'))),
    'T8e: can_edit_section() la usa algo más que las tres políticas de escritura de reservas';
  assert (select count(distinct d.objid) from pg_depend d
           where d.classid = 'pg_policy'::regclass and d.refclassid = 'pg_proc'::regclass
             and d.refobjid = v_fn) = 3,
    'T8f: can_edit_section() no la usan exactamente las tres políticas de escritura de reservas';

  -- Las otras tablas de la sección `reservas`: exactamente como el 2026-10-01.
  select string_agg(t.tabla, ', ' order by t.tabla) into v_distintas
    from (values
      ('solicitudes_pendientes',
            $h$solicitudes_pendientes_delete_seccion|d|permissive|authenticated|can_write_section('reservas'::text)|-$h$
       || ';' || $h$solicitudes_pendientes_insert_seccion|a|permissive|authenticated|-|can_write_section('reservas'::text)$h$
       || ';' || $h$solicitudes_pendientes_select_seccion|r|permissive|authenticated|can_read_section('reservas'::text)|-$h$
       || ';' || $h$solicitudes_pendientes_service_role|*|permissive|service_role|true|true$h$
       || ';' || $h$solicitudes_pendientes_update_seccion|w|permissive|authenticated|can_write_section('reservas'::text)|can_write_section('reservas'::text)$h$),
      ('blacklist',
            $h$blacklist_delete_seccion|d|permissive|authenticated|can_write_section('reservas'::text)|-$h$
       || ';' || $h$blacklist_insert_seccion|a|permissive|authenticated|-|can_write_section('reservas'::text)$h$
       || ';' || $h$blacklist_select_seccion|r|permissive|authenticated|can_read_section('reservas'::text)|-$h$
       || ';' || $h$blacklist_service_role|*|permissive|service_role|true|true$h$
       || ';' || $h$blacklist_update_seccion|w|permissive|authenticated|can_write_section('reservas'::text)|can_write_section('reservas'::text)$h$),
      ('mesas',
            $h$mesas_delete_seccion|d|permissive|authenticated|(SELECTcan_write_section('reservas'::text)AScan_write_section)|-$h$
       || ';' || $h$mesas_insert_seccion|a|permissive|authenticated|-|(SELECTcan_write_section('reservas'::text)AScan_write_section)$h$
       || ';' || $h$mesas_select_seccion|r|permissive|authenticated|(SELECTcan_read_section('reservas'::text)AScan_read_section)|-$h$
       || ';' || $h$mesas_service_role|*|permissive|service_role|true|true$h$
       || ';' || $h$mesas_update_seccion|w|permissive|authenticated|(SELECTcan_write_section('reservas'::text)AScan_write_section)|(SELECTcan_write_section('reservas'::text)AScan_write_section)$h$),
      ('asignaciones_mesa',
            $h$asignaciones_mesa_delete_seccion|d|permissive|authenticated|(SELECTcan_write_section('reservas'::text)AScan_write_section)|-$h$
       || ';' || $h$asignaciones_mesa_insert_seccion|a|permissive|authenticated|-|(SELECTcan_write_section('reservas'::text)AScan_write_section)$h$
       || ';' || $h$asignaciones_mesa_select_seccion|r|permissive|authenticated|(SELECTcan_read_section('reservas'::text)AScan_read_section)|-$h$
       || ';' || $h$asignaciones_mesa_service_role|*|permissive|service_role|true|true$h$
       || ';' || $h$asignaciones_mesa_update_seccion|w|permissive|authenticated|(SELECTcan_write_section('reservas'::text)AScan_write_section)|(SELECTcan_write_section('reservas'::text)AScan_write_section)$h$),
      ('asignaciones_mesa_descartadas',
            $h$asignaciones_mesa_descartadas_select_seccion|r|permissive|authenticated|(SELECTcan_read_section('reservas'::text)AScan_read_section)|-$h$
       || ';' || $h$asignaciones_mesa_descartadas_service_role|*|permissive|service_role|true|true$h$)
    ) as t(tabla, esperada)
   where t.esperada is distinct from (
           select string_agg(
                    p.polname || '|' || p.polcmd::text || '|'
                    || case when p.polpermissive then 'permissive' else 'restrictive' end || '|'
                    || coalesce((select string_agg(x.rol, ',' order by x.rol collate "C")
                                   from (select case when r = 0 then 'public' else r::regrole::text end as rol
                                           from unnest(p.polroles) as r) as x), '') || '|'
                    || coalesce(regexp_replace(pg_get_expr(p.polqual, p.polrelid), '\s+|public\.', '', 'g'), '-') || '|'
                    || coalesce(regexp_replace(pg_get_expr(p.polwithcheck, p.polrelid), '\s+|public\.', '', 'g'), '-'),
                    ';' order by p.polname collate "C")
             from pg_policy p
            where p.polrelid = to_regclass('public.' || t.tabla));
  assert v_distintas is null,
    format('T8g: han cambiado las políticas de otras tablas de la sección reservas: %s', v_distintas);
end
$t8$;

rollback;

-- ---------------------------------------------------------------------------
-- LIMPIEZA (despues del ROLLBACK). Solo ASCII y solo tablas, por ids fijos:
-- sin parametros de sesion (el ROLLBACK ya los ha deshecho).
-- ---------------------------------------------------------------------------
do $limpieza$
begin
  if exists (select 1 from auth.users
              where id in ('00000000-0000-0000-0000-0000000e5a01', '00000000-0000-0000-0000-0000000e5a02',
                           '00000000-0000-0000-0000-0000000e5a03', '00000000-0000-0000-0000-0000000e5a04')
                 or email like 'test-rls-reservas-%@rls.local') then
    raise exception 'LIMPIEZA: quedan usuarios test-rls-reservas-* tras el ROLLBACK: revisarlo a mano';
  end if;
  if exists (select 1 from public.user_permissions
              where user_id in ('00000000-0000-0000-0000-0000000e5a01', '00000000-0000-0000-0000-0000000e5a02',
                                '00000000-0000-0000-0000-0000000e5a03', '00000000-0000-0000-0000-0000000e5a04'))
     or exists (select 1 from public.super_admins where email like 'test-rls-reservas-%@rls.local') then
    raise exception 'LIMPIEZA: quedan permisos o super_admins de prueba tras el ROLLBACK: revisarlo a mano';
  end if;
  if exists (select 1 from public.reservas
              where id = '00000000-0000-0000-0000-0000000e5b00' or nombre like '[RLS-TEST]%')
     or exists (select 1 from public.ocupacion_diaria where fecha = date '2099-12-31') then
    raise exception 'LIMPIEZA: quedan reservas [RLS-TEST] u ocupacion de 2099-12-31 tras el ROLLBACK: revisarlo a mano';
  end if;
end
$limpieza$;

select 'rls_reservas_edicion: OK, todas las comprobaciones han pasado y no queda nada de la prueba' as resultado;
