set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261122153700_newsletter_plantillas — Newsletter: plantillas guardadas y
-- «Crear con IA» (10/11/2026)
-- ===========================================================================
-- Petición del dueño: «Mejorar las plantillas de los correos de la newsletter
-- siguiendo la estética actual y añadir nuevas y botón para crear nuevas con
-- redacción por IA y presentación por IA».
--
--   * newsletter_plantillas — plantillas que el personal guarda desde el panel
--                             (a mano o a partir de una propuesta de la IA):
--                             título, etiqueta, texto de vista previa y los
--                             BLOQUES del correo (jsonb, el mismo formato que
--                             valida _shared/newsletter/bloques.ts). Las
--                             plantillas de partida viven en el código; aquí
--                             solo las nuevas.
--   * newsletter_ia_peticiones — cada llamada a «Crear con IA» (Edge Function
--                             newsletter-ia), para el tope diario: 40 por
--                             usuario y día (día de Madrid), con cerrojo.
--   * Alta de «newsletter-ia» en ia_funciones (sin instrumentar hasta
--     desplegar la función; ver _shared/ENGANCHE-REGISTRO-IA.md) y en
--     ia_modelo_funcion (modelo elegible en Super Admin › Servicios › Modelos).
--
-- Permisos: los de Marketing (la sección Newsletter). Leer con «Ver»
-- (can_read_section); guardar, cambiar, borrar y usar la IA con «Editar»
-- (can_edit_section). Más la política restrictiva de sesión de panel no
-- bloqueada. Nada de esto envía correos: enviar sigue siendo enviar-newsletter
-- y siempre con confirmación en el panel.
--
-- Necesita: can_read_section / can_edit_section. Opcionales:
-- update_updated_at_column, fn_registrar_auditoria, sesion_panel_permitida,
-- ia_funciones, ia_modelo_funcion. Idempotente.
-- Rollback: supabase/rollbacks/20261122153700_newsletter_plantillas_ROLLBACK.sql
-- ===========================================================================

begin;

do $$
begin
  if to_regprocedure('public.can_edit_section(text)') is null or to_regprocedure('public.can_read_section(text)') is null then
    raise exception 'newsletter_plantillas: faltan can_read_section / can_edit_section.';
  end if;
end;
$$;

-- ─── 1. Tablas ──────────────────────────────────────────────────────────────

create table if not exists public.newsletter_plantillas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (char_length(btrim(nombre)) between 1 and 80),
  descripcion text not null default '' check (char_length(descripcion) <= 200),
  tipo text not null default 'personalizada' check (tipo in (
    'anuncio', 'nuevo_menu', 'oferta', 'menu_temporada', 'evento', 'novedades_carta', 'cheques_regalo', 'personalizada')),
  titulo text not null default '' check (char_length(titulo) <= 150),
  insignia text not null default '' check (char_length(insignia) <= 40),
  preheader text not null default '' check (char_length(preheader) <= 150),
  bloques jsonb not null check (
    jsonb_typeof(bloques) = 'array'
    and jsonb_array_length(bloques) between 1 and 20
    and octet_length(bloques::text) <= 40000),
  origen text not null default 'manual' check (origen in ('manual', 'ia')),
  creado_por uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists newsletter_plantillas_recientes on public.newsletter_plantillas (updated_at desc);

