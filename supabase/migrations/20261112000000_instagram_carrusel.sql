set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261112000000_instagram_carrusel — Carruseles (2–10 imágenes) en
-- instagram_piezas y programar con el texto en la misma llamada (05/11/2026)
-- ===========================================================================
-- El dueño sube varias fotos (p. ej. 6 de producto fresco), la IA monta el
-- carrusel (contrato «Montar con IA», src/lib/instagram/montar.ts) y el
-- render (api/instagram-render.ts) genera un JPEG 1080×1350 por imagen. Se
-- publica con la Content Publishing API: un contenedor hijo por imagen y un
-- contenedor CAROUSEL con todos (instagram-publicar). Ver
-- docs/instagram-carrusel.md.
--
-- POR QUÉ UNA COLUMNA JSON Y NO UNA TABLA HIJA
--   · Las diapositivas se leen y se escriben SIEMPRE juntas (el render las
--     genera todas en una llamada; publicar las manda todas) y son como mucho
--     10: no hay consultas por diapositiva.
--   · Todas las reglas de seguridad de instagram_piezas son POR FILA (RLS,
--     proteger_publicacion, proteger_video, proteger_programada, auditoría
--     trg_auditoria, imagen_borrada_at): con una columna, el carrusel queda
--     protegido por las mismas reglas sin duplicarlas en otra tabla.
--   · Es el patrón de las migraciones de Instagram: el JSON validado de la
--     pieza va en `datos` (jsonb) y el reel en `datos` y en
--     instagram_trabajos_render.reel/fotos (jsonb).
--   · El contenido de cada diapositiva lo valida un CHECK (forma, máximo 10,
--     rutas de SU pieza, alt_text ≤ 1000), así que el panel no puede colar
--     rutas de otra pieza para que se borren al publicar.
--
-- QUÉ CAMBIA
--   1. instagram_piezas:
--        tipo_medio  admite 'carrusel' (y tipo_medio = 'carrusel' ⇔ formato = 'carrusel')
--        formato     admite 'carrusel'
--        diapositivas jsonb: [{ foto, plantilla, datos, alt_text, imagen_ruta }]
--                    en el orden de publicación (la primera es la portada;
--                    imagen_ruta de la fila = la de la primera). Rutas
--                    piezas/AAAA-MM/<id de la pieza>-NN.jpg (NN = 01…10).
--        drive_ids   text[]: id en Drive de cada JPEG publicado (drive_id =
--                    el de la portada). Solo el servidor.
--      Trigger instagram_piezas_proteger_carrusel: el panel no escribe
--      drive_ids; una pieza programada o publicándose no cambia sus
--      diapositivas (salvo los textos alternativos).
--   2. instagram_objeto_bloqueado (de 20261111000000): también protege los
--      JPEG de las diapositivas de una pieza programada o publicándose.
--   3. instagram_piezas_reclamar_jpeg_caducados (limpieza diaria): devuelve
--      TODAS las imágenes de un carrusel (una fila por imagen, misma pieza).
--      Misma firma: instagram-programador no cambia.
--   4. instagram_programacion_pieza: un carrusel se programa si tiene sus
--      2–10 imágenes y no se han borrado.
--   5. instagram_programar acepta p_caption, p_alt_text y p_alt_texts (una
--      por diapositiva) en la propia llamada: ya no hace falta «Prueba sin
--      publicar» para que el programador tenga el texto.
--
-- APLICAR (una a una, nunca `db push`), DESPUÉS de 20261111000000_instagram_
-- seguridad: demo primero (sfonaclosuafvlhutkon), producción
-- (haqmmdfdzzatdnrrcgez) solo tras aceptar el PR y con el «sí» del dueño:
--   npx supabase db query --linked -f supabase/migrations/20261112000000_instagram_carrusel.sql
-- Idempotente. Tiene que terminar en «instagram_carrusel: aplicada».
-- Deshacer: supabase/rollbacks/20261112000000_instagram_carrusel_ROLLBACK.sql
-- Pruebas: npm run test:instagram-carrusel:db (PGlite).
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
  if to_regclass('public.instagram_piezas') is not null and not exists (
       select 1 from pg_attribute where attrelid = 'public.instagram_piezas'::regclass and attname = 'tipo_medio' and not attisdropped) then
    v_faltan := v_faltan || 'instagram_piezas.tipo_medio (aplica antes 20261109100000_instagram_video.sql)'::text;
  end if;
  if to_regprocedure('public.instagram_objeto_bloqueado(text, text)') is null then
    v_faltan := v_faltan || 'public.instagram_objeto_bloqueado (aplica antes 20261111000000_instagram_seguridad.sql)'::text;
  end if;
  if to_regprocedure('public.instagram_programacion_permiso()') is null then
    v_faltan := v_faltan || 'public.instagram_programacion_permiso (aplica antes 20261106110000_instagram_programacion.sql)'::text;
  end if;
  if to_regprocedure('public.instagram_piezas_reclamar_jpeg_caducados(integer, integer)') is null then
    v_faltan := v_faltan || 'public.instagram_piezas_reclamar_jpeg_caducados (aplica antes 20261107010000_instagram_limpieza_bucket.sql)'::text;
  end if;
  if cardinality(v_faltan) > 0 then
    raise exception 'instagram_carrusel: falta %. No se ha cambiado nada.', array_to_string(v_faltan, ', ');
  end if;
