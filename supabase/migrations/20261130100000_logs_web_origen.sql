-- ===========================================================================
--  Logs web · ORIGEN de cada error: fallo de la web / servicio externo / no
--  depende de la web (conexión del visitante, navegador o extensión, versión
--  antigua que se arregló sola, bots y pruebas)
--
--  Sin aplicar en producción: demo primero (sfonaclosuafvlhutkon); producción
--  (haqmmdfdzzatdnrrcgez) solo tras aceptar el PR de la release y con el «sí»
--  del dueño. Requiere 20261118100000_logs_web.sql y
--  20261129143000_logs_web_legibles.sql. Idempotente. Tiene que terminar en
--  «logs_web_origen: aplicada».
--  Deshacer: supabase/rollbacks/20261130100000_logs_web_origen_ROLLBACK.sql
--  Pruebas: npm run test:logs-web:db (PGlite) y
--  supabase/functions/_shared/__tests__/logs-web-origen.test.ts (vitest): los
--  MISMOS casos (logs-web-origen-casos.json) pasan por el SQL y por el espejo
--  en TypeScript (supabase/functions/_shared/logs-web/origen.ts).
--
--  Petición del dueño (14/11/2026): «En logs diferencia entre error web, error
--  que no depende de la web, diferentes colores y se tratan diferente». La
--  lista de la demo eran 17 «Error» en rojo, casi todas «Sin respuesta de
--  rest:… (sin conexión)»: el móvil del visitante sin cobertura.
--
--  1. web_eventos.origen: origen técnico de cada error, con reglas fijas (sin
--     IA): web_logs_origen_error(). web_incidencias.origen: el de la
--     incidencia (basta una ocurrencia de la web para que lo sea; si todas son
--     de bots, pruebas o tráfico interno, «bots»), origen_proveedor (el
--     servicio de fuera) y origen_prioridad (1 web, 2 externo, 3 resto; para
--     ordenar y filtrar). web_sesiones.errores_web / errores_externos.
--  2. Linear: solo los «Fallo de la web» (y los «Servicio externo» si se
--     activa linear_tickets_externos) cuentan para los umbrales y pueden abrir
--     o reabrir un ticket. Los tickets ya creados no se tocan ni se cierran.
--     «Pedir ticket» a mano sigue valiendo para cualquiera (decisión humana).
--  3. Una sola vez: clasifica lo guardado y devuelve a «sin ticket» las
--     pendientes que ya no pueden abrirlo (no las pedidas a mano).
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $$
begin
  if to_regclass('public.web_eventos') is null or to_regclass('public.web_incidencias') is null then
    raise exception 'logs_web_origen: falta 20261118100000_logs_web.sql. No se ha cambiado nada.';
  end if;
  if to_regprocedure('public.web_logs_clasificar_tras_publicar(timestamptz)') is null then
    raise exception 'logs_web_origen: falta 20261129143000_logs_web_legibles.sql. No se ha cambiado nada.';
  end if;
end;
$$;

-- ─── 1. Columnas ────────────────────────────────────────────────────────────
alter table public.web_eventos add column if not exists origen text;
alter table public.web_eventos drop constraint if exists web_eventos_origen_chk;
alter table public.web_eventos add constraint web_eventos_origen_chk
  check (origen is null or origen in ('web', 'externo', 'conexion', 'navegador', 'version_antigua'));
comment on column public.web_eventos.origen is
  'Solo errores: web (fallo nuestro), externo (servicio de fuera), conexion (red del visitante), navegador (navegador o extensión) o version_antigua (se arregló sola al recargar). Lo pone web_logs_agrupar_errores() con web_logs_origen_error(); bots/pruebas/interno van en sus indicadores.';

alter table public.web_incidencias add column if not exists origen text not null default 'web';
alter table public.web_incidencias add column if not exists origen_proveedor text;
alter table public.web_incidencias drop constraint if exists web_incidencias_origen_chk;
alter table public.web_incidencias add constraint web_incidencias_origen_chk
  check (origen in ('web', 'externo', 'conexion', 'navegador', 'version_antigua', 'bots')
         and (origen_proveedor is null or length(origen_proveedor) <= 120));
alter table public.web_incidencias add column if not exists origen_prioridad smallint
  generated always as (case origen when 'web' then 1 when 'externo' then 2 else 3 end) stored;
comment on column public.web_incidencias.origen is
  'Fallo de la web (web), Servicio externo (externo) o no depende de la web (conexion, navegador, version_antigua, bots). Basta una ocurrencia real de la web para que sea «web»; sin ninguna de visitantes reales, «bots». Solo web (y externo si linear_tickets_externos) abre tickets.';
