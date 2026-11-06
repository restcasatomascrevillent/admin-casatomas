set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261110000000_instagram_aprender — Métricas para aprender (fase 3, 10/11/2026)
-- ===========================================================================
-- Diseño: instagram-studio/propuesta/PROPUESTA.md, fila «3» del apartado 7 y
-- puntos 5.6.8 y 6.5. Documentación: docs/instagram-metricas.md («Qué funciona»).
--
-- QUÉ CAMBIA
--   1. public.instagram_metricas_publicacion, columnas nuevas (las rellena la
--      Edge Function instagram-metricas en cada captura):
--        hashtags         text[]     hashtags del texto, en minúsculas y sin repetir
--        publicado_local  timestamp  hora LOCAL de Madrid de la publicación
--        tiempo_medio_ms  integer    reels: ig_reels_avg_watch_time
--        tiempo_total_ms  bigint     reels: ig_reels_video_view_total_time
--        tasa_salto       numeric    reels: reels_skip_rate (% que la salta en 3 s)
--      y el texto (caption) pasa de 300 a 2200 caracteres (el máximo de
--      Instagram), para no perder los hashtags. Las filas que ya había se
--      completan: hora local desde publicado_at y hashtags de lo que quedaba
--      del texto.
--      La vista instagram_metricas_publicacion_ultima se rehace para que
--      lleve las columnas nuevas (sigue con security_invoker).
--   2. RPC public.instagram_que_funciona(marca, ig_user_id, dias, minimo):
--      «Qué funciona» de los últimos `dias` (90) por formato (post, story o
--      reel), plantilla, tipo de foto, día de la semana, franja de 2 horas
--      (hora de Madrid) y hashtag. Por grupo: publicaciones, alcance medio,
--      tasa de interacción (Σ interacciones / Σ alcance) y guardados por
--      alcance. Con MUESTRA MÍNIMA: un grupo cuenta si tiene al menos
--      `minimo` (3) publicaciones, y no se saca ninguna conclusión con menos
--      de 2 × `minimo` publicaciones en total; entonces devuelve un aviso de
--      «faltan datos». Una conclusión «mejor» solo sale si el mejor grupo
--      supera en un 10 % la media; si no, «no hay diferencias claras».
--      Devuelve también las 5 mejores y las 5 peores publicaciones (gancho,
--      formato, plantilla, fecha, alcance y tasa). Lo leen el panel (pestaña
--      Métricas) y la IA (instagram-ia: proponer_campana, ideas_semana y
--      sugerir_texto). SECURITY INVOKER: manda la RLS del usuario
--      (can_read_section('marketing') + sesión de panel viva). anon nada.
--
--   Solo cuentan publicaciones con alcance (> 0). Formato: el de Meta
--   (REELS → reel, STORY → story, FEED → post); plantilla y tipo de foto,
--   solo las que salieron del panel (instagram_piezas). Con «marca», las
--   piezas de la otra marca no cuentan (las publicaciones de fuera del panel
--   sí, si son de la cuenta pedida).
--
-- APLICAR (una a una, nunca `db push`): demo primero (sfonaclosuafvlhutkon),
-- producción (haqmmdfdzzatdnrrcgez) solo tras aceptar el PR y con el «sí» del
-- dueño. Necesita antes 20261106100000_instagram_metricas.sql. ANTES de
-- desplegar la versión nueva de instagram-metricas (que escribe las columnas
-- nuevas; si la migración falta, guarda sin ellas y avisa).
--   npx supabase db query --linked -f supabase/migrations/20261110000000_instagram_aprender.sql
-- Idempotente. Tiene que terminar en «instagram_aprender: aplicada».
-- Deshacer: supabase/rollbacks/20261110000000_instagram_aprender_ROLLBACK.sql
-- Pruebas: npm run test:instagram-aprender:db (PGlite).
-- ===========================================================================

begin;
set local lock_timeout = '5s';

-- ─── 0. Comprobaciones previas (no cambian nada) ────────────────────────────
do $$
declare
  v_faltan text[] := '{}';
begin
  if to_regprocedure('public.can_read_section(text)') is null then
    v_faltan := v_faltan || 'public.can_read_section(text)'::text;
  end if;
  if to_regclass('public.instagram_piezas') is null then
    v_faltan := v_faltan || 'public.instagram_piezas (aplica antes 20261105090000_instagram.sql)'::text;
  end if;
  if to_regclass('public.instagram_metricas_publicacion') is null then
    v_faltan := v_faltan || 'public.instagram_metricas_publicacion (aplica antes 20261106100000_instagram_metricas.sql)'::text;
  end if;
  if cardinality(v_faltan) > 0 then
    raise exception 'instagram_aprender: falta %. No se ha cambiado nada.', array_to_string(v_faltan, ', ');
  end if;