end;
$$;

-- ─── 1. instagram_piezas: carruseles ────────────────────────────────────────
alter table public.instagram_piezas add column if not exists diapositivas jsonb;
alter table public.instagram_piezas add column if not exists drive_ids text[];

-- Forma de las diapositivas. IMMUTABLE (solo mira sus argumentos): se usa en
-- un CHECK. La ruta de cada JPEG es la de SU pieza y SU posición.
create or replace function public.instagram_diapositivas_validas(p_id uuid, p_tipo_medio text, p_diapositivas jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_tipo_medio is distinct from 'carrusel' then p_diapositivas is null
    when p_diapositivas is null then true  -- carrusel aún sin generar
    else jsonb_typeof(p_diapositivas) = 'array'
     and jsonb_array_length(p_diapositivas) between 2 and 10
     and pg_column_size(p_diapositivas) <= 262144
     and not exists (
       select 1
         from jsonb_array_elements(p_diapositivas) with ordinality as e(v, i)
        where jsonb_typeof(e.v) is distinct from 'object'
           or jsonb_typeof(e.v -> 'datos') is distinct from 'object'
           or coalesce(e.v ->> 'plantilla', '') !~ '^[a-z0-9][a-z0-9-]{0,79}$'
           or (e.v ? 'foto' and jsonb_typeof(e.v -> 'foto') not in ('string', 'null'))
           or char_length(coalesce(e.v ->> 'foto', '')) > 200
           or (e.v ? 'alt_text' and jsonb_typeof(e.v -> 'alt_text') not in ('string', 'null'))
           or char_length(coalesce(e.v ->> 'alt_text', '')) > 1000
           or coalesce(e.v ->> 'imagen_ruta', '') !~ (
                '^piezas/[0-9]{4}-[0-9]{2}/' || p_id::text || '-' || lpad(e.i::text, 2, '0') || '\.jpg$'))
  end
$$;
comment on function public.instagram_diapositivas_validas(uuid, text, jsonb) is
  'CHECK de instagram_piezas.diapositivas: 2–10 objetos { foto, plantilla, datos, alt_text, imagen_ruta } con rutas piezas/AAAA-MM/<pieza>-NN.jpg. 20261112000000.';

alter table public.instagram_piezas drop constraint if exists instagram_piezas_formato_chk;
alter table public.instagram_piezas add constraint instagram_piezas_formato_chk
  check (formato in ('post', 'story', 'reel', 'carrusel'));
alter table public.instagram_piezas drop constraint if exists instagram_piezas_tipo_medio_chk;
alter table public.instagram_piezas add constraint instagram_piezas_tipo_medio_chk
  check (tipo_medio in ('imagen', 'reel', 'carrusel')
         and ((tipo_medio = 'reel') = (formato = 'reel'))
         and ((tipo_medio = 'carrusel') = (formato = 'carrusel')));
alter table public.instagram_piezas drop constraint if exists instagram_piezas_diapositivas_chk;
alter table public.instagram_piezas add constraint instagram_piezas_diapositivas_chk check (
  public.instagram_diapositivas_validas(id, tipo_medio, diapositivas)
  -- La imagen de la fila es la portada (primera diapositiva).
  and (diapositivas is null or imagen_ruta is null or imagen_ruta = diapositivas -> 0 ->> 'imagen_ruta')
);
alter table public.instagram_piezas drop constraint if exists instagram_piezas_drive_ids_chk;
alter table public.instagram_piezas add constraint instagram_piezas_drive_ids_chk check (
  drive_ids is null or (cardinality(drive_ids) between 1 and 10 and array_position(drive_ids, null) is null)
);

comment on column public.instagram_piezas.diapositivas is
  'Carrusel (tipo_medio = carrusel): [{ foto, plantilla, datos (DatosPieza validada), alt_text, imagen_ruta }] en orden de publicación; '
  'la primera es la portada e imagen_ruta de la fila es la suya. La escribe el render (api/instagram-render.ts). Ver docs/instagram-carrusel.md.';
comment on column public.instagram_piezas.drive_ids is
  'Carrusel publicado: id en Google Drive de cada JPEG (en orden). drive_id = el de la portada. Solo lo escribe el servidor.';

-- El panel no escribe drive_ids; una pieza programada o publicándose no cambia
-- sus imágenes (los textos alternativos sí: instagram_programar los guarda).
create or replace function public.instagram_piezas_proteger_carrusel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quitar_alt text := 'alt_text';
begin
  -- SECURITY DEFINER (para mirar el cerrojo, que es solo de service_role):
  -- aquí current_user es el dueño, así que el rol se mira en el JWT.
  if coalesce(auth.jwt() ->> 'role', '') in ('authenticated', 'anon') then
    if tg_op = 'INSERT' and new.drive_ids is not null then
      raise exception 'Solo el servidor puede anotar los ficheros de Drive de un carrusel' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and new.drive_ids is distinct from old.drive_ids then
      raise exception 'Solo el servidor puede anotar los ficheros de Drive de un carrusel' using errcode = '42501';
    end if;
  end if;
  -- Usuarios (también dentro de las RPC): como instagram_piezas_proteger_programada.
  if tg_op = 'UPDATE' and auth.uid() is not null
     and coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and old.diapositivas is not null
     and new.diapositivas is distinct from old.diapositivas
     and (new.diapositivas is null or old.diapositivas is null
          or jsonb_array_length(new.diapositivas) <> jsonb_array_length(old.diapositivas)
          or exists (select 1
                       from jsonb_array_elements(new.diapositivas) with ordinality n(v, i)
                       join jsonb_array_elements(old.diapositivas) with ordinality o(v, i) using (i)
                      where (n.v - v_quitar_alt) is distinct from (o.v - v_quitar_alt)))
     and (exists (select 1 from public.instagram_programaciones pr
                   where pr.pieza_id = old.id and pr.estado in ('programada', 'publicando'))
          or exists (select 1 from public.instagram_publicaciones_en_curso c
                      where c.pieza_id = old.id and c.bloqueada_hasta > now())) then
    raise exception 'Este carrusel tiene una publicación programada (o se está publicando): cancela la programación antes de cambiar sus imágenes'
      using errcode = '55006';
  end if;
  return new;
end;
$$;
revoke all on function public.instagram_piezas_proteger_carrusel() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.instagram_piezas_proteger_carrusel() from anon, authenticated';
  end if;
end;
$$;
drop trigger if exists instagram_piezas_proteger_carrusel on public.instagram_piezas;
create trigger instagram_piezas_proteger_carrusel
  before insert or update on public.instagram_piezas
  for each row execute function public.instagram_piezas_proteger_carrusel();

-- ─── 2. Ficheros bloqueados: también las diapositivas ──────────────────────
-- Igual que en 20261111000000 + las imágenes del carrusel. Las rutas de un
-- carrusel llevan el id de la pieza: se busca por id (clave primaria).
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
            or (p_bucket = 'instagram-video' and (pz.video_ruta = p_nombre or pz.portada_ruta = p_nombre))
            or (p_bucket = 'instagram'
                and pz.id = (substring(p_nombre from '^piezas/[0-9]{4}-[0-9]{2}/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-[0-9]{2}\.jpg$'))::uuid
                and pz.diapositivas is not null
                and exists (select 1 from jsonb_array_elements(pz.diapositivas) d where d ->> 'imagen_ruta' = p_nombre)))
       and (exists (select 1 from public.instagram_programaciones pr
                     where pr.pieza_id = pz.id and pr.estado in ('programada', 'publicando'))
            or exists (select 1 from public.instagram_publicaciones_en_curso c
                        where c.pieza_id = pz.id and c.bloqueada_hasta > now())))
