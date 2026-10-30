-- ===========================================================================
-- Tests SQL de T4a-DB-AUTHZ (remediación 2026-10-30): migraciones
--   20261030100000_gdpr_limpieza_solo_servicio.sql             (CT-REM-DB-01)
--   20261030110000_rpc_chatbot_sin_acceso_cliente.sql           (CT-REM-IA-01)
--   20261030120000_rls_tablas_nucleo_idempotente.sql            (CT-REM-DB-04 parte 1)
--   20261030130000_rls_minimo_privilegio_tablas_abiertas.sql    (CT-REM-DB-02)
--   20261030140000_rpc_roles_y_mantenimiento_minimo_privilegio.sql (CT-REM-DB-05)
-- ---------------------------------------------------------------------------
-- SQL plano (no pgTAP), como mesas_rls_test.sql: cada comprobación es un
-- ASSERT; el primer fallo aborta con "ASSERT FAILED: <mensaje>". Todo en una
-- transacción que termina en ROLLBACK.
--
-- Lo ejecuta scripts/test-minimo-privilegio.mjs (PGlite, npm run
-- test:minimo-privilegio:db) sobre el estado previo de Git
-- (supabase/tests/fixtures/t4a_estado_previo.sql) con las cinco migraciones
-- aplicadas. Contra una base local con TODAS las migraciones también vale
-- (psql -v ON_ERROR_STOP=1 -f ...), salvo que los triggers de auditoría
-- exijan contexto para los INSERT de datos sintéticos de abajo.
--
-- Personas (datos sintéticos):
--   STAFF   solo dashboard/view (lo que da el trigger de alta)
--   LECTOR  reservas view (sin edit)
--   GESTOR  gestion_web view
--   FACT    facturas view
--   SUPER   fila en super_admins
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
 ('f0000000-0000-0000-0000-00000000000f', 'gestor@test.local'),
 ('90000000-0000-0000-0000-000000000009', 'facturas@test.local');
insert into auth.sessions (id, user_id) values
 ('a1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a'),
 ('b1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000b'),
 ('c1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000000c'),
 ('f1000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000f'),
 ('91000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000009');
insert into public.user_permissions (user_id, section_key, can_view, can_edit) values
 ('a0000000-0000-0000-0000-00000000000a', 'dashboard', true, false),
 ('b0000000-0000-0000-0000-00000000000b', 'reservas', true, false),
 ('f0000000-0000-0000-0000-00000000000f', 'gestion_web', true, false),
 ('90000000-0000-0000-0000-000000000009', 'facturas', true, false);
insert into public.super_admins (user_id, email) values ('c0000000-0000-0000-0000-00000000000c', 'super@test.local');

insert into public.reservas (nombre, telefono, fecha, hora, numero_comensales, estado) values
 ('Antigua', '+34600000001', current_date - 800, '14:00', 2, 'completada'),
 ('Reciente', '+34600000002', current_date - 3, '21:00', 4, 'completada');
insert into public.gdpr_config (tabla, dias_retencion, accion, activo) values ('reservas', 730, 'anonimizar', true);
insert into public.gdpr_audit_log (accion, tabla, registros_afectados) values ('anonimizar', 'reservas', 1);
insert into public.security_log (type) values ('login_failed');
insert into public.rate_limit_log (identifier) values ('web:1');
insert into public.consultas_chatbot (pregunta, respuesta) values ('¿gasto?', '1.234 €');
insert into public.sell_users (user_id, nombre) values ('b0000000-0000-0000-0000-00000000000b', 'Cliente lector');
insert into public.resenas (nombre_cliente, valoracion, estado) values ('Troll', 1, 'pendiente'), ('Feliz', 5, 'publicada');
insert into public.novedades (titulo, activo, fecha_inicio) values ('Vigente', true, current_date - 1), ('Borrador', false, current_date);
insert into public.menus_diarios (fecha, idiom) values (current_date, 'es');
insert into public.tapas (id, fecha, idiom) values ('t1', current_date, 'es');
insert into public."Platos" (id, nombre, activado) values ('p1', 'Chuleta', true), ('p2', 'Oculto', false);
insert into public.salas (nombre, activa) values ('Activa', true), ('Inactiva', false);
insert into public.bew (nombre) values ('legado');
insert into public.ocupacion_diaria (fecha, total_comensales) values (current_date, 4);
insert into public.configuracion_turnos (nombre_periodo, hora_inicio, hora_fin) values ('Comida', '13:00', '16:00');
insert into public.config_google_places (place_id) values ('x');
insert into public."BebidasVENTA" (id, nombre) values ('bv1', 'Agua');

