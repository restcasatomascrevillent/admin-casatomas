-- ===========================================================================
-- Tests SQL de T7-ESPACIOS (remediación 2026-10-30, CT-REM-DB-02, D-005):
--   20261030210000_rls_espacios_reserva_por_seccion.sql
-- ---------------------------------------------------------------------------
-- SQL plano (no pgTAP): cada comprobación es un ASSERT; el primer fallo aborta
-- con "ASSERT FAILED: <mensaje>". Todo en una transacción que acaba en ROLLBACK.
-- Lo ejecuta scripts/test-espacios-reserva.mjs (PGlite, npm run
-- test:espacios:db) con la migración ya aplicada, sobre el estado de la demo,
-- el de Git y uno parcial de «producción».
--
-- Personas (datos sintéticos):
--   STAFF   solo dashboard/view (lo que da el trigger de alta)
--   LECTOR  reservas view (sin edit)
--   SUPER   fila en super_admins
--   BLOQ    reservas view pero sin sesión válida (restrictiva acceso_panel_no_bloqueado)
--   anon y service_role
-- ===========================================================================

begin;

create function pg_temp.n(q text) returns text language plpgsql as $f$
declare v text; begin execute q into v; return coalesce(v, '<null>');
exception when others then return 'ERR:' || sqlstate; end $f$;
create function pg_temp.x(q text) returns text language plpgsql as $f$
declare k bigint; begin execute q; get diagnostics k = row_count; return 'ok:' || k;
exception when others then return 'ERR:' || sqlstate; end $f$;
grant execute on function pg_temp.n(text), pg_temp.x(text) to public;

insert into auth.users (id, email) values
 ('a0000000-0000-0000-0000-00000000000a', 'staff@test.local'),
 ('b0000000-0000-0000-0000-00000000000b', 'lector@test.local'),
 ('c0000000-0000-0000-0000-00000000000c', 'super@test.local'),
 ('d0000000-0000-0000-0000-00000000000d', 'bloq@test.local');
insert into auth.sessions (id, user_id) values
 ('a1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a'),
 ('b1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000b'),
 ('c1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000000c');
insert into public.user_permissions (user_id, section_key, can_view, can_edit) values
 ('a0000000-0000-0000-0000-00000000000a', 'dashboard', true, false),
 ('b0000000-0000-0000-0000-00000000000b', 'reservas', true, false),
 ('d0000000-0000-0000-0000-00000000000d', 'reservas', true, false);
insert into public.super_admins (user_id, email) values ('c0000000-0000-0000-0000-00000000000c', 'super@test.local');

insert into public.espacios_reserva (id, nombre, capacidad_maxima, activa) values
 ('e0000000-0000-0000-0000-000000000001', 'Comedor', 80, true),
 ('e0000000-0000-0000-0000-000000000002', 'Cerrada', 20, false),
 ('e0000000-0000-0000-0000-000000000003', 'Borrable', 10, true);

-- ---------------------------------------------------------------------------
-- E1 catálogo
-- ---------------------------------------------------------------------------
do $t$ begin
  assert (select relrowsecurity from pg_class where oid = 'public.espacios_reserva'::regclass), 'E1a: RLS apagada';
  assert not exists (select 1 from pg_policies where tablename = 'espacios_reserva' and permissive = 'PERMISSIVE'
                      and roles && array['public','authenticated','anon']::name[]
                      and (coalesce(qual, '') in ('true', '(auth.uid() IS NOT NULL)') or coalesce(with_check, '') in ('true', '(auth.uid() IS NOT NULL)'))),
    'E1b: queda una permisiva abierta (true / auth.uid() IS NOT NULL) para public/authenticated/anon';
  assert (select string_agg(policyname, ',' order by policyname) from pg_policies where tablename = 'espacios_reserva') =
    'acceso_panel_no_bloqueado,espacios_reserva_delete_seccion,espacios_reserva_insert_seccion,espacios_reserva_select_anon_activos,espacios_reserva_select_seccion,espacios_reserva_service_role,espacios_reserva_update_seccion',
    'E1c: el conjunto final de políticas no es el esperado';
  assert not exists (select 1 from pg_policies where tablename = 'espacios_reserva' and roles = array['public']::name[]), 'E1d: queda una política TO public';
  assert has_table_privilege('anon', 'public.espacios_reserva', 'SELECT')
     and not has_table_privilege('anon', 'public.espacios_reserva', 'INSERT')
     and not has_table_privilege('anon', 'public.espacios_reserva', 'UPDATE')
     and not has_table_privilege('anon', 'public.espacios_reserva', 'DELETE')
     and not has_table_privilege('anon', 'public.espacios_reserva', 'TRUNCATE'), 'E1e: GRANT de anon (solo SELECT)';
  assert not has_table_privilege('authenticated', 'public.espacios_reserva', 'TRUNCATE'), 'E1f: authenticated conserva TRUNCATE';
  assert (select permissive from pg_policies where tablename = 'espacios_reserva' and policyname = 'acceso_panel_no_bloqueado') = 'RESTRICTIVE',
    'E1g: falta la restrictiva acceso_panel_no_bloqueado';
