set client_encoding = 'UTF8';
-- (Primera línea a propósito: los mensajes llevan tildes y psql en una consola
-- de Windows puede arrancar en WIN1252. Es lo ÚNICO antes del BEGIN y ninguna
-- comprobación depende de ello.)
-- ===========================================================================
-- Pruebas SQL de 20261001200000_realtime_reservas_solicitudes_notificaciones.sql
-- ---------------------------------------------------------------------------
-- SQL plano (no pgTAP), como el resto de supabase/tests/: cada comprobación
-- es un ASSERT dentro de un DO; el primer fallo aborta con
-- "ASSERT FAILED: <caso>: ...".
--
-- SOLO LECTURA del catálogo (pg_publication, pg_publication_tables, pg_class,
-- pg_index, pg_policies, privilegios): no crea, ni cambia, ni borra nada, y
-- aun así va todo dentro de BEGIN … ROLLBACK. No depende de ningún SET hecho
-- antes del BEGIN: ni de rol, ni de search_path (todo va cualificado).
--
-- CUÁNDO: DESPUÉS de aplicar la migración (R1 aborta si no).
--
-- DÓNDE Y CÓMO: vale contra producción, como `postgres`:
--   npx supabase db query --linked -f supabase/tests/realtime_reservas_publicacion.sql
-- Si termina sin ERROR, todo ha pasado (lo último que devuelve es una fila
-- «realtime_reservas_publicacion: todas las comprobaciones han pasado», con el
-- número total de tablas publicadas como dato informativo).
--
-- QUÉ SE PRUEBA (las 4 tablas: reservas, solicitudes_pendientes,
-- notificaciones_dashboard y asignaciones_mesa)
--   R1  la publicación supabase_realtime existe, no es FOR ALL TABLES, publica
--       INSERT/UPDATE/DELETE y tiene las 4 tablas.
--   R2  están publicadas las 8 esperadas: las 4 de antes (call_logs,
--       config_google_places, phone_system_config, resenas) + las 4. Si
--       alguien publica otra más, no falla: el total sale en la fila final.
--   R3  REPLICA IDENTITY por defecto (relreplident 'd', NO FULL) y clave
--       primaria válida e inmediata en las 4, igual que exige la migración: sin
--       ella sus UPDATE y DELETE fallarían al estar publicadas.
--   R4  RLS encendida en las 4 (Realtime filtra con ella cada INSERT/UPDATE).
--   R5  anon NO tiene ninguna política de lectura (SELECT ni ALL; ni por el
--       rol anon ni por public) sobre reservas, ni sobre las otras tres
--       (asignaciones_mesa incluida).
--   R6  toda lectura de authenticated sobre las 4 sigue exigiendo una sección
--       (`*_section(...)`): es lo que limita qué filas le llegan por realtime.
--   R7  anon no tiene privilegio SELECT (ni de tabla ni de columna) sobre
--       solicitudes_pendientes, notificaciones_dashboard ni asignaciones_mesa.
--       Los eventos de esas tablas le siguen llegando (un DELETE llega a todo
--       suscriptor; un INSERT/UPDATE, con errors: ["Error 401: Unauthorized"]),
--       pero sin datos: sin el privilegio, un DELETE no lleva la clave. Solo en
--       reservas, que sí tiene el GRANT SELECT de anon, llega el `id` de cada
--       fila borrada (el residuo descrito en la cabecera de la migración).
--
-- ESTADO: escrito el 2026-10-01/02 y SIN EJECUTAR (la migración tampoco está
-- aplicada).
-- ===========================================================================

begin;

set local statement_timeout = '30s';

do $$
declare
  t text;
  tabla regclass;
  faltan text;
  malas text;
  n int;
