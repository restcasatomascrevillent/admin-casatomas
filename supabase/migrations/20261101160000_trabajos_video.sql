-- «Mandar a un dispositivo potente» (vídeo del plato) — 01/11/2026
-- ---------------------------------------------------------------------------
-- El móvil graba el vídeo del plato, lo sube EN BRUTO al bucket `platos`
-- (`pendientes/<uuid>.<ext>`) y crea un trabajo aquí. Un dispositivo potente
-- (PC con WebGPU) con el panel abierto lo ve por sondeo (cada 60 s), lo
-- reclama con `reclamar_trabajo_video()`, lo procesa con el pipeline del
-- panel, guarda `Platos.video_url` y lo cierra con `terminar_trabajo_video()`.
-- La Edge Function `notificar-video` manda un Web Push al que lo grabó, con
-- las suscripciones de `suscripciones_push`.
--
-- Permisos: sección `gestor_carta` (can_write_section, igual que las
-- políticas de Platos y del bucket `platos` de 20261001150000) + la
-- restrictiva `acceso_panel_no_bloqueado` (sesión de panel viva, usuario no
-- bloqueado) si existe private.sesion_panel_permitida().
--
-- El panel funciona sin esta migración: si la tabla no existe (PGRST205 /
-- 42P01) oculta el botón «Mandar a un dispositivo potente» y el aviso.
--
-- Idempotente (if not exists / drop policy if exists / create or replace).
-- ROLLBACK: al final del fichero y en
-- supabase/rollbacks/20261101160000_trabajos_video_ROLLBACK.sql.
-- ---------------------------------------------------------------------------

-- 1. trabajos_video --------------------------------------------------------
create table if not exists public.trabajos_video (
  id                 uuid primary key default gen_random_uuid(),
  plato_id           text not null references public."Platos"(id) on delete cascade,
  ruta_original      text not null,
  tema               text not null default 'cartulina',
  estado             text not null default 'pendiente',
  creado_por         uuid default auth.uid() references auth.users(id) on delete set null,
  dispositivo_origen text,
  procesado_por      uuid references auth.users(id) on delete set null,
  dispositivo_proceso text,
  reclamado_en       timestamptz,
  intentos           integer not null default 0,
  error              text,
  terminado_en       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint trabajos_video_estado_chk check (estado in ('pendiente', 'procesando', 'listo', 'error')),
  constraint trabajos_video_ruta_chk check (ruta_original ~ '^pendientes/[A-Za-z0-9_-]{8,80}\.(mp4|mov|m4v|webm|3gp|mkv)$'),
  constraint trabajos_video_tema_chk check (tema ~ '^[a-z_]{1,40}$'),
  constraint trabajos_video_textos_chk check (
    coalesce(length(dispositivo_origen), 0) <= 200 and coalesce(length(dispositivo_proceso), 0) <= 200
    and coalesce(length(error), 0) <= 1000)
);

comment on table public.trabajos_video is
  'Vídeos del plato grabados en un móvil y pendientes de procesar en un dispositivo potente (PC con WebGPU). Ver docs/video-dispositivo-potente.md.';

-- Un solo trabajo vivo por plato (evita mandar dos veces el mismo).
create unique index if not exists trabajos_video_un_vivo_por_plato
  on public.trabajos_video (plato_id) where estado in ('pendiente', 'procesando');
-- Sondeo de pendientes.
create index if not exists trabajos_video_vivos_idx
  on public.trabajos_video (created_at) where estado in ('pendiente', 'procesando');
create index if not exists trabajos_video_creado_por_idx on public.trabajos_video (creado_por);

alter table public.trabajos_video enable row level security;
revoke all on public.trabajos_video from anon, authenticated;
grant select, insert, delete on public.trabajos_video to authenticated;
grant all on public.trabajos_video to service_role;

drop policy if exists trabajos_video_select_seccion on public.trabajos_video;
create policy trabajos_video_select_seccion on public.trabajos_video
  for select to authenticated
  using ( (select public.can_write_section('gestor_carta')) );

