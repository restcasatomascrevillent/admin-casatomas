set client_encoding = 'UTF8';
-- (Primera línea a propósito: los comentarios y mensajes llevan tildes y psql
-- en una consola de Windows puede arrancar en WIN1252.)
-- ===========================================================================
-- ##                                                                       ##
-- ##          NO APLICADA: la aplica el dueño a mano (ver pasos)           ##
-- ##                                                                       ##
-- ##   Publica en `supabase_realtime` las tablas `reservas`,               ##
-- ##   `solicitudes_pendientes`, `notificaciones_dashboard` y              ##
-- ##   `asignaciones_mesa`. El «tiempo real» del panel (campana,           ##
-- ##   solicitudes, Hoy, Calendario, rejilla de salas, modo servicio,      ##
-- ##   Asignación) NUNCA ha funcionado: los hooks se suscribían a estas    ##
-- ##   tablas pero ninguna migración las publicó, así que el servidor no   ##
-- ##   mandaba nada (y sin callback de estado, nada avisaba).              ##
-- ##   Solo ALTER PUBLICATION … ADD TABLE: no toca datos, ni RLS, ni       ##
-- ##   REPLICA IDENTITY, ni privilegios.                                   ##
-- ##                                                                       ##
-- ===========================================================================
--
-- ---------------------------------------------------------------------------
-- ESTADO ACTUAL VERIFICADO (producción, 2026-10-01/02, solo SELECT)
-- ---------------------------------------------------------------------------
--   Publicación supabase_realtime (dueño postgres): no es FOR ALL TABLES;
--   publica insert, update, delete y truncate. 4 tablas: call_logs,
--   config_google_places, phone_system_config y resenas. Ninguna de las 4 de
--   aquí está publicada.
--   reservas (~1.241 filas, más las 861 de la demo), solicitudes_pendientes,
--   notificaciones_dashboard y asignaciones_mesa:
--     · clave primaria `id` (válida e inmediata); REPLICA IDENTITY por defecto
--       (relreplident 'd': la PK);
--     · RLS encendida (sin FORCE). Lectura: `*_select_seccion` TO authenticated
--       con can_read_section('reservas') (reservas, solicitudes, asignaciones)
--       o can_read_section('dashboard') (notificaciones), más `*_service_role`.
--       Ninguna política para anon ni para public;
--     · privilegio SELECT de anon (de tabla o de alguna columna): SOLO sobre
--       reservas (el GRANT por defecto de Supabase; la RLS le deja 0 filas).
--       Sobre solicitudes_pendientes, notificaciones_dashboard y
--       asignaciones_mesa, ninguno.
--
-- ---------------------------------------------------------------------------
-- QUÉ HACE Y POR QUÉ ASÍ
-- ---------------------------------------------------------------------------
--   1. Precondiciones (abortan sin tocar nada): la publicación existe y no es
--      FOR ALL TABLES; cada tabla existe, tiene RLS, REPLICA IDENTITY por
--      defecto y una clave primaria válida e inmediata (sin ella, en cuanto la
--      tabla estuviera publicada sus UPDATE y DELETE FALLARÍAN); y anon NO tiene
--      SELECT sobre ninguna salvo reservas (si lo tuviera, los DELETE de esa
--      tabla le llegarían con la clave, como en reservas: ver SEGURIDAD).
--   2. ADD TABLE de las que falten (idempotente: reejecutarla no hace nada).
--   3. Red de seguridad: si al final no están las cuatro, se deshace TODO.
--   Las cuatro a la vez: el servidor da de alta las escuchas de un canal en
--   UNA transacción y reintenta cada 5-10 s los canales con una tabla sin
--   publicar. Dejar fuera asignaciones_mesa dejaría los canales de mesas del
--   modo servicio y de Asignación en ese bucle de error para siempre.
--
-- REPLICA IDENTITY POR DEFECTO, Y NO FULL. Los hooks releen al recibir el
-- evento (solicitudes, Hoy, Calendario, salas, modo servicio, Asignación) o
-- usan `payload.new` de un INSERT (campana); nadie lee `old`. Con la de por
-- defecto la fila vieja de un UPDATE/DELETE solo trae el `id`, y por eso los
-- canales FILTRADOS por `fecha=eq.X` (useOcupacionSalasDia,
-- useReservasServicioDia) nunca reciben un DELETE ni un UPDATE que SAQUE la
-- reserva de ese día: lo cubren `useReservasEnVivo` (sin filtro, en Hoy y el
-- Calendario) y el refresco de cada minuto. NO pasar a REPLICA IDENTITY FULL
-- para arreglarlo: anon tiene SELECT en todas las columnas de reservas y, con
-- la fila vieja completa, podría suscribirse con filtros (`nombre=eq.…`,
-- `telefono=eq.…`) y usarlos como oráculo de qué reservas se borran.
--
-- ---------------------------------------------------------------------------
-- SEGURIDAD: QUÉ VE CADA SUSCRIPTOR (según realtime.apply_rls de producción)
-- ---------------------------------------------------------------------------
--   Con la anon key (la de las webs, pública) cualquiera puede abrir un canal
--   a estas tablas, sin filtro. Lo que le llega:
--     · INSERT y UPDATE: Realtime comprueba, para cada fila y cada
--       suscriptor, su privilegio y la RLS de SELECT. Al panel (authenticated
--       con can_read_section('reservas') o ('dashboard')) le llega la fila. A
--       anon: en `reservas` nada (la RLS la descarta); en solicitudes,
--       notificaciones y asignaciones (sin privilegio SELECT) un evento con la
--       tabla, el tipo y errors: ["Error 401: Unauthorized"], sin datos.
--     · DELETE: la RLS no se puede aplicar (la fila ya no existe), así que el
--       evento llega a TODO suscriptor de la tabla, con su commit_timestamp. El
--       privilegio SELECT solo decide si lleva la clave primaria: en `reservas`
--       anon lo tiene y recibe el `id` de cada reserva borrada; en las otras
--       tres le llega con old_record vacío.
--   RESIDUO CONOCIDO: con la anon key se ve CUÁNDO hay actividad en las cuatro
--   tablas (no qué cambia), y el `id` (un uuid, nada más) de cada reserva que
--   se BORRE. El panel nunca borra reservas (cancelar es un UPDATE); el
--   residuo real son la LIMPIEZA de la demo y los borrados a mano. Cerrarlo
--   del todo pide `revoke select on public.reservas from anon`, fuera de este
--   encargo (revisar antes que ninguna web ni función lea reservas con la
--   anon key).
--   CÓMO COMPROBARLO (descrito, no ejecutado): desde una página cualquiera con
--   supabase-js y la anon key, `createClient(URL, ANON).channel("x").on(
--   "postgres_changes", { event: "*", schema: "public", table: "reservas" },
--   console.log).subscribe()`; cancelar una reserva de prueba desde el panel
--   (no debe llegar nada), borrar una reserva de prueba a mano (llega
--   `old: { id }`), y repetir con `asignaciones_mesa` (llegan eventos con
--   `errors: ["Error 401: Unauthorized"]` y sin datos).
--
-- ---------------------------------------------------------------------------
-- CÓMO SE APLICA (lo hace el dueño, a mano, desde adminpanelct/, una orden
-- por línea; NO con `supabase db push` ni `migration repair`)
-- ---------------------------------------------------------------------------
--   0. ANTES, el panel con los hooks en vivo tiene que estar DESPLEGADO:
--      Vercel lo publica solo al subir a main el commit «feat(reservas):
--      tiempo real de reservas, solicitudes y campana (hooks y migracion
--      preparada)». Comprobarlo: con la migración SIN aplicar, abrir /reservas
--      y mirar la consola del navegador: tienen que salir avisos «[realtime]
--      El canal «…» (tabla …) no está recibiendo cambios en vivo». Esa es la
--      señal de que el panel nuevo está activo. (Aplicarla con el panel viejo
--      no rompe nada: sus canales empezarían a recibir eventos sin debounce
--      ni avisos; por eso el orden.)
--   1. Que no haya transacciones largas abiertas (debe salir vacío):
--        npx supabase db query --linked "select pid, state, now() - xact_start as dura, left(query, 60) as consulta from pg_stat_activity where xact_start < now() - interval '1 minute' and pid <> pg_backend_pid();"
--   2. Aplicarla:
--        npx supabase db query --linked -f supabase/migrations/20261001200000_realtime_reservas_solicitudes_notificaciones.sql
--      Si falla con 55P03 (lock_not_available) no se ha aplicado nada (todo
--      va en una transacción): reintentar en unos segundos. Si falla en el
--      bloque 1 (precondiciones) tampoco: leer el mensaje.
--   3. Comprobarla (solo lectura, dentro de BEGIN … ROLLBACK):
--        npx supabase db query --linked -f supabase/tests/realtime_reservas_publicacion.sql
--   4. Recargar (F5) el panel en TODOS los dispositivos (tablet, móviles, PC).
--   5. Humo con dos dispositivos abiertos en /reservas: cambiar el estado de
--      una reserva de hoy en uno; en el otro el kanban y «Pendientes de mesa»
--      cambian solos en 1-2 s. Darle mesa a una reserva en el plano de uno: el
--      panel «Asignación» y «Pendientes de mesa» del otro la mueven solos. Y en
--      la consola del navegador ya no sale ningún aviso «[realtime]».
--
-- EFECTO ESPERADO: la publicación pasa a 8 tablas (las 4 de antes + estas 4).
-- Después de aplicarla, recargar (F5) el panel en todos los dispositivos.
-- Desde ahí la campana, las solicitudes (también las `reserva_hoy` que deja el
-- bot o la web), Hoy (kanban, Pendientes de mesa, línea de estados y cifras),
-- el Calendario, la rejilla de salas, el modo servicio y Asignación (también
-- las mesas asignadas) se ponen al día solos en 1-2 s con lo que cambie otro
-- dispositivo, el bot o la web, y ningún canal se queda en bucle de error.
--
-- CANDADOS: ALTER PUBLICATION … ADD TABLE toma ShareUpdateExclusiveLock sobre
-- cada tabla. No bloquea lecturas ni escrituras. Choca con un autovacuum de
-- esa tabla, pero uno normal se cancela solo en cuanto alguien espera por él
-- más de deadlock_timeout (1 s; los anti-wraparound no). Lo que de verdad la
-- haría esperar es un VACUUM o ANALYZE lanzado a mano, un CREATE INDEX o la
-- 20261001170000 aplicada a la vez. Con lock_timeout = 5s no se queda en cola:
-- falla con 55P03 y se reintenta.
--
-- RIESGOS QUE CONVIENE SABER
--   · La demo está aplicada (861 filas `[DEMO-SEED][oct-2026]`): su LIMPIEZA
--     soltará ~900 DELETE seguidos. El panel ya los agrupa (una relectura cada
--     5 s como mucho), pero conviene ejecutarla con la pestaña Asignación
--     cerrada (relee el rango por lotes).
--   · El cron detectar-ausencias (04:00 UTC) hace un UPDATE masivo diario: a esa
--     hora los paneles abiertos recibirán una ráfaga (agrupada igual).
--   · restaurante-phone (src/features/phone-system/services/supabasePhone.js:
--     98-108, `subscribeToReservations`) también escucha `reservas` y empezará
--     a recibir eventos: revisar que quien lo use aguanta ráfagas.
--   · WAL y tamaño de columnas: sin riesgo (Realtime lee la WAL que ya existe;
--     estas tablas son pequeñas).
--
-- Rollback: supabase/rollbacks/20261001200000_realtime_reservas_solicitudes_notificaciones_ROLLBACK.sql
-- ===========================================================================