begin
  -- -------------------------------------------------------------------------
  -- R1 la publicación y las 4 tablas
  -- -------------------------------------------------------------------------
  assert exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime'),
    'R1a: no existe la publicación supabase_realtime';
  assert (select not p.puballtables and p.pubinsert and p.pubupdate and p.pubdelete
            from pg_catalog.pg_publication p where p.pubname = 'supabase_realtime'),
    'R1b: supabase_realtime es FOR ALL TABLES o no publica INSERT/UPDATE/DELETE';
  foreach t in array array['reservas', 'solicitudes_pendientes', 'notificaciones_dashboard', 'asignaciones_mesa'] loop
    assert exists (select 1 from pg_catalog.pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t),
      format('R1c %s: no está en supabase_realtime: aplicar antes la migración 20261001200000', t);
  end loop;

  -- -------------------------------------------------------------------------
  -- R2 las 8 esperadas están publicadas (si hay más, el total sale al final)
  -- -------------------------------------------------------------------------
  select string_agg(e, ', ' order by e) into faltan
    from unnest(array['asignaciones_mesa', 'call_logs', 'config_google_places', 'notificaciones_dashboard',
                      'phone_system_config', 'resenas', 'reservas', 'solicitudes_pendientes']) as e
   where not exists (select 1 from pg_catalog.pg_publication_tables p
                      where p.pubname = 'supabase_realtime' and p.schemaname = 'public' and p.tablename = e);
  assert faltan is null, format('R2: faltan en supabase_realtime: %s', faltan);

  -- -------------------------------------------------------------------------
  -- R3 identidad de réplica por defecto + PK válida e inmediata; R4 RLS
  -- -------------------------------------------------------------------------
  foreach t in array array['reservas', 'solicitudes_pendientes', 'notificaciones_dashboard', 'asignaciones_mesa'] loop
    tabla := to_regclass(format('public.%I', t));
    assert tabla is not null, format('R3a %s: no existe la tabla', t);
    assert (select c.relreplident from pg_catalog.pg_class c where c.oid = tabla) = 'd',
      format('R3b %s: REPLICA IDENTITY ya no es la de por defecto (relreplident = %s; FULL no: ver la migración)', t,
             (select c.relreplident from pg_catalog.pg_class c where c.oid = tabla));
    assert exists (select 1 from pg_catalog.pg_index i
                    where i.indrelid = tabla and i.indisprimary and i.indisvalid and i.indimmediate),
      format('R3c %s: sin clave primaria válida e inmediata: con la tabla publicada sus UPDATE y DELETE fallarían', t);
    assert (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = tabla),
      format('R4 %s: la RLS está apagada: realtime mandaría sus filas a cualquier suscriptor', t);
  end loop;

  -- -------------------------------------------------------------------------
  -- R5 anon no lee nada por políticas (ni por rol anon ni por public)
  -- -------------------------------------------------------------------------
  select string_agg(format('«%s» (%s, %s)', policyname, cmd, roles::text), '; ') into malas
    from pg_catalog.pg_policies
   where schemaname = 'public' and tablename = 'reservas'
     and cmd in ('SELECT', 'ALL')
     and ('anon' = any (roles) or 'public' = any (roles));
  assert malas is null, format('R5a: anon tiene políticas de lectura sobre reservas: %s', malas);

  select string_agg(format('%s: «%s» (%s, %s)', tablename, policyname, cmd, roles::text), '; ') into malas
    from pg_catalog.pg_policies
   where schemaname = 'public'
     and tablename in ('solicitudes_pendientes', 'notificaciones_dashboard', 'asignaciones_mesa')
     and cmd in ('SELECT', 'ALL')
     and ('anon' = any (roles) or 'public' = any (roles));
  assert malas is null,
    format('R5b: anon tiene políticas de lectura sobre solicitudes, notificaciones o asignaciones_mesa: %s', malas);

  -- -------------------------------------------------------------------------
  -- R6 toda lectura de authenticated exige una sección
  -- -------------------------------------------------------------------------
  select string_agg(format('%s: «%s» (%s, using %s)', tablename, policyname, cmd, coalesce(qual, 'NULL')), '; ')
    into malas
    from pg_catalog.pg_policies
   where schemaname = 'public'
     and tablename in ('reservas', 'solicitudes_pendientes', 'notificaciones_dashboard', 'asignaciones_mesa')
     and cmd in ('SELECT', 'ALL')
     and 'authenticated' = any (roles)
     and (qual is null or qual !~ '_section\(');
  assert malas is null, format('R6a: hay lectura para authenticated sin sección: %s', malas);

  select count(*) into n
    from pg_catalog.pg_policies
   where schemaname = 'public'
     and cmd = 'SELECT'
     and 'authenticated' = any (roles)
     and ((tablename in ('reservas', 'solicitudes_pendientes', 'asignaciones_mesa')
           and qual like '%can_read_section(''reservas''::text)%')
       or (tablename = 'notificaciones_dashboard' and qual like '%can_read_section(''dashboard''::text)%'));
  assert n >= 4,
    format('R6b: se esperaba la lectura por sección en las 4 tablas (reservas ×3, dashboard) y hay %s', n);

  -- -------------------------------------------------------------------------
  -- R7 los DELETE solo llevan la clave en reservas
  -- -------------------------------------------------------------------------
  select string_agg(t2, ', ') into malas
    from unnest(array['solicitudes_pendientes', 'notificaciones_dashboard', 'asignaciones_mesa']) as t2
   where pg_catalog.has_any_column_privilege('anon', to_regclass(format('public.%I', t2)), 'SELECT');
  assert malas is null,
    format('R7: anon tiene privilegio SELECT sobre %s: los DELETE de esa tabla le llegarían con la clave', malas);
end
$$;

rollback;

select 'realtime_reservas_publicacion: todas las comprobaciones han pasado' as resultado,
       (select count(*) from pg_catalog.pg_publication_tables where pubname = 'supabase_realtime') as tablas_publicadas_en_total;
