set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261109100000_instagram_video — Reels en MP4: cola de render, cubo de
-- vídeo y reels en instagram_piezas (fase 6 de la propuesta, 09/11/2026)
-- ===========================================================================
-- El panel monta el reel (fase 5, src/lib/instagram/reels) y pulsa «Generar
-- vídeo»: se guarda la pieza y se crea un trabajo en la cola. Un TRABAJADOR
-- Node (scripts/instagram/render-reels.mjs) que corre en un ordenador de
-- Oficiosos (o, más adelante, en un servidor pequeño, solo cambiando
-- variables de entorno) reclama el trabajo, captura los fotogramas con
-- Chromium, codifica el MP4 con ffmpeg, lo sube al cubo «instagram-video» y
-- cierra el trabajo. Después, el reel se prueba, se publica o se programa
-- como una imagen (instagram-publicar con media_type=REELS). Ver
-- docs/instagram-video.md.
--
-- QUÉ CREA
--   1. instagram_piezas (reels):
--        tipo_medio   'imagen' (todas las de antes) o 'reel'
--        formato      admite 'reel' (y tipo_medio = 'reel' ⇔ formato = 'reel')
--        estado       admite 'procesando': Meta aún procesa el vídeo; lo
--                     cierra el programador (pg_cron) o el panel
--        video_ruta, portada_ruta, duracion_s, video_bytes  (solo el
--                     servidor o el trabajador por RPC; el panel no)
--        procesando_accion ('prueba' | 'publicar' | 'programador') y
--        procesando_desde: qué hacer cuando Meta termine (se limpian solos al
--                     salir de 'procesando')
--      Trigger instagram_piezas_proteger_video: el panel (authenticated) no
--      puede escribir el vídeo, la portada, la duración ni los bytes, ni
--      cambiar tipo_medio. Si cambia el reel (datos) de una pieza con vídeo,
--      el vídeo deja de valer: se quita y la pieza vuelve a «borrador».
--   2. public.instagram_trabajos_render: la cola. Estados pendiente →
--      renderizando → listo | error, o cancelado. Un solo trabajo vivo por
--      pieza. El panel solo LEE (marketing); todo cambio va por RPC
--      (SECURITY DEFINER, can_write_section('marketing') + sesión de panel
--      viva), igual que trabajos_video (20261101160000):
--        instagram_render_encolar(pieza, marca, reel, fotos, caption,
--                                 portada_s, audio_ruta)      panel
--        instagram_render_cancelar(trabajo)                    panel
--        instagram_render_reclamar(dispositivo, trabajo?)      trabajador
--          FOR UPDATE SKIP LOCKED; retoma los «renderizando» abandonados
--          (sin latido en 10 min); al 3.er abandono, error.
--        instagram_render_progreso(trabajo, progreso, fotogramas) trabajador (latido)
--        instagram_render_terminar(trabajo, ok, error, video, portada,
--                                  duracion, bytes, avisos)    trabajador
--          comprueba que el MP4 y la portada existen en el cubo y deja la
--          pieza en «generada» (solo si el reel no cambió mientras tanto).
--        instagram_render_soltar(trabajo)                      trabajador
--      El trabajador NO usa service_role: entra como un usuario del panel
--      con la sección Marketing (ver docs/instagram-video.md).
--   3. Cubo PÚBLICO «instagram-video» (Meta descarga video_url y cover_url
--      sin sesión): 50 MB por fichero; MP4, JPEG y audio (pista propia).
--        reels/AAAA-MM/<pieza>-<trabajo8>.mp4 / .jpg   vídeo y portada
--        audio/<uuid>.(m4a|mp3|aac|wav)               pistas subidas
--      Escritura y lectura por API: marketing (políticas ig_video_objetos_*,
--      acotadas al cubo).
--   4. instagram_programacion_pieza: un reel se puede programar si tiene
--      vídeo y no está «procesando».
--   5. pg_cron «instagram-programador»: también llama cuando hay piezas
--      «procesando» por una prueba o publicación del panel.
--
-- APLICAR (una a una, nunca `db push`), DESPUÉS de 20261107010000_instagram_
-- limpieza_bucket: demo primero (sfonaclosuafvlhutkon), producción
-- (haqmmdfdzzatdnrrcgez) solo tras aceptar el PR y con el «sí» del dueño:
--   npx supabase db query --linked -f supabase/migrations/20261109100000_instagram_video.sql
-- Idempotente. Tiene que terminar en «instagram_video: aplicada».
-- Deshacer: supabase/rollbacks/20261109100000_instagram_video_ROLLBACK.sql
-- Pruebas: npm run test:instagram-video:db (PGlite).
-- ===========================================================================

begin;
set local lock_timeout = '5s';

-- ─── 0. Comprobaciones previas (no cambian nada) ────────────────────────────
do $$
declare
  v_faltan text[] := '{}';
