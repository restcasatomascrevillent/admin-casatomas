set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261106100000_instagram_metricas — Pestaña «Métricas» de Instagram (06/11/2026)
-- ===========================================================================
-- Guarda cada día las métricas de la cuenta de Instagram y de sus
-- publicaciones (Graph API v26.0, Edge Function instagram-metricas) para que
-- el panel enseñe la evolución y qué piezas funcionan mejor.
--
-- QUÉ CREA
--   * public.instagram_metricas_cuenta: una fila por día (Europe/Madrid) y
--     cuenta (único fecha + ig_user_id). Seguidores (followers_count en el
--     momento de la captura; solo en el último día capturado), alcance,
--     visualizaciones (views: sustituye a impressions, retirada), visitas al
--     perfil, cuentas que interactúan, interacciones totales y su desglose.
--   * public.instagram_metricas_publicacion: una fila por publicación y día
--     de captura (único media_id + fecha_captura): alcance, me gusta,
--     comentarios, guardados, compartidos, visualizaciones e interacciones
--     (acumulados de toda la vida de la publicación, «lifetime»). pieza_id
--     enlaza (opcional) con instagram_piezas.id si la pieza salió del panel.
--   * public.instagram_metricas_publicacion_ultima: vista (security_invoker)
--     con la última captura de cada publicación.
--   * public.instagram_metricas_capturas: registro de cada captura (cron o
--     panel), con el error si falló (p. ej. falta instagram_manage_insights).
--
--   RLS: LEER con can_read_section('marketing') y sesión de panel viva
--   (acceso_panel_no_bloqueado). ESCRIBIR solo service_role (la Edge Function
--   instagram-metricas en la acción «capturar»). anon nada.
--
--   * Tarea pg_cron «instagram-metricas-diarias», 05:00 UTC (06:00 en
--     Europe/Madrid en horario de invierno, 07:00 en verano: pg_cron va en
--     UTC). Llama a la función con pg_net y {"accion":"capturar"}. Mismo
--     patrón que 20261101093800_trafico_web_cron_url_desde_vault.sql: la URL
--     y el secreto salen de Vault en CADA ejecución:
--       · 'project_url'                     -> https://<ref>.supabase.co (ya
--                                              existe si se aplicó 20261030153000)
--       · 'instagram_metricas_cron_secret'  -> el MISMO valor que el secreto
--                                              INSTAGRAM_METRICAS_CRON_SECRET
--                                              de la función (cabecera x-webhook-secret)
--     Si falta alguno, el job queda instalado pero MUDO (0 filas en el FROM:
--     no llama a nadie), como el cron del OCR. Esta migración NO falla por
--     eso: crea las tablas igualmente y lo avisa con un NOTICE.
--     Crear el secreto (una vez por proyecto, sin pegarlo en ningún sitio más):
--       select vault.create_secret('<valor largo aleatorio>', 'instagram_metricas_cron_secret');
--       npx supabase secrets set INSTAGRAM_METRICAS_CRON_SECRET=<el mismo valor> --project-ref <ref>
--
-- APLICAR (una a una, nunca `db push`): demo primero (sfonaclosuafvlhutkon),
-- producción (haqmmdfdzzatdnrrcgez) solo tras aceptar el PR y con el «sí» del
-- dueño. Necesita antes 20261105090000_instagram.sql.
--   npx supabase db query --linked -f supabase/migrations/20261106100000_instagram_metricas.sql
-- Idempotente. Tiene que terminar en «instagram_metricas: aplicada».
-- Deshacer: supabase/rollbacks/20261106100000_instagram_metricas_ROLLBACK.sql
-- Pruebas: node scripts/test-instagram-metricas.mjs (PGlite).
-- Documentación: docs/instagram-metricas.md
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
  if cardinality(v_faltan) > 0 then
    raise exception 'instagram_metricas: falta %. No se ha cambiado nada.', array_to_string(v_faltan, ', ');
  end if;
end;
$$;