-- ---------------------------------------------------------------------------
-- T1 catálogo
-- ---------------------------------------------------------------------------
do $t$ begin
  assert (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity) = 0,
    'T1a: queda alguna tabla de public sin RLS';
  assert not has_table_privilege('anon', 'public.reservas', 'SELECT'), 'T1b: anon conserva SELECT en reservas';
  assert not exists (select 1 from pg_policies where schemaname = 'public' and permissive = 'PERMISSIVE'
                      and cmd in ('INSERT','UPDATE','DELETE','ALL') and roles && array['public','authenticated']::name[]
                      and coalesce(qual, with_check) in ('true', '(auth.uid() IS NOT NULL)')),
    'T1c: queda una permisiva de escritura USING true / auth.uid() IS NOT NULL';
  assert not exists (select 1 from pg_policies where roles && array['public','anon']::name[]
                      and (coalesce(qual,'') || coalesce(with_check,'')) ~ '(is_admin|is_super_admin)\s*\('),
    'T1d: queda una política TO public/anon que llama a is_admin/is_super_admin';
  assert not has_function_privilege('anon', 'public.is_super_admin(uuid)', 'EXECUTE')
     and not has_function_privilege('anon', 'public.is_admin(uuid)', 'EXECUTE'), 'T1e: anon ejecuta is_admin/is_super_admin';
  assert has_function_privilege('authenticated', 'public.is_super_admin(uuid)', 'EXECUTE'), 'T1f: authenticated perdió is_super_admin';
  assert not has_function_privilege('authenticated', 'public.ejecutar_limpieza_gdpr()', 'EXECUTE')
     and has_function_privilege('service_role', 'public.ejecutar_limpieza_gdpr()', 'EXECUTE'), 'T1g: EXECUTE de ejecutar_limpieza_gdpr';
  assert not has_function_privilege('authenticated', 'public.append_tool_call_log(text,jsonb)', 'EXECUTE')
     and not has_function_privilege('authenticated', 'public.cleanup_old_security_logs()', 'EXECUTE')
     and not has_function_privilege('authenticated', 'public.recalcular_ocupacion_historica(date,date)', 'EXECUTE')
     and has_function_privilege('service_role', 'public.append_tool_call_log(text,jsonb)', 'EXECUTE'), 'T1h: RPC de mantenimiento';
  assert not exists (select 1 from pg_proc where proname = 'ejecutar_consulta_chatbot'
                      and (has_function_privilege('authenticated', oid, 'EXECUTE') or has_function_privilege('anon', oid, 'EXECUTE'))),
    'T1i: ejecutar_consulta_chatbot sigue ejecutable por clientes';
  assert not has_table_privilege('authenticated', 'public.novedades', 'TRUNCATE'), 'T1j: authenticated con TRUNCATE en novedades';
end $t$;

