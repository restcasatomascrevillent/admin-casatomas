-- ROLLBACK de migrations/20261030152000_superadmin_minimo_uno.sql (CT-REM-FN-13).
-- A mano. Efecto: VUELVE la carrera que puede dejar 0 superadmins.
begin;
drop trigger if exists trg_super_admins_al_menos_uno on public.super_admins;
drop trigger if exists trg_super_admins_sin_truncate on public.super_admins;
drop function if exists public.super_admins_exigir_al_menos_uno();
create or replace function public.establecer_superadmin_panel(
  p_user_id uuid,
  p_make_super_admin boolean,
  p_email text
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  bloqueado boolean;
begin
  if p_user_id is null or p_make_super_admin is null or p_email is null or p_email = '' then
    raise exception 'Datos de usuario no válidos' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 0));
  if p_make_super_admin then
    select s.access_blocked into bloqueado from public.user_access_status s
    where s.user_id = p_user_id for update;
    if coalesce(bloqueado, false) then
      raise exception 'Desbloquea el acceso antes de conceder superadmin' using errcode = '22023';
    end if;
    insert into public.user_roles (user_id, role) values (p_user_id, 'admin')
    on conflict (user_id) do update set role = excluded.role;
    insert into public.super_admins (user_id, email) values (p_user_id, p_email)
    on conflict (email) do update set user_id = excluded.user_id;
  else
    delete from public.super_admins where user_id = p_user_id;
  end if;
end;
$$;
revoke all on function public.establecer_superadmin_panel(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.establecer_superadmin_panel(uuid, boolean, text) to service_role;
commit;
