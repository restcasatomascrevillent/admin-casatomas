set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261129100000_peticiones — «Peticiones» (usuarios del panel) y «Tickets»
-- (Super Admin) con análisis de IA (13/11/2026)
-- ===========================================================================
-- Petición del dueño: «un generador de tickets tipo Jira pero muy sencillo:
-- título, prioridad y descripción con módulo afectado, para que los usuarios
-- reporten cosas; y luego, en el superadmin, un módulo de tickets, y que ese
-- ticket lo analice una IA y salga una tarea propuesta de lo que quieren y
-- cómo lo haría, y el prompt para la IA».
--
-- «Solicitudes» ya son las solicitudes de reserva: aquí son «peticiones».
--
--   * `peticiones`: título (3–120), prioridad (baja/normal/alta/urgente),
--     módulo (clave de la lista fija del panel:
--     supabase/functions/_shared/peticiones.ts), descripción (10–4000),
--     captura opcional (cubo privado «peticiones»), página y dispositivo
--     desde los que se envió, estado (nueva → en_analisis → aceptada → hecha,
--     o descartada con motivo visible para quien la envió) y el análisis de
--     la IA (jsonb, lo escribe SOLO la Edge Function analizar-peticion con
--     service role), más linear_id/linear_url para cuando se conecte Linear.
--     Nombre y email de quien la envía se copian al crearla (para el listado
--     del Super Admin; nunca se mandan a la IA).
--   * Permisos (RLS + privilegios por columna):
--       - cualquier usuario del panel crea peticiones A SU NOMBRE (solo las
--         columnas del formulario) y lee LAS SUYAS;
--       - el super admin lee todas y cambia solo `estado` y `motivo_descarte`;
--       - nadie más cambia nada (estado, análisis, autor…); nadie borra desde
--         el panel. Más la restrictiva acceso_panel_no_bloqueado.
--     Tope de 20 peticiones por usuario en 24 h (cada una gasta una llamada a
--     la IA), con cerrojo para que no se salte en paralelo.
--   * `peticion_reservar_analisis(id, forzar)`: solo service role. Marca la
--     petición «analizando» de forma atómica: sin `forzar` solo si está
--     pendiente (o un análisis se quedó colgado más de 3 min), para que cada
--     petición se analice UNA vez; con `forzar` («Volver a analizar», solo
--     super admin, lo comprueba la función), siempre (máx. 10 intentos).
--   * Prioridad «urgente»: aviso en la campana (notificaciones_dashboard,
--     tipo `peticion_urgente`) SOLO para el super admin: política restrictiva
--     nueva y `seccion_aviso` lleva los `peticion_*` a una sección que no
--     tiene nadie (solo pasa el super admin), así «Marcar todos» de un
--     usuario no los da por revisados.
--   * Cubo privado «peticiones» (5 MB, jpg/png/webp): cada usuario sube a su
--     carpeta `<su uid>/<uuid>.<ext>` y lee la suya; el super admin lee todo.
--   * Alta de «analizar-peticion» en Gasto IA (ia_funciones +
--     ia_modelo_funcion), instrumentada (registra cada llamada en ia_uso).
--
-- Idempotente. Necesita is_super_admin(uuid).
-- Rollback: supabase/rollbacks/20261129100000_peticiones_ROLLBACK.sql
-- Test:     npm run test:peticiones:db (scripts/test-peticiones.mjs)
-- ===========================================================================

begin;

do $$
begin
  if to_regprocedure('public.is_super_admin(uuid)') is null then
    raise exception 'peticiones: falta is_super_admin(uuid). No se ha cambiado nada.';
  end if;
end;
$$;

-- ─── 1. Ruta válida de una captura: <uid>/<uuid>.<ext> ──────────────────────