-- ---------------------------------------------------------------------------
-- T2 anon: conserva la lectura de la web y Touza; nada más
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $t$ begin
  assert pg_temp.n($q$select count(*) from public."Platos"$q$) = '1', 'T2a: anon no ve el plato activo (o ve el oculto)';
  assert pg_temp.n('select count(*) from public.menus_diarios') = '1', 'T2b: anon no ve menus_diarios';
  assert pg_temp.n('select count(*) from public.tapas') = '1', 'T2c: anon no ve tapas';
  assert pg_temp.n($q$select string_agg(titulo, ',') from public.novedades$q$) = 'Vigente', 'T2d: anon ve borradores o no ve la vigente';
  assert pg_temp.n($q$select string_agg(estado, ',') from public.resenas$q$) = 'publicada', 'T2e: anon ve reseñas no publicadas';
  assert pg_temp.n($q$select string_agg(nombre, ',') from public.salas$q$) = 'Activa', 'T2f: anon ve salas inactivas';
  assert pg_temp.n('select count(*) from public.reservas') = 'ERR:42501', 'T2g: anon lee reservas';
  assert pg_temp.n($q$select public.is_super_admin('c0000000-0000-0000-0000-00000000000c')::text$q$) = 'ERR:42501', 'T2h: oráculo de superadmin para anon';
  assert pg_temp.x($q$insert into public.salas (nombre) values ('anon')$q$) = 'ERR:42501', 'T2i: anon escribe salas';
  assert pg_temp.x($q$insert into public.novedades (titulo, fecha_inicio) values ('anon', current_date)$q$) = 'ERR:42501', 'T2j: anon escribe novedades';
  assert pg_temp.n($q$select public.ejecutar_consulta_chatbot('select 1')::text$q$) = 'ERR:42501', 'T2k: anon ejecuta ejecutar_consulta_chatbot';
end $t$;
reset role;

-- ---------------------------------------------------------------------------
-- T3 STAFF (solo dashboard)
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-00000000000a","role":"authenticated","session_id":"a1000000-0000-0000-0000-000000000001"}', true);
do $t$ begin
  assert pg_temp.n('select count(*) from public.sell_users') = '0', 'T3a: staff lee PII de sell_users';
  assert pg_temp.x('update public.gdpr_config set dias_retencion = 0') = 'ok:0', 'T3b: staff cambia gdpr_config';
  assert pg_temp.n('select count(*) from public.ejecutar_limpieza_gdpr()') = 'ERR:42501', 'T3c: staff ejecuta la limpieza RGPD';
  assert pg_temp.x('delete from public.gdpr_audit_log') = 'ERR:42501', 'T3d: staff borra gdpr_audit_log';
  assert pg_temp.x('delete from public.security_log') = 'ERR:42501', 'T3e: staff borra security_log';
  assert pg_temp.x('delete from public.rate_limit_log') = 'ERR:42501', 'T3f: staff borra rate_limit_log';
  assert pg_temp.x($q$update public.resenas set estado = 'publicada'$q$) = 'ok:0', 'T3g: staff modera reseñas';
  assert pg_temp.x($q$insert into public.novedades (titulo, fecha_inicio) values ('falsa', current_date)$q$) = 'ERR:42501', 'T3h: staff publica novedades';
  assert pg_temp.n('select count(*) from public.consultas_chatbot') = '0', 'T3i: staff lee consultas_chatbot';
  assert pg_temp.x('delete from public.ocupacion_diaria') = 'ERR:42501', 'T3j: staff borra ocupacion_diaria';
  assert pg_temp.x('update public.config_google_places set place_id = place_id') = 'ok:0', 'T3k: staff cambia config_google_places';
  assert pg_temp.n($q$select count(*) from public.novedades where titulo = 'Borrador'$q$) = '0', 'T3l: staff ve borradores';
  assert pg_temp.x('update public.menus_diarios set menu = menu') = 'ok:0', 'T3m: staff edita menús';
  assert pg_temp.n('select count(*) from public.bew') = '0' and pg_temp.n($q$select count(*) from public."BebidasVENTA"$q$) = '0', 'T3n: staff ve legado ecommerce';
  assert pg_temp.x($q$insert into public.salas (nombre) values ('staff')$q$) = 'ERR:42501', 'T3o: staff crea salas';
  assert pg_temp.n('select count(*) from public.configuracion_turnos') = '1', 'T3p: el widget del dashboard pierde configuracion_turnos';
  assert pg_temp.x($q$insert into public.configuracion_turnos (nombre_periodo, hora_inicio, hora_fin) values ('x','10:00','11:00')$q$) = 'ERR:42501', 'T3q: staff crea turnos';
  assert pg_temp.n($q$select count(*) from public."Platos"$q$) = '2', 'T3r: la carta (también oculta) deja de verse en el panel';
  assert pg_temp.n($q$select public.ejecutar_consulta_chatbot('select 1')::text$q$) = 'ERR:42501', 'T3s: staff ejecuta SQL libre';
  assert pg_temp.n($q$select public.verificar_duplicado_factura('X','Y',current_date,1)::text$q$) = 'ERR:42501', 'T3t: staff ejecuta verificar_duplicado_factura';
  assert pg_temp.x('select public.cleanup_old_security_logs()') = 'ERR:42501', 'T3u: staff ejecuta cleanup_old_security_logs';
  assert pg_temp.x($q$select public.append_tool_call_log('x', '[]'::jsonb)$q$) = 'ERR:42501', 'T3v: staff inyecta en call_logs';
  assert pg_temp.n('select count(*) from public.reservas') = '0', 'T3w: staff ve reservas';