$$;
comment on function public.instagram_objeto_bloqueado(text, text) is
  'true si el fichero es de una pieza programada o que se está publicando (imagen, vídeo, portada o diapositiva de un carrusel): no se puede sustituir ni borrar. 20261111000000 + 20261112000000.';

-- ─── 3. Limpieza diaria: todas las imágenes del carrusel ───────────────────
-- Misma firma y mismas reglas que 20261107010000; una fila por imagen.
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
  ), marcadas as (
    update public.instagram_piezas pz
       set imagen_borrada_at = now()
      from candidatas c
     where pz.id = c.id
    returning pz.id, pz.imagen_ruta, pz.diapositivas
  )
  select distinct m.id, r.ruta
    from marcadas m
    cross join lateral (
      select m.imagen_ruta as ruta
      union all
      select d ->> 'imagen_ruta' from jsonb_array_elements(coalesce(m.diapositivas, '[]'::jsonb)) d
    ) r
   where r.ruta is not null;
end;
$$;
revoke all on function public.instagram_piezas_reclamar_jpeg_caducados(integer, integer) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.instagram_piezas_reclamar_jpeg_caducados(integer, integer) from anon, authenticated';
    execute 'grant execute on function public.instagram_piezas_reclamar_jpeg_caducados(integer, integer) to service_role';
  end if;
