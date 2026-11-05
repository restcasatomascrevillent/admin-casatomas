set client_encoding = 'UTF8';
-- ===========================================================================
-- ROLLBACK de migrations/20261112000000_instagram_carrusel.sql (A MANO).
-- ===========================================================================
-- BORRA DATOS: los CARRUSELES de instagram_piezas (tipo_medio = 'carrusel':
-- su formato «carrusel» ya no cabría en la restricción) con sus
-- programaciones, y las columnas diapositivas y drive_ids. Los JPEG del cubo
-- «instagram» NO se borran (Storage no deja borrar objetos por SQL). Copia
-- antes si hace falta:
--   create table public.zz_backup_instagram_carruseles as select * from public.instagram_piezas where tipo_medio = 'carrusel';
--
-- Deja instagram_objeto_bloqueado como en 20261111000000,
-- instagram_piezas_reclamar_jpeg_caducados como en 20261107010000,
-- instagram_programacion_pieza como en 20261109100000 e instagram_programar
-- como en 20261106110000 (3 argumentos). Deshacer ANTES que 20261111000000.
-- Idempotente.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

-- 1. Trigger y restricciones del carrusel.
drop trigger if exists instagram_piezas_proteger_carrusel on public.instagram_piezas;
drop function if exists public.instagram_piezas_proteger_carrusel();
alter table public.instagram_piezas drop constraint if exists instagram_piezas_diapositivas_chk;
alter table public.instagram_piezas drop constraint if exists instagram_piezas_drive_ids_chk;
drop function if exists public.instagram_diapositivas_validas(uuid, text, jsonb);

-- 2. Datos de carruseles (con sus programaciones).
do $$
begin
  if exists (select 1 from pg_attribute where attrelid = 'public.instagram_piezas'::regclass and attname = 'tipo_medio' and not attisdropped) then
    -- Sin triggers de usuario: la limpieza también quita carruseles programados o publicados.
    execute 'alter table public.instagram_piezas disable trigger user';
    if to_regclass('public.instagram_programaciones') is not null then
      execute 'delete from public.instagram_programaciones where pieza_id in (select id from public.instagram_piezas where tipo_medio = ''carrusel'')';
    end if;
    execute 'delete from public.instagram_piezas where tipo_medio = ''carrusel''';
    execute 'alter table public.instagram_piezas enable trigger user';
  end if;
end;
$$;
alter table public.instagram_piezas drop column if exists diapositivas;
alter table public.instagram_piezas drop column if exists drive_ids;

alter table public.instagram_piezas drop constraint if exists instagram_piezas_formato_chk;
alter table public.instagram_piezas add constraint instagram_piezas_formato_chk
  check (formato in ('post', 'story', 'reel'));
alter table public.instagram_piezas drop constraint if exists instagram_piezas_tipo_medio_chk;
alter table public.instagram_piezas add constraint instagram_piezas_tipo_medio_chk
  check (tipo_medio in ('imagen', 'reel') and ((tipo_medio = 'reel') = (formato = 'reel')));

-- 3. instagram_objeto_bloqueado como en 20261111000000.
create or replace function public.instagram_objeto_bloqueado(p_bucket text, p_nombre text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.instagram_piezas pz
     where pz.media_id is null
       and ((p_bucket = 'instagram' and pz.imagen_ruta = p_nombre)
            or (p_bucket = 'instagram-video' and (pz.video_ruta = p_nombre or pz.portada_ruta = p_nombre)))
       and (exists (select 1 from public.instagram_programaciones pr
                     where pr.pieza_id = pz.id and pr.estado in ('programada', 'publicando'))
            or exists (select 1 from public.instagram_publicaciones_en_curso c
                        where c.pieza_id = pz.id and c.bloqueada_hasta > now())))
$$;
comment on function public.instagram_objeto_bloqueado(text, text) is
  'true si el fichero es de una pieza programada o que se está publicando: no se puede sustituir ni borrar. 20261111000000.';

-- 4. Limpieza como en 20261107010000.
create or replace function public.instagram_piezas_reclamar_jpeg_caducados(p_dias integer default 7, p_limite integer default 100)
returns table (id uuid, imagen_ruta text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return query
  with candidatas as (
    select pz.id
      from public.instagram_piezas pz
     where pz.imagen_ruta is not null
       and pz.imagen_borrada_at is null
       and pz.estado <> 'publicada'
       and pz.media_id is null
       and pz.updated_at < now() - make_interval(days => greatest(1, least(coalesce(p_dias, 7), 365)))
       and not exists (select 1 from public.instagram_programaciones p
                        where p.pieza_id = pz.id and p.estado in ('programada', 'publicando'))
       and not exists (select 1 from public.instagram_publicaciones_en_curso e
                        where e.pieza_id = pz.id and e.bloqueada_hasta > now())
     order by pz.updated_at
     limit greatest(1, least(coalesce(p_limite, 100), 500))
     for update of pz skip locked
  )
  update public.instagram_piezas pz
     set imagen_borrada_at = now()
    from candidatas c
   where pz.id = c.id
  returning pz.id, pz.imagen_ruta;
end;
$$;
revoke all on function public.instagram_piezas_reclamar_jpeg_caducados(integer, integer) from public;

-- 5. instagram_programacion_pieza como en 20261109100000.
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

-- 6. instagram_programar como en 20261106110000 (3 argumentos).
drop function if exists public.instagram_programar(uuid, timestamptz, boolean, text, text, text[]);
create or replace function public.instagram_programar(p_pieza_id uuid, p_para timestamptz, p_confirmar_conflicto boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_pieza public.instagram_piezas;
  v_activa public.instagram_programaciones;
  v_conflictos jsonb;
  v_fila public.instagram_programaciones;
begin
  perform public.instagram_programacion_permiso();
  perform public.instagram_programacion_validar_fecha(p_para);
  v_pieza := public.instagram_programacion_pieza(p_pieza_id);
  select * into v_activa from public.instagram_programaciones
   where pieza_id = p_pieza_id and estado in ('programada', 'publicando') for update;
  if v_activa.id is not null then
    return public.instagram_reprogramar(v_activa.id, p_para, p_confirmar_conflicto);
  end if;
  v_conflictos := public.instagram_programacion_conflictos(v_pieza.marca, p_para, v_pieza.id);
  if jsonb_array_length(v_conflictos) > 0 and not coalesce(p_confirmar_conflicto, false) then
    return jsonb_build_object('ok', false, 'requiereConfirmacion', true, 'conflictos', v_conflictos);
  end if;
  insert into public.instagram_programaciones (pieza_id, marca, programada_para, siguiente_intento_at, creado_por)
  values (v_pieza.id, v_pieza.marca, p_para, p_para, auth.uid())
  returning * into v_fila;
  return jsonb_build_object('ok', true, 'accion', 'programada', 'programacion', to_jsonb(v_fila), 'conflictos', v_conflictos);
end;
$$;
revoke all on function public.instagram_programar(uuid, timestamptz, boolean) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.instagram_piezas_reclamar_jpeg_caducados(integer, integer) from anon, authenticated';
    execute 'grant execute on function public.instagram_piezas_reclamar_jpeg_caducados(integer, integer) to service_role';
    execute 'revoke all on function public.instagram_programacion_pieza(uuid) from anon, authenticated';
    execute 'revoke all on function public.instagram_programar(uuid, timestamptz, boolean) from anon';
    execute 'grant execute on function public.instagram_programar(uuid, timestamptz, boolean) to authenticated';
  end if;
end;
$$;

commit;

do $$ begin raise notice 'instagram_carrusel: deshecha'; end $$;
