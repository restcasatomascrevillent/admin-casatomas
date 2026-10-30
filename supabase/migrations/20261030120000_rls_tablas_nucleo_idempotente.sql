set client_encoding = 'UTF8';
-- ===========================================================================
-- CT-REM-DB-04 (parte 1) · RLS de las tablas núcleo declarada en Git
-- (remediación 2026-10-30, tarea T4a-DB-AUTHZ, perfil rem-05)
-- ===========================================================================
--
-- PROBLEMA: `reservas`, la carta y otras ~20 tablas nacieron en Lovable/
-- Dashboard; ninguna migración las crea ni activa su RLS. Reconstruir un
-- entorno desde Git (rama de Supabase, demo nueva, db reset) deja `reservas`
-- legible por anon (50 filas con teléfono en prueba-db04.sql: GRANT SELECT de
-- los default privileges). `salas` y `bew` quedan SIN RLS incluso con el
-- baseline del laboratorio, con políticas que no aplican.
--
-- CAMBIO (idempotente; en producción, donde la RLS ya está activa, es casi
-- todo no-op):
--   1. ENABLE ROW LEVEL SECURITY en las tablas núcleo que existan y la tengan
--      apagada (no se toca la tabla si ya está activa: sin lock innecesario).
--   2. salas y bew: al activar su RLS se crean las políticas de sección para
--      que el panel no pierda acceso:
--        salas: lectura can_read_section('reservas'), escritura
--               can_write_section('reservas') (la lectura pública de salas
--               activas, si existe, se conserva).
--        bew:   solo superadmin (ningún consumidor en el código).
--      y la restrictiva acceso_panel_no_bloqueado (patrón 20261013082609).
--      Las permisivas viejas (auth.uid() IS NOT NULL / true) las retira
--      20261030130000 (DB-02).
--   3. revoke SELECT de `reservas` a anon: la web reserva por la Edge Function
--      reservas-web con service role; ni web-casatomas/src ni Touza leen
--      `reservas` (grep 30/10). Hoy anon ya ve 0 filas por RLS: pasa de 0 filas
--      a 401/permission denied. También sin escritura anon en salas/bew.
--
-- FUERA DE ESTA MIGRACIÓN (BLOQUEADO para el dueño): baseline real con
-- `supabase db dump --schema public` contra demo y buckets platos/novedades/
-- salas en Git (DB-04 partes 2 y 3).
--
-- Bloqueos: ACCESS EXCLUSIVE solo en las tablas cuya RLS esté apagada (en
-- prod se espera: salas y bew, legadas y sin uso) y al crear políticas en
-- salas/bew. lock_timeout 5 s. Rollback: supabase/rollbacks/
-- 20261030120000_rls_tablas_nucleo_idempotente_ROLLBACK.sql.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- Motor de políticas (idéntico en las migraciones 20261030100000…140000).
-- Vive en pg_temp: desaparece al cerrar la sesión y no deja nada en el esquema.
-- spec: [{tabla, opcional?, rls?, restrictiva?, borrar[], conservar[],
--         a_authenticated[], crear[{n, cmd, to, using?, check?}], revocar{rol: privs}}]
create or replace function pg_temp.t4a_politicas(p_spec jsonb, p_etiqueta text)
returns void language plpgsql as $motor$
declare
  e jsonb; c jsonb; v_t text; v_rel regclass; v_crear text[]; v_borrar text[]; v_ya boolean;
  v_n text; v_sql text; v_faltan text[] := '{}'; v_sobran text[]; v_permitidas text[];
  v_rol text; v_priv text; v_malos text[] := '{}';
