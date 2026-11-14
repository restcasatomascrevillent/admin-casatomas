-- ===========================================================================
--  Logs web · explicación en sencillo y errores «esperados tras publicar»
--
--  Sin aplicar en producción: demo primero (sfonaclosuafvlhutkon); producción
--  (haqmmdfdzzatdnrrcgez) solo tras aceptar el PR de la release y con el «sí»
--  del dueño. Requiere 20261118100000_logs_web.sql. Idempotente. Tiene que
--  terminar en «logs_web_legibles: aplicada».
--  Deshacer: supabase/rollbacks/20261129143000_logs_web_legibles_ROLLBACK.sql
--  Pruebas: npm run test:logs-web:db (PGlite).
--
--  1. Versión antigua tras publicar. Al publicar, quien tenía la web abierta
--     pide ficheros que ya no existen («Failed to fetch dynamically imported
--     module», «Importing a module script failed», vite:preloadError…). La web
--     decide (web-casatomas, src/lib/recarga-por-version.ts) y lo dice en
--     `accion`: recuperado_tras_recarga (recargó y ya va), recarga_sin_efecto
--     o aviso_version_nueva (recargar no lo arregló), sin_version_nueva (no
--     había publicación nueva: red o fichero que falta) o sin_conexion. Cada
--     ocurrencia se clasifica en web_eventos.tras_publicar:
--       · sin_impacto  → recuperado_tras_recarga; en eventos anteriores a esa
--                        marca, props.recargado o la sesión siguió con actividad;
--       · sin_datos    → no hay nada después (visitante sin «Estadísticas»: su
--                        id cambia en cada carga, así que es lo normal);
--       · sin_conexion → el visitante estaba sin conexión;
--       · repetido     → recarga_sin_efecto, aviso_version_nueva o, en eventos
--                        antiguos, volvió a fallar en la misma sesión tras recargar;
--       · null         → sin_version_nueva y el resto: error normal.
--     Solo «repetido» (y los normales) cuentan para los umbrales de ticket. Los
--     bots no se clasifican (no cuentan nunca). El patrón es el de
--     PATRON_CHUNK_CADUCADO (supabase/functions/_shared/logs-web/huella.ts):
--     si cambia uno, cambia el otro (lo comprueban las pruebas).
--  2. Umbrales: con «no contar pruebas automáticas» tampoco cuenta el tráfico
--     interno (?ct_interno=1): solo lo que afecta a clientes.
--  3. Explicación de la IA en sencillo, UNA vez por incidencia y guardada
--     (explicacion_ia*): solo para errores sin causa conocida. La escribe
--     procesar-logs-web dentro del tope diario de IA de web_logs_config.
--  4. Una sola vez: clasifica los errores ya guardados y devuelve a «sin
--     ticket» las incidencias pendientes que solo tenían errores esperados
--     tras publicar (no las pedidas a mano).
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $$
begin
  if to_regclass('public.web_eventos') is null or to_regclass('public.web_incidencias') is null then
    raise exception 'logs_web_legibles: falta 20261118100000_logs_web.sql. No se ha cambiado nada.';
  end if;
end;
$$;

-- ─── 1. Columnas ────────────────────────────────────────────────────────────
alter table public.web_eventos add column if not exists tras_publicar text;
-- Se rehace siempre (idempotente): así una versión anterior de esta migración queda al día.
alter table public.web_eventos drop constraint if exists web_eventos_tras_publicar_chk;
alter table public.web_eventos add constraint web_eventos_tras_publicar_chk
  check (tras_publicar is null or tras_publicar in ('sin_impacto', 'sin_datos', 'sin_conexion', 'repetido'));
comment on column public.web_eventos.tras_publicar is
  'Solo errores de «versión antigua tras publicar»: sin_impacto (se recargó y siguió), sin_datos (no hay nada después), sin_conexion (visitante sin red), repetido (recargar no lo arregló; es lo único de estos que cuenta para los umbrales). Lo pone web_logs_clasificar_tras_publicar() a partir de `accion` (o, en eventos antiguos, de la sesión).';

alter table public.web_incidencias add column if not exists ocurrencias_tras_publicar integer not null default 0;
alter table public.web_incidencias add column if not exists repetidas_tras_recargar   integer not null default 0;
alter table public.web_incidencias add column if not exists explicacion_ia          jsonb;
alter table public.web_incidencias add column if not exists explicacion_ia_en       timestamptz;
alter table public.web_incidencias add column if not exists explicacion_ia_error    text;
alter table public.web_incidencias add column if not exists explicacion_ia_intentos smallint not null default 0;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'web_incidencias_explicacion_ia_chk') then
    alter table public.web_incidencias add constraint web_incidencias_explicacion_ia_chk check (
      (explicacion_ia is null or (jsonb_typeof(explicacion_ia) = 'object' and length(explicacion_ia::text) <= 4000))
      and (explicacion_ia_error is null or length(explicacion_ia_error) <= 500));
  end if;