begin
  if to_regclass('public.instagram_piezas') is null then
    v_faltan := v_faltan || 'public.instagram_piezas (aplica antes 20261105090000_instagram.sql)'::text;
  end if;
  if to_regclass('public.instagram_programaciones') is null then
    v_faltan := v_faltan || 'public.instagram_programaciones (aplica antes 20261106110000_instagram_programacion.sql)'::text;
  end if;
  if to_regclass('public.instagram_publicaciones_en_curso') is null then
    v_faltan := v_faltan || 'public.instagram_publicaciones_en_curso (aplica antes 20261107000000_instagram_publicacion_servidor.sql)'::text;
  end if;
  if to_regclass('public.instagram_piezas') is not null and not exists (
       select 1 from pg_attribute where attrelid = 'public.instagram_piezas'::regclass and attname = 'imagen_borrada_at' and not attisdropped) then
    v_faltan := v_faltan || 'instagram_piezas.imagen_borrada_at (aplica antes 20261107010000_instagram_limpieza_bucket.sql)'::text;
  end if;
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    v_faltan := v_faltan || 'storage.buckets / storage.objects'::text;
  end if;
  if to_regclass('cron.job') is null then
    v_faltan := v_faltan || 'pg_cron (cron.job)'::text;
  end if;
  if cardinality(v_faltan) > 0 then
    raise exception 'instagram_video: falta %. No se ha cambiado nada.', array_to_string(v_faltan, ', ');
  end if;
end;
$$;

-- ─── 1. instagram_piezas: reels ─────────────────────────────────────────────
alter table public.instagram_piezas add column if not exists tipo_medio text not null default 'imagen';
alter table public.instagram_piezas add column if not exists video_ruta text;
alter table public.instagram_piezas add column if not exists portada_ruta text;
alter table public.instagram_piezas add column if not exists duracion_s numeric(6, 2);
alter table public.instagram_piezas add column if not exists video_bytes bigint;
alter table public.instagram_piezas add column if not exists procesando_accion text;
alter table public.instagram_piezas add column if not exists procesando_desde timestamptz;

alter table public.instagram_piezas drop constraint if exists instagram_piezas_formato_chk;
alter table public.instagram_piezas add constraint instagram_piezas_formato_chk
  check (formato in ('post', 'story', 'reel'));
alter table public.instagram_piezas drop constraint if exists instagram_piezas_estado_chk;
alter table public.instagram_piezas add constraint instagram_piezas_estado_chk
  check (estado in ('borrador', 'generada', 'procesando', 'prueba_ok', 'publicada', 'error'));
alter table public.instagram_piezas drop constraint if exists instagram_piezas_tipo_medio_chk;
alter table public.instagram_piezas add constraint instagram_piezas_tipo_medio_chk
  check (tipo_medio in ('imagen', 'reel') and ((tipo_medio = 'reel') = (formato = 'reel')));
alter table public.instagram_piezas drop constraint if exists instagram_piezas_video_chk;
alter table public.instagram_piezas add constraint instagram_piezas_video_chk check (
  (video_ruta is null or (tipo_medio = 'reel'
     and video_ruta ~ '^reels/[0-9]{4}-[0-9]{2}/[0-9a-f-]{36}-[0-9a-f]{8}\.mp4$'))
  and (portada_ruta is null or (tipo_medio = 'reel'
     and portada_ruta ~ '^reels/[0-9]{4}-[0-9]{2}/[0-9a-f-]{36}-[0-9a-f]{8}\.jpg$'))
  and (duracion_s is null or duracion_s between 3 and 90)
  and (video_bytes is null or video_bytes between 1 and 52428800)
  and (procesando_accion is null or procesando_accion in ('prueba', 'publicar', 'programador'))
);

comment on column public.instagram_piezas.tipo_medio is
  '«imagen» (JPEG del render) o «reel» (MP4 del trabajador; datos = ReelPieza). Ver docs/instagram-video.md.';
comment on column public.instagram_piezas.video_ruta is
  'MP4 del reel en el cubo instagram-video (reels/AAAA-MM/<pieza>-<trabajo>.mp4). Solo lo escribe instagram_render_terminar.';
comment on column public.instagram_piezas.portada_ruta is 'Portada JPEG del reel (cover_url) en el cubo instagram-video.';
comment on column public.instagram_piezas.duracion_s is 'Duración del MP4 (segundos, de ffprobe/el trabajador).';
comment on column public.instagram_piezas.video_bytes is 'Peso del MP4 (bytes).';
comment on column public.instagram_piezas.procesando_accion is
  'Con estado «procesando»: qué hacer cuando Meta termine (prueba, publicar o programador = lo cierra su programación).';
comment on column public.instagram_piezas.procesando_desde is 'Desde cuándo está «procesando» (a las 24 h el contenedor caduca).';

create index if not exists instagram_piezas_procesando_idx
  on public.instagram_piezas (procesando_desde) where estado = 'procesando';