end $t$;

-- ---------------------------------------------------------------------------
-- E2 anon: lee solo los activos (contrato del join del panel viejo), no escribe
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $t$ begin
  assert pg_temp.n($q$select string_agg(nombre, ',' order by nombre) from public.espacios_reserva$q$) = 'Borrable,Comedor', 'E2a: anon no ve solo los activos';
  assert pg_temp.x($q$insert into public.espacios_reserva (nombre) values ('anon')$q$) = 'ERR:42501', 'E2b: anon crea espacios';
  assert pg_temp.x($q$update public.espacios_reserva set nombre = nombre$q$) = 'ERR:42501', 'E2c: anon edita espacios';
  assert pg_temp.x($q$delete from public.espacios_reserva$q$) = 'ERR:42501', 'E2d: anon borra espacios';
end $t$;
reset role;

-- ---------------------------------------------------------------------------
-- E3 STAFF (solo dashboard): NEGATIVA del encargo
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-00000000000a","role":"authenticated","session_id":"a1000000-0000-0000-0000-000000000001"}', true);
do $t$ begin
  assert pg_temp.x($q$insert into public.espacios_reserva (nombre, capacidad_maxima) values ('staff', 1)$q$) = 'ERR:42501', 'E3a: staff crea espacios';
  assert pg_temp.x($q$update public.espacios_reserva set capacidad_maxima = 0$q$) = 'ok:0', 'E3b: staff edita espacios';
  assert pg_temp.x($q$delete from public.espacios_reserva$q$) = 'ok:0', 'E3c: staff borra espacios (y su cascada)';
  assert pg_temp.x($q$truncate public.espacios_reserva$q$) = 'ERR:42501', 'E3d: staff vacía la tabla con TRUNCATE';
  assert pg_temp.n('select count(*) from public.espacios_reserva') = '0', 'E3e: staff lee espacios sin la sección reservas';
end $t$;
reset role;

-- ---------------------------------------------------------------------------
-- E4 LECTOR (reservas view): POSITIVA (lee todo y escribe: can_write_section = 'view')
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-00000000000b","role":"authenticated","session_id":"b1000000-0000-0000-0000-000000000001"}', true);
do $t$ begin
  assert pg_temp.n('select count(*) from public.espacios_reserva') = '3', 'E4a: lector no ve todos los espacios (activos e inactivos)';
  assert pg_temp.x($q$insert into public.espacios_reserva (nombre, capacidad_maxima) values ('lector', 4)$q$) = 'ok:1', 'E4b: lector no crea espacios';
  assert pg_temp.x($q$update public.espacios_reserva set capacidad_maxima = 81 where nombre = 'Comedor'$q$) = 'ok:1', 'E4c: lector no edita espacios';
  assert pg_temp.x($q$delete from public.espacios_reserva where nombre = 'lector'$q$) = 'ok:1', 'E4d: lector no borra espacios';
  assert pg_temp.x($q$truncate public.espacios_reserva$q$) = 'ERR:42501', 'E4e: lector con TRUNCATE';
end $t$;
reset role;

-- ---------------------------------------------------------------------------
-- E5 BLOQ (reservas view sin sesión válida): la restrictiva manda
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-00000000000d","role":"authenticated","session_id":"d1000000-0000-0000-0000-000000000001"}', true);
do $t$ begin
  assert pg_temp.n('select count(*) from public.espacios_reserva') = '0', 'E5a: sesión no permitida lee espacios';
  assert pg_temp.x($q$delete from public.espacios_reserva$q$) = 'ok:0', 'E5b: sesión no permitida borra espacios';
end $t$;
reset role;

-- ---------------------------------------------------------------------------
-- E6 SUPERADMIN
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-00000000000c","role":"authenticated","session_id":"c1000000-0000-0000-0000-000000000001"}', true);
do $t$ begin
  assert pg_temp.n('select count(*) from public.espacios_reserva') = '3', 'E6a: superadmin no ve todos los espacios';
  assert pg_temp.x($q$insert into public.espacios_reserva (nombre, capacidad_maxima) values ('sa', 2)$q$) = 'ok:1', 'E6b: superadmin no crea espacios';
  assert pg_temp.x($q$update public.espacios_reserva set activa = true where nombre = 'Cerrada'$q$) = 'ok:1', 'E6c: superadmin no edita espacios';
  assert pg_temp.x($q$delete from public.espacios_reserva where nombre in ('sa', 'Borrable')$q$) = 'ok:2', 'E6d: superadmin no borra espacios';
end $t$;
reset role;

-- ---------------------------------------------------------------------------
-- E7 service_role (bot, reservas-web, emails-reserva): sin cambios
-- ---------------------------------------------------------------------------
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $t$ begin
  assert pg_temp.n('select count(*) from public.espacios_reserva') = '2', 'E7a: service_role no lee espacios';
  assert pg_temp.x($q$insert into public.espacios_reserva (nombre) values ('sr')$q$) = 'ok:1', 'E7b: service_role no escribe espacios';
end $t$;
reset role;

rollback;