end;
$$;
comment on column public.web_incidencias.explicacion_ia is
  'Explicación en sencillo para el dueño (IA · sin comprobar): {que_paso, a_quien_afecta, que_hacer, gravedad, modelo}. Una vez por incidencia, solo si no tiene causa conocida. La escribe procesar-logs-web.';
comment on column public.web_incidencias.ocurrencias_tras_publicar is
  'Ocurrencias (sin bots) de «versión antigua tras publicar» que no cuentan para los umbrales (sin_impacto + sin_datos + sin_conexion).';
comment on column public.web_incidencias.repetidas_tras_recargar is
  'Ocurrencias (sin bots) que no se arreglaron al recargar (recarga_sin_efecto, aviso_version_nueva o repetidas en la misma sesión): estas sí cuentan.';

-- ─── 2. ¿Es un error de «versión antigua tras publicar»? ────────────────────
create or replace function public.web_logs_es_version_antigua(p_tipo text, p_mensaje text, p_pila text, p_objetivo text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_tipo in ('error_js', 'error_promesa', 'error_react') then
      (coalesce(p_mensaje, '') || E'\n' || coalesce(p_pila, ''))
        ~* 'failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module|unable to preload css|chunkloaderror|loading (css )?chunk \S+ failed|''text/html'' is not a valid javascript mime type'
    when p_tipo = 'error_recurso' then
      coalesce(p_objetivo, '') ~ '/assets/[^/?#]+-[A-Za-z0-9_-]{8}\.(m?js|css)($|[?#])'
    else false
  end;
$$;
revoke all on function public.web_logs_es_version_antigua(text, text, text, text) from public, anon;
grant execute on function public.web_logs_es_version_antigua(text, text, text, text) to authenticated, service_role;

-- Clasifica las ocurrencias desde p_desde. Devuelve las incidencias con algún cambio.
create or replace function public.web_logs_clasificar_tras_publicar(p_desde timestamptz)
returns bigint[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids bigint[];
begin
  with cand as (
    -- Errores de carga marcados por la web (accion) o, sin marca, con el patrón de versión antigua.
    -- Los bots no se clasifican: llevan horas falsas y nunca cuentan.
    select e.id, e.sesion_id, e.ocurrido_en, e.propiedades, e.incidencia_id, e.accion
      from public.web_eventos e
     where e.categoria = 'error'
       and not e.es_bot
       and e.ocurrido_en >= p_desde
       and e.tipo in ('error_js', 'error_promesa', 'error_react', 'error_recurso')
       and (e.accion in ('recuperado_tras_recarga', 'recarga_sin_efecto', 'aviso_version_nueva', 'sin_version_nueva', 'sin_conexion')
            or public.web_logs_es_version_antigua(e.tipo, e.mensaje, e.pila, e.objetivo))
  ), nueva as (
    select c.id,
           case
             -- 1) Lo que dice la web (señal principal).
             when c.accion = 'recuperado_tras_recarga' then 'sin_impacto'
             when c.accion in ('recarga_sin_efecto', 'aviso_version_nueva') then 'repetido'
             when c.accion = 'sin_conexion' then 'sin_conexion'
             when c.accion = 'sin_version_nueva' then null -- no era versión antigua: error normal
             -- 2) Eventos anteriores a esa marca: lo mandó la página YA recargada.
             when coalesce(c.propiedades ->> 'recargado', '') = 'true' then 'sin_impacto'
             -- Antes, en la misma sesión, ya falló y se recargó (aviso «recargado» o una carga
             -- completa de página entre medias): ha vuelto a fallar tras recargar.
             when c.sesion_id is not null and exists (
               select 1 from public.web_eventos y
                where y.sesion_id = c.sesion_id and y.id <> c.id and y.categoria = 'error' and not y.es_bot
                  and y.ocurrido_en < c.ocurrido_en
                  and public.web_logs_es_version_antigua(y.tipo, y.mensaje, y.pila, y.objetivo)
                  and (coalesce(y.propiedades ->> 'recargado', '') = 'true'
                       or exists (select 1 from public.web_eventos p
                                   where p.sesion_id = c.sesion_id and p.tipo = 'pagina_vista' and not p.es_bot
                                     and p.propiedades ->> 'navegacion' = 'inicial'
                                     and p.ocurrido_en > y.ocurrido_en and p.ocurrido_en < c.ocurrido_en))) then 'repetido'
             -- La sesión siguió con actividad después: funciona.
             when c.sesion_id is not null and exists (
               select 1 from public.web_eventos x
                where x.sesion_id = c.sesion_id and x.categoria <> 'error' and not x.es_bot and x.ocurrido_en > c.ocurrido_en) then 'sin_impacto'
             -- Sin consentimiento el id cambia en cada carga: no ver nada después es lo normal.
             else 'sin_datos'
           end as clase
      from cand c
  ), cambiadas as (
    update public.web_eventos e
       set tras_publicar = n.clase
      from nueva n
     where e.id = n.id and e.tras_publicar is distinct from n.clase
    returning e.incidencia_id
  )
  select array_agg(distinct incidencia_id) filter (where incidencia_id is not null) into v_ids from cambiadas;
  return coalesce(v_ids, array[]::bigint[]);
