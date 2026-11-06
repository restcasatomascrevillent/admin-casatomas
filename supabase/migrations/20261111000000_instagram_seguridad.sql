set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261111000000_instagram_seguridad — Bloque A de la evaluación de seguridad
-- de la sección Instagram (05/11/2026). Ver docs/instagram.md, «Seguridad
-- (bloque A)», y instagram-studio/propuesta/evaluacion/seguridad.md.
-- ===========================================================================
-- QUÉ CAMBIA (sin tocar ninguna migración ya aplicada):
--
--   A2  «Editar» para escribir en Instagram. Hasta hoy toda la sección usaba
--       can_write_section('marketing'), que mira «Ver» (a propósito, para todo
--       el panel; NO se toca aquí). Ahora:
--         · toda política de ESCRITURA de las tablas instagram_* y
--           marketing_fechas y de los cubos «instagram» e «instagram-video»
--           pasa a can_edit_section (20261001170000);
--         · las RPC de permiso (instagram_programacion_permiso,
--           instagram_campanas_permiso, instagram_render_permiso) y
--           instagram_encargo_lado (restaurante Y agencia) exigen «Editar»;
--         · LEER sigue con can_read_section («Ver»).
--       Las Edge Functions y /api/instagram-render comprueban lo mismo
--       (can_edit_section) en el mismo despliegue.
--   A5  Cubo «instagram-video»: columna instagram_piezas.video_borrado_at y
--       RPC instagram_video_reclamar_caducados (service_role) para la
--       limpieza diaria: MP4 y portadas sin pieza viva (regenerados,
--       sustituidos, piezas borradas, subidas a medias) y los de piezas
--       publicadas hace más de N días (30 por defecto). Al terminar un render,
--       instagram_render_terminar devuelve «anteriores» (los MP4/portadas
--       viejos de esa pieza que ya no usa nadie) y el trabajador los borra.
--   A6  Sección propia del trabajador de render: «instagram_render». Con
--       «Editar» en ella (y nada más) puede reclamar, marcar progreso, soltar
--       y terminar SUS trabajos, leer la cola y subir/borrar SOLO los ficheros
--       de los trabajos que tiene reclamados. Ya no necesita Marketing.
--   A7  Agencia: sube solo a encargos SUYOS (modo «oficiosos») en estado
--       aceptado, en curso o con cambios pedidos, con la ruta del encargo, como
--       mucho 20 ficheros y 100 MB (imágenes) / 400 MB (vídeo) por encargo. Lee
--       solo ficheros de encargos enviados, nunca los reels del restaurante.
--   A8  · Cupo de IA atómico (tabla instagram_ia_cupo + RPC
--         instagram_ia_reservar_cupo): cuenta ANTES de llamar a OpenAI, así
--         que cuenta también los fallos, y admite un tope global diario.
--       · Una pieza con publicación programada (o que se está publicando) no
--         cambia de marca, formato, datos, imagen ni vídeo; una publicada (o que
--         se está publicando) no se borra; y el fichero de una pieza programada
--         no se puede sustituir ni borrar en los cubos.
--       · instagram_encargo_eventos.notificado_at: el push de un evento se
--         manda una sola vez (notificar-video).
--
-- APLICAR (una a una, nunca `db push`), DESPUÉS de todas las de Instagram
-- (20261105090000 … 20261110100000) y de 20261001170000 (can_edit_section):
-- demo primero (sfonaclosuafvlhutkon); producción (haqmmdfdzzatdnrrcgez) solo
-- tras aceptar el PR y con el «sí» del dueño:
--   npx supabase db query --linked -f supabase/migrations/20261111000000_instagram_seguridad.sql
-- Idempotente. Tiene que terminar en «instagram_seguridad: aplicada».
-- ANTES de aplicarla en producción: dar «Editar» en Marketing a quien publica,
-- «Editar» en Instagram · Agencia a la agencia y crear el usuario del
-- trabajador de render con «Editar» en «Instagram · Render» (docs/instagram-video.md).
-- Deshacer: supabase/rollbacks/20261111000000_instagram_seguridad_ROLLBACK.sql
-- Pruebas: npm run test:instagram-seguridad:db (PGlite).
-- ===========================================================================

begin;
set local lock_timeout = '5s';

-- ─── 0. Comprobaciones previas (no cambian nada) ────────────────────────────
do $$
declare
  v_faltan text[] := '{}';
