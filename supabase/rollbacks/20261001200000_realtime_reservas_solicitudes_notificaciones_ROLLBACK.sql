set client_encoding = 'UTF8';
-- (Primera línea a propósito: los comentarios y mensajes llevan tildes.)
-- ===========================================================================
-- ROLLBACK de supabase/migrations/20261001200000_realtime_reservas_solicitudes_notificaciones.sql
-- ===========================================================================
--
-- Este fichero NO es una migración y no debe copiarse a
-- supabase/migrations/ (ver supabase/rollbacks/README.md). Se ejecuta A MANO
-- y solo para deshacer un despliegue que salió mal:
--   npx supabase db query --linked -f supabase/rollbacks/20261001200000_realtime_reservas_solicitudes_notificaciones_ROLLBACK.sql
--
-- Saca de la publicación supabase_realtime `reservas`,
-- `solicitudes_pendientes`, `notificaciones_dashboard` y `asignaciones_mesa`
-- (solo las que estén: idempotente). No toca datos, ni RLS, ni REPLICA
-- IDENTITY, ni privilegios.
--
-- Quita las cuatro AUNQUE alguna la hubiera publicado otro cambio. Hoy
-- (2026-10-02) no hay ninguna de las cuatro publicada, así que deshacer la
-- migración deja la publicación EXACTAMENTE como estaba: sus 4 tablas de
-- antes (call_logs, config_google_places, phone_system_config, resenas).
--
-- EFECTO: el panel deja de recibir en vivo los cambios de reservas,
-- solicitudes, notificaciones y mesas asignadas, como antes de la migración.
-- No hace falta revertir ningún frontend. Con el panel nuevo desplegado (el
-- de los hooks en vivo), todo sigue funcionando con su respaldo: campana y
-- solicitudes se releen cada minuto, y Hoy, Calendario, modo servicio y
-- Asignación también, siempre con la pestaña a la vista; la consola vuelve a
-- avisar una vez por tabla («[realtime] … no está recibiendo cambios en
-- vivo») y el servidor vuelve a reintentar cada 5-10 s esos canales. Con el
-- panel viejo, todo queda exactamente como antes de la migración. Recargar
-- (F5) el panel en los dispositivos para que los canales se vuelvan a crear.
--
-- CANDADOS: DROP TABLE de una publicación toma el mismo candado que el ADD
-- (ShareUpdateExclusiveLock). lock_timeout = 5s: un 55P03 significa que no se
-- ha deshecho nada y se reintenta.
-- ===========================================================================

begin;

set local lock_timeout = '5s';

do $$
declare
  t text;
begin
  foreach t in array array['reservas', 'solicitudes_pendientes', 'notificaciones_dashboard', 'asignaciones_mesa'] loop
    if exists (
      select 1 from pg_catalog.pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime drop table public.%I', t);
    end if;
  end loop;
end
$$;

-- Comprobación: no queda publicada ninguna de las cuatro; si no, se aborta TODO.
do $$
begin
  if exists (
    select 1 from pg_catalog.pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public'
       and tablename in ('reservas', 'solicitudes_pendientes', 'notificaciones_dashboard', 'asignaciones_mesa')
  ) then
    raise exception 'ROLLBACK: sigue publicada alguna de las cuatro tablas: no se ha deshecho nada';
  end if;
end
$$;

commit;

-- VERIFICACIÓN:
--   select schemaname, tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 2;
--   -- -> 4 filas: call_logs, config_google_places, phone_system_config, resenas