-- El panel no escribe el vídeo; si cambia el reel, el vídeo deja de valer.
create or replace function public.instagram_piezas_proteger_video()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      if new.video_ruta is not null or new.portada_ruta is not null or new.duracion_s is not null
         or new.video_bytes is not null or new.procesando_accion is not null or new.procesando_desde is not null then
        raise exception 'Solo el trabajador de render puede poner el vídeo de un reel' using errcode = '42501';
      end if;
    else
      if new.tipo_medio is distinct from old.tipo_medio then
        raise exception 'No se puede cambiar el tipo de una pieza (imagen / reel)' using errcode = '42501';
      end if;
      if new.video_ruta is distinct from old.video_ruta or new.portada_ruta is distinct from old.portada_ruta
         or new.duracion_s is distinct from old.duracion_s or new.video_bytes is distinct from old.video_bytes
         or new.procesando_accion is distinct from old.procesando_accion
         or new.procesando_desde is distinct from old.procesando_desde then
        raise exception 'Solo el servidor puede cambiar el vídeo de un reel (vídeo, portada, duración, procesando)'
          using errcode = '42501';
      end if;
      -- Reel cambiado a mano: el MP4 ya no corresponde.
      if old.tipo_medio = 'reel' and new.datos is distinct from old.datos and old.video_ruta is not null then
        new.video_ruta := null;
        new.portada_ruta := null;
        new.duracion_s := null;
        new.video_bytes := null;
        new.contenedor_id := null;
        new.estado := 'borrador';
      end if;
    end if;
  end if;
  -- Para todos: los datos de «procesando» solo existen en ese estado.
  if new.estado = 'procesando' then
    new.procesando_desde := coalesce(new.procesando_desde, now());
  else
    new.procesando_accion := null;
    new.procesando_desde := null;
  end if;
  return new;
end;
$$;
revoke all on function public.instagram_piezas_proteger_video() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.instagram_piezas_proteger_video() from anon, authenticated';
  end if;
end;
$$;
drop trigger if exists instagram_piezas_proteger_video on public.instagram_piezas;
create trigger instagram_piezas_proteger_video
  before insert or update on public.instagram_piezas
  for each row execute function public.instagram_piezas_proteger_video();

-- ─── 2. Cubo «instagram-video» ──────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('instagram-video', 'instagram-video', true, 52428800,
        array['video/mp4', 'image/jpeg', 'audio/mp4', 'audio/x-m4a', 'audio/mpeg', 'audio/aac', 'audio/wav', 'audio/x-wav'])
on conflict (id) do update
   set public             = excluded.public,
       file_size_limit    = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;

-- Prefijo ig_video_ (no instagram_): la comprobación final de
-- 20261105090000 exige que las políticas «instagram_%» sean del cubo «instagram».
drop policy if exists ig_video_objetos_select_seccion on storage.objects;
create policy ig_video_objetos_select_seccion on storage.objects
  for select to authenticated
  using ( bucket_id = 'instagram-video' and (select public.can_read_section('marketing')) );

drop policy if exists ig_video_objetos_insert_seccion on storage.objects;
create policy ig_video_objetos_insert_seccion on storage.objects
  for insert to authenticated
  with check ( bucket_id = 'instagram-video' and (select public.can_write_section('marketing')) );

drop policy if exists ig_video_objetos_update_seccion on storage.objects;
create policy ig_video_objetos_update_seccion on storage.objects
  for update to authenticated
  using      ( bucket_id = 'instagram-video' and (select public.can_write_section('marketing')) )
  with check ( bucket_id = 'instagram-video' and (select public.can_write_section('marketing')) );

drop policy if exists ig_video_objetos_delete_seccion on storage.objects;
create policy ig_video_objetos_delete_seccion on storage.objects
  for delete to authenticated
  using ( bucket_id = 'instagram-video' and (select public.can_write_section('marketing')) );

-- ─── 3. Cola de render ──────────────────────────────────────────────────────
create table if not exists public.instagram_trabajos_render (
  id             uuid primary key default gen_random_uuid(),
  pieza_id       uuid not null references public.instagram_piezas (id) on delete cascade,
  estado         text not null default 'pendiente',
  reel           jsonb not null,
  fotos          jsonb not null default '{}'::jsonb,
  audio_ruta     text,
  portada_s      numeric(6, 2),
  progreso       smallint not null default 0,
  fotogramas     integer,
  creado_por     uuid default auth.uid() references auth.users (id) on delete set null,
  procesado_por  uuid references auth.users (id) on delete set null,
  dispositivo    text,
  reclamado_en   timestamptz,
  latido_en      timestamptz,
  intentos       smallint not null default 0,
  error          text,
  avisos         jsonb not null default '[]'::jsonb,
  video_ruta     text,
  portada_ruta   text,
  duracion_s     numeric(6, 2),
  bytes          bigint,
  terminado_en   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint instagram_trabajos_render_estado_chk check (estado in ('pendiente', 'renderizando', 'listo', 'error', 'cancelado')),
  constraint instagram_trabajos_render_reel_chk check (jsonb_typeof(reel) = 'object' and pg_column_size(reel) <= 65536),
  constraint instagram_trabajos_render_fotos_chk check (jsonb_typeof(fotos) = 'object' and pg_column_size(fotos) <= 32768),
  constraint instagram_trabajos_render_avisos_chk check (jsonb_typeof(avisos) = 'array' and pg_column_size(avisos) <= 16384),
  constraint instagram_trabajos_render_audio_chk check (
    audio_ruta is null or audio_ruta ~ '^audio/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(m4a|mp3|aac|wav)$'),
  constraint instagram_trabajos_render_numeros_chk check (
    progreso between 0 and 100 and intentos between 0 and 10
    and (portada_s is null or portada_s between 0 and 90)
    and (fotogramas is null or fotogramas between 1 and 2700)
    and (duracion_s is null or duracion_s between 3 and 90)
    and (bytes is null or bytes between 1 and 52428800)),
  constraint instagram_trabajos_render_listo_chk check (estado <> 'listo' or (video_ruta is not null and bytes is not null)),
  constraint instagram_trabajos_render_textos_chk check (
    coalesce(char_length(dispositivo), 0) <= 200 and coalesce(char_length(error), 0) <= 2000
    and coalesce(char_length(video_ruta), 0) <= 200 and coalesce(char_length(portada_ruta), 0) <= 200)
);
comment on table public.instagram_trabajos_render is
  'Cola de render de reels a MP4 (trabajador Node con Playwright + ffmpeg). Escritura solo por RPC instagram_render_*. Ver docs/instagram-video.md.';