end;
$$;

-- ─── 4. Programar carruseles ────────────────────────────────────────────────
-- Igual que en 20261109100000 + el carrusel (2–10 imágenes, no borradas).
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
  if v.tipo_medio = 'carrusel' and (v.diapositivas is null or jsonb_array_length(v.diapositivas) < 2) then
    raise exception 'El carrusel no tiene sus imágenes: genéralo antes de programarlo' using errcode = '22023';
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

-- ─── 5. instagram_programar con el texto en la misma llamada ───────────────
-- p_caption: texto de la publicación (≤ 2200; null = el guardado).
-- p_alt_text: texto alternativo de un post (≤ 1000; null = el guardado).
-- p_alt_texts: carrusel, uno por imagen en su orden (null = los guardados).
-- Las reglas de Instagram del texto (30 #, 20 @) las vuelve a comprobar
-- instagram-publicar al publicar; instagram-publicar con «programarPara» las
-- comprueba ANTES de llamar a esta RPC.
drop function if exists public.instagram_programar(uuid, timestamptz, boolean);
create or replace function public.instagram_programar(
  p_pieza_id uuid,
  p_para timestamptz,
  p_confirmar_conflicto boolean default false,
  p_caption text default null,
  p_alt_text text default null,
  p_alt_texts text[] default null
)
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
  v_diapositivas jsonb;
begin
  perform public.instagram_programacion_permiso();
  perform public.instagram_programacion_validar_fecha(p_para);
  v_pieza := public.instagram_programacion_pieza(p_pieza_id);

  -- Texto en la misma llamada.
  if p_caption is not null and char_length(p_caption) > 2200 then
    raise exception 'El texto pasa de 2200 caracteres' using errcode = '22023';
  end if;
  if p_alt_text is not null and char_length(p_alt_text) > 1000 then
    raise exception 'El texto alternativo pasa de 1000 caracteres' using errcode = '22023';
  end if;
  if p_alt_texts is not null then
    if v_pieza.tipo_medio is distinct from 'carrusel' then
      raise exception 'p_alt_texts es solo para carruseles (usa p_alt_text)' using errcode = '22023';
    end if;
    if cardinality(p_alt_texts) <> jsonb_array_length(v_pieza.diapositivas) then
      raise exception 'Hacen falta % textos alternativos (uno por imagen) y llegan %',
        jsonb_array_length(v_pieza.diapositivas), cardinality(p_alt_texts) using errcode = '22023';
    end if;
    if exists (select 1 from unnest(p_alt_texts) a where char_length(coalesce(a, '')) > 1000) then
      raise exception 'Algún texto alternativo pasa de 1000 caracteres' using errcode = '22023';
    end if;
    select jsonb_agg(case when nullif(btrim(coalesce(p_alt_texts[d.i::int], '')), '') is null
                          then d.v - 'alt_text'
                          else jsonb_set(d.v, '{alt_text}', to_jsonb(btrim(p_alt_texts[d.i::int]))) end
                     order by d.i)
      into v_diapositivas
      from jsonb_array_elements(v_pieza.diapositivas) with ordinality d(v, i);
  end if;
  if p_caption is not null or p_alt_text is not null or v_diapositivas is not null then
    update public.instagram_piezas
       set caption = coalesce(p_caption, caption),
           alt_text = case when p_alt_text is null then alt_text else nullif(btrim(p_alt_text), '') end,
           diapositivas = coalesce(v_diapositivas, diapositivas)
     where id = v_pieza.id;
  end if;

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
revoke all on function public.instagram_programar(uuid, timestamptz, boolean, text, text, text[]) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.instagram_programar(uuid, timestamptz, boolean, text, text, text[]) from anon';
    execute 'grant execute on function public.instagram_programar(uuid, timestamptz, boolean, text, text, text[]) to authenticated';
  end if;
end;
$$;

-- ─── 6. Comprobación final ──────────────────────────────────────────────────
do $$
declare
  v_malos text[] := '{}';
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.instagram_piezas'::regclass
                  and tgname = 'instagram_piezas_proteger_carrusel' and not tgisinternal) then
    v_malos := v_malos || 'falta el trigger instagram_piezas_proteger_carrusel'::text;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.instagram_piezas'::regclass
                  and conname = 'instagram_piezas_diapositivas_chk') then
    v_malos := v_malos || 'falta el CHECK de las diapositivas'::text;
  end if;
  if to_regprocedure('public.instagram_programar(uuid, timestamptz, boolean)') is not null then
    v_malos := v_malos || 'sigue la versión vieja de instagram_programar'::text;
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    if has_function_privilege('anon', 'public.instagram_programar(uuid, timestamptz, boolean, text, text, text[])', 'execute') then
      v_malos := v_malos || 'anon puede programar'::text;
    end if;
    if has_function_privilege('authenticated', 'public.instagram_piezas_reclamar_jpeg_caducados(integer, integer)', 'execute') then
      v_malos := v_malos || 'la RPC de limpieza es ejecutable fuera de service_role'::text;
    end if;
  end if;
  if cardinality(v_malos) > 0 then
    raise exception 'instagram_carrusel: comprobación final fallida (%). No se ha aplicado nada.', array_to_string(v_malos, '; ');
  end if;
  raise notice 'instagram_carrusel: aplicada';
end;
$$;

commit;

-- VERIFICACIÓN (solo lectura):
--   select id, tipo_medio, jsonb_array_length(diapositivas) imagenes, estado from public.instagram_piezas
--    where tipo_medio = 'carrusel' order by created_at desc limit 10;