comment on column public.web_incidencias.origen_prioridad is '1 = fallo de la web, 2 = servicio externo, 3 = no depende de la web (orden y filtros del panel).';
create index if not exists web_incidencias_origen_idx on public.web_incidencias (entorno, origen_prioridad, ultima_vez desc);

alter table public.web_sesiones add column if not exists errores_web integer;
alter table public.web_sesiones add column if not exists errores_externos integer;
comment on column public.web_sesiones.errores_web is
  'Errores de la sesión que son fallo de la web (null = aún sin clasificar). Lo pone web_logs_agrupar_errores().';

alter table public.web_logs_config add column if not exists linear_tickets_externos boolean not null default false;
comment on column public.web_logs_config.linear_tickets_externos is
  'Si los errores de servicios externos (Google Maps, Instagram, Stripe, OpenAI…) pueden abrir ticket en Linear. Por defecto no.';
grant update (linear_tickets_externos) on public.web_logs_config to authenticated;

-- ─── 2. Reglas (espejo de supabase/functions/_shared/logs-web/origen.ts) ────
-- Servicio de fuera que falla, o null. Navegador: objetivo + mensaje + pila;
-- servidor: solo el mensaje sin el «<función>: » del principio (la función
-- puede llamarse como el proveedor: stripe-estado-cuenta, ia-modelos-openai…).
create or replace function public.web_logs_proveedor_externo(p_tipo text, p_fuente text, p_mensaje text, p_pila text, p_objetivo text)
returns text
language sql
immutable
set search_path = ''
as $$
  with t as (
    select coalesce(p_fuente, 'navegador') = 'navegador' as nav,
           case when coalesce(p_fuente, 'navegador') = 'navegador'
                then coalesce(p_objetivo, '') || E'\n' || coalesce(p_mensaje, '') || E'\n' || coalesce(p_pila, '')
                when p_objetivo is not null and left(coalesce(p_mensaje, ''), length(p_objetivo) + 2) = p_objetivo || ': '
                then substr(p_mensaje, length(p_objetivo) + 3)
                else coalesce(p_mensaje, '')
           end as texto,
           regexp_replace(lower(substring(coalesce(p_objetivo, '') from '^[Hh][Tt][Tt][Pp][Ss]?://([^/:?#]+)')), '^www\.', '') as host
  )
  select case
    when not t.nav and t.texto ~* 'job startup timeout|could not start background process|out of background worker slots|too many (clients|connections)|remaining connection slots are reserved|the database system is (starting up|shutting down|in recovery mode)' then 'Supabase'
    when t.texto ~* 'maps\.googleapis\.com|maps\.gstatic\.com|google maps|google\.maps|maps\.google\.' then 'Google Maps'
    when t.texto ~* 'mapbox' then 'Mapbox'
    when t.texto ~* 'instagram\.com|cdninstagram\.com|instgrm|graph\.facebook\.com|graph api|fbcdn\.net|connect\.facebook\.net|errores? (temporal )?de meta|meta (no |ha )' then 'Instagram / Meta'
    when t.texto ~* 'api\.stripe\.com|js\.stripe\.com|m\.stripe\.network|stripe(api|connection|ratelimit|authentication|invalidrequest|card|permission)error|consultar stripe|stripe no respond' then 'Stripe'
    when t.texto ~* 'openai|chatgpt' then 'OpenAI'
    when t.texto ~* 'generativelanguage\.googleapis\.com|gemini' then 'Google (IA)'
    when t.texto ~* 'google drive|drive token|googleapis\.com/(upload/)?drive' then 'Google Drive'
    when t.texto ~* 'google places|places api|mybusiness|businessprofile|google my business' then 'Google (reseñas y sitios)'
    when t.texto ~* 'api\.resend\.com|resend_error|resend_sandbox|resend (api|respondió|devolvió|no respond)|(segments|contactos|audiencia) de resend|con resend|en resend' then 'Resend'
    when t.texto ~* 'api\.vercel\.com|vercel [0-9]{3}|vercel (api|no respond)' then 'Vercel'
    when t.texto ~* 'api\.telegram\.org|telegram (api|respondió|devolvió|no respond)' then 'Telegram'
    when t.texto ~* 'api\.vapi\.ai|vapi responded' then 'Vapi'
    when t.texto ~* 'fonts\.googleapis\.com|fonts\.gstatic\.com' then 'Google Fonts'
    when t.texto ~* 'youtube\.com|ytimg\.com|youtube-nocookie\.com' then 'YouTube'
    when t.nav and p_tipo = 'error_recurso' and t.host is not null and t.host <> ''
         and t.host !~ '(^|\.)(restaurantecasatomascrevillente\.es|web-casatomas[a-z0-9-]*\.vercel\.app|admin-casatomas[a-z0-9-]*\.vercel\.app|localhost|127\.0\.0\.1|[a-z]{20}\.supabase\.co)$'
      then left(t.host, 120)
    else null
  end
  from t;