-- ─── 1. Instantánea diaria de la cuenta ─────────────────────────────────────
create table if not exists public.instagram_metricas_cuenta (
  id                   bigint generated always as identity primary key,
  fecha                date not null,
  ig_user_id           text not null,
  seguidores           integer,
  alcance              integer,
  visualizaciones      integer,
  visitas_perfil       integer,
  cuentas_interaccion  integer,
  interacciones        integer,
  me_gusta             integer,
  comentarios          integer,
  guardados            integer,
  compartidos          integer,
  toques_enlaces       integer,
  capturado_at         timestamptz not null default now(),
  constraint instagram_metricas_cuenta_fecha_cuenta_key unique (fecha, ig_user_id),
  constraint instagram_metricas_cuenta_ig_chk check (ig_user_id ~ '^[0-9]{1,30}$'),
  constraint instagram_metricas_cuenta_no_negativos_chk check (
    coalesce(seguidores, 0) >= 0 and coalesce(alcance, 0) >= 0 and coalesce(visualizaciones, 0) >= 0
    and coalesce(visitas_perfil, 0) >= 0 and coalesce(cuentas_interaccion, 0) >= 0
    and coalesce(interacciones, 0) >= 0 and coalesce(me_gusta, 0) >= 0 and coalesce(comentarios, 0) >= 0
    and coalesce(guardados, 0) >= 0 and coalesce(compartidos, 0) >= 0 and coalesce(toques_enlaces, 0) >= 0)
);
comment on table public.instagram_metricas_cuenta is
  'Métricas diarias de la cuenta de Instagram (día de Europe/Madrid). La escribe SOLO la Edge Function instagram-metricas (service_role). NULL = Meta no dio el dato. Ver docs/instagram-metricas.md.';
comment on column public.instagram_metricas_cuenta.seguidores is 'followers_count al capturar (solo en el último día capturado; los anteriores no se pisan).';
comment on column public.instagram_metricas_cuenta.alcance is 'reach (period=day, metric_type=total_value): cuentas únicas que vieron contenido ese día.';
comment on column public.instagram_metricas_cuenta.visualizaciones is 'views (sustituye a impressions, retirada desde v22.0).';
comment on column public.instagram_metricas_cuenta.visitas_perfil is 'profile_views: no figura en la tabla de la referencia v26; se pide aparte y queda NULL si Meta la rechaza.';
comment on column public.instagram_metricas_cuenta.cuentas_interaccion is 'accounts_engaged.';
comment on column public.instagram_metricas_cuenta.interacciones is 'total_interactions.';
comment on column public.instagram_metricas_cuenta.toques_enlaces is 'profile_links_taps (botones de contacto y enlaces del perfil).';

create index if not exists instagram_metricas_cuenta_cuenta_fecha_idx
  on public.instagram_metricas_cuenta (ig_user_id, fecha desc);

-- ─── 2. Métricas por publicación ────────────────────────────────────────────
create table if not exists public.instagram_metricas_publicacion (
  id               bigint generated always as identity primary key,
  media_id         text not null,
  ig_user_id       text not null,
  fecha_captura    date not null,
  capturado_at     timestamptz not null default now(),
  pieza_id         uuid references public.instagram_piezas (id) on delete set null,
  tipo_medio       text,
  producto         text,
  publicado_at     timestamptz,
  permalink        text,
  miniatura_url    text,
  caption          text,
  alcance          integer,
  me_gusta         integer,
  comentarios      integer,
  guardados        integer,
  compartidos      integer,
  visualizaciones  integer,
  interacciones    integer,
  constraint instagram_metricas_publicacion_media_fecha_key unique (media_id, fecha_captura),
  constraint instagram_metricas_publicacion_media_chk check (media_id ~ '^[0-9]{1,40}$'),
  constraint instagram_metricas_publicacion_ig_chk check (ig_user_id ~ '^[0-9]{1,30}$'),
  constraint instagram_metricas_publicacion_tipo_chk check (tipo_medio is null or tipo_medio in ('IMAGE', 'VIDEO', 'CAROUSEL_ALBUM')),
  constraint instagram_metricas_publicacion_producto_chk check (producto is null or producto in ('FEED', 'REELS', 'STORY', 'AD')),
  constraint instagram_metricas_publicacion_textos_chk check (
    coalesce(char_length(permalink), 0) <= 500 and coalesce(char_length(miniatura_url), 0) <= 2000
    and coalesce(char_length(caption), 0) <= 300),
  constraint instagram_metricas_publicacion_no_negativos_chk check (
    coalesce(alcance, 0) >= 0 and coalesce(me_gusta, 0) >= 0 and coalesce(comentarios, 0) >= 0
    and coalesce(guardados, 0) >= 0 and coalesce(compartidos, 0) >= 0 and coalesce(visualizaciones, 0) >= 0
    and coalesce(interacciones, 0) >= 0)
);
comment on table public.instagram_metricas_publicacion is
  'Métricas de cada publicación de Instagram por día de captura (acumuladas, lifetime). La escribe SOLO la Edge Function instagram-metricas (service_role). Ver docs/instagram-metricas.md.';
