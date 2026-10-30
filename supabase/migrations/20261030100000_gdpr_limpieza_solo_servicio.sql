set client_encoding = 'UTF8';
-- ===========================================================================
-- CT-REM-DB-01 · La limpieza RGPD deja de estar al alcance de cualquier cuenta
-- (remediación 2026-10-30, tarea T4a-DB-AUTHZ, perfil rem-05)
-- ===========================================================================
--
-- PROBLEMA (confirmado en el laboratorio PGlite reconstruido desde Git a0b8d3a,
-- remediacion-2026-10-30/evidencias/lab-bd, salida t4a-antes.*):
--   * public.ejecutar_limpieza_gdpr() es SECURITY DEFINER, no comprueba rol y
--     está concedida a `authenticated` (20260918084909:231-232). Anonimiza
--     reservas/reseñas y borra blacklist según public.gdpr_config.
--   * gdpr_config y gdpr_audit_log tienen "Auth can manage …" FOR ALL TO
--     authenticated USING (true) (20260208164243:47,50): cualquier cuenta pone
--     dias_retencion = 0, ejecuta la limpieza (52 reservas anonimizadas en el
--     lab) y borra el rastro de gdpr_audit_log.
--
-- CAMBIO:
--   1. ejecutar_limpieza_gdpr(): EXECUTE solo para service_role (el panel no la
--      llama: solo aparece en types.ts; no hay cron.schedule que la use).
--   2. gdpr_config: lectura/escritura solo superadmin (se borran "Auth can
--      manage gdpr_config" y "Admins can manage gdpr_config", esta última
--      TO public con is_admin()).
--   3. gdpr_audit_log: solo lectura superadmin; sin INSERT/UPDATE/DELETE
--      cliente (la función, SECURITY DEFINER, sigue escribiendo como owner).
--   4. Sin privilegios para anon en ambas tablas; sin TRUNCATE para
--      authenticated (TRUNCATE no pasa por RLS).
--
-- NO INCLUIDO (decisión del dueño): CHECK de días mínimos de retención
--   (p. ej. `check (dias_retencion >= 365)`). Ver T4a-db-resultado.md.
--
-- HUELLA: el motor de abajo ABORTA si falta alguna de las políticas que se
-- esperan borrar (el estado no es el de Git) o si al final queda en la tabla
-- alguna política que esta migración no conoce (una permisiva desconocida
-- reabriría el agujero por OR). Idempotente: si las políticas nuevas ya
-- existen, no exige las viejas y vuelve a dejar el mismo estado.
--
-- Bloqueos: ACCESS EXCLUSIVE breve sobre gdpr_config y gdpr_audit_log (tablas
-- de pocas filas, sin uso del panel). lock_timeout 5 s: si no lo consigue,
-- falla sin tocar nada y se reintenta. Rollback: supabase/rollbacks/
-- 20261030100000_gdpr_limpieza_solo_servicio_ROLLBACK.sql.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- Motor de políticas (idéntico en las migraciones 20261030100000…140000).
-- Vive en pg_temp: desaparece al cerrar la sesión y no deja nada en el esquema.
-- spec: [{tabla, opcional?, rls?, restrictiva?, borrar[], conservar[],
--         a_authenticated[], crear[{n, cmd, to, using?, check?}], revocar{rol: privs}}]
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Guarda de la función
-- ---------------------------------------------------------------------------
do $guarda$
begin
  if to_regprocedure('public.ejecutar_limpieza_gdpr()') is null then
    raise exception 'MIGRACIÓN ABORTADA (DB-01): no existe public.ejecutar_limpieza_gdpr(). No se ha tocado nada.';
  end if;
  if to_regprocedure('public.is_super_admin(uuid)') is null then
    raise exception 'MIGRACIÓN ABORTADA (DB-01): no existe public.is_super_admin(uuid). No se ha tocado nada.';
  end if;
end
$guarda$;

-- 1. La RPC destructiva, solo para el servidor
revoke all on function public.ejecutar_limpieza_gdpr() from public, anon, authenticated;
grant execute on function public.ejecutar_limpieza_gdpr() to service_role;

-- 2 y 3. Políticas
select pg_temp.t4a_politicas($spec$[
  {"tabla": "gdpr_config",
   "borrar": ["Auth can manage gdpr_config", "Admins can manage gdpr_config"],
   "crear": [
     {"n": "gdpr_config_superadmin", "cmd": "all", "to": "authenticated",
      "using": "(select public.is_super_admin((select auth.uid())))",
      "check": "(select public.is_super_admin((select auth.uid())))"}],
   "revocar": {"anon": "all", "authenticated": "truncate"}},
  {"tabla": "gdpr_audit_log",
   "borrar": ["Auth can manage gdpr_audit_log", "Admins can view gdpr_audit_log"],
   "crear": [
     {"n": "gdpr_audit_log_select_superadmin", "cmd": "select", "to": "authenticated",
      "using": "(select public.is_super_admin((select auth.uid())))"}],
   "revocar": {"anon": "all", "authenticated": "insert, update, delete, truncate"}}
]$spec$::jsonb, 'DB-01');

-- Comprobación final de privilegios de la función
do $final$
declare v_fn constant regprocedure := 'public.ejecutar_limpieza_gdpr()'::regprocedure;
begin
  if has_function_privilege('anon', v_fn, 'EXECUTE')
     or has_function_privilege('authenticated', v_fn, 'EXECUTE')
     or not has_function_privilege('service_role', v_fn, 'EXECUTE') then
    raise exception 'MIGRACIÓN ABORTADA al final (DB-01): EXECUTE de ejecutar_limpieza_gdpr() inesperado (solo service_role). No se ha aplicado nada.';
  end if;
  if has_table_privilege('authenticated', 'public.gdpr_audit_log', 'DELETE')
     or has_table_privilege('anon', 'public.gdpr_config', 'SELECT') then
    raise exception 'MIGRACIÓN ABORTADA al final (DB-01): GRANT de gdpr_* inesperados. No se ha aplicado nada.';
  end if;
end
$final$;

drop function pg_temp.t4a_politicas(jsonb, text);
commit;