end;
$$;
revoke all on function public.web_logs_clasificar_tras_publicar(timestamptz) from public, anon, authenticated;
grant execute on function public.web_logs_clasificar_tras_publicar(timestamptz) to service_role;

-- ─── 3. Agrupación con los umbrales nuevos ─────────────────────────────────
-- Igual que en 20261118100000 salvo: clasifica «tras publicar», no cuenta para
-- los umbrales lo que no afecta a clientes (ver arriba) y guarda las cifras
-- ocurrencias_tras_publicar / repetidas_tras_recargar.
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
           -- Para los umbrales solo cuenta lo que afecta a clientes: sin bots, sin pruebas ni
           -- tráfico interno (si así se configura) y sin «versión antigua tras publicar» que se
           -- arregló sola, de la que no hay datos o sin conexión (sí cuenta si recargar no lo arregló).
           count(*) filter (where not e.es_bot and (not c.excluir_pruebas_tickets or not (e.es_prueba or e.es_interno))
                              and coalesce(e.tras_publicar, '-') not in ('sin_impacto', 'sin_datos', 'sin_conexion')
                              and e.ocurrido_en > now() - make_interval(hours => c.umbral_ventana_horas)) as n_ventana,
           count(distinct e.sesion_id) filter (where not e.es_bot and (not c.excluir_pruebas_tickets or not (e.es_prueba or e.es_interno))
                              and coalesce(e.tras_publicar, '-') not in ('sin_impacto', 'sin_datos', 'sin_conexion')
                              and e.ocurrido_en > now() - make_interval(hours => c.umbral_ventana_horas)) as ses_ventana,
           count(*) filter (where not e.es_bot and e.tras_publicar in ('sin_impacto', 'sin_datos', 'sin_conexion')) as n_tras_publicar,
           count(*) filter (where not e.es_bot and e.tras_publicar = 'repetido') as n_repetidas,
           count(*) filter (where not e.es_bot and e.ocurrido_en > now() - interval '24 hours') as n24,
           max(case e.gravedad when 'critico' then 4 when 'error' then 3 when 'aviso' then 2 else 1 end) as grav,
           (array_agg(e.version order by e.ocurrido_en) filter (where e.version is not null))[1] as vprim,
           (array_agg(e.version order by e.ocurrido_en desc) filter (where e.version is not null))[1] as vult,
           (array_agg(e.despliegue order by e.ocurrido_en desc) filter (where e.despliegue is not null))[1] as dult
      from public.web_eventos e
     where e.incidencia_id = any (v_afectadas)
     group by e.incidencia_id
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
     set primera_vez = st.primera,
         ultima_vez = st.ultima,
         ocurrencias = st.n,
         sesiones_afectadas = st.ses,
         ocurrencias_ventana = st.n_ventana,
         sesiones_ventana = st.ses_ventana,
         ocurrencias_24h = st.n24,
         gravedad = case st.grav when 4 then 'critico' when 3 then 'error' when 2 then 'aviso' else 'info' end,
         rutas = coalesce(rutas.rutas, '[]'::jsonb),
         version_primera = st.vprim,
         version_ultima = st.vult,
         despliegue_ultimo = st.dult,
         ocurrencias_tras_publicar = st.n_tras_publicar,
         repetidas_tras_recargar = st.n_repetidas,
         actualizado_en = now()
    from st left join rutas on rutas.id = st.id
   where i.id = st.id
     and (i.ultima_vez, i.ocurrencias, i.ocurrencias_ventana, i.sesiones_ventana, i.ocurrencias_24h, i.sesiones_afectadas, i.rutas,
          i.ocurrencias_tras_publicar, i.repetidas_tras_recargar)
         is distinct from (st.ultima, st.n::integer, st.n_ventana::integer, st.ses_ventana::integer, st.n24::integer, st.ses::integer,
          coalesce(rutas.rutas, '[]'::jsonb), st.n_tras_publicar::integer, st.n_repetidas::integer);

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

  -- Reaparición de una resuelta: nueva ocurrencia posterior a la resolución.
  --   reabrir      → estado «reabierta» y, si había ticket, se reabre/comenta el mismo.
  --   nuevo_ticket → estado «reabierta» y un ticket NUEVO (id nuevo), enlazando el anterior.
  --   ignorar      → sigue resuelta (las ocurrencias se cuentan igual).
  with r as (
    update public.web_incidencias i
       set estado = 'reabierta',
           reabierta_veces = i.reabierta_veces + 1,
           linear_pendiente_reapertura = (c.reapertura = 'reabrir' and i.linear_estado = 'creado'),
           linear_estado = case when c.reapertura = 'nuevo_ticket' and i.linear_estado = 'creado' then 'sin_ticket' else i.linear_estado end,
           linear_uuid = case when c.reapertura = 'nuevo_ticket' and i.linear_estado = 'creado' then gen_random_uuid() else i.linear_uuid end,
           linear_issue_id = case when c.reapertura = 'nuevo_ticket' and i.linear_estado = 'creado' then null else i.linear_issue_id end,
           motivo_ticket = case when c.reapertura = 'nuevo_ticket' and i.linear_estado = 'creado'
                                then left('Reaparecida tras resolverse (ticket anterior: ' || coalesce(i.linear_identificador, i.linear_issue_id, '?') || ')', 500)
                                else i.motivo_ticket end
     where i.id = any (v_afectadas) and i.estado = 'resuelta' and i.resuelta_en is not null
       and c.reapertura <> 'ignorar'
       and exists (select 1 from public.web_eventos e where e.incidencia_id = i.id and e.ocurrido_en > i.resuelta_en and not e.es_bot)
    returning 1
  )
  select count(*) into v_reabiertas from r;

  -- Umbrales de ticket.
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