$$;
revoke all on function public.web_logs_proveedor_externo(text, text, text, text, text) from public, anon;
grant execute on function public.web_logs_proveedor_externo(text, text, text, text, text) to authenticated, service_role;

-- Origen técnico de UNA ocurrencia (sin bots: esos se miran por sus indicadores).
create or replace function public.web_logs_origen_error(p_tipo text, p_fuente text, p_mensaje text, p_pila text, p_objetivo text,
                                                         p_propiedades jsonb, p_accion text, p_tras_publicar text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    -- 1. Versión antigua tras publicar: lo que pasó después manda.
    when p_tras_publicar = 'repetido' then 'web'
    when p_tras_publicar = 'sin_conexion' then 'conexion'
    when p_tras_publicar in ('sin_impacto', 'sin_datos') then 'version_antigua'
    when p_tipo in ('error_js', 'error_promesa', 'error_react', 'error_recurso')
         and p_accion in ('recarga_sin_efecto', 'aviso_version_nueva', 'sin_version_nueva') then 'web'
    when p_tipo in ('error_js', 'error_promesa', 'error_react', 'error_recurso') and p_accion = 'sin_conexion' then 'conexion'
    when p_tipo in ('error_js', 'error_promesa', 'error_react', 'error_recurso') and p_accion = 'recuperado_tras_recarga' then 'version_antigua'
    when public.web_logs_es_version_antigua(p_tipo, p_mensaje, p_pila, p_objetivo) then 'version_antigua'
    -- 2. Nuestro aunque lo parezca de fuera.
    when p_tipo = 'error_despliegue' then 'web'
    when coalesce(p_fuente, 'navegador') <> 'navegador'
         and (coalesce(p_mensaje, '') || E'\n' || coalesce(p_pila, ''))
             ~* 'falta_secreto|falta (el |la )?(secreto|clave|configur|firma)|not_configured|no_configurado|no está configurad|missing (secret|api key|env)|dns error|failed to lookup address|enotfound|name or service not known'
      then 'web'
    -- 3. El navegador o una extensión.
    when coalesce(p_fuente, 'navegador') = 'navegador'
         and ((coalesce(p_mensaje, '') || E'\n' || coalesce(p_pila, '') || E'\n' || coalesce(p_objetivo, ''))
                ~* '(chrome|moz|safari|safari-web|ms-browser|edge)-extension://|webkit-masked-url://'
              or (coalesce(p_mensaje, '') || E'\n' || coalesce(p_pila, ''))
                ~* 'resizeobserver loop|_autofillcallbackhandler|instantsearchsdkjsbridge|__gcrweb|weixinjsbridge|webkit\.messagehandlers|java object is gone|zalojsv2|getreadmode(config|render|extract)|symbrowser_|cefsharp|non-error promise rejection captured|can.t find variable: (gmo|zalo|_autofill)'
              or btrim(coalesce(p_mensaje, ''), E' \t\n\r') ~* '^(uncaught )?script error\.?$'
              or (p_tipo = 'error_recurso' and coalesce(p_objetivo, '')
                ~* 'googletagmanager\.com|google-analytics\.com|doubleclick\.net|googlesyndication\.com|clarity\.ms|hotjar\.com|cloudflareinsights\.com|fbevents\.js'))
      then 'navegador'
    -- 4. La conexión del visitante.
    when coalesce(p_fuente, 'navegador') = 'navegador' and p_tipo = 'error_peticion'
         and (coalesce(p_propiedades ->> 'status', '') = '0' or coalesce(p_mensaje, '') ~* '^sin respuesta')
      then 'conexion'
    when coalesce(p_fuente, 'navegador') = 'navegador' and p_tipo in ('error_js', 'error_promesa', 'error_react')
         and coalesce(p_mensaje, '') ~* 'failed to fetch|load failed|networkerror when attempting to fetch resource|network ?error|network request failed|network connection was lost|internet connection appears to be offline|err_internet_disconnected|err_network_changed|err_connection_(reset|closed|refused|timed_out|aborted)|aborterror|user aborted a request|operation was aborted|signal is aborted|fetch is aborted|request aborted|failed to send a request to the edge function|authretryablefetcherror|^(typeerror: )?(cancelled|canceled|cancelado)$'
      then 'conexion'
    -- 5. Un servicio de fuera.
    when public.web_logs_proveedor_externo(p_tipo, p_fuente, p_mensaje, p_pila, p_objetivo) is not null then 'externo'
    -- 6. Lo nuestro.
    else 'web'
  end;
$$;
revoke all on function public.web_logs_origen_error(text, text, text, text, text, jsonb, text, text) from public, anon;
grant execute on function public.web_logs_origen_error(text, text, text, text, text, jsonb, text, text) to authenticated, service_role;

-- ─── 3. Agrupación con el origen ───────────────────────────────────────────
-- Igual que en 20261129143000 salvo: guarda el origen de cada ocurrencia y de
-- cada incidencia; para los umbrales solo cuentan las ocurrencias de la web
-- (y las de servicios externos si linear_tickets_externos); solo las de la
-- web (o externas, con el interruptor) abren ticket o reabren el suyo; las
-- pendientes que ya no pueden vuelven a «sin ticket» (no las pedidas a mano);
-- y cuenta los errores de la web y externos de cada sesión.
create or replace function public.web_logs_agrupar_errores(p_limite integer default 5000)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.web_logs_config;
  v_ids bigint[];
  v_afectadas bigint[];
  v_nuevas integer := 0;
  v_reabiertas integer := 0;
  v_pendientes integer := 0;
  v_reclasificadas bigint[];
begin
  if not pg_try_advisory_xact_lock(hashtext('web_logs_agrupar_errores')) then
    return jsonb_build_object('ocupado', true);
  end if;
  select * into c from public.web_logs_config where id;

  select array_agg(id order by id) into v_ids
    from (select id from public.web_eventos
           where categoria = 'error' and incidencia_id is null and huella is not null
           order by id limit greatest(p_limite, 1)) t;

  if v_ids is not null then
    with nuevas as (
      insert into public.web_incidencias (entorno, huella, titulo, tipo, fuente, proyecto, gravedad, primera_vez, ultima_vez,
                                          mensaje, pila, ejemplo_evento_id)
      select distinct on (e.entorno, e.huella)
             e.entorno, e.huella,
             left(coalesce(nullif(e.mensaje, ''), e.tipo) || coalesce(' · ' || nullif(e.objetivo, ''), ''), 200),
             e.tipo, e.fuente, e.proyecto, coalesce(e.gravedad, 'error'), e.ocurrido_en, e.ocurrido_en, e.mensaje, e.pila, e.id
        from public.web_eventos e
       where e.id = any (v_ids)
       order by e.entorno, e.huella, e.id
      on conflict (entorno, huella) do nothing
      returning 1
    )
    select count(*) into v_nuevas from nuevas;

    update public.web_eventos e
       set incidencia_id = i.id
      from public.web_incidencias i
     where e.id = any (v_ids) and i.entorno = e.entorno and i.huella = e.huella;

    select array_agg(distinct incidencia_id) into v_afectadas from public.web_eventos where id = any (v_ids);
  end if;

  -- Ficheros de una versión anterior (tras publicar): se clasifican con lo que
  -- pasó después en la misma sesión. Las que cambian se recalculan.
  v_reclasificadas := public.web_logs_clasificar_tras_publicar(now() - interval '2 days');

  -- Origen de cada ocurrencia nueva o reclasificada (y de las que aún no lo tengan).
  update public.web_eventos e
     set origen = public.web_logs_origen_error(e.tipo, e.fuente, e.mensaje, e.pila, e.objetivo, e.propiedades, e.accion, e.tras_publicar)
   where e.categoria = 'error'
     and (e.id = any (coalesce(v_ids, array[]::bigint[])) or e.incidencia_id = any (v_reclasificadas))
     and e.origen is distinct from public.web_logs_origen_error(e.tipo, e.fuente, e.mensaje, e.pila, e.objetivo, e.propiedades, e.accion, e.tras_publicar);

  -- Errores de la web y externos de cada sesión tocada.
  with ses as (
    select distinct e.sesion_id from public.web_eventos e
     where e.sesion_id is not null and e.categoria = 'error'
       and (e.id = any (coalesce(v_ids, array[]::bigint[])) or e.incidencia_id = any (v_reclasificadas))
  ), cuenta as (
    select e.sesion_id, count(*) filter (where e.origen = 'web') as w, count(*) filter (where e.origen = 'externo') as x
      from public.web_eventos e
     where e.sesion_id in (select sesion_id from ses) and e.categoria = 'error'
     group by e.sesion_id
  )
  update public.web_sesiones s
     set errores_web = cuenta.w, errores_externos = cuenta.x
    from cuenta
   where s.sesion_id = cuenta.sesion_id
     and (s.errores_web, s.errores_externos) is distinct from (cuenta.w::integer, cuenta.x::integer);

  -- También las que tienen ocurrencias que salen de las ventanas (cifras al día).
  select array_agg(distinct x) into v_afectadas
    from (select unnest(coalesce(v_afectadas, array[]::bigint[])) as x
          union
          select unnest(v_reclasificadas)
          union
          select id from public.web_incidencias
           where ocurrencias_ventana > 0 or ocurrencias_24h > 0) t;

  if v_afectadas is null then
    return jsonb_build_object('agrupados', 0, 'nuevas', 0, 'reabiertas', 0, 'pendientes_linear', 0);
  end if;

  with st as (
    select e.incidencia_id as id,
           min(e.ocurrido_en) as primera,
           max(e.ocurrido_en) as ultima,
           count(*) filter (where not e.es_bot) as n,
           count(distinct e.sesion_id) filter (where not e.es_bot) as ses,
           -- Para los umbrales solo cuenta lo que afecta a clientes y es de la web (o de un
           -- servicio externo, si así se configura): sin bots, sin pruebas ni tráfico interno
           -- (si así se configura), sin conexión del visitante, navegador ni versión antigua.
           count(*) filter (where not e.es_bot and (not c.excluir_pruebas_tickets or not (e.es_prueba or e.es_interno))
                              and (e.origen = 'web' or (e.origen = 'externo' and c.linear_tickets_externos))
                              and e.ocurrido_en > now() - make_interval(hours => c.umbral_ventana_horas)) as n_ventana,
           count(distinct e.sesion_id) filter (where not e.es_bot and (not c.excluir_pruebas_tickets or not (e.es_prueba or e.es_interno))
                              and (e.origen = 'web' or (e.origen = 'externo' and c.linear_tickets_externos))
                              and e.ocurrido_en > now() - make_interval(hours => c.umbral_ventana_horas)) as ses_ventana,
           count(*) filter (where not e.es_bot and e.tras_publicar in ('sin_impacto', 'sin_datos', 'sin_conexion')) as n_tras_publicar,
           count(*) filter (where not e.es_bot and e.tras_publicar = 'repetido') as n_repetidas,
           count(*) filter (where not e.es_bot and e.ocurrido_en > now() - interval '24 hours') as n24,
           -- Origen: ocurrencias de visitantes reales (sin bots; sin pruebas ni interno si no cuentan).
           count(*) filter (where not e.es_bot and (not c.excluir_pruebas_tickets or not (e.es_prueba or e.es_interno)) and e.origen = 'web') as o_web,
           count(*) filter (where not e.es_bot and (not c.excluir_pruebas_tickets or not (e.es_prueba or e.es_interno)) and e.origen = 'externo') as o_ext,
           count(*) filter (where not e.es_bot and (not c.excluir_pruebas_tickets or not (e.es_prueba or e.es_interno)) and e.origen = 'conexion') as o_con,
           count(*) filter (where not e.es_bot and (not c.excluir_pruebas_tickets or not (e.es_prueba or e.es_interno)) and e.origen = 'navegador') as o_nav,
           count(*) filter (where not e.es_bot and (not c.excluir_pruebas_tickets or not (e.es_prueba or e.es_interno)) and e.origen = 'version_antigua') as o_ver,
           mode() within group (order by public.web_logs_proveedor_externo(e.tipo, e.fuente, e.mensaje, e.pila, e.objetivo))
             filter (where not e.es_bot and e.origen = 'externo') as prov,
           max(case e.gravedad when 'critico' then 4 when 'error' then 3 when 'aviso' then 2 else 1 end) as grav,
           (array_agg(e.version order by e.ocurrido_en) filter (where e.version is not null))[1] as vprim,
           (array_agg(e.version order by e.ocurrido_en desc) filter (where e.version is not null))[1] as vult,
           (array_agg(e.despliegue order by e.ocurrido_en desc) filter (where e.despliegue is not null))[1] as dult
      from public.web_eventos e
     where e.incidencia_id = any (v_afectadas)
     group by e.incidencia_id
  ), st2 as (
    select st.*,
           case
             when st.o_web > 0 then 'web'
             when st.o_ext > 0 then 'externo'
             when st.o_con + st.o_nav + st.o_ver = 0 then 'bots'
             when st.o_nav >= st.o_con and st.o_nav >= st.o_ver then 'navegador'
             when st.o_con >= st.o_ver then 'conexion'
             else 'version_antigua'
           end as origen
      from st
  ), rutas as (
    select r.incidencia_id as id, jsonb_agg(jsonb_build_object('ruta', r.ruta, 'n', r.n) order by r.n desc) as rutas
      from (select e.incidencia_id, coalesce(e.ruta, '(sin ruta)') as ruta, count(*) as n,
                   row_number() over (partition by e.incidencia_id order by count(*) desc) as rk
              from public.web_eventos e
             where e.incidencia_id = any (v_afectadas) and not e.es_bot
             group by e.incidencia_id, coalesce(e.ruta, '(sin ruta)')) r
     where r.rk <= 5
     group by r.incidencia_id
  )
  update public.web_incidencias i
     set primera_vez = st2.primera,
         ultima_vez = st2.ultima,
         ocurrencias = st2.n,
         sesiones_afectadas = st2.ses,
         ocurrencias_ventana = st2.n_ventana,
         sesiones_ventana = st2.ses_ventana,
         ocurrencias_24h = st2.n24,
         gravedad = case st2.grav when 4 then 'critico' when 3 then 'error' when 2 then 'aviso' else 'info' end,
         rutas = coalesce(rutas.rutas, '[]'::jsonb),
         version_primera = st2.vprim,
         version_ultima = st2.vult,
         despliegue_ultimo = st2.dult,
         ocurrencias_tras_publicar = st2.n_tras_publicar,
         repetidas_tras_recargar = st2.n_repetidas,
         origen = st2.origen,
         origen_proveedor = case when st2.origen = 'externo' then left(st2.prov, 120) end,
         actualizado_en = now()
    from st2 left join rutas on rutas.id = st2.id
   where i.id = st2.id
     and (i.ultima_vez, i.ocurrencias, i.ocurrencias_ventana, i.sesiones_ventana, i.ocurrencias_24h, i.sesiones_afectadas, i.rutas,
          i.ocurrencias_tras_publicar, i.repetidas_tras_recargar, i.origen, i.origen_proveedor)
         is distinct from (st2.ultima, st2.n::integer, st2.n_ventana::integer, st2.ses_ventana::integer, st2.n24::integer, st2.ses::integer,
          coalesce(rutas.rutas, '[]'::jsonb), st2.n_tras_publicar::integer, st2.n_repetidas::integer, st2.origen,
          case when st2.origen = 'externo' then left(st2.prov, 120) end);

  -- Incidencias cuyos eventos ya se purgaron: ventanas a cero.
  update public.web_incidencias i
     set ocurrencias_ventana = 0, sesiones_ventana = 0, ocurrencias_24h = 0
   where i.id = any (v_afectadas)
     and not exists (select 1 from public.web_eventos e where e.incidencia_id = i.id)
     and (i.ocurrencias_ventana > 0 or i.ocurrencias_24h > 0);

  -- Patrones ignorados (extensiones del navegador, ruido conocido).
  update public.web_incidencias i
     set estado = 'ignorada', linear_estado = case when i.linear_estado = 'pendiente' then 'no_aplica' else i.linear_estado end,
         motivo_ticket = 'Coincide con un patrón ignorado en Configuración'
   where i.id = any (v_afectadas) and i.estado = 'nueva'
     and exists (select 1 from unnest(c.mensajes_ignorados) p
                  where p <> '' and (position(lower(p) in lower(coalesce(i.mensaje, ''))) > 0
                                     or position(lower(p) in lower(coalesce(i.pila, ''))) > 0));

  -- Pendientes de ticket que ya no pueden abrirlo (no dependen de la web, o externas
  -- con el interruptor apagado): vuelven a «sin ticket». Las pedidas a mano, no.
  update public.web_incidencias i
     set linear_estado = 'sin_ticket', requiere_ticket = false, linear_proximo_intento = null,
         motivo_ticket = case when i.origen = 'externo'
                              then left('Servicio externo (' || coalesce(i.origen_proveedor, 'de fuera') || '): no abre ticket salvo que se active en Configuración', 500)
                              else 'No depende de la web: no abre ticket' end
   where i.id = any (v_afectadas)
     and i.linear_estado in ('pendiente', 'error')
     and not (i.origen = 'web' or (i.origen = 'externo' and c.linear_tickets_externos))
     and coalesce(i.motivo_ticket, '') not like 'Pedido a mano%';

  -- Reaparición de una resuelta: nueva ocurrencia posterior a la resolución.
  --   reabrir      → estado «reabierta» y, si había ticket, se reabre/comenta el mismo.
  --   nuevo_ticket → estado «reabierta» y un ticket NUEVO (id nuevo), enlazando el anterior.
  --   ignorar      → sigue resuelta (las ocurrencias se cuentan igual).
  -- El ticket solo se toca si puede abrirlo (de la web, o externa con el interruptor).
  with r as (
    update public.web_incidencias i
       set estado = 'reabierta',
           reabierta_veces = i.reabierta_veces + 1,
           linear_pendiente_reapertura = (c.reapertura = 'reabrir' and i.linear_estado = 'creado'
                                          and (i.origen = 'web' or (i.origen = 'externo' and c.linear_tickets_externos))),
           linear_estado = case when c.reapertura = 'nuevo_ticket' and i.linear_estado = 'creado'
                                     and (i.origen = 'web' or (i.origen = 'externo' and c.linear_tickets_externos)) then 'sin_ticket' else i.linear_estado end,
           linear_uuid = case when c.reapertura = 'nuevo_ticket' and i.linear_estado = 'creado'
                                   and (i.origen = 'web' or (i.origen = 'externo' and c.linear_tickets_externos)) then gen_random_uuid() else i.linear_uuid end,
           linear_issue_id = case when c.reapertura = 'nuevo_ticket' and i.linear_estado = 'creado'
                                       and (i.origen = 'web' or (i.origen = 'externo' and c.linear_tickets_externos)) then null else i.linear_issue_id end,
           motivo_ticket = case when c.reapertura = 'nuevo_ticket' and i.linear_estado = 'creado'
                                     and (i.origen = 'web' or (i.origen = 'externo' and c.linear_tickets_externos))
                                then left('Reaparecida tras resolverse (ticket anterior: ' || coalesce(i.linear_identificador, i.linear_issue_id, '?') || ')', 500)
                                else i.motivo_ticket end
     where i.id = any (v_afectadas) and i.estado = 'resuelta' and i.resuelta_en is not null
       and c.reapertura <> 'ignorar'
       and exists (select 1 from public.web_eventos e where e.incidencia_id = i.id and e.ocurrido_en > i.resuelta_en and not e.es_bot)
    returning 1
  )
  select count(*) into v_reabiertas from r;

  -- Umbrales de ticket (solo fallos de la web; externos si linear_tickets_externos).
  update public.web_incidencias i
     set requiere_ticket = true,
         linear_estado = 'pendiente',
         linear_proximo_intento = coalesce(i.linear_proximo_intento, now()),
         motivo_ticket = case
           when i.gravedad = 'critico' then 'Gravedad crítica: se abre con la primera ocurrencia'
           when i.tipo = 'error_404' then format('%s 404 en 24 h (umbral %s)', i.ocurrencias_24h, c.umbral_404_diario)
           else format('%s ocurrencias y %s sesiones en %s h (umbral %s y %s)', i.ocurrencias_ventana, i.sesiones_ventana,
                       c.umbral_ventana_horas, c.umbral_ocurrencias, c.umbral_sesiones)
         end || case when i.motivo_ticket like 'Reaparecida%' then ' · ' || i.motivo_ticket else '' end
   where i.id = any (v_afectadas)
     and i.linear_estado = 'sin_ticket'
     and i.estado in ('nueva', 'abierta', 'reabierta')
     and c.linear_modo <> 'desactivado'
     and i.entorno = any (c.entornos_ticket)
     and (i.origen = 'web' or (i.origen = 'externo' and c.linear_tickets_externos))
     and i.ocurrencias_ventana > 0
     and (
       (i.tipo = 'error_404' and c.tickets_404 and i.ocurrencias_24h >= c.umbral_404_diario)
       or (i.tipo <> 'error_404' and (
             i.gravedad = 'critico'
             or (i.ocurrencias_ventana >= c.umbral_ocurrencias
                 and (i.fuente <> 'navegador' or i.sesiones_ventana >= c.umbral_sesiones))))
     );

  select count(*) into v_pendientes from public.web_incidencias
   where linear_estado in ('pendiente', 'error') or linear_pendiente_reapertura;

  return jsonb_build_object('agrupados', coalesce(cardinality(v_ids), 0), 'nuevas', v_nuevas,
                            'reabiertas', v_reabiertas, 'pendientes_linear', v_pendientes);
end;
$$;
revoke all on function public.web_logs_agrupar_errores(integer) from public, anon, authenticated;
grant execute on function public.web_logs_agrupar_errores(integer) to service_role;

-- ─── 4. «Pedir ticket» a mano: el motivo empieza SIEMPRE por «Pedido a mano» ─
-- Antes se conservaba el motivo anterior si lo había, y entonces el proceso no
-- sabía que lo había pedido una persona (las pedidas a mano abren ticket
-- aunque no dependan de la web: es una decisión humana).
create or replace function public.web_incidencia_pedir_ticket(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_modo text;
begin
  if not coalesce(public.is_super_admin(auth.uid()), false) then
    raise exception 'Solo un super admin puede pedir tickets' using errcode = '42501';
  end if;
  select linear_modo into v_modo from public.web_logs_config where id;
  update public.web_incidencias i
     set requiere_ticket = true,
         linear_estado = 'pendiente',
         linear_proximo_intento = now(),
         linear_intentos = 0,
         linear_ultimo_error = null,
         linear_uuid = case when i.linear_destino is not null and i.linear_destino <> v_modo then gen_random_uuid() else i.linear_uuid end,
         linear_issue_id = case when i.linear_destino is not null and i.linear_destino <> v_modo then null else i.linear_issue_id end,
         motivo_ticket = case when coalesce(i.motivo_ticket, '') like 'Pedido a mano%' then i.motivo_ticket
                              else left('Pedido a mano desde Super Admin › Logs' || coalesce(' · ' || nullif(i.motivo_ticket, ''), ''), 500) end,
         estado = case when i.estado = 'ignorada' then 'abierta' else i.estado end
   where i.id = p_id
     and (i.linear_estado <> 'creado' or (i.linear_destino is not null and i.linear_destino <> v_modo));
end;
$$;
revoke all on function public.web_incidencia_pedir_ticket(bigint) from public, anon;
grant execute on function public.web_incidencia_pedir_ticket(bigint) to authenticated;

-- ─── 5. Una sola vez: lo ya guardado ───────────────────────────────────────
update public.web_eventos e
   set origen = public.web_logs_origen_error(e.tipo, e.fuente, e.mensaje, e.pila, e.objetivo, e.propiedades, e.accion, e.tras_publicar)
 where e.categoria = 'error'
   and e.origen is distinct from public.web_logs_origen_error(e.tipo, e.fuente, e.mensaje, e.pila, e.objetivo, e.propiedades, e.accion, e.tras_publicar);

do $$
declare
  c public.web_logs_config;
begin
  select * into c from public.web_logs_config where id;

  with st as (
    select e.incidencia_id as id,
           count(*) filter (where not e.es_bot and (not c.excluir_pruebas_tickets or not (e.es_prueba or e.es_interno))
                              and (e.origen = 'web' or (e.origen = 'externo' and c.linear_tickets_externos))
                              and e.ocurrido_en > now() - make_interval(hours => c.umbral_ventana_horas)) as n_ventana,
           count(distinct e.sesion_id) filter (where not e.es_bot and (not c.excluir_pruebas_tickets or not (e.es_prueba or e.es_interno))
                              and (e.origen = 'web' or (e.origen = 'externo' and c.linear_tickets_externos))
                              and e.ocurrido_en > now() - make_interval(hours => c.umbral_ventana_horas)) as ses_ventana,
           count(*) filter (where not e.es_bot and (not c.excluir_pruebas_tickets or not (e.es_prueba or e.es_interno)) and e.origen = 'web') as o_web,
           count(*) filter (where not e.es_bot and (not c.excluir_pruebas_tickets or not (e.es_prueba or e.es_interno)) and e.origen = 'externo') as o_ext,
           count(*) filter (where not e.es_bot and (not c.excluir_pruebas_tickets or not (e.es_prueba or e.es_interno)) and e.origen = 'conexion') as o_con,
           count(*) filter (where not e.es_bot and (not c.excluir_pruebas_tickets or not (e.es_prueba or e.es_interno)) and e.origen = 'navegador') as o_nav,
           count(*) filter (where not e.es_bot and (not c.excluir_pruebas_tickets or not (e.es_prueba or e.es_interno)) and e.origen = 'version_antigua') as o_ver,
           mode() within group (order by public.web_logs_proveedor_externo(e.tipo, e.fuente, e.mensaje, e.pila, e.objetivo))
             filter (where not e.es_bot and e.origen = 'externo') as prov
      from public.web_eventos e
     where e.incidencia_id is not null
     group by e.incidencia_id
  ), st2 as (
    select st.*,
           case
             when st.o_web > 0 then 'web'
             when st.o_ext > 0 then 'externo'
             when st.o_con + st.o_nav + st.o_ver = 0 then 'bots'
             when st.o_nav >= st.o_con and st.o_nav >= st.o_ver then 'navegador'
             when st.o_con >= st.o_ver then 'conexion'
             else 'version_antigua'
           end as origen
      from st
  )
  update public.web_incidencias i
     set origen = st2.origen,
         origen_proveedor = case when st2.origen = 'externo' then left(st2.prov, 120) end,
         ocurrencias_ventana = st2.n_ventana,
         sesiones_ventana = st2.ses_ventana
    from st2
   where i.id = st2.id;

  -- Errores de la web y externos de cada sesión.
  update public.web_sesiones s
     set errores_web = x.w, errores_externos = x.ex
    from (select e.sesion_id, count(*) filter (where e.origen = 'web')::integer as w, count(*) filter (where e.origen = 'externo')::integer as ex
            from public.web_eventos e
           where e.sesion_id is not null and e.categoria = 'error'
           group by e.sesion_id) x
   where s.sesion_id = x.sesion_id;

  -- Pendientes de ticket que ya no pueden abrirlo (no las pedidas a mano).
  update public.web_incidencias i
     set linear_estado = 'sin_ticket', requiere_ticket = false, linear_proximo_intento = null,
         motivo_ticket = case when i.origen = 'externo'
                              then left('Servicio externo (' || coalesce(i.origen_proveedor, 'de fuera') || '): no abre ticket salvo que se active en Configuración', 500)
                              else 'No depende de la web: no abre ticket' end
   where i.linear_estado in ('pendiente', 'error')
     and not (i.origen = 'web' or (i.origen = 'externo' and c.linear_tickets_externos))
     and coalesce(i.motivo_ticket, '') not like 'Pedido a mano%';
end;
$$;

do $$ begin raise notice 'logs_web_origen: aplicada'; end $$;

commit;