begin
  if to_regprocedure('public.can_edit_section(text)') is null then
    v_faltan := v_faltan || 'public.can_edit_section(text) (aplica antes 20261001170000_rls_reservas_exige_edicion.sql)'::text;
  end if;
  if to_regprocedure('public.can_read_section(text)') is null then
    v_faltan := v_faltan || 'public.can_read_section(text)'::text;
  end if;
  if to_regclass('public.instagram_encargos') is null then
    v_faltan := v_faltan || 'public.instagram_encargos (aplica antes 20261110100000_instagram_encargos.sql)'::text;
  end if;
  if to_regclass('public.instagram_trabajos_render') is null then
    v_faltan := v_faltan || 'public.instagram_trabajos_render (aplica antes 20261109100000_instagram_video.sql)'::text;
  end if;
  if to_regclass('public.instagram_publicaciones_en_curso') is null then
    v_faltan := v_faltan || 'public.instagram_publicaciones_en_curso (aplica antes 20261107000000_instagram_publicacion_servidor.sql)'::text;
  end if;
  if to_regclass('storage.objects') is null then
    v_faltan := v_faltan || 'storage.objects'::text;
  end if;
  if cardinality(v_faltan) > 0 then
    raise exception 'instagram_seguridad: falta %. No se ha cambiado nada.', array_to_string(v_faltan, ', ');
  end if;
end;
$$;

-- ─── 1. A2: escribir exige «Editar» (tablas) ────────────────────────────────
-- Todas las políticas de las tablas de Instagram (y marketing_fechas, que es
-- de las campañas de Instagram) que escriben con can_write_section pasan a
-- can_edit_section. Se cambia SOLO la función: mismas políticas, mismos
-- roles, mismas condiciones (ALTER POLICY sobre la expresión guardada).
do $$
declare
  r record;
  v_sql text;
begin
  for r in
    select schemaname, tablename, policyname, qual, with_check
      from pg_policies
     where schemaname = 'public'
       and (tablename like 'instagram\_%' or tablename = 'marketing_fechas')
       and (coalesce(qual, '') like '%can_write_section%' or coalesce(with_check, '') like '%can_write_section%')
  loop
    v_sql := format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    if r.qual is not null then
      v_sql := v_sql || ' using (' || replace(r.qual, 'can_write_section', 'can_edit_section') || ')';
    end if;
    if r.with_check is not null then
      v_sql := v_sql || ' with check (' || replace(r.with_check, 'can_write_section', 'can_edit_section') || ')';
    end if;
    execute v_sql;
  end loop;
end;
$$;

-- ─── 2. Ficheros de una pieza programada: no se sustituyen ni se borran ─────
-- true si el fichero es la imagen, el vídeo o la portada de una pieza sin
-- publicar con una programación activa o con el cerrojo de publicación.
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

-- ─── 3. A2: cubos «instagram» e «instagram-video» del restaurante ───────────
drop policy if exists instagram_objetos_insert_seccion on storage.objects;
create policy instagram_objetos_insert_seccion on storage.objects
  for insert to authenticated
  with check ( bucket_id = 'instagram' and (select public.can_edit_section('marketing')) );

drop policy if exists instagram_objetos_update_seccion on storage.objects;
create policy instagram_objetos_update_seccion on storage.objects
  for update to authenticated
  using      ( bucket_id = 'instagram' and (select public.can_edit_section('marketing'))
               and not public.instagram_objeto_bloqueado(bucket_id, name) )
  with check ( bucket_id = 'instagram' and (select public.can_edit_section('marketing')) );

drop policy if exists instagram_objetos_delete_seccion on storage.objects;
create policy instagram_objetos_delete_seccion on storage.objects
  for delete to authenticated
  using ( bucket_id = 'instagram' and (select public.can_edit_section('marketing'))
          and not public.instagram_objeto_bloqueado(bucket_id, name) );

drop policy if exists ig_video_objetos_insert_seccion on storage.objects;
create policy ig_video_objetos_insert_seccion on storage.objects
  for insert to authenticated
  with check ( bucket_id = 'instagram-video' and (select public.can_edit_section('marketing')) );

drop policy if exists ig_video_objetos_update_seccion on storage.objects;
create policy ig_video_objetos_update_seccion on storage.objects
  for update to authenticated
  using      ( bucket_id = 'instagram-video' and (select public.can_edit_section('marketing'))
               and not public.instagram_objeto_bloqueado(bucket_id, name) )
  with check ( bucket_id = 'instagram-video' and (select public.can_edit_section('marketing')) );

drop policy if exists ig_video_objetos_delete_seccion on storage.objects;
create policy ig_video_objetos_delete_seccion on storage.objects
  for delete to authenticated
  using ( bucket_id = 'instagram-video' and (select public.can_edit_section('marketing'))
          and not public.instagram_objeto_bloqueado(bucket_id, name) );

-- ─── 4. A2: RPC de permiso del panel ────────────────────────────────────────
create or replace function public.instagram_programacion_permiso()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not coalesce(public.can_edit_section('marketing'), false) then
    raise exception 'Sin permiso para editar Marketing (hace falta «Editar», no solo «Ver»)' using errcode = '42501';
  end if;
  if to_regprocedure('private.sesion_panel_permitida()') is not null then
    if not coalesce((select private.sesion_panel_permitida()), false) then
      raise exception 'Sesión de panel no válida' using errcode = '42501';
    end if;
  end if;
end;
$$;