-- ─── 4. Una sola vez: lo ya guardado ───────────────────────────────────────
update public.web_eventos set tras_publicar = null where es_bot and tras_publicar is not null;
select public.web_logs_clasificar_tras_publicar('-infinity'::timestamptz);

do $$
declare
  c public.web_logs_config;
begin
  select * into c from public.web_logs_config where id;
  with afectadas as (
    select distinct e.incidencia_id as id
      from public.web_eventos e
     where e.incidencia_id is not null and (e.tras_publicar is not null or e.es_interno)
  ), st as (
    select e.incidencia_id as id,
           count(*) filter (where not e.es_bot and e.tras_publicar in ('sin_impacto', 'sin_datos', 'sin_conexion')) as n_tras,
           count(*) filter (where not e.es_bot and e.tras_publicar = 'repetido') as n_rep,
           count(*) filter (where not e.es_bot and (not c.excluir_pruebas_tickets or not (e.es_prueba or e.es_interno))
                              and coalesce(e.tras_publicar, '-') not in ('sin_impacto', 'sin_datos', 'sin_conexion')
                              and e.ocurrido_en > now() - make_interval(hours => c.umbral_ventana_horas)) as n_ventana,
           count(distinct e.sesion_id) filter (where not e.es_bot and (not c.excluir_pruebas_tickets or not (e.es_prueba or e.es_interno))
                              and coalesce(e.tras_publicar, '-') not in ('sin_impacto', 'sin_datos', 'sin_conexion')
                              and e.ocurrido_en > now() - make_interval(hours => c.umbral_ventana_horas)) as ses_ventana
      from public.web_eventos e
     where e.incidencia_id in (select id from afectadas)
     group by e.incidencia_id
  )
  update public.web_incidencias i
     set ocurrencias_tras_publicar = st.n_tras,
         repetidas_tras_recargar = st.n_rep,
         ocurrencias_ventana = st.n_ventana,
         sesiones_ventana = st.ses_ventana
    from st
   where i.id = st.id;

  -- Pendientes de ticket que solo tenían errores esperados tras publicar (no las pedidas a mano).
  update public.web_incidencias i
     set linear_estado = 'sin_ticket', requiere_ticket = false, linear_proximo_intento = null,
         motivo_ticket = 'Error esperado tras publicar (página antigua que se recarga sola): no abre ticket salvo que se repita tras recargar'
   where i.linear_estado in ('pendiente', 'error')
     and coalesce(i.motivo_ticket, '') not like 'Pedido a mano%'
     and i.ocurrencias_tras_publicar > 0
     and i.repetidas_tras_recargar = 0
     and not exists (select 1 from public.web_eventos e
                      where e.incidencia_id = i.id and not e.es_bot and e.tras_publicar is null);
end;
$$;

do $$ begin raise notice 'logs_web_legibles: aplicada'; end $$;

commit;