comment on column public.instagram_trabajos_render.reel is 'Copia del ReelPieza que se renderiza (lo que se vio en el panel al pulsar «Generar vídeo»).';
comment on column public.instagram_trabajos_render.fotos is 'id de foto («drive:…», «carta:…») → URL pública tmp/ del cubo instagram (preparada por el panel).';
comment on column public.instagram_trabajos_render.audio_ruta is 'Pista propia (con licencia) en el cubo instagram-video; null = pista de silencio AAC.';
comment on column public.instagram_trabajos_render.latido_en is 'Último progreso del trabajador: sin latido en 10 min, otro trabajador puede retomarlo.';

create unique index if not exists instagram_trabajos_render_vivo_uq
  on public.instagram_trabajos_render (pieza_id) where estado in ('pendiente', 'renderizando');
create index if not exists instagram_trabajos_render_vivos_idx
  on public.instagram_trabajos_render (created_at) where estado in ('pendiente', 'renderizando');
create index if not exists instagram_trabajos_render_pieza_idx
  on public.instagram_trabajos_render (pieza_id, created_at desc);

create or replace function public.instagram_trabajos_render_al_editar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.creado_por := old.creado_por;
    new.created_at := old.created_at;
    new.pieza_id := old.pieza_id;
    new.reel := old.reel;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.instagram_trabajos_render_al_editar() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.instagram_trabajos_render_al_editar() from anon, authenticated';
  end if;
end;
$$;
drop trigger if exists instagram_trabajos_render_al_editar on public.instagram_trabajos_render;
create trigger instagram_trabajos_render_al_editar
  before insert or update on public.instagram_trabajos_render
  for each row execute function public.instagram_trabajos_render_al_editar();

-- Auditoría (el mismo trigger que instala instalar_auditoria_panel()).
do $$
begin
  if to_regprocedure('public.fn_registrar_auditoria()') is not null
     and not exists (select 1 from pg_trigger
                      where tgrelid = 'public.instagram_trabajos_render'::regclass
                        and tgfoid = 'public.fn_registrar_auditoria()'::regprocedure
                        and not tgisinternal) then
    execute 'drop trigger if exists trg_auditoria on public.instagram_trabajos_render';
    execute 'create trigger trg_auditoria after insert or update or delete on public.instagram_trabajos_render
             for each row execute function public.fn_registrar_auditoria()';
  end if;
end;
$$;

alter table public.instagram_trabajos_render enable row level security;
revoke all on public.instagram_trabajos_render from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.instagram_trabajos_render from anon, authenticated';
    execute 'grant select on public.instagram_trabajos_render to authenticated';
    execute 'grant all on public.instagram_trabajos_render to service_role';
  end if;
end;
$$;

drop policy if exists instagram_trabajos_render_select_seccion on public.instagram_trabajos_render;
create policy instagram_trabajos_render_select_seccion on public.instagram_trabajos_render
  for select to authenticated using ((select public.can_read_section('marketing')));
drop policy if exists instagram_trabajos_render_service_role on public.instagram_trabajos_render;
create policy instagram_trabajos_render_service_role on public.instagram_trabajos_render
  for all to service_role using (true) with check (true);

do $$
begin
  if to_regprocedure('private.sesion_panel_permitida()') is not null then
    execute 'drop policy if exists "acceso_panel_no_bloqueado" on public.instagram_trabajos_render';
    execute 'create policy "acceso_panel_no_bloqueado" on public.instagram_trabajos_render as restrictive for all to authenticated
      using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()))';
  end if;
end;
$$;

-- ─── 4. RPC ─────────────────────────────────────────────────────────────────

-- Marketing con edición y sesión de panel viva (panel y trabajador).
create or replace function public.instagram_render_permiso()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not coalesce(public.can_write_section('marketing'), false) then
    raise exception 'Sin permiso de Marketing' using errcode = '42501';
  end if;
  if to_regprocedure('private.sesion_panel_permitida()') is not null then
    if not coalesce((select private.sesion_panel_permitida()), false) then
      raise exception 'Sesión de panel no válida' using errcode = '42501';
    end if;
  end if;
end;
$$;