create or replace function public.instagram_campanas_permiso()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not coalesce(public.can_edit_section('marketing'), false) then
    raise exception 'Sin permiso para editar Marketing (hace falta «Editar», no solo «Ver»)' using errcode = '42501';
  end if;
  if to_regprocedure('private.sesion_panel_permitida()') is not null then
    if not coalesce((select private.sesion_panel_permitida()), false) then
      raise exception 'Sesión de panel no válida' using errcode = '42501';
    end if;
  end if;
end;
$$;

-- Panel (encolar y cancelar vídeos): Marketing con «Editar».
create or replace function public.instagram_render_permiso()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not coalesce(public.can_edit_section('marketing'), false) then
    raise exception 'Sin permiso para editar Marketing (hace falta «Editar», no solo «Ver»)' using errcode = '42501';
  end if;
  if to_regprocedure('private.sesion_panel_permitida()') is not null then
    if not coalesce((select private.sesion_panel_permitida()), false) then
      raise exception 'Sesión de panel no válida' using errcode = '42501';
    end if;
  end if;
end;
$$;

-- Encargos: restaurante = «Editar» en Marketing; agencia = «Editar» en
-- Instagram · Agencia. Leer los encargos sigue con «Ver» (RLS).
create or replace function public.instagram_encargo_lado(p_lado text, p_preferido text default null)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_r boolean;
  v_a boolean;
begin
  if auth.uid() is null then
    raise exception 'Sin sesión' using errcode = '42501';
  end if;
  if to_regprocedure('private.sesion_panel_permitida()') is not null then
    if not coalesce((select private.sesion_panel_permitida()), false) then
      raise exception 'Sesión de panel no válida' using errcode = '42501';
    end if;
  end if;
  v_r := coalesce(public.can_edit_section('marketing'), false);
  v_a := coalesce(public.can_edit_section('instagram_agencia'), false);
  if p_lado = 'restaurante' then
    if not v_r then raise exception 'Solo el restaurante (permiso «Editar» en Marketing) puede hacer esto' using errcode = '42501'; end if;
    return 'restaurante';
  elsif p_lado = 'agencia' then
    if not v_a then raise exception 'Solo la agencia (permiso «Editar» en Instagram · Agencia) puede hacer esto' using errcode = '42501'; end if;
    return 'agencia';
  end if;
  if v_r and v_a then
    return case when p_preferido = 'agencia' then 'agencia' else 'restaurante' end;
  elsif v_r then
    return 'restaurante';
  elsif v_a then
    return 'agencia';
  end if;
  raise exception 'Sin permiso para los encargos de Instagram (hace falta «Editar»)' using errcode = '42501';
end;
$$;

-- ─── 5. A5: vídeos que ya no usa nadie ──────────────────────────────────────
alter table public.instagram_piezas add column if not exists video_borrado_at timestamptz;
comment on column public.instagram_piezas.video_borrado_at is
  'Cuándo borró la limpieza diaria el MP4 y la portada del cubo instagram-video (pieza publicada hace más de N días). video_ruta se conserva. 20261111000000.';

-- true si ninguna pieza ni ninguna entrega de encargo usa ese fichero del cubo de vídeo.
create or replace function public.instagram_video_objeto_huerfano(p_nombre text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from public.instagram_piezas pz
                      where pz.video_ruta = p_nombre or pz.portada_ruta = p_nombre)
     and not exists (select 1 from public.instagram_encargo_entregas e
                      where e.cubo = 'instagram-video' and (e.ruta = p_nombre or e.portada_ruta = p_nombre))
$$;

