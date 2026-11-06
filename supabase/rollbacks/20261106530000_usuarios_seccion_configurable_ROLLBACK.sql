set client_encoding = 'UTF8';
-- Deshace 20261106530000_usuarios_seccion_configurable: la lectura de todos los
-- roles y permisos vuelve al rol admin (is_admin) y se quita la de super_admins
-- por la sección. Los permisos 'usuarios' sembrados se dejan (no hacen nada sin
-- las políticas); bórralos a mano si hace falta:
--   delete from public.user_permissions where section_key = 'usuarios';
-- Hay que volver a desplegar la versión anterior de list-users (is_admin).
begin;
set local lock_timeout = '5s';

drop policy if exists user_roles_select_seccion_usuarios on public.user_roles;
drop policy if exists "Admins pueden ver todos los roles" on public.user_roles;
create policy "Admins pueden ver todos los roles"
  on public.user_roles for select to authenticated
  using (public.is_admin(auth.uid()));

drop policy if exists user_permissions_select_seccion_usuarios on public.user_permissions;
drop policy if exists "Admins pueden ver todos los permisos" on public.user_permissions;
create policy "Admins pueden ver todos los permisos"
  on public.user_permissions for select to authenticated
  using (public.is_admin(auth.uid()));

drop policy if exists super_admins_select_seccion_usuarios on public.super_admins;

commit;
