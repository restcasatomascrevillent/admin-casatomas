-- =============================================================================
-- LIMPIEZA de la DEMO OCTUBRE 2026 (pareja de 20261001_demo_reservas_octubre.sql)
-- =============================================================================
-- Borra SOLO las reservas cuyas notas_cliente empiezan por '[DEMO-SEED][oct-2026]' y, antes,
-- las asignaciones_mesa que el personal les haya puesto. Nada más se borra a mano.
--
-- Efectos automáticos de la BD al borrar esas reservas (por diseño de las FK):
--   · ON DELETE CASCADE: desaparecen con ellas sus filas en sugerencias_blacklist,
--     avisos_reserva_enviados y envios_email_reserva.
--   · ON DELETE SET NULL: solicitudes_pendientes.reserva_id queda a NULL si alguna apuntaba.
--   · trigger_actualizar_ocupacion recalcula ocupacion_diaria (y borra las horas vacías).
-- NO se borra (no tiene FK; la salida lo cuenta y el PASO 0 comentado trae el borrado
-- exacto, que solo funciona ANTES de borrar las reservas):
--   · notificaciones_dashboard que apunten a estas reservas (referencia_id).
--   · asignaciones_mesa_descartadas de estas reservas.
--   · blacklist creada al APROBAR una sugerencia de una reserva demo.
--   · reservas demo a las que alguien quitó la marca de la nota: se reconocen porque
--     tienen el mismo created_at que las demo (toda la demo entra en una transacción).
-- OJO: el cleanup_demo_data.sql antiguo (LIKE '[DEMO-SEED]%') TAMBIÉN borraría estas reservas.
--
-- Ejecutar (desde adminpanelct/):
--   npx supabase db query --linked -f supabase/seeds/20261001_demo_reservas_octubre_LIMPIEZA.sql
-- Es todo o nada (begin/commit propios, lock_timeout de 5 s: un 55P03 no borra nada, reintentar).
-- La salida es una fila con el inventario ANTES y DESPUÉS.
-- =============================================================================
set client_encoding = 'UTF8';
begin;
set local lock_timeout = '5s';

create temp table _demo_oct_ids as
  select id, created_at from public.reservas where notas_cliente like '[DEMO-SEED][oct-2026]%';

create temp table _demo_oct_antes as
select
  (select count(*) from _demo_oct_ids)                                                    as reservas_demo,
  (select count(*) from public.reservas)                                                  as reservas_total,
  (select count(*) from public.asignaciones_mesa where reserva_id in (select id from _demo_oct_ids))       as asignaciones_mesa,
  (select count(*) from public.sugerencias_blacklist where reserva_id in (select id from _demo_oct_ids))   as sugerencias_cascade,
  (select count(*) from public.sugerencias_blacklist where reserva_id in (select id from _demo_oct_ids)
      and blacklist_id is not null)                                                        as sugerencias_aprobadas,
  (select count(*) from public.avisos_reserva_enviados where reserva_id in (select id from _demo_oct_ids)) as avisos_cascade,
  (select count(*) from public.envios_email_reserva where reserva_id in (select id from _demo_oct_ids))    as envios_cascade,
  (select count(*) from public.solicitudes_pendientes where reserva_id in (select id from _demo_oct_ids))  as solicitudes_set_null,
  (select count(*) from public.notificaciones_dashboard where referencia_tipo = 'reserva'
      and referencia_id in (select id from _demo_oct_ids))                                 as notificaciones_no_se_borran,
  (select count(*) from public.asignaciones_mesa_descartadas where reserva_id in (select id from _demo_oct_ids)) as descartadas_no_se_borran,
  (select count(*) from public.reservas
    where created_at in (select distinct created_at from _demo_oct_ids)
      and coalesce(notas_cliente, '') not like '[DEMO-SEED][oct-2026]%')                                as demo_sin_marca_no_se_borran;

-- PASO 0 (OPCIONAL; NO se ejecuta). Si alguna columna *_no_se_borran o
-- sugerencias_aprobadas salió > 0 en una ejecución anterior, descomentar aquí lo que
-- haga falta (antes de borrar las reservas). Criterio exacto:
-- delete from public.notificaciones_dashboard
--  where referencia_tipo = 'reserva' and referencia_id in (select id from _demo_oct_ids);
-- delete from public.asignaciones_mesa_descartadas
--  where reserva_id in (select id from _demo_oct_ids);
-- delete from public.blacklist where id in (
--   select blacklist_id from public.sugerencias_blacklist
--    where reserva_id in (select id from _demo_oct_ids) and blacklist_id is not null);
-- delete from public.reservas  -- revisar antes la lista: misma transacción que la demo, sin marca
--  where created_at in (select distinct created_at from _demo_oct_ids)
--    and coalesce(notas_cliente, '') not like '[DEMO-SEED][oct-2026]%';

-- 1) Mesas que el personal haya asignado a reservas demo (antes que las reservas).
delete from public.asignaciones_mesa where reserva_id in (select id from _demo_oct_ids);
-- 2) Las reservas demo, y solo ellas.
delete from public.reservas where id in (select id from _demo_oct_ids);

commit;

-- Inventario antes / después (solo lectura).
select a.reservas_demo                     as antes_reservas_demo,
       (select count(*) from public.reservas where notas_cliente like '[DEMO-SEED][oct-2026]%') as despues_reservas_demo,
       a.reservas_total                    as antes_reservas_total,
       (select count(*) from public.reservas) as despues_reservas_total,
       a.asignaciones_mesa                 as antes_asignaciones_mesa,
       (select count(*) from public.asignaciones_mesa where reserva_id in (select id from _demo_oct_ids)) as despues_asignaciones_mesa,
       a.sugerencias_cascade, a.sugerencias_aprobadas, a.avisos_cascade, a.envios_cascade, a.solicitudes_set_null,
       a.notificaciones_no_se_borran, a.descartadas_no_se_borran, a.demo_sin_marca_no_se_borran
  from _demo_oct_antes a;