end;
$$;

-- ─── 1. Columnas nuevas de las publicaciones ────────────────────────────────
alter table public.instagram_metricas_publicacion
  add column if not exists hashtags        text[] not null default '{}',
  add column if not exists publicado_local timestamp,
  add column if not exists tiempo_medio_ms integer,
  add column if not exists tiempo_total_ms bigint,
  add column if not exists tasa_salto      numeric(5, 2);

alter table public.instagram_metricas_publicacion drop constraint if exists instagram_metricas_publicacion_textos_chk;
alter table public.instagram_metricas_publicacion add constraint instagram_metricas_publicacion_textos_chk check (
  coalesce(char_length(permalink), 0) <= 500 and coalesce(char_length(miniatura_url), 0) <= 2000
  and coalesce(char_length(caption), 0) <= 2200);

alter table public.instagram_metricas_publicacion drop constraint if exists instagram_metricas_publicacion_aprender_chk;
alter table public.instagram_metricas_publicacion add constraint instagram_metricas_publicacion_aprender_chk check (
  cardinality(hashtags) <= 60
  and coalesce(tiempo_medio_ms, 0) >= 0 and coalesce(tiempo_total_ms, 0) >= 0
  and (tasa_salto is null or tasa_salto between 0 and 100));

comment on column public.instagram_metricas_publicacion.caption is 'Pie de foto completo (hasta 2200 caracteres, el máximo de Instagram; antes de 20261110000000, solo los 300 primeros).';
comment on column public.instagram_metricas_publicacion.hashtags is 'Hashtags del pie de foto, con «#», en minúsculas y sin repetir (los saca la Edge Function).';
comment on column public.instagram_metricas_publicacion.publicado_local is 'Hora local de Madrid (Europe/Madrid) de publicado_at, sin zona: para agrupar por día de la semana y franja horaria.';
comment on column public.instagram_metricas_publicacion.tiempo_medio_ms is 'Reels: ig_reels_avg_watch_time (tiempo medio de reproducción). Meta no documenta la unidad en la tabla de métricas; se guarda tal cual (milisegundos, sin verificar con datos reales).';
comment on column public.instagram_metricas_publicacion.tiempo_total_ms is 'Reels: ig_reels_video_view_total_time (tiempo total de reproducción, con repeticiones; «en desarrollo» según Meta). Misma unidad que tiempo_medio_ms.';
comment on column public.instagram_metricas_publicacion.tasa_salto is 'Reels: reels_skip_rate, % de reproducciones que saltan el reel en los 3 primeros segundos («estimada y en desarrollo» según Meta).';

-- Filas que ya había: hora local y hashtags de lo que quedaba del texto.
update public.instagram_metricas_publicacion m
   set publicado_local = m.publicado_at at time zone 'Europe/Madrid'
 where m.publicado_local is null and m.publicado_at is not null;

update public.instagram_metricas_publicacion m
   set hashtags = coalesce((
         select (array_agg(distinct '#' || lower(x[1])))[1:60]
           from regexp_matches(m.caption, '#([[:alnum:]_]+)', 'g') as x), '{}')
 where m.hashtags = '{}' and m.caption like '%#%';

-- La vista se rehace para que lleve las columnas nuevas (las añade al final).
create or replace view public.instagram_metricas_publicacion_ultima
with (security_invoker = on) as
  select distinct on (media_id) *
    from public.instagram_metricas_publicacion
   order by media_id, fecha_captura desc;
comment on view public.instagram_metricas_publicacion_ultima is
  'Última captura de cada publicación de Instagram. security_invoker: aplica la RLS de instagram_metricas_publicacion.';

create index if not exists instagram_metricas_publicacion_publicado_idx
  on public.instagram_metricas_publicacion (publicado_at desc);

-- ─── 2. RPC «Qué funciona» ──────────────────────────────────────────────────
create or replace function public.instagram_que_funciona(
  p_marca text default null,
  p_ig_user_id text default null,
  p_dias integer default 90,
  p_minimo integer default 3)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_join_fotos text := '';
  v_tipo_foto text := $t$case when p.foto like 'carta:%' then 'plato' end$t$;
  v_sql text;
  v_res jsonb;