create or replace function public.peticiones_ruta_captura_valida(p_nombre text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(p_nombre ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$', false)
$$;
revoke all on function public.peticiones_ruta_captura_valida(text) from public, anon;
grant execute on function public.peticiones_ruta_captura_valida(text) to authenticated, service_role;

-- ─── 2. Tabla ───────────────────────────────────────────────────────────────

create table if not exists public.peticiones (
  id                  uuid primary key default gen_random_uuid(),
  creado_por          uuid default auth.uid() references auth.users (id) on delete set null,
  creado_por_nombre   text check (creado_por_nombre is null or char_length(creado_por_nombre) <= 200),
  creado_por_email    text check (creado_por_email is null or char_length(creado_por_email) <= 320),
  titulo              text not null check (char_length(btrim(titulo)) between 3 and 120),
  prioridad           text not null default 'normal' check (prioridad in ('baja', 'normal', 'alta', 'urgente')),
  modulo              text not null check (modulo ~ '^[a-z][a-z0-9_]{1,39}$'),
  descripcion         text not null check (char_length(btrim(descripcion)) between 10 and 4000),
  captura_path        text check (captura_path is null or public.peticiones_ruta_captura_valida(captura_path)),
  ruta                text check (ruta is null or char_length(ruta) <= 300),
  dispositivo         text check (dispositivo is null or char_length(dispositivo) <= 400),
  estado              text not null default 'nueva' check (estado in ('nueva', 'en_analisis', 'aceptada', 'hecha', 'descartada')),
  motivo_descarte     text check (motivo_descarte is null or char_length(motivo_descarte) <= 500),
  estado_cambiado_por uuid,
  estado_cambiado_en  timestamptz,
  analisis            jsonb check (analisis is null or jsonb_typeof(analisis) = 'object'),
  analisis_estado     text not null default 'pendiente' check (analisis_estado in ('pendiente', 'analizando', 'hecho', 'error')),
  analisis_error      text check (analisis_error is null or char_length(analisis_error) <= 500),
  analisis_modelo     text check (analisis_modelo is null or char_length(analisis_modelo) <= 120),
  analisis_intentos   integer not null default 0 check (analisis_intentos between 0 and 50),
  analisis_pedido_en  timestamptz,
  analizado_en        timestamptz,
  linear_id           text check (linear_id is null or char_length(linear_id) <= 100),
  linear_url          text check (linear_url is null or (linear_url ~ '^https://' and char_length(linear_url) <= 500)),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- Descartar exige un motivo (lo ve quien la envió).
  constraint peticiones_descartada_con_motivo
    check (estado <> 'descartada' or char_length(btrim(coalesce(motivo_descarte, ''))) >= 3)
);

comment on table public.peticiones is
  'Peticiones de los usuarios del panel (Nueva petición) y Tickets del Super Admin, con análisis de IA (20261129100000). El análisis lo escribe solo analizar-peticion (service role).';

create index if not exists peticiones_por_autor on public.peticiones (creado_por, created_at desc);
create index if not exists peticiones_por_estado on public.peticiones (estado, created_at desc);

-- ─── 3. Al crear: autor del servidor, datos de contacto y tope diario ──────

create or replace function public.peticiones_al_crear()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_hoy integer;
begin
  if v_uid is not null then
    -- Desde el panel: siempre a nombre de quien la envía, recién creada y sin análisis.
    new.creado_por := v_uid;
    new.estado := 'nueva';
    new.motivo_descarte := null;
    new.estado_cambiado_por := null;
    new.estado_cambiado_en := null;
    new.analisis := null;
    new.analisis_estado := 'pendiente';
    new.analisis_error := null;
    new.analisis_modelo := null;
    new.analisis_intentos := 0;
    new.analisis_pedido_en := null;
    new.analizado_en := null;
    new.linear_id := null;
    new.linear_url := null;
    new.created_at := now();
  end if;
  new.updated_at := now();
  new.titulo := btrim(new.titulo);
  new.descripcion := btrim(new.descripcion);

  if new.creado_por is not null then
    select left(coalesce(nullif(btrim(u.raw_user_meta_data ->> 'display_name'), ''), u.email), 200), left(u.email, 320)
      into new.creado_por_nombre, new.creado_por_email
      from auth.users u
     where u.id = new.creado_por;

    -- Tope por usuario (cada petición gasta una llamada a la IA). El cerrojo
    -- evita que varias a la vez se lo salten.
    perform pg_advisory_xact_lock(hashtext('peticiones_tope_' || new.creado_por::text));
    select count(*) into v_hoy
      from public.peticiones
     where creado_por = new.creado_por
       and created_at > now() - interval '24 hours';
    if v_hoy >= 20 then
      raise exception 'Has enviado 20 peticiones en las últimas 24 horas. Espera un poco antes de mandar otra.';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.peticiones_al_crear() from public, anon, authenticated;

drop trigger if exists trg_peticiones_al_crear on public.peticiones;
create trigger trg_peticiones_al_crear before insert on public.peticiones
  for each row execute function public.peticiones_al_crear();

-- ─── 4. Al cambiar: quién y cuándo, y lo que no cambia nunca ───────────────

create or replace function public.peticiones_al_cambiar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.id := old.id;
  -- El autor no cambia… salvo a NULL (ON DELETE SET NULL al dar de baja al usuario).
  if new.creado_por is not null then
    new.creado_por := old.creado_por;
  end if;
  new.created_at := old.created_at;
  new.updated_at := now();
  if new.estado is distinct from old.estado then
    new.estado_cambiado_por := (select auth.uid());
    new.estado_cambiado_en := now();
  end if;
  -- El motivo solo tiene sentido descartada (si se reabre, se borra).
  if new.estado <> 'descartada' then
    new.motivo_descarte := null;
  else
    new.motivo_descarte := nullif(btrim(new.motivo_descarte), '');
  end if;
  return new;
end;
$$;
revoke all on function public.peticiones_al_cambiar() from public, anon, authenticated;

drop trigger if exists trg_peticiones_al_cambiar on public.peticiones;
create trigger trg_peticiones_al_cambiar before update on public.peticiones
  for each row execute function public.peticiones_al_cambiar();

-- ─── 5. Urgente: aviso en la campana del super admin ────────────────────────

create or replace function public.peticiones_avisar_urgente()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.prioridad <> 'urgente' or to_regclass('public.notificaciones_dashboard') is null then
    return new;
  end if;
  -- Un aviso nunca debe impedir guardar la petición.
  begin
    insert into public.notificaciones_dashboard (tipo, titulo, mensaje, referencia_id, referencia_tipo, prioridad)
    values (
      'peticion_urgente',
      left('Petición urgente: ' || new.titulo, 200),
      left(coalesce(new.creado_por_nombre, 'Un usuario') || ' · módulo ' || new.modulo, 300),
      new.id,
      'peticion',
      'alta'
    );
  exception when others then
    raise warning 'peticiones_avisar_urgente: no se pudo crear el aviso (%)', sqlerrm;
  end;
  return new;
end;
$$;
revoke all on function public.peticiones_avisar_urgente() from public, anon, authenticated;

drop trigger if exists trg_peticiones_avisar_urgente on public.peticiones;
create trigger trg_peticiones_avisar_urgente after insert on public.peticiones
  for each row execute function public.peticiones_avisar_urgente();

-- ─── 6. Reservar el análisis (solo service role: analizar-peticion) ────────

create or replace function public.peticion_reservar_analisis(p_id uuid, p_forzar boolean default false)
returns setof public.peticiones
language sql
set search_path = public
as $$
  update public.peticiones p
     set analisis_estado = 'analizando',
         analisis_pedido_en = now(),
         analisis_intentos = p.analisis_intentos + 1,
         analisis_error = null
   where p.id = p_id
     and p.analisis_intentos < 10
     and (
       coalesce(p_forzar, false)
       or p.analisis_estado = 'pendiente'
       or (p.analisis_estado = 'analizando' and p.analisis_pedido_en < now() - interval '3 minutes')
     )
  returning p.*
$$;
revoke all on function public.peticion_reservar_analisis(uuid, boolean) from public, anon, authenticated;
grant execute on function public.peticion_reservar_analisis(uuid, boolean) to service_role;

-- ─── 7. RLS y privilegios ───────────────────────────────────────────────────

alter table public.peticiones enable row level security;

drop policy if exists peticiones_insert_propia on public.peticiones;
create policy peticiones_insert_propia on public.peticiones for insert to authenticated
  with check (
    creado_por = (select auth.uid())
    and (captura_path is null or split_part(captura_path, '/', 1) = (select auth.uid())::text)
  );

drop policy if exists peticiones_select_propia on public.peticiones;
create policy peticiones_select_propia on public.peticiones for select to authenticated
  using (creado_por = (select auth.uid()));

drop policy if exists peticiones_select_super_admin on public.peticiones;
create policy peticiones_select_super_admin on public.peticiones for select to authenticated
  using ((select public.is_super_admin((select auth.uid()))));

drop policy if exists peticiones_update_super_admin on public.peticiones;
create policy peticiones_update_super_admin on public.peticiones for update to authenticated
  using ((select public.is_super_admin((select auth.uid()))))
  with check ((select public.is_super_admin((select auth.uid()))));

revoke all on public.peticiones from anon, authenticated;
grant select on public.peticiones to authenticated;
grant insert (titulo, prioridad, modulo, descripcion, captura_path, ruta, dispositivo) on public.peticiones to authenticated;
grant update (estado, motivo_descarte) on public.peticiones to authenticated;
grant all on public.peticiones to service_role;

do $$
begin
  if to_regprocedure('private.sesion_panel_permitida()') is not null then
    drop policy if exists "acceso_panel_no_bloqueado" on public.peticiones;
    create policy "acceso_panel_no_bloqueado" on public.peticiones as restrictive for all to authenticated
      using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()));
  end if;
  if to_regprocedure('public.fn_registrar_auditoria()') is not null then
    execute 'drop trigger if exists trg_auditoria on public.peticiones';
    execute 'create trigger trg_auditoria after insert or update or delete on public.peticiones for each row execute function public.fn_registrar_auditoria()';
  end if;