-- Guarda el reel en su pieza (la crea si p_pieza_id es null) y lo encola.
-- Un trabajo pendiente anterior de la misma pieza se cancela (lo sustituye
-- este); uno que se está renderizando, no: hay que esperar o cancelarlo.
create or replace function public.instagram_render_encolar(
  p_pieza_id  uuid,
  p_marca     text,
  p_reel      jsonb,
  p_fotos     jsonb default '{}'::jsonb,
  p_caption   text default null,
  p_portada_s numeric default null,
  p_audio_ruta text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_pieza public.instagram_piezas;
  v_vivo public.instagram_trabajos_render;
  v_trabajo public.instagram_trabajos_render;
  v_base text := p_reel ->> 'base';
  v_mala text;
begin
  perform public.instagram_render_permiso();
  if p_marca is null or p_marca not in ('casa-tomas', 'touza') then
    raise exception 'Marca no válida: %', p_marca using errcode = '22023';
  end if;
  if p_reel is null or jsonb_typeof(p_reel) <> 'object' or coalesce(jsonb_typeof(p_reel -> 'escenas'), '') <> 'array'
     or coalesce(jsonb_typeof(p_reel -> 'cierre'), '') <> 'object' then
    raise exception 'El reel no tiene la forma esperada (escenas y cierre)' using errcode = '22023';
  end if;
  if pg_column_size(p_reel) > 65536 then
    raise exception 'El reel es demasiado grande' using errcode = '22023';
  end if;
  if p_reel ->> 'marca' is distinct from p_marca then
    raise exception 'La marca del reel no coincide con la de la pieza' using errcode = '22023';
  end if;
  if v_base is null or v_base !~ '^[a-z0-9][a-z0-9-]{0,79}$' then
    raise exception 'Base de reel no válida' using errcode = '22023';
  end if;
  if p_fotos is null or jsonb_typeof(p_fotos) <> 'object' then
    raise exception '«fotos» tiene que ser un objeto id → URL' using errcode = '22023';
  end if;
  select f.key into v_mala from jsonb_each(p_fotos) f
   where char_length(f.key) > 200 or jsonb_typeof(f.value) <> 'string'
      or char_length(f.value #>> '{}') > 1000 or (f.value #>> '{}') !~ '^https://[^[:space:]]+$'
   limit 1;
  if v_mala is not null then
    raise exception 'La foto «%» no tiene una URL https válida', left(v_mala, 60) using errcode = '22023';
  end if;
  if p_caption is not null and char_length(p_caption) > 2200 then
    raise exception 'El texto pasa de 2200 caracteres' using errcode = '22023';
  end if;
  if p_portada_s is not null and (p_portada_s < 0 or p_portada_s > 90) then
    raise exception 'El instante de la portada tiene que estar entre 0 y 90 s' using errcode = '22023';
  end if;
  if p_audio_ruta is not null and p_audio_ruta !~ '^audio/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(m4a|mp3|aac|wav)$' then
    raise exception 'Ruta de la pista de audio no válida' using errcode = '22023';
  end if;
  if (select count(*) from public.instagram_trabajos_render where estado = 'pendiente') >= 20 then
    raise exception 'Hay demasiados vídeos en cola; espera a que el equipo de render los termine' using errcode = '54000';
  end if;

  if p_pieza_id is null then
    insert into public.instagram_piezas (marca, plantilla, formato, tipo_medio, datos, caption, estado)
    values (p_marca, v_base, 'reel', 'reel', p_reel, p_caption, 'borrador')
    returning * into v_pieza;
  else
    select * into v_pieza from public.instagram_piezas where id = p_pieza_id for update;
    if not found then
      raise exception 'No existe esa pieza' using errcode = 'P0002';
    end if;
    if v_pieza.tipo_medio <> 'reel' then
      raise exception 'Esa pieza no es un reel' using errcode = '22023';
    end if;
    if v_pieza.media_id is not null or v_pieza.estado = 'publicada' then
      raise exception 'Ese reel ya está publicado: guárdalo como uno nuevo' using errcode = '22023';
    end if;
    if v_pieza.estado = 'procesando' then
      raise exception 'Instagram está procesando el vídeo de este reel; espera a que termine' using errcode = '55006';
    end if;
    if exists (select 1 from public.instagram_publicaciones_en_curso where pieza_id = v_pieza.id and bloqueada_hasta > now()) then
      raise exception 'Este reel se está probando o publicando ahora mismo' using errcode = '55006';
    end if;
    if exists (select 1 from public.instagram_programaciones where pieza_id = v_pieza.id and estado in ('programada', 'publicando')) then
      raise exception 'Este reel está programado: cancela la programación antes de volver a generar el vídeo' using errcode = '55006';
    end if;
    update public.instagram_piezas
       set marca = p_marca, plantilla = v_base, datos = p_reel, caption = coalesce(p_caption, caption),
           estado = 'borrador', video_ruta = null, portada_ruta = null, duracion_s = null, video_bytes = null,
           contenedor_id = null, error = null
     where id = v_pieza.id
    returning * into v_pieza;
  end if;

  select * into v_vivo from public.instagram_trabajos_render
   where pieza_id = v_pieza.id and estado in ('pendiente', 'renderizando') for update;
  if v_vivo.id is not null then
    if v_vivo.estado = 'renderizando' and v_vivo.latido_en > now() - interval '10 minutes' then
      raise exception 'Ya se está generando el vídeo de este reel: espera a que termine' using errcode = '55006';
    end if;
    update public.instagram_trabajos_render
       set estado = 'cancelado', error = 'Sustituido por un vídeo nuevo', terminado_en = now()
     where id = v_vivo.id;
  end if;

  insert into public.instagram_trabajos_render (pieza_id, reel, fotos, audio_ruta, portada_s, creado_por)
  values (v_pieza.id, p_reel, p_fotos, p_audio_ruta, p_portada_s, auth.uid())
  returning * into v_trabajo;
  return jsonb_build_object('ok', true, 'piezaId', v_pieza.id, 'trabajo', to_jsonb(v_trabajo));
end;
$$;

-- Cancela un trabajo pendiente (o uno con error / abandonado) desde el panel.
create or replace function public.instagram_render_cancelar(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.instagram_trabajos_render;
begin
  perform public.instagram_render_permiso();
  update public.instagram_trabajos_render
     set estado = 'cancelado', terminado_en = now()
   where id = p_id
     and (estado in ('pendiente', 'error')
          or (estado = 'renderizando' and coalesce(latido_en, reclamado_en) < now() - interval '10 minutes'))
  returning * into v;
  if v.id is null then
    if exists (select 1 from public.instagram_trabajos_render where id = p_id and estado = 'renderizando') then
      raise exception 'Se está generando ahora mismo; espera a que termine' using errcode = '55006';
    end if;
    raise exception 'No hay ningún vídeo pendiente con ese id' using errcode = 'P0002';
  end if;
  return jsonb_build_object('ok', true, 'trabajo', to_jsonb(v));
end;
$$;

-- Trabajador: reclama UN trabajo de forma atómica (el pendiente más antiguo,
-- o el indicado, o uno «renderizando» sin latido en 10 min). Un trabajo que
-- se ha abandonado 3 veces pasa a error en vez de reclamarse otra vez.
create or replace function public.instagram_render_reclamar(p_dispositivo text default null, p_id uuid default null)
returns setof public.instagram_trabajos_render
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform public.instagram_render_permiso();
  update public.instagram_trabajos_render t
     set estado = 'error',
         error = 'El equipo de render se cortó 3 veces con este vídeo. Revisa el reel (fotos, duración) y vuelve a generarlo.',
         terminado_en = now()
   where t.estado = 'renderizando'
     and coalesce(t.latido_en, t.reclamado_en) < now() - interval '10 minutes'
     and t.intentos >= 3;

  select t.id into v_id
    from public.instagram_trabajos_render t
   where (p_id is null or t.id = p_id)
     and (t.estado = 'pendiente'
          or (t.estado = 'renderizando' and coalesce(t.latido_en, t.reclamado_en) < now() - interval '10 minutes'))
   order by t.created_at
   limit 1
   for update skip locked;
  if v_id is null then
    return;
  end if;
  return query
    update public.instagram_trabajos_render t
       set estado = 'renderizando',
           procesado_por = auth.uid(),
           dispositivo = left(p_dispositivo, 200),
           reclamado_en = now(),
           latido_en = now(),
           intentos = least(10, t.intentos + 1),
           progreso = 0,
           error = null
     where t.id = v_id
    returning t.*;
end;
$$;

-- Trabajador: progreso (0-100) y latido. Solo quien lo reclamó.
create or replace function public.instagram_render_progreso(p_id uuid, p_progreso integer, p_fotogramas integer default null)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public.instagram_render_permiso();
  update public.instagram_trabajos_render t
     set progreso = greatest(0, least(100, coalesce(p_progreso, t.progreso))),
         fotogramas = coalesce(case when p_fotogramas between 1 and 2700 then p_fotogramas end, t.fotogramas),
         latido_en = now()
   where t.id = p_id and t.estado = 'renderizando' and t.procesado_por = auth.uid();
  return found;
end;
$$;

-- Trabajador: cierra el trabajo. Con p_ok, el MP4 y la portada tienen que
-- estar ya en el cubo con la ruta de esa pieza; la pieza pasa a «generada»
-- solo si su reel sigue siendo el renderizado.
create or replace function public.instagram_render_terminar(
  p_id           uuid,
  p_ok           boolean,
  p_error        text default null,
  p_video_ruta   text default null,
  p_portada_ruta text default null,
  p_duracion_s   numeric default null,
  p_bytes        bigint default null,
  p_avisos       jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.instagram_trabajos_render;
  v_prefijo text;
  v_pieza_al_dia boolean := false;
  v_avisos jsonb := case when jsonb_typeof(p_avisos) = 'array' then p_avisos else '[]'::jsonb end;
begin
  perform public.instagram_render_permiso();
  select * into v from public.instagram_trabajos_render
   where id = p_id and estado = 'renderizando' and procesado_por = auth.uid()
   for update;
  if not found then
    raise exception 'El trabajo no existe o no lo está generando este usuario' using errcode = 'P0002';
  end if;

  if not coalesce(p_ok, false) then
    update public.instagram_trabajos_render
       set estado = 'error', error = left(coalesce(nullif(btrim(p_error), ''), 'Error al generar el vídeo'), 2000),
           avisos = v_avisos, terminado_en = now()
     where id = v.id returning * into v;
    return jsonb_build_object('ok', true, 'trabajo', to_jsonb(v), 'piezaAlDia', false);
  end if;

  v_prefijo := '^reels/[0-9]{4}-[0-9]{2}/' || v.pieza_id::text || '-[0-9a-f]{8}\.';
  if p_video_ruta is null or p_video_ruta !~ (v_prefijo || 'mp4$') then
    raise exception 'Ruta del vídeo no válida para esta pieza' using errcode = '22023';
  end if;
  if p_portada_ruta is not null and p_portada_ruta !~ (v_prefijo || 'jpg$') then
    raise exception 'Ruta de la portada no válida para esta pieza' using errcode = '22023';
  end if;
  if p_duracion_s is null or p_duracion_s < 3 or p_duracion_s > 90 then
    raise exception 'Duración del vídeo fuera de 3-90 s: %', p_duracion_s using errcode = '22023';
  end if;
  if p_bytes is null or p_bytes < 1 or p_bytes > 52428800 then
    raise exception 'Peso del vídeo fuera de límites: %', p_bytes using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'instagram-video' and name = p_video_ruta) then
    raise exception 'El vídeo no está en el cubo instagram-video: súbelo antes de cerrar el trabajo' using errcode = '22023';
  end if;
  if p_portada_ruta is not null
     and not exists (select 1 from storage.objects where bucket_id = 'instagram-video' and name = p_portada_ruta) then
    raise exception 'La portada no está en el cubo instagram-video' using errcode = '22023';
  end if;

  update public.instagram_trabajos_render
     set estado = 'listo', progreso = 100, error = null, avisos = v_avisos,
         video_ruta = p_video_ruta, portada_ruta = p_portada_ruta, duracion_s = p_duracion_s, bytes = p_bytes,
         terminado_en = now(), latido_en = now()
   where id = v.id returning * into v;

  update public.instagram_piezas pz
     set video_ruta = p_video_ruta, portada_ruta = p_portada_ruta, duracion_s = p_duracion_s, video_bytes = p_bytes,
         estado = 'generada', contenedor_id = null, error = null
   where pz.id = v.pieza_id
     and pz.datos = v.reel
     and pz.media_id is null
     and pz.estado not in ('publicada', 'procesando');
  v_pieza_al_dia := found;
  return jsonb_build_object('ok', true, 'trabajo', to_jsonb(v), 'piezaAlDia', v_pieza_al_dia);
end;
$$;

-- Trabajador: devuelve a «pendiente» un trabajo suyo (al pararlo a mano).
create or replace function public.instagram_render_soltar(p_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public.instagram_render_permiso();
  update public.instagram_trabajos_render t
     set estado = 'pendiente', procesado_por = null, dispositivo = null, reclamado_en = null,
         latido_en = null, progreso = 0, intentos = greatest(0, t.intentos - 1)
   where t.id = p_id and t.estado = 'renderizando' and t.procesado_por = auth.uid();
  return found;
end;
$$;

revoke all on function public.instagram_render_permiso() from public;
revoke all on function public.instagram_render_encolar(uuid, text, jsonb, jsonb, text, numeric, text) from public;
revoke all on function public.instagram_render_cancelar(uuid) from public;
revoke all on function public.instagram_render_reclamar(text, uuid) from public;
revoke all on function public.instagram_render_progreso(uuid, integer, integer) from public;
revoke all on function public.instagram_render_terminar(uuid, boolean, text, text, text, numeric, bigint, jsonb) from public;
revoke all on function public.instagram_render_soltar(uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.instagram_render_permiso() from anon, authenticated';
    execute 'revoke all on function public.instagram_render_encolar(uuid, text, jsonb, jsonb, text, numeric, text) from anon';
    execute 'revoke all on function public.instagram_render_cancelar(uuid) from anon';
    execute 'revoke all on function public.instagram_render_reclamar(text, uuid) from anon';
    execute 'revoke all on function public.instagram_render_progreso(uuid, integer, integer) from anon';
    execute 'revoke all on function public.instagram_render_terminar(uuid, boolean, text, text, text, numeric, bigint, jsonb) from anon';
    execute 'revoke all on function public.instagram_render_soltar(uuid) from anon';
    execute 'grant execute on function public.instagram_render_encolar(uuid, text, jsonb, jsonb, text, numeric, text) to authenticated';
    execute 'grant execute on function public.instagram_render_cancelar(uuid) to authenticated';
    execute 'grant execute on function public.instagram_render_reclamar(text, uuid) to authenticated';
    execute 'grant execute on function public.instagram_render_progreso(uuid, integer, integer) to authenticated';
    execute 'grant execute on function public.instagram_render_terminar(uuid, boolean, text, text, text, numeric, bigint, jsonb) to authenticated';
    execute 'grant execute on function public.instagram_render_soltar(uuid) to authenticated';
  end if;
end;
$$;

-- ─── 5. Programar reels ─────────────────────────────────────────────────────
-- Igual que en 20261107010000 para las imágenes; un reel necesita su MP4 y no
-- estar «procesando».
create or replace function public.instagram_programacion_pieza(p_pieza_id uuid)
returns public.instagram_piezas
language plpgsql
volatile
set search_path = ''
as $$
declare
  v public.instagram_piezas;
begin
  select * into v from public.instagram_piezas where id = p_pieza_id for update;
  if not found then
    raise exception 'No existe esa pieza' using errcode = 'P0002';
  end if;
  if v.media_id is not null or v.estado = 'publicada' then
    raise exception 'Esa pieza ya está publicada' using errcode = '22023';
  end if;
  if v.tipo_medio = 'reel' then
    if v.video_ruta is null then
      raise exception 'El reel no tiene vídeo: pulsa «Generar vídeo» antes de programarlo' using errcode = '22023';
    end if;
    if v.estado = 'procesando' then
      raise exception 'Instagram está procesando el vídeo de este reel; espera a que termine para programarlo' using errcode = '22023';
    end if;
    return v;
  end if;
  if v.imagen_ruta is null then
    raise exception 'La pieza no tiene imagen: genérala antes de programarla' using errcode = '22023';
  end if;
  if v.imagen_borrada_at is not null then
    raise exception 'La imagen de esta pieza se borró por llevar días sin publicarse: vuelve a generarla antes de programarla' using errcode = '22023';
  end if;
  return v;
end;
$$;
revoke all on function public.instagram_programacion_pieza(uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.instagram_programacion_pieza(uuid) from anon, authenticated';
  end if;
end;
$$;

-- ─── 6. pg_cron: también cierra los reels «procesando» del panel ────────────
-- Mismo job y misma llamada que 20261106110000; solo se añade la condición.
select cron.unschedule('instagram-programador')
 where exists (select 1 from cron.job where jobname = 'instagram-programador');

select cron.schedule(
  'instagram-programador',
  '*/5 * * * *',
  $cron$
  select net.http_post(
    url := rtrim(u.decrypted_secret, '/') || '/functions/v1/instagram-programador',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', s.decrypted_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  )
  from vault.decrypted_secrets s
  cross join vault.decrypted_secrets u
  where s.name = 'instagram_programador_secret'
    and u.name = 'project_url'
    and (exists (
      select 1 from public.instagram_programaciones p
       where (p.estado = 'programada' and p.siguiente_intento_at <= now())
          or (p.estado = 'publicando' and p.bloqueada_hasta < now())
    ) or exists (
      select 1 from public.instagram_piezas pz
       where pz.estado = 'procesando' and pz.procesando_accion in ('prueba', 'publicar')
    ));
  $cron$
);

-- ─── 7. Comprobación final ──────────────────────────────────────────────────
do $$
declare
  v_malos text[] := '{}';
  v_malas text;
begin
  if not exists (select 1 from storage.buckets where id = 'instagram-video' and public and file_size_limit = 52428800) then
    v_malos := v_malos || 'el cubo instagram-video no es público de 50 MB'::text;
  end if;
  select string_agg(policyname, ', ') into v_malas
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and policyname like 'ig\_video\_%'
     and coalesce(qual, with_check) not like '%bucket_id = ''instagram-video''%';
  if v_malas is not null then
    v_malos := v_malos || format('políticas de storage sin acotar al cubo: %s', v_malas);
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.instagram_trabajos_render'::regclass) then
    v_malos := v_malos || 'RLS apagada en instagram_trabajos_render'::text;
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.instagram_piezas'::regclass
                  and tgname = 'instagram_piezas_proteger_video' and not tgisinternal) then
    v_malos := v_malos || 'falta el trigger instagram_piezas_proteger_video'::text;
  end if;
  if (select count(*) from cron.job where jobname = 'instagram-programador') <> 1 then
    v_malos := v_malos || 'el cron instagram-programador no quedó instalado una vez'::text;
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    if has_table_privilege('anon', 'public.instagram_trabajos_render', 'SELECT')
       or has_table_privilege('authenticated', 'public.instagram_trabajos_render', 'INSERT')
       or has_table_privilege('authenticated', 'public.instagram_trabajos_render', 'UPDATE')
       or has_table_privilege('authenticated', 'public.instagram_trabajos_render', 'DELETE')
       or has_table_privilege('authenticated', 'public.instagram_trabajos_render', 'TRUNCATE') then
      v_malos := v_malos || 'instagram_trabajos_render se puede escribir sin pasar por las RPC (o anon la lee)'::text;
    end if;
    if has_function_privilege('anon', 'public.instagram_render_encolar(uuid, text, jsonb, jsonb, text, numeric, text)', 'execute')
       or has_function_privilege('anon', 'public.instagram_render_reclamar(text, uuid)', 'execute')
       or has_function_privilege('authenticated', 'public.instagram_render_permiso()', 'execute') then
      v_malos := v_malos || 'RPC de render ejecutables por anon (o el permiso suelto)'::text;
    end if;
  end if;
  if cardinality(v_malos) > 0 then
    raise exception 'instagram_video: comprobación final fallida (%). No se ha aplicado nada.', array_to_string(v_malos, '; ');
  end if;
  raise notice 'instagram_video: aplicada';
end;
$$;

commit;

-- VERIFICACIÓN (solo lectura):
--   select 'instagram_video: aplicada' as resultado,
--          (select public from storage.buckets where id = 'instagram-video') as cubo_publico,
--          (select count(*) from public.instagram_trabajos_render where estado in ('pendiente', 'renderizando')) as en_cola;