begin
  if p_marca is not null and p_marca not in ('casa-tomas', 'touza') then
    raise exception 'marca debe ser «casa-tomas» o «touza»' using errcode = '22023';
  end if;
  if p_ig_user_id is not null and p_ig_user_id !~ '^[0-9]{1,30}$' then
    raise exception 'ig_user_id debe ser solo dígitos' using errcode = '22023';
  end if;
  if p_dias is null or p_dias < 7 or p_dias > 365 then
    raise exception 'dias debe estar entre 7 y 365' using errcode = '22023';
  end if;
  if p_minimo is null or p_minimo < 1 or p_minimo > 50 then
    raise exception 'minimo debe estar entre 1 y 50' using errcode = '22023';
  end if;
  if auth.uid() is not null and not coalesce(public.can_read_section('marketing'), false) then
    raise exception 'Sin permiso de Marketing' using errcode = '42501';
  end if;

  -- Tipo de foto de las piezas: «carta:<id>» es un plato; las de la
  -- biblioteca («drive:<id>» o el uuid de las subidas antes de Drive), el de
  -- instagram_fotos (si la tabla existe).
  if to_regclass('public.instagram_fotos') is not null then
    if exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'instagram_fotos' and column_name = 'drive_id') then
      v_join_fotos := $j$left join lateral (
          select f.tipo from public.instagram_fotos f
           where (p.foto like 'drive:%' and f.drive_id = substr(p.foto, 7))
              or (p.foto ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and f.id::text = lower(p.foto))
           limit 1) f on true$j$;
    else
      v_join_fotos := $j$left join lateral (
          select f.tipo from public.instagram_fotos f
           where p.foto ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and f.id::text = lower(p.foto)
           limit 1) f on true$j$;
    end if;
    v_tipo_foto := $t$case when p.foto like 'carta:%' then 'plato' else f.tipo end$t$;
  end if;

  v_sql := $q$
    with base as (
      select m.media_id,
             m.alcance::numeric as alcance,
             coalesce(m.interacciones, coalesce(m.me_gusta, 0) + coalesce(m.comentarios, 0)
                      + coalesce(m.guardados, 0) + coalesce(m.compartidos, 0))::numeric as inter,
             coalesce(m.guardados, 0)::numeric as guardados,
             case m.producto when 'STORY' then 'story' when 'REELS' then 'reel' when 'FEED' then 'post' when 'AD' then 'post'
                             else coalesce(p.formato, 'post') end as formato,
             p.id as pieza_id,
             p.plantilla,
             {{TIPO_FOTO}} as tipo_foto,
             coalesce(m.publicado_local, m.publicado_at at time zone 'Europe/Madrid') as local,
             coalesce(m.hashtags, '{}') as hashtags,
             m.caption
        from public.instagram_metricas_publicacion_ultima m
        left join lateral (
          select x.id, x.marca, x.plantilla, x.formato, x.datos ->> 'foto' as foto
            from public.instagram_piezas x
           where x.id = m.pieza_id or (x.media_id is not null and x.media_id = m.media_id)
           order by (x.id = m.pieza_id) desc nulls last
           limit 1) p on true
        {{JOIN_FOTOS}}
       where m.publicado_at >= now() - make_interval(days => $3)
         and m.alcance > 0
         and ($2::text is null or m.ig_user_id = $2::text)
         and ($1::text is null or p.id is null or p.marca = $1::text)
    ),
    tot as (
      select count(*) as n,
             count(pieza_id) as con_pieza,
             round(100 * sum(inter) / nullif(sum(alcance), 0), 1) as tasa,
             round(100 * sum(guardados) / nullif(sum(alcance), 0), 2) as gpa,
             count(*) >= 2 * $4 as suficiente
        from base
    ),
    g as (
      select 'formato'::text as eje, formato as clave, 0 as orden, alcance, inter, guardados from base
      union all
      select 'plantilla', plantilla, 0, alcance, inter, guardados from base where plantilla is not null
      union all
      select 'tipo_foto', tipo_foto, 0, alcance, inter, guardados from base where tipo_foto is not null
      union all
      select 'dia', (array['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'])[extract(isodow from local)::int],
             extract(isodow from local)::int, alcance, inter, guardados
        from base where local is not null
      union all
      select 'franja', lpad(h::text, 2, '0') || '-' || lpad((h + 2)::text, 2, '0'), h, alcance, inter, guardados
        from (select b.*, (extract(hour from b.local)::int / 2) * 2 as h from base b where b.local is not null) b2
      union all
      select 'hashtag', t.h, 0, b.alcance, b.inter, b.guardados
        from base b cross join lateral unnest(b.hashtags) as t(h)
    ),
    r as (
      select eje, clave, min(orden) as orden, count(*) as n,
             round(avg(alcance)) as alcance_medio,
             round(100 * sum(inter) / nullif(sum(alcance), 0), 1) as tasa,
             round(100 * sum(guardados) / nullif(sum(alcance), 0), 2) as gpa,
             count(*) >= $4 as suficiente
        from g
       where clave is not null
       group by eje, clave
    ),
    rl as (
      select r.*, row_number() over (partition by eje order by suficiente desc, tasa desc nulls last, n desc, clave) as puesto
        from r
       where eje <> 'hashtag' or suficiente
    ),
    ejes(eje, nombre, ord) as (
      values ('formato', 'formato', 1), ('plantilla', 'plantilla', 2), ('tipo_foto', 'tipo de foto', 3),
             ('dia', 'día de la semana', 4), ('franja', 'hora de publicación', 5), ('hashtag', 'hashtag', 6)
    ),
    mejor as (
      select distinct on (eje) eje, clave, n, tasa, orden
        from r where suficiente and tasa is not null
       order by eje, tasa desc, n desc, clave
    ),
    nsuf as (
      select eje, count(*) filter (where suficiente) as ns from r group by eje
    ),
    concl as (
      select e.eje, e.nombre, e.ord, mj.clave, mj.n, mj.tasa, mj.orden, t.tasa as media,
             case
               when not t.suficiente or coalesce(ns.ns, 0) < 2 or mj.clave is null then 'faltan_datos'
               when t.tasa > 0 and mj.tasa >= t.tasa * 1.1 then 'mejor'
               else 'parecido'
             end as estado
        from ejes e
        cross join tot t
        left join nsuf ns on ns.eje = e.eje
        left join mejor mj on mj.eje = e.eje
    ),
    cifra as (
      -- 6.8 → «6,8»; 12.0 → «12».
      select c.*,
             regexp_replace(replace(to_char(c.tasa, 'FM999990.0'), '.', ','), ',0$', '') as tasa_txt,
             regexp_replace(replace(to_char(c.media, 'FM999990.0'), '.', ','), ',0$', '') as media_txt
        from concl c
    ),
    textos as (
      select c.*,
             case c.estado
               when 'mejor' then
                 (case c.eje
                    when 'formato' then (case c.clave when 'reel' then 'Los reels' when 'story' then 'Las historias'
                                                     else 'Las publicaciones del feed' end) || ' funcionan mejor'
                    when 'plantilla' then 'La plantilla «' || c.clave || '» funciona mejor'
                    when 'tipo_foto' then 'Las fotos de ' || (case c.clave when 'plato' then 'platos' when 'bebida' then 'bebidas'
                                                              when 'coctel' then 'cócteles' else c.clave end) || ' funcionan mejor'
                    when 'dia' then 'Los ' || (case c.clave when 'sábado' then 'sábados' when 'domingo' then 'domingos' else c.clave end)
                                    || ' funcionan mejor'
                    when 'franja' then 'Publicar entre las ' || c.orden || ' y las ' || (c.orden + 2) || ' h funciona mejor'
                    else 'Las publicaciones con ' || c.clave || ' funcionan mejor'
                  end)
                 || ': ' || c.tasa_txt || ' % de interacción en ' || c.n || ' publicaciones, frente al '
                 || c.media_txt || ' % de media.'
               when 'parecido' then 'Por ' || c.nombre || ' no hay diferencias claras todavía.'
               else 'Por ' || c.nombre || ' faltan datos: hacen falta al menos ' || $4
                    || ' publicaciones en dos grupos distintos.'
             end as texto
        from cifra c
    ),
    pubs as (
      select b.media_id, (b.local)::date as fecha, b.formato, b.plantilla,
             nullif(left(split_part(btrim(coalesce(b.caption, '')), E'\n', 1), 120), '') as gancho,
             b.alcance::bigint as alcance,
             round(100 * b.inter / b.alcance, 1) as tasa,
             row_number() over (order by b.inter / b.alcance desc, b.alcance desc, b.media_id) as rn_mejor,
             row_number() over (order by b.inter / b.alcance asc, b.alcance asc, b.media_id) as rn_peor
        from base b
    )
    select jsonb_build_object(
      'periodo_dias', $3,
      'desde', ((now() at time zone 'Europe/Madrid')::date - $3),
      'minimo', $4,
      'publicaciones', t.n,
      'con_pieza', t.con_pieza,
      'tasa_media', t.tasa,
      'guardados_media', t.gpa,
      'suficiente', t.suficiente,
      'aviso', case
                 when t.n = 0 then 'Todavía no hay publicaciones con datos en los últimos ' || $3 || ' días.'
                 when not t.suficiente then 'Solo hay ' || t.n || ' publicaciones con datos en los últimos ' || $3
                      || ' días: hacen falta al menos ' || (2 * $4) || ' para sacar conclusiones.'
               end,
      'por', coalesce((
        select jsonb_object_agg(x.eje, x.grupos) from (
          select eje, jsonb_agg(jsonb_build_object(
                   'clave', clave, 'publicaciones', n, 'alcance_medio', alcance_medio, 'tasa', tasa,
                   'guardados_por_alcance', gpa, 'suficiente', suficiente, 'orden', orden) order by puesto) as grupos
            from rl
           where puesto <= case when eje = 'hashtag' then 8 else 12 end
           group by eje) x), '{}'::jsonb),
      'conclusiones', coalesce((
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                 'eje', x.eje, 'estado', x.estado,
                 'clave', case when x.estado = 'mejor' then x.clave end,
                 'publicaciones', case when x.estado = 'mejor' then x.n end,
                 'tasa', case when x.estado = 'mejor' then x.tasa end,
                 'tasa_media', x.media,
                 'texto', x.texto)) order by x.ord)
          from textos x), '[]'::jsonb),
      'mejores', case when t.suficiente then coalesce((
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('media_id', y.media_id, 'fecha', y.fecha, 'formato', y.formato,
                 'plantilla', y.plantilla, 'gancho', y.gancho, 'alcance', y.alcance, 'tasa', y.tasa)) order by y.rn_mejor)
          from pubs y where y.rn_mejor <= 5), '[]'::jsonb) else '[]'::jsonb end,
      'peores', case when t.suficiente then coalesce((
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('media_id', y.media_id, 'fecha', y.fecha, 'formato', y.formato,
                 'plantilla', y.plantilla, 'gancho', y.gancho, 'alcance', y.alcance, 'tasa', y.tasa)) order by y.rn_peor)
          from pubs y where y.rn_peor <= least(5, t.n - 5)), '[]'::jsonb) else '[]'::jsonb end)
      from tot t
  $q$;
  v_sql := replace(replace(v_sql, '{{TIPO_FOTO}}', v_tipo_foto), '{{JOIN_FOTOS}}', v_join_fotos);
  execute v_sql into v_res using p_marca, p_ig_user_id, p_dias, p_minimo;
  return v_res;
