-- ===========================================================================
--  CT-REM-FN-13 · Nunca puede quedar el sistema con cero superadmins.
--
--  Sin aplicar: la aplica el dueño (demo primero). No requiere redesplegar
--  ninguna función (admin-set-super-admin sigue llamando a la misma RPC con
--  la misma firma).
--
--  Causa: establecer_superadmin_panel (20261013132015) bloqueaba con un
--  advisory lock por USUARIO OBJETIVO y no comprobaba si quedaban otros. Si A
--  quita a B y B quita a A a la vez, cada transacción ve al otro todavía y
--  ambas confirman: 0 superadmins.
--
--  Arreglo, en la tabla (cubre la RPC, un DELETE directo con service_role y
--  el borrado en cascada desde auth.users):
--   1. Trigger de SENTENCIA tras DELETE o UPDATE OF user_id en
--      public.super_admins: toma un advisory lock de transacción GLOBAL
--      ('public.super_admins') y, ya con el lock, cuenta las filas con
--      user_id no nulo. Si quedan 0 -> error 23514 y se deshace todo.
--      Por qué funciona con dos transacciones concurrentes: la segunda espera
--      al lock hasta que la primera confirma; en READ COMMITTED su recuento
--      (sentencia nueva => instantánea nueva) ya ve el borrado confirmado de
--      la primera más el suyo, cuenta 0 y aborta.
--   2. BEFORE TRUNCATE: prohibido vaciar la tabla.
--   3. establecer_superadmin_panel toma el MISMO lock global al empezar (en
--      vez del lock por usuario), para que conceder/quitar se serialicen
--      también entre sí.
--
--  Si hoy la tabla ya tiene 0 filas, nada cambia hasta el primer DELETE.
--  Idempotente.
-- ===========================================================================

begin;

create or replace function public.super_admins_exigir_al_menos_uno()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n bigint;
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'No se puede vaciar super_admins: debe quedar al menos un superadmin'
      using errcode = '23514';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('public.super_admins', 0));
  select count(*) into v_n from public.super_admins where user_id is not null;
  if v_n = 0 then
    raise exception 'Debe quedar al menos un superadmin'
      using errcode = '23514',
            hint = 'Concede superadmin a otra cuenta antes de quitar el último.';
  end if;
  return null;
end;
$$;

revoke all on function public.super_admins_exigir_al_menos_uno() from public, anon, authenticated;

drop trigger if exists trg_super_admins_al_menos_uno on public.super_admins;
create trigger trg_super_admins_al_menos_uno
  after delete or update of user_id on public.super_admins
  for each statement execute function public.super_admins_exigir_al_menos_uno();

drop trigger if exists trg_super_admins_sin_truncate on public.super_admins;
create trigger trg_super_admins_sin_truncate
  before truncate on public.super_admins
  for each statement execute function public.super_admins_exigir_al_menos_uno();

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
  -- Lock GLOBAL (el mismo que el trigger trg_super_admins_al_menos_uno):
  -- todas las altas y bajas de superadmin se serializan.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('public.super_admins', 0));
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
    -- Si es el último, el trigger lanza 23514 y no cambia nada.
    delete from public.super_admins where user_id = p_user_id;
  end if;
end;
$$;

revoke all on function public.establecer_superadmin_panel(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.establecer_superadmin_panel(uuid, boolean, text) to service_role;

commit;
