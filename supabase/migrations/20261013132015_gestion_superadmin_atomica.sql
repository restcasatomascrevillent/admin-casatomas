-- La Edge Function verifica la sesión y el superadmin antes de llamar con
-- service_role. Ambas tablas y sus eventos de auditoría cambian juntas.
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
  -- La identidad y el correo proceden de Auth Admin, verificados por la Edge
  -- Function. No se amplían los permisos de service_role sobre auth.users.
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