end;
$$;

-- ─── 8. Avisos de peticiones: solo el super admin ───────────────────────────

do $$
begin
  if to_regclass('public.notificaciones_dashboard') is not null then
    drop policy if exists notificaciones_peticiones_solo_super_admin on public.notificaciones_dashboard;
    create policy notificaciones_peticiones_solo_super_admin on public.notificaciones_dashboard
      as restrictive for all to authenticated
      using ( tipo not like 'peticion\_%' or (select public.is_super_admin((select auth.uid()))) )
      with check ( tipo not like 'peticion\_%' or (select public.is_super_admin((select auth.uid()))) );
  end if;
end;
$$;

-- Sección de cada aviso (20261124100000) + los de peticiones a «solo_super_admin»: ningún usuario
-- tiene esa sección y has_section_permission da true al super admin, así que marcar_avisos_revisados
-- (SECURITY DEFINER) tampoco los marca por otros.
create or replace function public.seccion_aviso(p_tipo text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_tipo in ('reserva_nueva', 'reserva_cancelada', 'reserva_sin_asignar', 'solicitud_pendiente') then 'reservas'
    when p_tipo like 'facturas\_%' or p_tipo in ('subida_precio', 'original_sin_drive') then 'facturas'
    when p_tipo like 'peticion\_%' then 'solo_super_admin'
    else 'dashboard'
  end
$$;
revoke all on function public.seccion_aviso(text) from public, anon;
grant execute on function public.seccion_aviso(text) to authenticated, service_role;

-- ─── 9. Cubo privado «peticiones» (capturas) ────────────────────────────────

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('peticiones', 'peticiones', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  end if;
end;
$$;

do $$
declare
  v_sesion text := case when to_regprocedure('private.sesion_panel_permitida()') is not null
                        then ' and (select private.sesion_panel_permitida())' else '' end;
begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists peticiones_capturas_insert on storage.objects';
    execute 'create policy peticiones_capturas_insert on storage.objects for insert to authenticated with check (bucket_id = ''peticiones'''
      || ' and split_part(name, ''/'', 1) = (select auth.uid())::text and public.peticiones_ruta_captura_valida(name)' || v_sesion || ')';
    execute 'drop policy if exists peticiones_capturas_select on storage.objects';
    execute 'create policy peticiones_capturas_select on storage.objects for select to authenticated using (bucket_id = ''peticiones'''
      || ' and (split_part(name, ''/'', 1) = (select auth.uid())::text or (select public.is_super_admin((select auth.uid()))))' || v_sesion || ')';
  end if;
end;
$$;

-- ─── 10. Gasto IA ───────────────────────────────────────────────────────────

do $$
begin
  if to_regclass('public.ia_funciones') is not null then
    insert into public.ia_funciones (funcion, descripcion, instrumentada, unidad, orden)
    values ('analizar-peticion', 'Peticiones · la IA analiza cada ticket una vez (qué quieren, tarea propuesta y prompt para la IA); «Volver a analizar» desde Super Admin › Tickets', true, 'petición', 97)
    on conflict (funcion) do nothing;
  end if;
  if to_regclass('public.ia_modelo_funcion') is not null and to_regclass('public.ia_funciones') is not null then
    insert into public.ia_modelo_funcion (funcion, modelo_codigo, centralizado)
    values ('analizar-peticion', 'gpt-4.1-mini, en código (secreto PETICIONES_IA_MODELO)', true)
    on conflict (funcion) do nothing;
  end if;
end;
$$;

do $$ begin raise notice 'peticiones: aplicada'; end $$;

commit;

-- VERIFICACIÓN (solo lectura):
--   select estado, prioridad, analisis_estado, count(*) from public.peticiones group by 1, 2, 3;
--   select polname from pg_policy where polrelid = 'public.peticiones'::regclass order by 1;
--   select id, public, file_size_limit from storage.buckets where id = 'peticiones';
--   select public.seccion_aviso('peticion_urgente');  -- solo_super_admin