begin
  -- 1) huella previa
  for e in select x from jsonb_array_elements(p_spec) as x loop
    v_t := e->>'tabla';
    v_rel := to_regclass(format('public.%I', v_t));
    if v_rel is null then
      if coalesce((e->>'opcional')::boolean, false) then
        raise notice '% · public.% no existe: se omite', p_etiqueta, v_t; continue;
      end if;
      raise exception 'MIGRACIÓN ABORTADA (%): no existe public.%. No se ha tocado nada.', p_etiqueta, v_t;
    end if;
    select coalesce(array_agg(x->>'n'), '{}') into v_crear from jsonb_array_elements(coalesce(e->'crear', '[]')) x;
    select coalesce(array_agg(x), '{}') into v_borrar from jsonb_array_elements_text(coalesce(e->'borrar', '[]')) x;
    if cardinality(v_crear) > 0 then
      v_ya := not exists (select 1 from unnest(v_crear) n
                           where not exists (select 1 from pg_policy p where p.polrelid = v_rel and p.polname = n));
    else
      v_ya := not exists (select 1 from unnest(v_borrar) n
                           where exists (select 1 from pg_policy p where p.polrelid = v_rel and p.polname = n));
    end if;
    if not v_ya then
      foreach v_n in array v_borrar loop
        if not exists (select 1 from pg_policy p where p.polrelid = v_rel and p.polname = v_n) then
          v_faltan := v_faltan || format('%s: «%s»', v_t, v_n);
        end if;
      end loop;
    end if;
  end loop;
  if cardinality(v_faltan) > 0 then
    raise exception 'MIGRACIÓN ABORTADA (%): faltan políticas que se esperaba encontrar (el estado no es el de Git a0b8d3a; revisar a mano). No se ha tocado nada. Faltan: %',
      p_etiqueta, array_to_string(v_faltan, '; ');
  end if;

  -- 2) aplicar
  for e in select x from jsonb_array_elements(p_spec) as x loop
    v_t := e->>'tabla';
    v_rel := to_regclass(format('public.%I', v_t));
    continue when v_rel is null;
    if coalesce((e->>'rls')::boolean, false) then
      execute format('alter table public.%I enable row level security', v_t);
    end if;
    for v_n in select jsonb_array_elements_text(coalesce(e->'borrar', '[]')) loop
      execute format('drop policy if exists %I on public.%I', v_n, v_t);
    end loop;
    for c in select x from jsonb_array_elements(coalesce(e->'crear', '[]')) as x loop
      execute format('drop policy if exists %I on public.%I', c->>'n', v_t);
      v_sql := format('create policy %I on public.%I as permissive for %s to %s', c->>'n', v_t, c->>'cmd', c->>'to');
      if c ? 'using' then v_sql := v_sql || format(' using (%s)', c->>'using'); end if;
      if c ? 'check' then v_sql := v_sql || format(' with check (%s)', c->>'check'); end if;
      execute v_sql;
    end loop;
    for v_n in select jsonb_array_elements_text(coalesce(e->'a_authenticated', '[]')) loop
      if exists (select 1 from pg_policy p where p.polrelid = v_rel and p.polname = v_n) then
        execute format('alter policy %I on public.%I to authenticated', v_n, v_t);
      end if;
    end loop;
    for v_rol, v_priv in select key, value from jsonb_each_text(coalesce(e->'revocar', '{}')) loop
      execute format('revoke %s on public.%I from %I', v_priv, v_t, v_rol);
    end loop;
    if coalesce((e->>'restrictiva')::boolean, false)
       and to_regprocedure('private.sesion_panel_permitida()') is not null
       and not exists (select 1 from pg_policy p where p.polrelid = v_rel and p.polname = 'acceso_panel_no_bloqueado') then
      execute format('create policy acceso_panel_no_bloqueado on public.%I as restrictive for all to authenticated using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()))', v_t);
    end if;
  end loop;

  -- 3) huella final: en cada tabla solo quedan las políticas conocidas
  for e in select x from jsonb_array_elements(p_spec) as x loop
    v_t := e->>'tabla';
    v_rel := to_regclass(format('public.%I', v_t));
    continue when v_rel is null;
    select coalesce(array_agg(x), '{}') into v_permitidas from (
      select jsonb_array_elements_text(coalesce(e->'conservar', '[]')) x
      union all select jsonb_array_elements_text(coalesce(e->'a_authenticated', '[]'))
      union all select y->>'n' from jsonb_array_elements(coalesce(e->'crear', '[]')) y
      union all select 'acceso_panel_no_bloqueado') s;
    select array_agg(p.polname order by p.polname) into v_sobran
      from pg_policy p where p.polrelid = v_rel and p.polname <> all (v_permitidas);
    if v_sobran is not null then
      v_malos := v_malos || format('%s: %s', v_t, array_to_string(v_sobran, ', '));
    end if;
    if exists (select 1 from pg_policy p
                where p.polrelid = v_rel
                  and p.polname in (select jsonb_array_elements_text(coalesce(e->'a_authenticated', '[]')))
                  and p.polroles <> array['authenticated'::regrole::oid]) then
      v_malos := v_malos || format('%s: política sin pasar a TO authenticated', v_t);
    end if;
    if coalesce((e->>'rls')::boolean, false)
       and not (select relrowsecurity from pg_class where oid = v_rel) then
      v_malos := v_malos || format('%s: RLS apagada', v_t);
    end if;
  end loop;
  if cardinality(v_malos) > 0 then
    raise exception 'MIGRACIÓN ABORTADA al final (%): quedan políticas que esta migración no conoce (una permisiva desconocida reabre el acceso por OR). No se ha aplicado nada. Detalle: %',
      p_etiqueta, array_to_string(v_malos, '; ');
  end if;
