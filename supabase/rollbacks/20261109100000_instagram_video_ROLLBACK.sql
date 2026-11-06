set client_encoding = 'UTF8';
-- ===========================================================================
-- ROLLBACK de migrations/20261109100000_instagram_video.sql (A MANO).
-- ===========================================================================
-- BORRA DATOS: la cola instagram_trabajos_render, los REELS de
-- instagram_piezas (tipo_medio = 'reel': sin la columna no se distinguen de
-- las imágenes y su formato «reel» ya no cabría en la restricción) y las
-- columnas de vídeo. Los ficheros del cubo «instagram-video» NO se borran
-- (Storage no deja borrar objetos por SQL): bórralos desde el Dashboard
-- (Storage → instagram-video) o con la API antes de quitar el cubo, o deja el
-- cubo. Copia antes si hace falta:
--   create table public.zz_backup_instagram_reels as select * from public.instagram_piezas where tipo_medio = 'reel';
--
-- Deja instagram_programacion_pieza y el cron «instagram-programador» como
-- estaban tras 20261107010000 / 20261106110000.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

-- 1. Cron como en 20261106110000 (sin la condición de «procesando»).
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
    and exists (
      select 1 from public.instagram_programaciones p
       where (p.estado = 'programada' and p.siguiente_intento_at <= now())
          or (p.estado = 'publicando' and p.bloqueada_hasta < now())
    );
  $cron$
);

-- 2. instagram_programacion_pieza como en 20261107010000.
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

-- 3. RPC y cola.
drop function if exists public.instagram_render_soltar(uuid);
drop function if exists public.instagram_render_terminar(uuid, boolean, text, text, text, numeric, bigint, jsonb);
drop function if exists public.instagram_render_progreso(uuid, integer, integer);
drop function if exists public.instagram_render_reclamar(text, uuid);
drop function if exists public.instagram_render_cancelar(uuid);
drop function if exists public.instagram_render_encolar(uuid, text, jsonb, jsonb, text, numeric, text);
drop function if exists public.instagram_render_permiso();
drop table if exists public.instagram_trabajos_render;
drop function if exists public.instagram_trabajos_render_al_editar();

-- 4. Políticas del cubo (el cubo y sus ficheros se quedan; ver arriba).
drop policy if exists ig_video_objetos_select_seccion on storage.objects;
drop policy if exists ig_video_objetos_insert_seccion on storage.objects;
drop policy if exists ig_video_objetos_update_seccion on storage.objects;
drop policy if exists ig_video_objetos_delete_seccion on storage.objects;

-- 5. instagram_piezas: fuera los reels y las columnas de vídeo.
drop trigger if exists instagram_piezas_proteger_video on public.instagram_piezas;
drop function if exists public.instagram_piezas_proteger_video();
delete from public.instagram_piezas where tipo_medio = 'reel';
update public.instagram_piezas set estado = 'error', error = coalesce(error, 'Quedó «procesando» al deshacer los reels')
 where estado = 'procesando';
drop index if exists public.instagram_piezas_procesando_idx;
alter table public.instagram_piezas drop constraint if exists instagram_piezas_video_chk;
alter table public.instagram_piezas drop constraint if exists instagram_piezas_tipo_medio_chk;
alter table public.instagram_piezas drop constraint if exists instagram_piezas_estado_chk;
alter table public.instagram_piezas add constraint instagram_piezas_estado_chk
  check (estado in ('borrador', 'generada', 'prueba_ok', 'publicada', 'error'));
alter table public.instagram_piezas drop constraint if exists instagram_piezas_formato_chk;
alter table public.instagram_piezas add constraint instagram_piezas_formato_chk
  check (formato in ('post', 'story'));
alter table public.instagram_piezas drop column if exists procesando_desde;
alter table public.instagram_piezas drop column if exists procesando_accion;
alter table public.instagram_piezas drop column if exists video_bytes;
alter table public.instagram_piezas drop column if exists duracion_s;
alter table public.instagram_piezas drop column if exists portada_ruta;
alter table public.instagram_piezas drop column if exists video_ruta;
alter table public.instagram_piezas drop column if exists tipo_medio;

commit;

select 'instagram_video: deshecha (el cubo instagram-video y sus ficheros siguen ahí)' as resultado;