end;
$$;
comment on function public.instagram_que_funciona(text, text, integer, integer) is
  '«Qué funciona» de Instagram (fase 3): por formato, plantilla, tipo de foto, día, franja de 2 h (Madrid) y hashtag, con muestra mínima. SECURITY INVOKER (RLS de Marketing). Lo leen la pestaña Métricas y instagram-ia. Ver docs/instagram-metricas.md.';

revoke all on function public.instagram_que_funciona(text, text, integer, integer) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.instagram_que_funciona(text, text, integer, integer) from anon';
    execute 'grant execute on function public.instagram_que_funciona(text, text, integer, integer) to authenticated, service_role';
  end if;
end;
$$;

-- ─── 3. Comprobación final ──────────────────────────────────────────────────
do $$
declare
  v_malos text[] := '{}';
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'instagram_metricas_publicacion_ultima'
         and column_name in ('hashtags', 'publicado_local', 'tiempo_medio_ms', 'tiempo_total_ms', 'tasa_salto')) <> 5 then
    v_malos := v_malos || 'la vista instagram_metricas_publicacion_ultima no lleva las columnas nuevas'::text;
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.instagram_metricas_publicacion'::regclass) then
    v_malos := v_malos || 'RLS apagada en instagram_metricas_publicacion'::text;
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon')
     and has_function_privilege('anon', 'public.instagram_que_funciona(text, text, integer, integer)', 'EXECUTE') then
    v_malos := v_malos || 'anon puede ejecutar instagram_que_funciona'::text;
  end if;
  if cardinality(v_malos) > 0 then
    raise exception 'instagram_aprender: comprobación final fallida (%). No se ha aplicado nada.', array_to_string(v_malos, '; ');
  end if;
  raise notice 'instagram_aprender: aplicada';
end;
$$;

commit;