end
$motor$;

-- 1. RLS de las tablas núcleo
do $nucleo$
declare
  v_t text;
  v_rel regclass;
  v_activadas text[] := '{}';
  v_sin_politicas text[] := '{}';
begin
  foreach v_t in array array[
    'reservas', 'salas', 'bew', 'Platos', 'Vinos', 'Bebidas', 'Cocteles', 'tapas', 'menus_diarios',
    'consultas_chatbot', 'conversaciones', 'mensajes_chat', 'n8n_chat_histories', 'documentos',
    'items_documento', 'rate_limit_log', 'security_log', 'usage_events', 'scope_prices',
    'posiciones_sala', 'clientes', 'asignaciones_turno']
  loop
    v_rel := to_regclass(format('public.%I', v_t));
    continue when v_rel is null;
    if not (select relrowsecurity from pg_class where oid = v_rel) then
      execute format('alter table public.%I enable row level security', v_t);
      v_activadas := v_activadas || v_t;
      if v_t not in ('salas', 'bew')
         and not exists (select 1 from pg_policy p where p.polrelid = v_rel and p.polpermissive) then
        v_sin_politicas := v_sin_politicas || v_t;
      end if;
    end if;
  end loop;
  raise notice 'DB-04 · RLS activada ahora en: %', coalesce(nullif(array_to_string(v_activadas, ', '), ''), '(ninguna: ya estaban)');
  if cardinality(v_sin_politicas) > 0 then
    raise notice 'DB-04 · AVISO: sin políticas permisivas (solo service_role las verá): %', array_to_string(v_sin_politicas, ', ');
  end if;
end
$nucleo$;

-- 2. salas y bew: políticas de sección para no dejar al panel sin acceso
select pg_temp.t4a_politicas($spec$[
  {"tabla": "salas", "opcional": true, "rls": true, "restrictiva": true,
   "conservar": ["Público puede ver salas activas",
                 "Solo usuarios autenticados pueden actualizar salas",
                 "Solo usuarios autenticados pueden crear salas",
                 "Solo usuarios autenticados pueden eliminar salas"],
   "crear": [
     {"n": "salas_select_seccion", "cmd": "select", "to": "authenticated",
      "using": "(select public.can_read_section('reservas'))"},
     {"n": "salas_insert_seccion", "cmd": "insert", "to": "authenticated",
      "check": "(select public.can_write_section('reservas'))"},
     {"n": "salas_update_seccion", "cmd": "update", "to": "authenticated",
      "using": "(select public.can_write_section('reservas'))",
      "check": "(select public.can_write_section('reservas'))"},
     {"n": "salas_delete_seccion", "cmd": "delete", "to": "authenticated",
      "using": "(select public.can_write_section('reservas'))"},
     {"n": "salas_service_role", "cmd": "all", "to": "service_role", "using": "true", "check": "true"}],
   "revocar": {"anon": "insert, update, delete, truncate", "authenticated": "truncate"}},
  {"tabla": "bew", "opcional": true, "rls": true, "restrictiva": true,
   "conservar": ["Authenticated users can delete bew", "Authenticated users can insert bew",
                 "Authenticated users can read bew", "Authenticated users can update bew"],
   "crear": [
     {"n": "bew_superadmin", "cmd": "all", "to": "authenticated",
      "using": "(select public.is_super_admin((select auth.uid())))",
      "check": "(select public.is_super_admin((select auth.uid())))"},
     {"n": "bew_service_role", "cmd": "all", "to": "service_role", "using": "true", "check": "true"}],
   "revocar": {"anon": "all", "authenticated": "truncate"}}
]$spec$::jsonb, 'DB-04');

-- 3. reservas: sin SELECT para anon
do $reservas$
begin
  if to_regclass('public.reservas') is not null then
    revoke select on public.reservas from anon;
    if has_table_privilege('anon', 'public.reservas', 'SELECT') then
      raise exception 'MIGRACIÓN ABORTADA al final (DB-04): anon sigue con SELECT sobre reservas (¿concedido a PUBLIC?). No se ha aplicado nada.';
    end if;
    if not (select relrowsecurity from pg_class where oid = 'public.reservas'::regclass) then
      raise exception 'MIGRACIÓN ABORTADA al final (DB-04): la RLS de reservas no ha quedado activa. No se ha aplicado nada.';
    end if;
  end if;
end
$reservas$;

drop function pg_temp.t4a_politicas(jsonb, text);
commit;