comment on column public.instagram_metricas_publicacion.pieza_id is 'instagram_piezas.id si la publicación salió del panel (mismo media_id). Opcional.';
comment on column public.instagram_metricas_publicacion.producto is 'media_product_type de Meta: FEED, REELS, STORY o AD.';
comment on column public.instagram_metricas_publicacion.miniatura_url is 'media_url / thumbnail_url de Meta (URL del CDN de Instagram: caduca; se renueva en cada captura).';
comment on column public.instagram_metricas_publicacion.caption is 'Primeros 300 caracteres del pie de foto.';

create index if not exists instagram_metricas_publicacion_media_fecha_idx
  on public.instagram_metricas_publicacion (media_id, fecha_captura desc);
create index if not exists instagram_metricas_publicacion_pieza_idx
  on public.instagram_metricas_publicacion (pieza_id) where pieza_id is not null;

-- Última captura de cada publicación (la que enseña el panel).
create or replace view public.instagram_metricas_publicacion_ultima
with (security_invoker = on) as
  select distinct on (media_id) *
    from public.instagram_metricas_publicacion
   order by media_id, fecha_captura desc;
comment on view public.instagram_metricas_publicacion_ultima is
  'Última captura de cada publicación de Instagram. security_invoker: aplica la RLS de instagram_metricas_publicacion.';

-- ─── 3. Registro de capturas ────────────────────────────────────────────────
create table if not exists public.instagram_metricas_capturas (
  id               bigint generated always as identity primary key,
  origen           text not null,
  inicio           timestamptz not null default now(),
  fin              timestamptz,
  ok               boolean not null default false,
  ig_user_id       text,
  dias             integer not null default 0,
  publicaciones    integer not null default 0,
  error_tipo       text,
  error            text,
  avisos           jsonb not null default '[]'::jsonb,
  constraint instagram_metricas_capturas_origen_chk check (origen in ('cron', 'panel', 'servicio')),
  constraint instagram_metricas_capturas_textos_chk check (
    coalesce(char_length(error), 0) <= 2000 and coalesce(char_length(error_tipo), 0) <= 60
    and jsonb_typeof(avisos) = 'array' and pg_column_size(avisos) <= 16384)
);
comment on table public.instagram_metricas_capturas is
  'Cada captura de métricas de Instagram (cron diario o botón «Actualizar ahora»). error_tipo = permiso_insights si al token le falta instagram_manage_insights. Textos ya saneados (sin tokens).';

create index if not exists instagram_metricas_capturas_inicio_idx
  on public.instagram_metricas_capturas (inicio desc);

-- ─── 4. RLS y privilegios: leer con Marketing, escribir solo service_role ───
do $$
declare
  t text;
begin
  foreach t in array array['instagram_metricas_cuenta', 'instagram_metricas_publicacion', 'instagram_metricas_capturas'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on public.%I from anon, authenticated', t);
      execute format('grant select on public.%I to authenticated', t);
      execute format('grant all on public.%I to service_role', t);
    end if;
    execute format('drop policy if exists %I on public.%I', t || '_select_seccion', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.can_read_section(''marketing'')))',
                   t || '_select_seccion', t);
    execute format('drop policy if exists %I on public.%I', t || '_service_role', t);
    execute format('create policy %I on public.%I for all to service_role using (true) with check (true)', t || '_service_role', t);
    if to_regprocedure('private.sesion_panel_permitida()') is not null then
      execute format('drop policy if exists "acceso_panel_no_bloqueado" on public.%I', t);
      execute format('create policy "acceso_panel_no_bloqueado" on public.%I as restrictive for all to authenticated
        using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()))', t);
    end if;
  end loop;
end;
$$;