end $t$;
reset role;

-- ---------------------------------------------------------------------------
-- T4 LECTOR (reservas view): sus pantallas siguen funcionando
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-00000000000b","role":"authenticated","session_id":"b1000000-0000-0000-0000-000000000001"}', true);
do $t$ begin
  assert pg_temp.n('select count(*) from public.reservas') = '2', 'T4a: lector no ve reservas';
  assert pg_temp.x($q$update public.reservas set notas_cliente = 'x'$q$) = 'ok:0', 'T4b: lector edita reservas sin can_edit';
  assert pg_temp.n('select count(*) from public.configuracion_turnos') = '1', 'T4c: lector no ve turnos';
  assert pg_temp.x('update public.configuracion_turnos set activo = activo') = 'ok:1', 'T4d: lector (view) ya no escribe turnos (cambiaría con DB-03)';
  assert pg_temp.n('select count(*) from public.salas') = '2', 'T4e: lector no ve todas las salas';
  assert pg_temp.n('select count(*) from public.ocupacion_diaria') = '1', 'T4f: lector no ve ocupacion_diaria';
  assert pg_temp.n($q$select count(*) from public.novedades where titulo = 'Borrador'$q$) = '0', 'T4g: lector ve borradores de novedades';
  assert pg_temp.n('select count(*) from public.sell_users') = '1', 'T4h: el perfil propio de sell_users deja de verse';
end $t$;
reset role;

-- ---------------------------------------------------------------------------
-- T5 GESTOR (gestion_web view) y FACT (facturas view)
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f0000000-0000-0000-0000-00000000000f","role":"authenticated","session_id":"f1000000-0000-0000-0000-000000000001"}', true);
do $t$ begin
  assert pg_temp.n('select count(*) from public.novedades') = '2', 'T5a: gestor no ve borradores';
  assert pg_temp.x($q$insert into public.novedades (titulo, fecha_inicio) values ('gestor', current_date)$q$) = 'ok:1', 'T5b: gestor no crea novedades';
  assert pg_temp.x('update public.menus_diarios set menu = menu') = 'ok:1', 'T5c: gestor no edita menús';
  assert pg_temp.x($q$update public.tapas set tapas = tapas$q$) = 'ok:1', 'T5d: gestor no edita tapas';
  assert pg_temp.x($q$delete from public.tapas where id = 'no-existe'$q$) = 'ok:0', 'T5e: gestor no borra tapas';
  assert pg_temp.x($q$update public.resenas set estado = 'publicada'$q$) = 'ok:0', 'T5f: gestor modera reseñas';
  assert pg_temp.n('select count(*) from public.ocupacion_diaria') = '0', 'T5g: gestor ve ocupación';