begin;

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. PRECONDICIONES: si algo no es como se verificó, abortar SIN tocar nada.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  tabla regclass;
  identidad "char";
begin
  if not exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    raise exception 'Abortado sin tocar nada: no existe la publicación supabase_realtime';
  end if;
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime' and puballtables) then
    raise exception 'Abortado sin tocar nada: supabase_realtime es FOR ALL TABLES (no admite ADD TABLE)';
  end if;

  foreach t in array array['reservas', 'solicitudes_pendientes', 'notificaciones_dashboard', 'asignaciones_mesa'] loop
    tabla := to_regclass(format('public.%I', t));
    if tabla is null then
      raise exception 'Abortado sin tocar nada: no existe public.%', t;
    end if;

    -- Sin RLS, Realtime mandaría cada fila entera a cualquier suscriptor con
    -- privilegio SELECT (anon lo tiene sobre reservas).
    if not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = tabla) then
      raise exception 'Abortado sin tocar nada: public.% tiene la RLS apagada: publicarla mandaría sus filas a cualquiera', t;
    end if;

    -- REPLICA IDENTITY por defecto y NO FULL (ver «REPLICA IDENTITY POR
    -- DEFECTO, Y NO FULL» arriba).
    select c.relreplident into identidad from pg_catalog.pg_class c where c.oid = tabla;
    if identidad <> 'd' then
      raise exception 'Abortado sin tocar nada: public.% no tiene REPLICA IDENTITY por defecto (relreplident = %): esta migración solo publica con la de por defecto', t, identidad;
    end if;

    -- La de por defecto usa la clave primaria SOLO si es válida e inmediata;
    -- si no, Postgres no tiene identidad y, con la tabla publicada, sus UPDATE y
    -- DELETE fallarían («cannot update table … because it does not have a
    -- replica identity and publishes updates»).
    if not exists (
      select 1 from pg_catalog.pg_index i
       where i.indrelid = tabla and i.indisprimary and i.indisvalid and i.indimmediate
    ) then
      raise exception 'Abortado sin tocar nada: public.% no tiene una clave primaria válida e inmediata: publicarla rompería sus UPDATE y DELETE', t;
    end if;

    -- anon sin SELECT (ni de tabla ni de columna) salvo en reservas: con él,
    -- los DELETE de la tabla le llegarían con la clave (ver SEGURIDAD).
    if t <> 'reservas' and pg_catalog.has_any_column_privilege('anon', tabla, 'SELECT') then
      raise exception 'Abortado sin tocar nada: anon tiene privilegio SELECT sobre public.%: publicarla le mandaría la clave de cada fila borrada', t;
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. PUBLICAR las que falten (idempotente).
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['reservas', 'solicitudes_pendientes', 'notificaciones_dashboard', 'asignaciones_mesa'] loop
    if not exists (
      select 1 from pg_catalog.pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. RED DE SEGURIDAD: las cuatro quedan publicadas; si no, se aborta TODO.
-- ---------------------------------------------------------------------------
do $$
declare
  n int;
begin
  select count(*) into n
    from pg_catalog.pg_publication_tables
   where pubname = 'supabase_realtime' and schemaname = 'public'
     and tablename in ('reservas', 'solicitudes_pendientes', 'notificaciones_dashboard', 'asignaciones_mesa');
  if n <> 4 then
    raise exception 'Se esperaban las 4 tablas en supabase_realtime y hay %: no se ha aplicado nada', n;
  end if;
end
$$;

commit;

-- ===========================================================================
-- LO QUE ESTE FICHERO NO TAPA
-- ===========================================================================
--   1. El residuo de seguridad (ver SEGURIDAD): actividad visible con la anon
--      key en las cuatro tablas, y el `id` de las reservas borradas.
--   2. Los canales filtrados por fecha no ven DELETE ni UPDATE que saquen una
--      reserva del día (ver REPLICA IDENTITY).
--   3. La Lista de reservas renuncia a realtime a propósito (relee todo el
--      histórico por lotes); no cambia con esto.
--
-- ===========================================================================
-- VERIFICACIÓN tras aplicar (el juego completo: supabase/tests/realtime_reservas_publicacion.sql)
-- ===========================================================================
--   select schemaname, tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 2;
--   -- -> 8 filas: asignaciones_mesa, call_logs, config_google_places,
--   --    notificaciones_dashboard, phone_system_config, resenas, reservas,
--   --    solicitudes_pendientes
-- ===========================================================================