-- Limpieza diaria (instagram-programador, acción «limpiar»; solo service_role).
-- Devuelve las rutas que hay que borrar por la API de Storage:
--   «publicada»: MP4 y portada de reels publicados hace más de p_dias días
--                (se marca video_borrado_at; video_ruta se conserva);
--   «huerfano»:  ficheros reels/ que no usa ninguna pieza ni entrega y tienen
--                más de p_gracia_horas (un render o una subida a medias no se
--                toca hasta entonces).
create or replace function public.instagram_video_reclamar_caducados(
  p_dias integer default 30,
  p_gracia_horas integer default 24,
  p_limite integer default 200
)
returns table (ruta text, motivo text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_limite integer := greatest(1, least(coalesce(p_limite, 200), 1000));
begin
  return query
  with candidatas as (
    select pz.id
      from public.instagram_piezas pz
     where pz.video_borrado_at is null
       and (pz.video_ruta is not null or pz.portada_ruta is not null)
       and pz.media_id is not null
       and pz.estado = 'publicada'
       and coalesce(pz.publicada_at, pz.updated_at) < now() - make_interval(days => greatest(1, least(coalesce(p_dias, 30), 3650)))
     order by coalesce(pz.publicada_at, pz.updated_at)
     limit v_limite
     for update of pz skip locked
  ), marcadas as (
    update public.instagram_piezas pz
       set video_borrado_at = now()
      from candidatas c
     where pz.id = c.id
    returning pz.video_ruta, pz.portada_ruta
  )
  select x.r, 'publicada'::text
    from marcadas m, lateral (values (m.video_ruta), (m.portada_ruta)) as x (r)
   where x.r is not null and x.r like 'reels/%';

  return query
  select o.name::text, 'huerfano'::text
    from storage.objects o
   where o.bucket_id = 'instagram-video'
     and o.name like 'reels/%'
     and o.created_at < now() - make_interval(hours => greatest(1, least(coalesce(p_gracia_horas, 24), 24 * 30)))
     and public.instagram_video_objeto_huerfano(o.name)
   order by o.created_at
   limit v_limite;
end;
$$;

-- ─── 6. A6: trabajador de render con sección propia ─────────────────────────
create or replace function public.instagram_render_permiso_trabajador()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not coalesce(public.can_edit_section('instagram_render'), false) then
    raise exception 'Sin permiso de trabajador de render (hace falta «Editar» en Instagram · Render)' using errcode = '42501';
  end if;
  if to_regprocedure('private.sesion_panel_permitida()') is not null then
    if not coalesce((select private.sesion_panel_permitida()), false) then
      raise exception 'Sesión de panel no válida' using errcode = '42501';
    end if;
  end if;
end;
$$;

-- Ficheros que puede subir: los de un trabajo que tiene reclamado
-- (reels/AAAA-MM/<pieza>-<8 primeros hex del trabajo>.mp4|.jpg).
create or replace function public.instagram_render_puede_subir(p_nombre text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.instagram_trabajos_render t
     where t.estado = 'renderizando'
       and t.procesado_por = auth.uid()
       and p_nombre ~ ('^reels/[0-9]{4}-[0-9]{2}/' || t.pieza_id::text || '-'
                       || left(replace(t.id::text, '-', ''), 8) || '\.(mp4|jpg)$'))
$$;

-- Leer: lo que puede subir y la pista de audio de sus trabajos reclamados.
create or replace function public.instagram_render_puede_leer(p_nombre text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.instagram_render_puede_subir(p_nombre)
      or (auth.uid() is not null and exists (
            select 1 from public.instagram_trabajos_render t
             where t.estado = 'renderizando' and t.procesado_por = auth.uid() and t.audio_ruta = p_nombre))
$$;

-- Borrar: solo vídeos viejos de piezas que ha renderizado él y que ya no usa nadie.
create or replace function public.instagram_render_puede_borrar(p_nombre text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and p_nombre ~ '^reels/[0-9]{4}-[0-9]{2}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9a-f]{8}\.(mp4|jpg)$'
     and exists (select 1 from public.instagram_trabajos_render t
                  where t.procesado_por = auth.uid()
                    and t.pieza_id::text = substring(p_nombre from '^reels/[0-9]{4}-[0-9]{2}/([0-9a-f-]{36})-'))
     and public.instagram_video_objeto_huerfano(p_nombre)
$$;

drop policy if exists ig_render_video_select on storage.objects;
create policy ig_render_video_select on storage.objects
  for select to authenticated
  using ( bucket_id = 'instagram-video' and (select public.can_edit_section('instagram_render'))
          and (public.instagram_render_puede_leer(name) or public.instagram_render_puede_borrar(name)) );
drop policy if exists ig_render_video_insert on storage.objects;
create policy ig_render_video_insert on storage.objects
  for insert to authenticated
  with check ( bucket_id = 'instagram-video' and (select public.can_edit_section('instagram_render'))
               and public.instagram_render_puede_subir(name) );
drop policy if exists ig_render_video_update on storage.objects;
create policy ig_render_video_update on storage.objects
  for update to authenticated
  using      ( bucket_id = 'instagram-video' and (select public.can_edit_section('instagram_render'))
               and public.instagram_render_puede_subir(name) )
  with check ( bucket_id = 'instagram-video' and (select public.can_edit_section('instagram_render'))
               and public.instagram_render_puede_subir(name) );
drop policy if exists ig_render_video_delete on storage.objects;
create policy ig_render_video_delete on storage.objects
  for delete to authenticated
  using ( bucket_id = 'instagram-video' and (select public.can_edit_section('instagram_render'))
          and public.instagram_render_puede_borrar(name) );

-- La cola (pendientes y en curso), para «--comprobar» del trabajador.
drop policy if exists instagram_trabajos_render_select_trabajador on public.instagram_trabajos_render;
create policy instagram_trabajos_render_select_trabajador on public.instagram_trabajos_render
  for select to authenticated
  using ( (select public.can_edit_section('instagram_render')) and estado in ('pendiente', 'renderizando') );

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
  perform public.instagram_render_permiso_trabajador();
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

create or replace function public.instagram_render_progreso(p_id uuid, p_progreso integer, p_fotogramas integer default null)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public.instagram_render_permiso_trabajador();
  update public.instagram_trabajos_render t
     set progreso = greatest(0, least(100, coalesce(p_progreso, t.progreso))),
         fotogramas = coalesce(case when p_fotogramas between 1 and 2700 then p_fotogramas end, t.fotogramas),
         latido_en = now()
   where t.id = p_id and t.estado = 'renderizando' and t.procesado_por = auth.uid();
  return found;
end;
$$;

-- Como antes, y además: no toca una pieza programada (se publicaría otro
-- vídeo del que se programó) y devuelve «anteriores», los MP4 y portadas
-- viejos de la pieza que ya no usa nadie, para que el trabajador los borre.
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
  v_anteriores jsonb := '[]'::jsonb;
  v_avisos jsonb := case when jsonb_typeof(p_avisos) = 'array' then p_avisos else '[]'::jsonb end;
begin
  perform public.instagram_render_permiso_trabajador();
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
    return jsonb_build_object('ok', true, 'trabajo', to_jsonb(v), 'piezaAlDia', false, 'anteriores', '[]'::jsonb);
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
         estado = 'generada', contenedor_id = null, error = null, video_borrado_at = null
   where pz.id = v.pieza_id
     and pz.datos = v.reel
     and pz.media_id is null
     and pz.estado not in ('publicada', 'procesando')
     and not exists (select 1 from public.instagram_programaciones pr
                      where pr.pieza_id = pz.id and pr.estado in ('programada', 'publicando'))
     and not exists (select 1 from public.instagram_publicaciones_en_curso c
                      where c.pieza_id = pz.id and c.bloqueada_hasta > now());
  v_pieza_al_dia := found;

  select coalesce(jsonb_agg(x.name order by x.name), '[]'::jsonb) into v_anteriores
    from (select o.name
            from storage.objects o
           where o.bucket_id = 'instagram-video'
             and o.name ~ ('^reels/[0-9]{4}-[0-9]{2}/' || v.pieza_id::text || '-[0-9a-f]{8}\.(mp4|jpg)$')
             and o.name <> p_video_ruta
             and o.name is distinct from p_portada_ruta
             and public.instagram_video_objeto_huerfano(o.name)
           limit 20) x;
  return jsonb_build_object('ok', true, 'trabajo', to_jsonb(v), 'piezaAlDia', v_pieza_al_dia, 'anteriores', v_anteriores);
end;
$$;

create or replace function public.instagram_render_soltar(p_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public.instagram_render_permiso_trabajador();
  update public.instagram_trabajos_render t
     set estado = 'pendiente', procesado_por = null, dispositivo = null, reclamado_en = null,
         latido_en = null, progreso = 0, intentos = greatest(0, t.intentos - 1)
   where t.id = p_id and t.estado = 'renderizando' and t.procesado_por = auth.uid();
  return found;
end;
$$;

-- ─── 7. A7: subidas y lecturas de la agencia, atadas a sus encargos ─────────
-- Encargo (uuid) de una ruta de entrega de la agencia, o null si la ruta no
-- tiene la forma de una entrega:
--   instagram        encargos/<encargo>/v<N>-<8 hex>.jpg
--   instagram-video  reels/AAAA-MM/<encargo>-<8 hex>.mp4|.jpg
create or replace function public.instagram_encargo_de_ruta(p_bucket text, p_nombre text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when p_bucket = 'instagram'
         and p_nombre ~ '^encargos/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/v[0-9]{1,3}-[0-9a-f]{8}\.jpg$'
      then substring(p_nombre from '^encargos/([0-9a-f-]{36})/')::uuid
    when p_bucket = 'instagram-video'
         and p_nombre ~ '^reels/[0-9]{4}-[0-9]{2}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9a-f]{8}\.(mp4|jpg)$'
      then substring(p_nombre from '^reels/[0-9]{4}-[0-9]{2}/([0-9a-f-]{36})-')::uuid
  end
$$;

-- Límites de lo que la agencia sube por encargo y cubo.
create or replace function public.instagram_encargo_limites_subida(p_bucket text)
returns table (max_ficheros integer, max_bytes bigint)
language sql
immutable
set search_path = ''
as $$
  select 20, case when p_bucket = 'instagram-video' then 400::bigint * 1024 * 1024 else 100::bigint * 1024 * 1024 end
$$;

-- ¿Puede la agencia subir ese fichero? Encargo «oficiosos» suyo en un estado
-- en el que se trabaja (aceptado, en curso o con cambios pedidos), el cubo de
-- su formato y sin pasar de los límites de número y peso por encargo.
create or replace function public.instagram_agencia_puede_subir(p_bucket text, p_nombre text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid := public.instagram_encargo_de_ruta(p_bucket, p_nombre);
  v public.instagram_encargos;
  v_lim record;
  v_n integer;
  v_bytes bigint;
  v_patron text;
begin
  if v_id is null or auth.uid() is null then
    return false;
  end if;
  select * into v from public.instagram_encargos where id = v_id;
  if not found or v.modo <> 'oficiosos' or v.estado not in ('aceptado', 'en_curso', 'cambios_pedidos') then
    return false;
  end if;
  if (v.formato = 'reel') <> (p_bucket = 'instagram-video') then
    return false;
  end if;
  select * into v_lim from public.instagram_encargo_limites_subida(p_bucket);
  v_patron := case when p_bucket = 'instagram' then 'encargos/' || v_id::text || '/%'
                   else 'reels/%/' || v_id::text || '-%' end;
  select count(*), coalesce(sum(case when (o.metadata ->> 'size') ~ '^[0-9]+$' then (o.metadata ->> 'size')::bigint else 0 end), 0)
    into v_n, v_bytes
    from storage.objects o
   where o.bucket_id = p_bucket and o.name like v_patron and o.name <> p_nombre;
  return v_n < v_lim.max_ficheros and v_bytes < v_lim.max_bytes;
end;
$$;

-- ¿Puede la agencia leer ese fichero? Solo entregas de encargos «oficiosos»
-- ya enviados (nunca los borradores ni los reels del restaurante).
create or replace function public.instagram_agencia_puede_leer(p_bucket text, p_nombre text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.instagram_encargos e
     where e.id = public.instagram_encargo_de_ruta(p_bucket, p_nombre)
       and e.modo = 'oficiosos' and e.estado <> 'borrador')
$$;

drop policy if exists ig_encargos_jpeg_insert on storage.objects;
create policy ig_encargos_jpeg_insert on storage.objects
  for insert to authenticated
  with check ( bucket_id = 'instagram' and name like 'encargos/%'
               and (select public.can_edit_section('instagram_agencia'))
               and public.instagram_agencia_puede_subir(bucket_id, name) );
drop policy if exists ig_encargos_jpeg_select on storage.objects;
create policy ig_encargos_jpeg_select on storage.objects
  for select to authenticated
  using ( bucket_id = 'instagram' and name like 'encargos/%'
          and (select public.can_read_section('instagram_agencia'))
          and public.instagram_agencia_puede_leer(bucket_id, name) );
drop policy if exists ig_encargos_video_insert on storage.objects;
create policy ig_encargos_video_insert on storage.objects
  for insert to authenticated
  with check ( bucket_id = 'instagram-video' and name like 'reels/%'
               and (select public.can_edit_section('instagram_agencia'))
               and public.instagram_agencia_puede_subir(bucket_id, name) );
drop policy if exists ig_encargos_video_select on storage.objects;
create policy ig_encargos_video_select on storage.objects
  for select to authenticated
  using ( bucket_id = 'instagram-video' and name like 'reels/%'
          and (select public.can_read_section('instagram_agencia'))
          and public.instagram_agencia_puede_leer(bucket_id, name) );

-- ─── 8. A8: cupo de IA atómico ──────────────────────────────────────────────
-- Una fila por usuario y día (Europe/Madrid); usuario 00000000-… = total del
-- día. Solo la RPC escribe. Se cuenta ANTES de llamar a OpenAI: un fallo
-- también gasta cupo.
create table if not exists public.instagram_ia_cupo (
  usuario  uuid not null,
  dia      date not null,
  usadas   integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (usuario, dia),
  constraint instagram_ia_cupo_usadas_chk check (usadas between 0 and 100000)
);
comment on table public.instagram_ia_cupo is
  'Cupo diario de la IA de Instagram por usuario (y total con usuario 00000000-0000-0000-0000-000000000000). Solo lo escribe instagram_ia_reservar_cupo. 20261111000000.';
alter table public.instagram_ia_cupo enable row level security;
revoke all on public.instagram_ia_cupo from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.instagram_ia_cupo from anon, authenticated';
    execute 'grant all on public.instagram_ia_cupo to service_role';
  end if;
end;
$$;
drop policy if exists instagram_ia_cupo_service_role on public.instagram_ia_cupo;
create policy instagram_ia_cupo_service_role on public.instagram_ia_cupo
  for all to service_role using (true) with check (true);

create or replace function public.instagram_ia_reservar_cupo(p_cupo integer, p_cupo_global integer default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_dia date := (now() at time zone 'Europe/Madrid')::date;
  v_total constant uuid := '00000000-0000-0000-0000-000000000000';
  v_mias integer;
  v_todas integer;
begin
  if auth.uid() is null or not coalesce(public.can_edit_section('marketing'), false) then
    raise exception 'Sin permiso para editar Marketing (hace falta «Editar», no solo «Ver»)' using errcode = '42501';
  end if;
  if to_regprocedure('private.sesion_panel_permitida()') is not null then
    if not coalesce((select private.sesion_panel_permitida()), false) then
      raise exception 'Sesión de panel no válida' using errcode = '42501';
    end if;
  end if;
  if p_cupo is null or p_cupo < 1 then
    raise exception 'Cupo no válido' using errcode = '22023';
  end if;
  -- Un cerrojo para todo el cupo del día: dos peticiones a la vez no se cuelan.
  perform pg_advisory_xact_lock(hashtext('instagram_ia_cupo'));
  select coalesce((select usadas from public.instagram_ia_cupo where usuario = auth.uid() and dia = v_dia), 0) into v_mias;
  select coalesce((select usadas from public.instagram_ia_cupo where usuario = v_total and dia = v_dia), 0) into v_todas;
  if v_mias >= p_cupo then
    return jsonb_build_object('ok', false, 'motivo', 'usuario', 'usadas', v_mias, 'cupo', p_cupo);
  end if;
  if p_cupo_global is not null and p_cupo_global > 0 and v_todas >= p_cupo_global then
    return jsonb_build_object('ok', false, 'motivo', 'global', 'usadas', v_todas, 'cupo', p_cupo_global);
  end if;
  insert into public.instagram_ia_cupo as c (usuario, dia, usadas) values (auth.uid(), v_dia, 1)
  on conflict (usuario, dia) do update set usadas = c.usadas + 1, updated_at = now();
  insert into public.instagram_ia_cupo as c (usuario, dia, usadas) values (v_total, v_dia, 1)
  on conflict (usuario, dia) do update set usadas = c.usadas + 1, updated_at = now();
  return jsonb_build_object('ok', true, 'usadas', v_mias + 1, 'cupo', p_cupo, 'usadasTotal', v_todas + 1);
end;
$$;

-- ─── 9. A8: pieza programada, publicada o publicándose ──────────────────────
-- Solo para usuarios (auth.uid() con valor, también dentro de las RPC). El
-- servidor (service_role: instagram-publicar, el programador, la limpieza)
-- no pasa por aquí.
create or replace function public.instagram_piezas_proteger_programada()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := coalesce(new.id, old.id);
  v_programada boolean;
  v_en_curso boolean;
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;
  v_programada := exists (select 1 from public.instagram_programaciones pr
                           where pr.pieza_id = v_id and pr.estado in ('programada', 'publicando'));
  v_en_curso := exists (select 1 from public.instagram_publicaciones_en_curso c
                         where c.pieza_id = v_id and c.bloqueada_hasta > now())
             or exists (select 1 from public.instagram_programaciones pr
                         where pr.pieza_id = v_id and pr.estado = 'publicando');
  if tg_op = 'DELETE' then
    if old.media_id is not null or old.estado = 'publicada' then
      raise exception 'Esa pieza ya está publicada en Instagram: no se puede borrar del panel' using errcode = '42501';
    end if;
    if v_en_curso then
      raise exception 'Esa pieza se está publicando ahora mismo: espera a que termine' using errcode = '55006';
    end if;
    return old;
  end if;
  if (v_programada or v_en_curso)
     and (new.marca is distinct from old.marca
          or new.formato is distinct from old.formato
          or new.tipo_medio is distinct from old.tipo_medio
          or new.datos is distinct from old.datos
          or new.imagen_ruta is distinct from old.imagen_ruta
          or new.video_ruta is distinct from old.video_ruta
          or new.portada_ruta is distinct from old.portada_ruta) then
    raise exception 'Esta pieza tiene una publicación programada (o se está publicando): cancela la programación antes de cambiar la marca, el formato o la imagen'
      using errcode = '55006';
  end if;
  return new;
end;
$$;
drop trigger if exists instagram_piezas_proteger_programada on public.instagram_piezas;
create trigger instagram_piezas_proteger_programada
  before update or delete on public.instagram_piezas
  for each row execute function public.instagram_piezas_proteger_programada();

-- ─── 10. A8: el push de un evento de encargo, una sola vez ──────────────────
alter table public.instagram_encargo_eventos add column if not exists notificado_at timestamptz;
comment on column public.instagram_encargo_eventos.notificado_at is
  'Cuándo mandó notificar-video el Web Push de este evento (se marca con UPDATE … WHERE notificado_at IS NULL: solo la primera llamada avisa). 20261111000000.';

-- ─── 11. Permisos de ejecución ──────────────────────────────────────────────
do $$
declare
  v_f text;
begin
  foreach v_f in array array[
    'public.instagram_objeto_bloqueado(text, text)',
    'public.instagram_video_objeto_huerfano(text)',
    'public.instagram_video_reclamar_caducados(integer, integer, integer)',
    'public.instagram_render_permiso_trabajador()',
    'public.instagram_render_puede_subir(text)',
    'public.instagram_render_puede_leer(text)',
    'public.instagram_render_puede_borrar(text)',
    'public.instagram_encargo_de_ruta(text, text)',
    'public.instagram_encargo_limites_subida(text)',
    'public.instagram_agencia_puede_subir(text, text)',
    'public.instagram_agencia_puede_leer(text, text)',
    'public.instagram_ia_reservar_cupo(integer, integer)',
    'public.instagram_piezas_proteger_programada()',
    'public.instagram_programacion_permiso()', 'public.instagram_campanas_permiso()',
    'public.instagram_render_permiso()', 'public.instagram_encargo_lado(text, text)',
    'public.instagram_render_reclamar(text, uuid)', 'public.instagram_render_progreso(uuid, integer, integer)',
    'public.instagram_render_terminar(uuid, boolean, text, text, text, numeric, bigint, jsonb)',
    'public.instagram_render_soltar(uuid)'] loop
    execute format('revoke all on function %s from public', v_f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon, authenticated', v_f);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    -- Las que usan las políticas (las evalúa el rol que consulta).
    foreach v_f in array array[
      'public.instagram_objeto_bloqueado(text, text)',
      'public.instagram_render_puede_subir(text)',
      'public.instagram_render_puede_leer(text)',
      'public.instagram_render_puede_borrar(text)',
      'public.instagram_agencia_puede_subir(text, text)',
      'public.instagram_agencia_puede_leer(text, text)',
      'public.instagram_video_objeto_huerfano(text)',
      'public.instagram_encargo_de_ruta(text, text)',
      -- RPC del panel y del trabajador.
      'public.instagram_ia_reservar_cupo(integer, integer)',
      'public.instagram_render_reclamar(text, uuid)', 'public.instagram_render_progreso(uuid, integer, integer)',
      'public.instagram_render_terminar(uuid, boolean, text, text, text, numeric, bigint, jsonb)',
      'public.instagram_render_soltar(uuid)'] loop
      execute format('grant execute on function %s to authenticated, service_role', v_f);
    end loop;
    execute 'grant execute on function public.instagram_video_reclamar_caducados(integer, integer, integer) to service_role';
  end if;
end;
$$;

-- ─── 12. Comprobación final ─────────────────────────────────────────────────
do $$
declare
  v_malos text[] := '{}';
  v_malas text;
begin
  -- A2: ninguna política de Instagram escribe ya con can_write_section.
  select string_agg(format('%s.%s', tablename, policyname), ', ') into v_malas
    from pg_policies
   where ((schemaname = 'public' and (tablename like 'instagram\_%' or tablename = 'marketing_fechas'))
          or (schemaname = 'storage' and tablename = 'objects'
              and (policyname like 'instagram\_%' or policyname like 'ig\_%')))
     and (coalesce(qual, '') like '%can_write_section%' or coalesce(with_check, '') like '%can_write_section%');
  if v_malas is not null then
    v_malos := v_malos || format('políticas que siguen con can_write_section: %s', v_malas);
  end if;
  select string_agg(p.proname, ', ') into v_malas
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'instagram\_%'
     and p.prosrc like '%can_write_section%';
  if v_malas is not null then
    v_malos := v_malos || format('funciones que siguen con can_write_section: %s', v_malas);
  end if;
  -- Todas las políticas de storage de Instagram, acotadas a su cubo.
  select string_agg(policyname, ', ') into v_malas
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and policyname like 'ig\_render\_%'
     and coalesce(qual, with_check) not like '%bucket_id = ''instagram-video''%';
  if v_malas is not null then
    v_malos := v_malos || format('políticas de storage sin acotar al cubo: %s', v_malas);
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.instagram_ia_cupo'::regclass) then
    v_malos := v_malos || 'RLS apagada en instagram_ia_cupo'::text;
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.instagram_piezas'::regclass
                  and tgname = 'instagram_piezas_proteger_programada' and not tgisinternal) then
    v_malos := v_malos || 'falta el trigger instagram_piezas_proteger_programada'::text;
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    if has_table_privilege('authenticated', 'public.instagram_ia_cupo', 'INSERT')
       or has_table_privilege('authenticated', 'public.instagram_ia_cupo', 'UPDATE')
       or has_table_privilege('anon', 'public.instagram_ia_cupo', 'SELECT') then
      v_malos := v_malos || 'instagram_ia_cupo se puede escribir sin la RPC'::text;
    end if;
    if has_function_privilege('authenticated', 'public.instagram_video_reclamar_caducados(integer, integer, integer)', 'execute')
       or has_function_privilege('anon', 'public.instagram_ia_reservar_cupo(integer, integer)', 'execute')
       or has_function_privilege('authenticated', 'public.instagram_render_permiso_trabajador()', 'execute') then
      v_malos := v_malos || 'RPC de limpieza, cupo o permiso ejecutables por quien no debe'::text;
    end if;
  end if;
  if cardinality(v_malos) > 0 then
    raise exception 'instagram_seguridad: comprobación final fallida (%). No se ha aplicado nada.', array_to_string(v_malos, '; ');
  end if;
  raise notice 'instagram_seguridad: aplicada';
end;
$$;

commit;

-- VERIFICACIÓN (solo lectura):
--   select tablename, policyname, cmd from pg_policies
--    where (tablename like 'instagram%' or policyname like 'ig\_%') and (qual like '%can_edit_section%' or with_check like '%can_edit_section%')
--    order by 1, 2;
--   select user_id, section_key, can_view, can_edit from public.user_permissions
--    where section_key in ('marketing', 'instagram_agencia', 'instagram_render') order by 2, 1;