create table if not exists public.newsletter_ia_peticiones (
  id bigserial primary key,
  modelo text,
  ok boolean,
  creado_por uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists newsletter_ia_peticiones_cupo on public.newsletter_ia_peticiones (creado_por, created_at);

-- ─── 2. Autor y updated_at (los pone el servidor) ───────────────────────────

create or replace function public.newsletter_plantillas_fijar_autor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.creado_por := auth.uid();
    new.created_at := now();
  else
    -- creado_por solo puede quedar NULL: el «on delete set null» al dar de
    -- baja al usuario (si se repusiera, apuntaría a un usuario que no existe).
    if new.creado_por is not null then
      new.creado_por := old.creado_por;
    end if;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.newsletter_plantillas_fijar_autor() from public, anon, authenticated;

drop trigger if exists newsletter_plantillas_autor on public.newsletter_plantillas;
create trigger newsletter_plantillas_autor before insert or update on public.newsletter_plantillas
  for each row execute function public.newsletter_plantillas_fijar_autor();

-- ─── 3. Tope diario de «Crear con IA» (día de Madrid) ───────────────────────

create or replace function public.newsletter_comprobar_cupo_ia()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dia timestamptz := date_trunc('day', now() at time zone 'Europe/Madrid') at time zone 'Europe/Madrid';
  v integer;
begin
  -- Dos peticiones a la vez no se saltan el tope.
  perform pg_advisory_xact_lock(hashtext('newsletter_cupo_ia_' || coalesce(auth.uid()::text, '')));
  new.creado_por := auth.uid();
  new.created_at := now(); -- un created_at viejo no contaría para el tope de hoy
  new.ok := null;
  select count(*) into v from public.newsletter_ia_peticiones where creado_por = new.creado_por and created_at >= v_dia;
  if v >= 40 then
    raise exception 'newsletter_cupo_ia: has llegado al tope de 40 propuestas de la IA por hoy' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.newsletter_comprobar_cupo_ia() from public, anon, authenticated;

drop trigger if exists newsletter_ia_peticiones_cupo on public.newsletter_ia_peticiones;
create trigger newsletter_ia_peticiones_cupo before insert on public.newsletter_ia_peticiones
  for each row execute function public.newsletter_comprobar_cupo_ia();

-- ─── 4. RLS y privilegios ───────────────────────────────────────────────────

alter table public.newsletter_plantillas enable row level security;
alter table public.newsletter_ia_peticiones enable row level security;

drop policy if exists newsletter_plantillas_select on public.newsletter_plantillas;
create policy newsletter_plantillas_select on public.newsletter_plantillas for select to authenticated
  using ((select public.can_read_section('marketing')));
drop policy if exists newsletter_plantillas_insert on public.newsletter_plantillas;
create policy newsletter_plantillas_insert on public.newsletter_plantillas for insert to authenticated
  with check ((select public.can_edit_section('marketing')));
drop policy if exists newsletter_plantillas_update on public.newsletter_plantillas;
create policy newsletter_plantillas_update on public.newsletter_plantillas for update to authenticated
  using ((select public.can_edit_section('marketing'))) with check ((select public.can_edit_section('marketing')));
drop policy if exists newsletter_plantillas_delete on public.newsletter_plantillas;
create policy newsletter_plantillas_delete on public.newsletter_plantillas for delete to authenticated
  using ((select public.can_edit_section('marketing')));

-- Peticiones a la IA: las inserta la Edge Function con el JWT del usuario.
drop policy if exists newsletter_ia_peticiones_select on public.newsletter_ia_peticiones;
create policy newsletter_ia_peticiones_select on public.newsletter_ia_peticiones for select to authenticated
  using ((select public.can_read_section('marketing')));
drop policy if exists newsletter_ia_peticiones_insert on public.newsletter_ia_peticiones;
create policy newsletter_ia_peticiones_insert on public.newsletter_ia_peticiones for insert to authenticated
  with check ((select public.can_edit_section('marketing')));
drop policy if exists newsletter_ia_peticiones_update on public.newsletter_ia_peticiones;
create policy newsletter_ia_peticiones_update on public.newsletter_ia_peticiones for update to authenticated
  using ((select public.can_edit_section('marketing')) and creado_por = (select auth.uid()))
  with check ((select public.can_edit_section('marketing')) and creado_por = (select auth.uid()));

grant select, insert, update, delete on public.newsletter_plantillas to authenticated;
grant select, insert on public.newsletter_ia_peticiones to authenticated;
revoke update, delete, truncate on public.newsletter_ia_peticiones from authenticated;
grant update (ok) on public.newsletter_ia_peticiones to authenticated;
grant usage, select on sequence public.newsletter_ia_peticiones_id_seq to authenticated;
revoke all on public.newsletter_plantillas, public.newsletter_ia_peticiones from anon;
grant all on public.newsletter_plantillas, public.newsletter_ia_peticiones to service_role;

-- Sesión de panel viva y no bloqueada (como el resto de tablas del panel).
do $$
declare
  t text;
begin
  if to_regprocedure('private.sesion_panel_permitida()') is not null then
    foreach t in array array['newsletter_plantillas', 'newsletter_ia_peticiones'] loop
      execute format('drop policy if exists "acceso_panel_no_bloqueado" on public.%I', t);
      execute format('create policy "acceso_panel_no_bloqueado" on public.%I as restrictive for all to authenticated using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()))', t);
    end loop;
  end if;
end;
$$;

-- ─── 5. Auditoría (las plantillas; las peticiones a la IA ya son un registro) ─

do $$
begin
  if to_regprocedure('public.fn_registrar_auditoria()') is not null then
    drop trigger if exists trg_auditoria on public.newsletter_plantillas;
    create trigger trg_auditoria after insert or update or delete on public.newsletter_plantillas
      for each row execute function public.fn_registrar_auditoria();
  end if;
end;
$$;

-- ─── 6. Coste de la IA ──────────────────────────────────────────────────────

do $$
begin
  if to_regclass('public.ia_funciones') is not null then
    insert into public.ia_funciones (funcion, descripcion, instrumentada, unidad, orden)
    values ('newsletter-ia', 'Newsletter · «Crear con IA» (redacta el correo y propone su presentación por bloques)', false, 'propuesta', 63)
    on conflict (funcion) do nothing;
  end if;
  if to_regclass('public.ia_modelo_funcion') is not null and to_regclass('public.ia_funciones') is not null then
    execute $q$
      insert into public.ia_modelo_funcion (funcion, modelo_codigo, centralizado)
      values ('newsletter-ia', 'gpt-5.6-luna, en código (NEWSLETTER_IA_MODEL)', true)
      on conflict (funcion) do nothing
    $q$;
  end if;
end;
$$;

do $$
begin
  raise notice 'newsletter_plantillas: aplicada';
end;
$$;

commit;

-- VERIFICACIÓN (solo lectura):
--   select tablename from pg_tables where tablename in ('newsletter_plantillas', 'newsletter_ia_peticiones');
--   select polname from pg_policy where polrelid in ('public.newsletter_plantillas'::regclass, 'public.newsletter_ia_peticiones'::regclass) order by 1;
--   select funcion, instrumentada from public.ia_funciones where funcion = 'newsletter-ia';
-- AL DESPLEGAR newsletter-ia (ni antes ni después):
--   update public.ia_funciones set instrumentada = true where funcion = 'newsletter-ia';