end $t$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"90000000-0000-0000-0000-000000000009","role":"authenticated","session_id":"91000000-0000-0000-0000-000000000001"}', true);
do $t$ begin
  assert pg_temp.n('select count(*) from public.consultas_chatbot') = '1', 'T5h: facturas no ve consultas_chatbot';
  assert pg_temp.x('delete from public.consultas_chatbot') = 'ERR:42501', 'T5i: facturas borra consultas_chatbot';
end $t$;
reset role;

-- ---------------------------------------------------------------------------
-- T6 SUPERADMIN
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-00000000000c","role":"authenticated","session_id":"c1000000-0000-0000-0000-000000000001"}', true);
do $t$ begin
  assert pg_temp.x($q$update public.gdpr_config set descripcion = 'sa'$q$) = 'ok:1', 'T6a: superadmin no edita gdpr_config';
  assert pg_temp.n('select count(*) from public.gdpr_audit_log') = '1', 'T6b: superadmin no lee gdpr_audit_log';
  assert pg_temp.x($q$update public.resenas set estado = 'publicada' where estado = 'pendiente'$q$) = 'ok:1', 'T6c: superadmin no modera reseñas';
  assert pg_temp.x('update public.config_google_places set place_id = place_id') = 'ok:1', 'T6d: superadmin no edita config_google_places';
  assert pg_temp.n('select count(*) from public.security_log') = '1' and pg_temp.n('select count(*) from public.rate_limit_log') = '1', 'T6e: superadmin no lee logs';
  assert pg_temp.n('select count(*) from public.sell_users') = '1', 'T6f: superadmin no lee sell_users';
  assert pg_temp.n('select count(*) from public.bew') = '1' and pg_temp.x($q$insert into public."BebidasVENTA" (id, nombre) values ('bv2', 'Vino')$q$) = 'ok:1', 'T6g: superadmin sin ecommerce';
  assert pg_temp.x($q$insert into public.salas (nombre) values ('sa')$q$) = 'ok:1', 'T6h: superadmin no crea salas';
  assert pg_temp.x($q$update public.user_permissions set can_edit = can_edit where user_id = 'b0000000-0000-0000-0000-00000000000b'$q$) = 'ok:1', 'T6i: superadmin no gestiona permisos';
  assert pg_temp.x($q$insert into public.novedades (titulo, fecha_inicio) values ('sa', current_date)$q$) = 'ok:1', 'T6j: superadmin no crea novedades';
end $t$;
reset role;

-- ---------------------------------------------------------------------------
-- T7 service_role (Edge Functions, bot): sin cambios
-- ---------------------------------------------------------------------------
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $t$ begin
  assert pg_temp.n($q$select string_agg(tabla || ':' || registros_procesados, ',') from public.ejecutar_limpieza_gdpr()$q$) = 'reservas:1', 'T7a: la limpieza RGPD no funciona con service_role';
  assert pg_temp.n($q$select count(*) from public.gdpr_audit_log where tabla = 'reservas'$q$) = '2', 'T7b: la limpieza no deja rastro';
  assert pg_temp.x('select public.cleanup_old_security_logs()') = 'ok:1', 'T7c: service_role no ejecuta cleanup_old_security_logs';
  assert pg_temp.n($q$select (public.verificar_duplicado_factura('X','Y',current_date,1)->>'es_duplicado')$q$) = 'false', 'T7d: procesar-factura pierde verificar_duplicado_factura';
  assert pg_temp.x($q$insert into public.security_log (type) values ('sr')$q$) = 'ok:1', 'T7e: service_role no escribe security_log';
  assert pg_temp.n($q$select public.is_admin('c0000000-0000-0000-0000-00000000000c')::text$q$) = 'false', 'T7f: service_role pierde is_admin';
end $t$;
reset role;
do $t$ begin
  assert (select string_agg(nombre, ',' order by fecha) from public.reservas) = 'Cliente Anonimizado,Reciente',
    'T7g: la limpieza anonimizó lo que no debía';
end $t$;

rollback;