-- Solo se crea en estado inicial y a nombre propio; el resto lo cambian las RPC.
drop policy if exists trabajos_video_insert_seccion on public.trabajos_video;
create policy trabajos_video_insert_seccion on public.trabajos_video
  for insert to authenticated
  with check (
    (select public.can_write_section('gestor_carta'))
    and creado_por = (select auth.uid())
    and estado = 'pendiente' and procesado_por is null and reclamado_en is null
    and intentos = 0 and error is null and terminado_en is null
  );

-- Cancelar un pendiente o limpiar uno terminado (no uno que se está procesando).
drop policy if exists trabajos_video_delete_seccion on public.trabajos_video;
create policy trabajos_video_delete_seccion on public.trabajos_video
  for delete to authenticated
  using ( (select public.can_write_section('gestor_carta')) and estado <> 'procesando' );

drop policy if exists trabajos_video_service_role on public.trabajos_video;
create policy trabajos_video_service_role on public.trabajos_video
  for all to service_role using (true) with check (true);

-- 2. suscripciones_push ----------------------------------------------------
create table if not exists public.suscripciones_push (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  etiqueta    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint suscripciones_push_endpoint_chk check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  constraint suscripciones_push_claves_chk check (length(p256dh) between 16 and 200 and length(auth) between 8 and 100),
  constraint suscripciones_push_etiqueta_chk check (coalesce(length(etiqueta), 0) <= 200)
);

comment on table public.suscripciones_push is
  'Suscripciones Web Push (VAPID) del panel por usuario y dispositivo. Las usa la Edge Function notificar-video.';

create index if not exists suscripciones_push_user_idx on public.suscripciones_push (user_id);

alter table public.suscripciones_push enable row level security;
revoke all on public.suscripciones_push from anon, authenticated;
-- Alta/actualización solo por guardar_suscripcion_push() (reasigna el endpoint
-- si en ese navegador entra otro usuario). Cada uno ve y borra las suyas.
grant select, delete on public.suscripciones_push to authenticated;
grant all on public.suscripciones_push to service_role;

drop policy if exists suscripciones_push_select_propias on public.suscripciones_push;
create policy suscripciones_push_select_propias on public.suscripciones_push
  for select to authenticated using ( user_id = (select auth.uid()) );
drop policy if exists suscripciones_push_delete_propias on public.suscripciones_push;
create policy suscripciones_push_delete_propias on public.suscripciones_push
  for delete to authenticated using ( user_id = (select auth.uid()) );
drop policy if exists suscripciones_push_service_role on public.suscripciones_push;
create policy suscripciones_push_service_role on public.suscripciones_push
  for all to service_role using (true) with check (true);

-- Restrictiva de sesión de panel (como el resto de tablas del panel), si existe.
do $$
begin
  if to_regprocedure('private.sesion_panel_permitida()') is not null then
    execute 'drop policy if exists "acceso_panel_no_bloqueado" on public.trabajos_video';
    execute 'create policy "acceso_panel_no_bloqueado" on public.trabajos_video as restrictive for all to authenticated
      using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()))';
    execute 'drop policy if exists "acceso_panel_no_bloqueado" on public.suscripciones_push';
    execute 'create policy "acceso_panel_no_bloqueado" on public.suscripciones_push as restrictive for all to authenticated
      using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()))';
  end if;
end $$;

-- 3. RPC -------------------------------------------------------------------
-- Comprobación común: sesión de panel (si existe la función) + gestor_carta.
create or replace function public.trabajos_video_permiso()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.can_write_section('gestor_carta') then
    raise exception 'Sin permiso de carta' using errcode = '42501';
  end if;
  if to_regprocedure('private.sesion_panel_permitida()') is not null then
    if not coalesce((select private.sesion_panel_permitida()), false) then
      raise exception 'Sesión de panel no válida' using errcode = '42501';
    end if;
  end if;
end $$;
revoke all on function public.trabajos_video_permiso() from public, anon;
grant execute on function public.trabajos_video_permiso() to authenticated, service_role;

