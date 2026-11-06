set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261106530000_usuarios_seccion_configurable — «Usuarios» como sección de
-- permisos (06/11/2026)
-- ===========================================================================
-- Petición del dueño: «que el módulo de usuarios también sea configurable si se
-- puede ver o no». Hasta hoy la pantalla Usuarios del admin panel (consulta de la
-- lista y de los permisos) la veía quien tenía el ROL admin (is_admin). Pasa a la
-- sección de permisos 'usuarios' («Usuarios» en Usuarios, un solo interruptor:
-- «Puede ver»). Crear, borrar, bloquear y cambiar permisos sigue siendo solo del
-- super admin (sus políticas y funciones no cambian).
--
-- No hay lista ni CHECK de claves de sección: has_section_permission y
-- can_read_section valen para cualquier clave.
--
-- QUÉ CAMBIA
--   * user_roles y user_permissions: la lectura de TODAS las filas pasa de
--     «Admins pueden ver todos los …» (is_admin) a can_read_section('usuarios').
--     Cada usuario sigue leyendo lo suyo y el super admin, todo.
--   * super_admins: con «Ver» en Usuarios se leen las filas (la lista marca
--     quién es super admin). Antes un admin solo veía la suya.
--   * La Edge Function list-users pide has_section_permission(…, 'usuarios',
--     'view') en vez de is_admin: hay que desplegarla junto con esta migración.
--
-- NADIE PIERDE LA PANTALLA (semilla, solo la primera vez): quien hoy tiene el
-- rol admin (y no es super admin, que entra siempre) recibe 'usuarios' con
-- «Ver». Los roles preconfigurados con rol base admin reciben la misma entrada.
-- Si ya hay permisos de esta sección (se aplica otra vez), no se siembra nada.
--
-- AUDITORÍA: user_permissions y user_roles ya llevan trg_auditoria; las filas
-- sembradas quedan en el registro sin actor (como cualquier migración).
--
-- APLICAR (una a una, nunca `db push`): demo primero (sfonaclosuafvlhutkon),
-- producción (haqmmdfdzzatdnrrcgez) solo tras aceptar el PR y con el «sí» del
-- dueño. Idempotente. Tiene que terminar en «usuarios_seccion_configurable: aplicada».
-- Deshacer: supabase/rollbacks/20261106530000_usuarios_seccion_configurable_ROLLBACK.sql
-- ===========================================================================

begin;
set local lock_timeout = '5s';

-- ─── 0. Comprobaciones previas (no cambian nada) ────────────────────────────
do $$
declare
  v_faltan text[] := '{}';
  v_t text;
  v_f text;
begin
  foreach v_t in array array['public.user_permissions', 'public.user_roles', 'public.super_admins'] loop
    if to_regclass(v_t) is null then
      v_faltan := v_faltan || v_t;
    end if;
  end loop;
  foreach v_f in array array['public.can_read_section(text)', 'public.is_super_admin(uuid)'] loop
    if to_regprocedure(v_f) is null then
      v_faltan := v_faltan || v_f;
    end if;
  end loop;
  if cardinality(v_faltan) > 0 then
    raise exception 'usuarios_seccion_configurable: falta %. No se ha cambiado nada.', array_to_string(v_faltan, ', ');
  end if;
end;
$$;

-- ─── 1. Semilla: quien hoy ve Usuarios (rol admin) la conserva ──────────────
do $$
declare
  v_n integer := 0;
begin
  if exists (select 1 from public.user_permissions where section_key = 'usuarios') then
    raise notice 'usuarios_seccion_configurable: la sección ya tiene permisos; no se siembra otra vez';
    return;
  end if;

  insert into public.user_permissions (user_id, section_key, can_view, can_edit)
  select distinct r.user_id, 'usuarios', true, false
    from public.user_roles r
   where r.role::text = 'admin'
     and not public.is_super_admin(r.user_id)
  on conflict (user_id, section_key) do nothing;
  get diagnostics v_n = row_count;
  raise notice 'usuarios_seccion_configurable: % admin(s) conservan la pantalla Usuarios', v_n;

  if to_regclass('public.user_role_presets') is not null then
    update public.user_role_presets
       set permissions = permissions || jsonb_build_array(jsonb_build_object(
             'section_key', 'usuarios', 'can_view', true, 'can_edit', false))
     where base_role::text = 'admin'
       and jsonb_typeof(permissions) = 'array'
       and not exists (select 1 from jsonb_array_elements(permissions) e
                        where e ->> 'section_key' = 'usuarios');
    get diagnostics v_n = row_count;
    raise notice 'usuarios_seccion_configurable: % rol(es) preconfigurado(s) con la sección', v_n;
  end if;
end;
$$;

-- ─── 2. Lectura de roles, permisos y super admins ───────────────────────────
drop policy if exists "Admins pueden ver todos los roles" on public.user_roles;
drop policy if exists user_roles_select_seccion_usuarios on public.user_roles;
create policy user_roles_select_seccion_usuarios
  on public.user_roles for select to authenticated
  using ((select public.can_read_section('usuarios')));

drop policy if exists "Admins pueden ver todos los permisos" on public.user_permissions;
drop policy if exists user_permissions_select_seccion_usuarios on public.user_permissions;
create policy user_permissions_select_seccion_usuarios
  on public.user_permissions for select to authenticated
  using ((select public.can_read_section('usuarios')));

drop policy if exists super_admins_select_seccion_usuarios on public.super_admins;
create policy super_admins_select_seccion_usuarios
  on public.super_admins for select to authenticated
  using ((select public.can_read_section('usuarios')));

-- ─── 3. Comprobación final ──────────────────────────────────────────────────
do $$
declare
  v_n integer;
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('user_roles', 'user_permissions')
              and policyname in ('Admins pueden ver todos los roles', 'Admins pueden ver todos los permisos')) then
    raise exception 'usuarios_seccion_configurable: siguen las políticas por rol admin. No se ha aplicado nada.';
  end if;
  select count(*) into v_n from pg_policies
   where schemaname = 'public'
     and policyname in ('user_roles_select_seccion_usuarios', 'user_permissions_select_seccion_usuarios', 'super_admins_select_seccion_usuarios');
  if v_n <> 3 then
    raise exception 'usuarios_seccion_configurable: faltan políticas nuevas (%/3). No se ha aplicado nada.', v_n;
  end if;
  raise notice 'usuarios_seccion_configurable: aplicada';
end;
$$;

commit;
