set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261124130000_usuarios_pestana_inicial — «Pestaña por defecto» de cada
-- usuario (11/11/2026)
-- ===========================================================================
-- En Usuarios › Permisos el super admin elige qué pestaña del menú (ruta:
-- /reservas, /facturas…) se le abre a ese usuario al iniciar sesión. El panel
-- solo ofrece las pestañas que ese usuario puede ver y, al entrar, la vuelve a
-- comprobar: si ya no puede verla (o no hay elección), entra como siempre.
--
--   * user_pestana_inicial — una fila por usuario (sin fila = como siempre).
--
-- Permisos: el MISMO camino que user_permissions (escritura directa desde el
-- panel con RLS, sin Edge Function ni RPC):
--   · leer: el propio usuario (para abrirla al entrar), un super admin y quien
--     puede ver la sección «usuarios» (can_read_section, como user_permissions);
--   · crear, cambiar y borrar: solo un super admin (is_super_admin);
--   · más la restrictiva de sesión de panel no bloqueada y la auditoría.
-- La ruta solo se valida por forma (/xxx): qué pestañas hay lo sabe el menú del
-- panel y una ruta desconocida simplemente se ignora al entrar.
--
-- Necesita: is_super_admin(uuid), can_read_section(text). Opcionales:
-- sesion_panel_permitida, fn_registrar_auditoria. Idempotente.
-- Rollback: supabase/rollbacks/20261124130000_usuarios_pestana_inicial_ROLLBACK.sql
-- Test:     supabase/tests/usuarios_pestana_inicial_test.sql
-- ===========================================================================

begin;

do $$
begin
  if to_regprocedure('public.is_super_admin(uuid)') is null or to_regprocedure('public.can_read_section(text)') is null then
    raise exception 'usuarios_pestana_inicial: faltan is_super_admin / can_read_section.';
  end if;
end;
$$;

-- ─── 1. Tabla ───────────────────────────────────────────────────────────────

create table if not exists public.user_pestana_inicial (
  user_id uuid primary key references auth.users (id) on delete cascade,
  ruta text not null check (ruta ~ '^/[a-z0-9-]{1,40}$'),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

comment on table public.user_pestana_inicial is
  'Pestaña del panel que se abre a cada usuario al iniciar sesión (la elige un super admin en Usuarios › Permisos). Sin fila: como siempre.';

-- ─── 2. Quién y cuándo (lo pone el servidor) ────────────────────────────────

create or replace function public.user_pestana_inicial_fijar_autor()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
revoke all on function public.user_pestana_inicial_fijar_autor() from public, anon, authenticated;

drop trigger if exists user_pestana_inicial_autor on public.user_pestana_inicial;
create trigger user_pestana_inicial_autor before insert or update on public.user_pestana_inicial
  for each row execute function public.user_pestana_inicial_fijar_autor();

-- ─── 3. RLS y privilegios ───────────────────────────────────────────────────

alter table public.user_pestana_inicial enable row level security;

drop policy if exists user_pestana_inicial_select_propia on public.user_pestana_inicial;
create policy user_pestana_inicial_select_propia on public.user_pestana_inicial for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists user_pestana_inicial_select_super_admin on public.user_pestana_inicial;
create policy user_pestana_inicial_select_super_admin on public.user_pestana_inicial for select to authenticated
  using ((select public.is_super_admin((select auth.uid()))));
drop policy if exists user_pestana_inicial_select_seccion_usuarios on public.user_pestana_inicial;
create policy user_pestana_inicial_select_seccion_usuarios on public.user_pestana_inicial for select to authenticated
  using ((select public.can_read_section('usuarios')));
drop policy if exists user_pestana_inicial_insert on public.user_pestana_inicial;
create policy user_pestana_inicial_insert on public.user_pestana_inicial for insert to authenticated
  with check ((select public.is_super_admin((select auth.uid()))));
drop policy if exists user_pestana_inicial_update on public.user_pestana_inicial;
create policy user_pestana_inicial_update on public.user_pestana_inicial for update to authenticated
  using ((select public.is_super_admin((select auth.uid()))))
  with check ((select public.is_super_admin((select auth.uid()))));
drop policy if exists user_pestana_inicial_delete on public.user_pestana_inicial;
create policy user_pestana_inicial_delete on public.user_pestana_inicial for delete to authenticated
  using ((select public.is_super_admin((select auth.uid()))));

revoke all on public.user_pestana_inicial from anon, authenticated;
grant select, insert, update, delete on public.user_pestana_inicial to authenticated;
grant all on public.user_pestana_inicial to service_role;

-- Sesión de panel viva y no bloqueada (como el resto de tablas del panel).
do $$
begin
  if to_regprocedure('private.sesion_panel_permitida()') is not null then
    drop policy if exists "acceso_panel_no_bloqueado" on public.user_pestana_inicial;
    create policy "acceso_panel_no_bloqueado" on public.user_pestana_inicial as restrictive for all to authenticated
      using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()));
  end if;
end;
$$;

-- ─── 4. Auditoría (como user_permissions) ───────────────────────────────────

do $$
begin
  if to_regprocedure('public.fn_registrar_auditoria()') is not null then
    drop trigger if exists trg_auditoria on public.user_pestana_inicial;
    create trigger trg_auditoria after insert or update or delete on public.user_pestana_inicial
      for each row execute function public.fn_registrar_auditoria();
  end if;
end;
$$;

do $$
begin
  raise notice 'usuarios_pestana_inicial: aplicada';
end;
$$;

commit;

-- VERIFICACIÓN (solo lectura):
--   select polname, polpermissive from pg_policy where polrelid = 'public.user_pestana_inicial'::regclass order by 1;
--   select count(*) from public.user_pestana_inicial;