revoke all on public.instagram_metricas_publicacion_ultima from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.instagram_metricas_publicacion_ultima from anon, authenticated';
    execute 'grant select on public.instagram_metricas_publicacion_ultima to authenticated, service_role';
  end if;
end;
$$;

-- ─── 5. Cron diario (instalado; mudo hasta crear los secretos de Vault) ─────
do $$
declare
  v_secretos bigint;
begin
  if to_regnamespace('cron') is null then
    raise notice 'instagram_metricas: pg_cron no está instalado; NO se programa la captura diaria (las tablas sí se crean).';
    return;
  end if;
  perform cron.unschedule('instagram-metricas-diarias')
     from cron.job where jobname = 'instagram-metricas-diarias';
  perform cron.schedule(
    'instagram-metricas-diarias',
    '0 5 * * *',
    $cron$
  select net.http_post(
    url := rtrim(u.decrypted_secret, '/') || '/functions/v1/instagram-metricas',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', s.decrypted_secret
    ),
    body := '{"accion":"capturar"}'::jsonb,
    timeout_milliseconds := 120000
  )
  from vault.decrypted_secrets s
  cross join vault.decrypted_secrets u
  where s.name = 'instagram_metricas_cron_secret'
    and u.name = 'project_url';
  $cron$
  );
  if to_regclass('vault.decrypted_secrets') is not null then
    execute 'select count(distinct name) from vault.decrypted_secrets
              where name in (''instagram_metricas_cron_secret'', ''project_url'')' into v_secretos;
  end if;
  if coalesce(v_secretos, 0) < 2 then
    raise notice 'instagram_metricas: el cron queda MUDO hasta crear en Vault project_url e instagram_metricas_cron_secret (ver cabecera).';
  end if;
end;
$$;

-- ─── 6. Comprobación final ──────────────────────────────────────────────────
do $$
declare
  v_malos text[] := '{}';
  v_jobs bigint;
  t text;
begin
  foreach t in array array['instagram_metricas_cuenta', 'instagram_metricas_publicacion', 'instagram_metricas_capturas'] loop
    if not (select relrowsecurity from pg_class where oid = format('public.%I', t)::regclass) then
      v_malos := v_malos || format('RLS apagada en %s', t);
    end if;
    if exists (select 1 from pg_roles where rolname = 'anon') then
      if has_table_privilege('anon', format('public.%I', t), 'SELECT')
         or has_table_privilege('anon', format('public.%I', t), 'INSERT') then
        v_malos := v_malos || format('anon tiene acceso a %s', t);
      end if;
      if has_table_privilege('authenticated', format('public.%I', t), 'INSERT')
         or has_table_privilege('authenticated', format('public.%I', t), 'UPDATE')
         or has_table_privilege('authenticated', format('public.%I', t), 'DELETE')
         or has_table_privilege('authenticated', format('public.%I', t), 'TRUNCATE') then
        v_malos := v_malos || format('authenticated puede escribir en %s', t);
      end if;
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon')
     and has_table_privilege('anon', 'public.instagram_metricas_publicacion_ultima', 'SELECT') then
    v_malos := v_malos || 'anon puede leer instagram_metricas_publicacion_ultima'::text;
  end if;
  if to_regnamespace('cron') is not null then
    -- Dinámico: sin pg_cron, cron.job no existe y la consulta no se puede ni preparar.
    execute 'select count(*) from cron.job where jobname = ''instagram-metricas-diarias''' into v_jobs;
    if v_jobs <> 1 then
      v_malos := v_malos || 'el cron instagram-metricas-diarias no quedó instalado una vez'::text;
    end if;
  end if;
  if cardinality(v_malos) > 0 then
    raise exception 'instagram_metricas: comprobación final fallida (%). No se ha aplicado nada.', array_to_string(v_malos, '; ');
  end if;
  raise notice 'instagram_metricas: aplicada';
end;
$$;

commit;

-- VERIFICACIÓN (solo lectura): «cron activo | secretos de Vault creados».
--   select jobname, schedule, active from cron.job where jobname = 'instagram-metricas-diarias';
--   select name from vault.secrets where name in ('project_url', 'instagram_metricas_cron_secret');
--   select * from public.instagram_metricas_capturas order by inicio desc limit 5;
