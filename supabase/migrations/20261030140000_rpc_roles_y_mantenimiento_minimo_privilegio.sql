set client_encoding = 'UTF8';
-- ===========================================================================
-- CT-REM-DB-05 · Oráculo de roles para anon y RPC de mantenimiento abiertas
-- (remediación 2026-10-30, tarea T4a-DB-AUTHZ, perfil rem-05)
-- ===========================================================================
--
-- PROBLEMA (lab, salida t4a-antes.*):
--   * T2d: anon ejecuta is_super_admin(uuid)/is_admin(uuid) -> sabe si un UUID
--     es superadmin/admin (EXECUTE concedido a PUBLIC y anon).
--   * append_tool_call_log(text,jsonb), cleanup_old_security_logs() y
--     recalcular_ocupacion_historica(date,date): SECURITY DEFINER, mutan
--     call_logs / security_log+rate_limit_log / ocupacion_diaria y cualquier
--     autenticado puede ejecutarlas sin control de rol.
--
-- CONSUMIDORES (grep 30/10): append_tool_call_log solo lo llaman
-- restaurante-phone/api/vapi-webhook.js y el-webhook.js con
-- SUPABASE_SERVICE_ROLE_KEY. Las otras dos no tienen consumidor (ni cron en
-- Git). Ningún cliente (panel, web, Touza) llama a ninguna de las cinco por
-- RPC; las políticas que usan is_admin/is_super_admin son de authenticated.
--
-- CAMBIO:
--   1. user_permissions: sus 3 políticas de escritura de superadmin eran TO
--      public; pasan a TO authenticated (mismo USING/CHECK). Las de
--      gdpr_*/configuracion_*/ocupacion_diaria ya las retocaron
--      20261030100000 y 20261030130000.
--   2. GUARDA: aborta si alguna política aplicable a anon (TO public/anon) o
--      alguna vista usa is_admin/is_super_admin, porque al revocar anon esas
--      consultas pasarían de 0 filas a error. Las funciones INVOKER que anon
--      podría ejecutar y las usan se listan con NOTICE (hoy:
--      oficiososia_facturacion_leer(), que ya lanza 'Acceso exclusivo de
--      superadmin' a anon: seguirá negándose, con otro mensaje).
--   3. revoke EXECUTE de is_admin(uuid)/is_super_admin(uuid) a public y anon
--      (authenticated y service_role lo conservan).
--   4. Las 3 RPC de mantenimiento: solo service_role.
--
-- Bloqueos: ACCESS EXCLUSIVE breve sobre user_permissions (ALTER POLICY); el
-- resto son GRANT/REVOKE de funciones. lock_timeout 5 s. Rollback:
-- supabase/rollbacks/20261030140000_rpc_roles_y_mantenimiento_minimo_privilegio_ROLLBACK.sql.
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

-- 1. user_permissions: escritura de superadmin solo TO authenticated
select pg_temp.t4a_politicas($spec$[
  {"tabla": "user_permissions",
   "conservar": ["Admins pueden ver todos los permisos", "Super admins pueden consultar permisos",
                 "Usuarios pueden ver sus propios permisos"],
   "a_authenticated": ["Super admins pueden actualizar permisos", "Super admins pueden crear permisos",
                       "Super admins pueden eliminar permisos"]}
]$spec$::jsonb, 'DB-05');

-- 2. Guarda: nada que evalúe anon puede llamar a is_admin/is_super_admin
do $guarda$
declare
  v_pol text;
  v_vis text;
  v_fn text;
begin
  if to_regprocedure('public.is_admin(uuid)') is null or to_regprocedure('public.is_super_admin(uuid)') is null then
    raise exception 'MIGRACIÓN ABORTADA (DB-05): no existen public.is_admin(uuid) / public.is_super_admin(uuid). No se ha tocado nada.';
  end if;

  select string_agg(format('%s.%s «%s» %s', schemaname, tablename, policyname, roles::text), '; ')
    into v_pol
    from pg_policies
   where roles && array['public', 'anon']::name[]
     and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ '\m(is_admin|is_super_admin)\s*\(';
  if v_pol is not null then
    raise exception 'MIGRACIÓN ABORTADA (DB-05): estas políticas las evalúa anon y usan is_admin/is_super_admin; al revocar EXECUTE a anon fallarían: %. Pasarlas a TO authenticated antes. No se ha tocado nada.', v_pol;
  end if;

  select string_agg(c.oid::regclass::text, ', ')
    into v_vis
    from pg_class c
   where c.relkind in ('v', 'm')
     and c.relnamespace not in ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
     and pg_get_viewdef(c.oid) ~ '\m(is_admin|is_super_admin)\s*\(';
  if v_vis is not null then
    raise exception 'MIGRACIÓN ABORTADA (DB-05): vistas que usan is_admin/is_super_admin: %. Revisar si anon las lee. No se ha tocado nada.', v_vis;
  end if;

  select string_agg(p.oid::regprocedure::text, ', ')
    into v_fn
    from pg_proc p
   where p.pronamespace in (select n.oid from pg_namespace n where n.nspname in ('public', 'storage'))
     and not p.prosecdef
     and p.proname not in ('is_admin', 'is_super_admin')
     and p.prosrc ~ '\m(is_admin|is_super_admin)\s*\('
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if v_fn is not null then
    raise notice 'DB-05 · funciones INVOKER ejecutables por anon que llaman a is_admin/is_super_admin (anon recibirá permission denied en vez de su propio error): %', v_fn;
  end if;
end
$guarda$;

-- 3. Sin oráculo de roles para anon
revoke all on function public.is_admin(uuid) from public, anon;
revoke all on function public.is_super_admin(uuid) from public, anon;
grant execute on function public.is_admin(uuid) to authenticated, service_role;
grant execute on function public.is_super_admin(uuid) to authenticated, service_role;

-- 4. RPC de mantenimiento: solo el servidor
do $mantenimiento$
declare
  v_fn text;
begin
  foreach v_fn in array array['public.append_tool_call_log(text,jsonb)',
                              'public.cleanup_old_security_logs()',
                              'public.recalcular_ocupacion_historica(date,date)']
  loop
    if to_regprocedure(v_fn) is null then
      raise notice 'DB-05 · % no existe: se omite', v_fn;
      continue;
    end if;
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);
  end loop;
end
$mantenimiento$;

-- Comprobación final
do $final$
declare
  v_fn text;
begin
  foreach v_fn in array array['public.is_admin(uuid)', 'public.is_super_admin(uuid)'] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE')
       or not has_function_privilege('authenticated', v_fn, 'EXECUTE')
       or not has_function_privilege('service_role', v_fn, 'EXECUTE') then
      raise exception 'MIGRACIÓN ABORTADA al final (DB-05): EXECUTE inesperado en %. No se ha aplicado nada.', v_fn;
    end if;
  end loop;
  foreach v_fn in array array['public.append_tool_call_log(text,jsonb)',
                              'public.cleanup_old_security_logs()',
                              'public.recalcular_ocupacion_historica(date,date)'] loop
    continue when to_regprocedure(v_fn) is null;
    if has_function_privilege('anon', v_fn, 'EXECUTE')
       or has_function_privilege('authenticated', v_fn, 'EXECUTE')
       or not has_function_privilege('service_role', v_fn, 'EXECUTE') then
      raise exception 'MIGRACIÓN ABORTADA al final (DB-05): EXECUTE inesperado en %. No se ha aplicado nada.', v_fn;
    end if;
  end loop;
end
$final$;

drop function pg_temp.t4a_politicas(jsonb, text);
commit;