-- Reclama UN trabajo de forma atómica: el pendiente más antiguo (o el indicado
-- en p_id) o uno 'procesando' abandonado (reclamado hace más de 10 min).
-- FOR UPDATE SKIP LOCKED: dos dispositivos a la vez nunca cogen el mismo.
-- Devuelve 0 filas si no hay nada que coger.
create or replace function public.reclamar_trabajo_video(p_id uuid default null, p_dispositivo text default null)
returns setof public.trabajos_video
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform public.trabajos_video_permiso();
  select t.id into v_id
    from public.trabajos_video t
   where (p_id is null or t.id = p_id)
     and (t.estado = 'pendiente'
          or (t.estado = 'procesando' and t.reclamado_en < now() - interval '10 minutes'))
   order by t.created_at
   limit 1
   for update skip locked;
  if v_id is null then
    return;
  end if;
  return query
    update public.trabajos_video t
       set estado = 'procesando',
           procesado_por = auth.uid(),
           dispositivo_proceso = left(p_dispositivo, 200),
           reclamado_en = now(),
           intentos = t.intentos + 1,
           error = null,
           updated_at = now()
     where t.id = v_id
    returning t.*;
end $$;
revoke all on function public.reclamar_trabajo_video(uuid, text) from public, anon;
grant execute on function public.reclamar_trabajo_video(uuid, text) to authenticated, service_role;

-- Cierra un trabajo reclamado POR QUIEN LLAMA: listo (p_ok) o error.
create or replace function public.terminar_trabajo_video(p_id uuid, p_ok boolean, p_error text default null)
returns public.trabajos_video
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.trabajos_video;
begin
  perform public.trabajos_video_permiso();
  update public.trabajos_video t
     set estado = case when p_ok then 'listo' else 'error' end,
         error = case when p_ok then null else left(coalesce(nullif(p_error, ''), 'Error al procesar'), 1000) end,
         terminado_en = now(),
         updated_at = now()
   where t.id = p_id and t.estado = 'procesando' and t.procesado_por = auth.uid()
  returning t.* into v;
  if v.id is null then
    raise exception 'El trabajo no existe o no lo está procesando este usuario' using errcode = 'P0002';
  end if;
  return v;
end $$;
revoke all on function public.terminar_trabajo_video(uuid, boolean, text) from public, anon;
grant execute on function public.terminar_trabajo_video(uuid, boolean, text) to authenticated, service_role;

-- Devuelve a 'pendiente' un trabajo reclamado por quien llama (cancelar en el PC).
create or replace function public.soltar_trabajo_video(p_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public.trabajos_video_permiso();
  update public.trabajos_video t
     set estado = 'pendiente', procesado_por = null, dispositivo_proceso = null,
         reclamado_en = null, updated_at = now()
   where t.id = p_id and t.estado = 'procesando' and t.procesado_por = auth.uid();
  return found;
end $$;
revoke all on function public.soltar_trabajo_video(uuid) from public, anon;
grant execute on function public.soltar_trabajo_video(uuid) to authenticated, service_role;

-- Alta o actualización de la suscripción push de ESTE navegador para quien
-- llama (si el endpoint era de otro usuario, pasa a ser del que llama).
create or replace function public.guardar_suscripcion_push(p_endpoint text, p_p256dh text, p_auth text, p_etiqueta text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sin sesión' using errcode = '42501';
  end if;
  if to_regprocedure('private.sesion_panel_permitida()') is not null then
    if not coalesce((select private.sesion_panel_permitida()), false) then
      raise exception 'Sesión de panel no válida' using errcode = '42501';
    end if;
  end if;
  insert into public.suscripciones_push as s (user_id, endpoint, p256dh, auth, etiqueta)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_etiqueta, 200))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        etiqueta = excluded.etiqueta, updated_at = now()
  returning s.id into v_id;
  return v_id;
end $$;
revoke all on function public.guardar_suscripcion_push(text, text, text, text) from public, anon;
grant execute on function public.guardar_suscripcion_push(text, text, text, text) to authenticated, service_role;

-- ROLLBACK (manual; también en supabase/rollbacks/20261101160000_trabajos_video_ROLLBACK.sql):
--   drop function if exists public.guardar_suscripcion_push(text, text, text, text);
--   drop function if exists public.soltar_trabajo_video(uuid);
--   drop function if exists public.terminar_trabajo_video(uuid, boolean, text);
--   drop function if exists public.reclamar_trabajo_video(uuid, text);
--   drop function if exists public.trabajos_video_permiso();
--   drop table if exists public.suscripciones_push;
--   drop table if exists public.trabajos_video;
--   -- y borrar del bucket `platos` lo que quede en pendientes/
