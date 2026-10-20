-- ===========================================================================
-- ##                                                                       ##
-- ##                          SIN APLICAR                                  ##
-- ##                                                                       ##
-- ##   Escrita 2026-09-23 (cambio SDD `trafico-web`, Fase 1). NO se ha     ##
-- ##   aplicado a produccion. Antes de aplicarla, leer el CHECKLIST del    ##
-- ##   final: el cron queda instalado pero MUDO hasta que exista el        ##
-- ##   secreto de Vault `trafico_web_cron_secret`, y ese secreto solo se   ##
-- ##   debe crear DESPUES de desplegar la Edge Function (Fase 2).          ##
-- ##                                                                       ##
-- ===========================================================================
--
-- TRAFICO WEB: visitas diarias de casa-tomas-story y touza-restaurant-website
-- (Vercel Web Analytics) + estimacion de Fast Data Transfer (FDT).
-- ---------------------------------------------------------------------------
-- Flujo:
--   pg_cron 03:30 UTC --net.http_post(x-webhook-secret de Vault)--> Edge
--   Function `sync-trafico-web` (Fase 2) --> Vercel /v1/query/web-analytics
--   --> upsert en trafico_web_diario / trafico_web_desglose (service_role)
--   --> trafico_web_sync_estado.
--   Panel /trafico-web --supabase.rpc()--> trafico_web_* (security invoker,
--   asi que la RLS de las tablas se aplica tal cual al usuario del panel).
--
-- QUE CREA
--   1. 4 tablas: trafico_web_diario, trafico_web_desglose, peso_paginas,
--      trafico_web_sync_estado.
--   2. RLS: SELECT -> can_read_section('trafico_web'); escritura solo
--      service_role, salvo peso_paginas (editable con
--      can_write_section('trafico_web') desde el panel).
--   3. Semilla de peso_paginas (ruta '*' = peso medio por visita del
--      proyecto). VALORES PROVISIONALES, ver PIEZA 3.
--   4. 5 RPC de estadistica (serie+anomalias, tendencia, FDT del mes, top
--      paginas, desgloses).
--   5. Job pg_cron `sync-trafico-web` (idempotente).
--
-- CONTRATO DE LA API DE VERCEL (verificado en vivo el 2026-09-23)
--   /visits/aggregate devuelve data:[{timestamp, <dimension>: valor,
--   pageviews, visitors}] (dias sin trafico rellenos con 0). Se guardan
--   `visitas` (pageviews) y `visitantes` (visitors), este ultimo NULLABLE: si
--   la API no lo devuelve se guarda NULL y la UI pinta "sin datos", nunca 0.
--   device/country/referrer tambien pueden faltar: la tabla de desgloses
--   simplemente queda vacia para esa dimension.
--
-- Todo el FDT es una ESTIMACION (visitas x bytes_por_visita). La cifra real
-- solo la da el dashboard de uso de Vercel. Limite: 100 GB = 100e9 bytes
-- (GB decimales, como factura Vercel).
--
-- Re-ejecutable: todo usa IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS /
-- ON CONFLICT DO NOTHING, y el cron hace unschedule-si-existe.
-- ===========================================================================

begin;

-- ============================================================================
-- PIEZA 1 — Tablas
-- ----------------------------------------------------------------------------
-- Volumen esperado: 2 proyectos x ~50 rutas x 365 dias ~ 36k filas/año en
-- trafico_web_diario, y algo parecido en desgloses. Las PK (fecha primero)
-- ya sirven los filtros por rango de fechas de todas las RPC; no se crean
-- indices adicionales hasta que haya un plan que lo pida.
-- ============================================================================

-- Visitas por dia, proyecto y ruta. ruta='*' es la fila de TOTALES del dia
-- (centinela dentro de la PK, en vez de NULL, para que el upsert sea simple).
-- Las filas por ruta pueden no sumar el total si la API solo devuelve el top
-- N de rutas: la RPC de FDT reparte ese remanente con el peso medio.
create table if not exists public.trafico_web_diario (
  fecha            date        not null,
  proyecto         text        not null
                   check (proyecto in ('casa-tomas-story', 'touza-restaurant-website')),
  ruta             text        not null default '*'
                   check (length(ruta) between 1 and 2048),
  visitas          integer     not null check (visitas >= 0),
  visitantes       integer              check (visitantes >= 0),
  sincronizado_en  timestamptz not null default now(),
  primary key (fecha, proyecto, ruta)
);

comment on table public.trafico_web_diario is
  'Snapshot diario de Vercel Web Analytics por proyecto y ruta. ruta=''*'' = total del dia. Solo escribe la Edge Function sync-trafico-web (service_role). visitantes NULL = la API no lo devolvio (mostrar "sin datos", nunca 0).';
comment on column public.trafico_web_diario.visitas is
  'Pageviews del dia (campo `pageviews` de /visits/aggregate).';
comment on column public.trafico_web_diario.visitantes is
  'Visitantes unicos (campo `visitors`). NULL si la API no lo da.';

-- Desgloses por dimension (device/country/referrer) en una sola tabla
-- generica. `valor` no admite NULL (esta en la PK): la Edge Function debe
-- normalizar el valor vacio (p.ej. referrer directo) a un literal.
create table if not exists public.trafico_web_desglose (
  fecha            date        not null,
  proyecto         text        not null
                   check (proyecto in ('casa-tomas-story', 'touza-restaurant-website')),
  dimension        text        not null
                   check (dimension in ('device', 'country', 'referrer')),
  valor            text        not null check (length(valor) between 1 and 2048),
  visitas          integer     not null check (visitas >= 0),
  visitantes       integer              check (visitantes >= 0),
  sincronizado_en  timestamptz not null default now(),
  primary key (fecha, proyecto, dimension, valor)
);

comment on table public.trafico_web_desglose is
  'Visitas por dia, proyecto y dimension (device|country|referrer). Vacia para una dimension si la API no la ofrece.';

-- Peso medio transferido por visita, para ESTIMAR el FDT.
-- ruta='*' = peso medio del proyecto (fallback para rutas sin peso propio y
-- para el remanente de visitas no desglosadas por ruta).
create table if not exists public.peso_paginas (
  proyecto          text        not null
                    check (proyecto in ('casa-tomas-story', 'touza-restaurant-website')),
  ruta              text        not null default '*'
                    check (length(ruta) between 1 and 2048),
  bytes_por_visita  bigint      not null check (bytes_por_visita > 0),
  nota              text,
  actualizado_en    timestamptz not null default now(),
  primary key (proyecto, ruta)
);

comment on table public.peso_paginas is
  'Bytes transferidos por visita (ESTIMACION). ruta=''*'' = media del proyecto, usada como fallback. Editable desde /trafico-web con permiso de escritura en la seccion trafico_web. El panel debe fijar actualizado_en=now() al editar.';

-- Estado del ultimo sync por proyecto (para el aviso de sync obsoleto, R5).
create table if not exists public.trafico_web_sync_estado (
  proyecto             text        primary key
                       check (proyecto in ('casa-tomas-story', 'touza-restaurant-website')),
  ultimo_ok_en         timestamptz,
  ultimo_intento_en    timestamptz,
  ultimo_error         text,
  fallos_consecutivos  integer     not null default 0 check (fallos_consecutivos >= 0),
  dias_ultimo_sync     integer              check (dias_ultimo_sync >= 0)
);

comment on table public.trafico_web_sync_estado is
  'Una fila por proyecto. ultimo_ok_en NULL = nunca sincronizado (el primer run hace backfill). Aviso en el panel si now()-ultimo_ok_en > 48h o si el ultimo intento dejo ultimo_error.';


-- ============================================================================
-- PIEZA 2 — RLS y privilegios
-- ----------------------------------------------------------------------------
-- Mismo modelo que 20260918120000_rls_por_permisos_de_seccion.sql:
--   SELECT                -> can_read_section('trafico_web')  (admin siempre)
--   escritura             -> solo service_role (Edge Function)
--   peso_paginas escribe  -> can_write_section('trafico_web')
-- La llamada va envuelta en (select ...) para que Postgres la evalue una vez
-- por consulta (InitPlan) y no una vez por fila.
-- anon no tiene nada que hacer aqui: se le retiran los privilegios que
-- Supabase concede por defecto a las tablas nuevas de public.
-- ============================================================================

alter table public.trafico_web_diario      enable row level security;
alter table public.trafico_web_desglose    enable row level security;
alter table public.peso_paginas            enable row level security;
alter table public.trafico_web_sync_estado enable row level security;

revoke all on public.trafico_web_diario      from anon, authenticated;
revoke all on public.trafico_web_desglose    from anon, authenticated;
revoke all on public.peso_paginas            from anon, authenticated;
revoke all on public.trafico_web_sync_estado from anon, authenticated;

grant select on public.trafico_web_diario      to authenticated;
grant select on public.trafico_web_desglose    to authenticated;
grant select on public.trafico_web_sync_estado to authenticated;
grant select, insert, update, delete on public.peso_paginas to authenticated;

grant all on public.trafico_web_diario      to service_role;
grant all on public.trafico_web_desglose    to service_role;
grant all on public.peso_paginas            to service_role;
grant all on public.trafico_web_sync_estado to service_role;

-- trafico_web_diario
drop policy if exists "trafico_web_diario_select_seccion" on public.trafico_web_diario;
create policy "trafico_web_diario_select_seccion" on public.trafico_web_diario
  for select to authenticated
  using ((select public.can_read_section('trafico_web')));
drop policy if exists "trafico_web_diario_service_role" on public.trafico_web_diario;
create policy "trafico_web_diario_service_role" on public.trafico_web_diario
  for all to service_role using (true) with check (true);

-- trafico_web_desglose
drop policy if exists "trafico_web_desglose_select_seccion" on public.trafico_web_desglose;
create policy "trafico_web_desglose_select_seccion" on public.trafico_web_desglose
  for select to authenticated
  using ((select public.can_read_section('trafico_web')));
drop policy if exists "trafico_web_desglose_service_role" on public.trafico_web_desglose;
create policy "trafico_web_desglose_service_role" on public.trafico_web_desglose
  for all to service_role using (true) with check (true);

-- trafico_web_sync_estado
drop policy if exists "trafico_web_sync_estado_select_seccion" on public.trafico_web_sync_estado;
create policy "trafico_web_sync_estado_select_seccion" on public.trafico_web_sync_estado
  for select to authenticated
  using ((select public.can_read_section('trafico_web')));
drop policy if exists "trafico_web_sync_estado_service_role" on public.trafico_web_sync_estado;
create policy "trafico_web_sync_estado_service_role" on public.trafico_web_sync_estado
  for all to service_role using (true) with check (true);

-- peso_paginas (la unica editable desde el panel)
drop policy if exists "peso_paginas_select_seccion" on public.peso_paginas;
create policy "peso_paginas_select_seccion" on public.peso_paginas
  for select to authenticated
  using ((select public.can_read_section('trafico_web')));
drop policy if exists "peso_paginas_insert_seccion" on public.peso_paginas;
create policy "peso_paginas_insert_seccion" on public.peso_paginas
  for insert to authenticated
  with check ((select public.can_write_section('trafico_web')));
drop policy if exists "peso_paginas_update_seccion" on public.peso_paginas;
create policy "peso_paginas_update_seccion" on public.peso_paginas
  for update to authenticated
  using ((select public.can_write_section('trafico_web')))
  with check ((select public.can_write_section('trafico_web')));
drop policy if exists "peso_paginas_delete_seccion" on public.peso_paginas;
create policy "peso_paginas_delete_seccion" on public.peso_paginas
  for delete to authenticated
  using ((select public.can_write_section('trafico_web')));
drop policy if exists "peso_paginas_service_role" on public.peso_paginas;
create policy "peso_paginas_service_role" on public.peso_paginas
  for all to service_role using (true) with check (true);


-- ============================================================================
-- PIEZA 3 — Semilla de peso_paginas (PROVISIONAL)
-- ----------------------------------------------------------------------------
-- Tarea 0.3 (medir transfer size real por ruta con DevTools) sigue pendiente.
-- Mientras tanto, un peso medio por proyecto:
--   casa-tomas-story          ~2.5 MB/visita (Three.js code-split + imagenes)
--   touza-restaurant-website  ~1.5 MB/visita
-- ON CONFLICT DO NOTHING: re-ejecutar la migracion no pisa lo que se haya
-- corregido despues desde el panel. Las rutas medidas se anaden luego desde
-- el editor de pesos (o con un INSERT aparte), no aqui.
-- ============================================================================

insert into public.peso_paginas (proyecto, ruta, bytes_por_visita, nota) values
  ('casa-tomas-story',         '*', 2500000,
   'ESTIMACION PROVISIONAL (2026-09-23): ~2.5 MB/visita sin medir. Sustituir tras medir transfer size real (tarea 0.3).'),
  ('touza-restaurant-website', '*', 1500000,
   'ESTIMACION PROVISIONAL (2026-09-23): ~1.5 MB/visita sin medir. Sustituir tras medir transfer size real (tarea 0.3).')
on conflict (proyecto, ruta) do nothing;


-- ============================================================================
-- PIEZA 4 — RPC de estadistica
-- ----------------------------------------------------------------------------
-- Todas: language sql, STABLE, SECURITY INVOKER (la RLS de las tablas se
-- aplica al usuario que llama: sin permiso -> 0 filas / NULL), search_path=''
-- (todo va cualificado con esquema). p_proyecto NULL = las dos webs sumadas.
-- Un dia sin sincronizar NO es 0 visitas: los huecos salen como NULL
-- (generate_series + left join) y avg/stddev los ignoran.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 4.1 trafico_web_serie — serie diaria con medias moviles y anomalias
--   R1: linea base de anomalia = los 8 mismos dias de la semana (isodow)
--       ANTERIORES, sin contar el propio dia (que una anomalia no infle su
--       propia sigma y que los fines de semana no salten siempre).
--       |z| > 2 -> anomalia. Si hay < 3 muestras o sigma = 0 -> z y
--       es_anomalia = NULL (no false: "no se puede saber").
--   R2: las bandas +-1/+-2 sigma se pintan en el cliente como
--       media_dow +- k*desv_dow; un punto fuera de la banda 2 sigma es
--       exactamente es_anomalia = true.
--   Se cargan 60 dias de calentamiento antes de p_desde para que las
--   ventanas (30 dias, 8 semanas) ya esten llenas en el primer dia pedido.
-- ---------------------------------------------------------------------------
create or replace function public.trafico_web_serie(
  p_proyecto text default null,
  p_desde    date default (current_date - 90),
  p_hasta    date default (current_date - 1)
)
returns table (
  fecha           date,
  visitas         bigint,
  visitantes      bigint,
  media_7         numeric,
  media_30        numeric,
  desv_30         numeric,
  media_dow       numeric,
  desv_dow        numeric,
  n_dow           integer,
  z_dow           numeric,
  desviacion_pct  numeric,
  es_anomalia     boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with dias as (
    select (p_desde - 60) + i as dia
    from generate_series(0, greatest(p_hasta - (p_desde - 60), -1)) as i
  ),
  tot as (
    select t.fecha as dia,
           sum(t.visitas) as v,
           -- visitantes solo si TODAS las filas sumadas lo traen; si no, NULL
           case when count(t.visitantes) = count(*) then sum(t.visitantes) end as vis
    from public.trafico_web_diario t
    where t.ruta = '*'
      and (p_proyecto is null or t.proyecto = p_proyecto)
      and t.fecha between p_desde - 60 and p_hasta
    group by t.fecha
  ),
  s as (
    select d.dia,
           tot.v::bigint   as v,
           tot.vis::bigint as vis,
           extract(isodow from d.dia)::int as dow
    from dias d
    left join tot on tot.dia = d.dia
  ),
  w as (
    select s.dia, s.v, s.vis,
           avg(s.v)          over w7   as m7,
           avg(s.v)          over w30  as m30,
           stddev_samp(s.v)  over w30  as sd30,
           avg(s.v)          over wdow as mdow,
           stddev_samp(s.v)  over wdow as sddow,
           count(s.v)        over wdow as ndow
    from s
    window
      w7   as (order by s.dia rows between 6 preceding and current row),
      w30  as (order by s.dia rows between 29 preceding and current row),
      wdow as (partition by s.dow order by s.dia rows between 8 preceding and 1 preceding)
  ),
  z as (
    select w.*,
           case when w.v is not null and w.ndow >= 3 and w.sddow > 0
                then (w.v - w.mdow) / w.sddow end as zz
    from w
  )
  select z.dia,
         z.v,
         z.vis,
         round(z.m7, 2),
         round(z.m30, 2),
         round(z.sd30, 2),
         round(z.mdow, 2),
         round(z.sddow, 2),
         z.ndow::int,
         round(z.zz, 3),
         case when z.v is not null and z.mdow > 0
              then round(100 * (z.v - z.mdow) / z.mdow, 2) end,
         case when z.zz is not null then abs(z.zz) > 2 end
  from z
  where z.dia between p_desde and p_hasta
  order by z.dia;
$$;

comment on function public.trafico_web_serie(text, date, date) is
  'Serie diaria de visitas (ruta=''*'') con media movil 7/30, sigma 30, media/sigma de los 8 mismos isodow anteriores, z y anomalia (|z|>2; NULL si n<3 o sigma=0). Huecos = NULL. p_proyecto NULL = ambas webs.';

-- ---------------------------------------------------------------------------
-- 4.2 trafico_web_tendencia — regresion lineal de visitas/dia
--   x = fecha - current_date (x=0 es hoy, asi el intercepto es "el valor de
--   hoy"), y = visitas del dia. Solo dias cerrados (< hoy) con dato.
--   R6: fiable = n >= 14. Con < 2 puntos no hay recta: pendiente,
--   proyeccion y total_30d = NULL (no una proyeccion de ceros).
-- ---------------------------------------------------------------------------
create or replace function public.trafico_web_tendencia(
  p_proyecto text    default null,
  p_dias     integer default 90
)
returns table (
  pendiente   numeric,
  intercepto  numeric,
  r2          numeric,
  n           integer,
  fiable      boolean,
  proyeccion  jsonb,
  total_30d   numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with t as (
    select (d.fecha - current_date)::float8 as x,
           sum(d.visitas)::float8          as y
    from public.trafico_web_diario d
    where d.ruta = '*'
      and (p_proyecto is null or d.proyecto = p_proyecto)
      and d.fecha >= current_date - least(greatest(coalesce(p_dias, 90), 1), 3650)
      and d.fecha <  current_date
    group by d.fecha
  ),
  r as (
    select regr_slope(t.y, t.x)     as b,
           regr_intercept(t.y, t.x) as a,
           regr_r2(t.y, t.x)        as r2,
           regr_count(t.y, t.x)::int as n
    from t
  )
  select round(r.b::numeric, 4),
         round(r.a::numeric, 2),
         round(r.r2::numeric, 4),
         r.n,
         r.n >= 14,
         case when r.b is not null then (
           select jsonb_agg(
                    jsonb_build_object(
                      'fecha',   current_date + k,
                      'visitas', round(greatest(0, r.a + r.b * k)::numeric, 1))
                    order by k)
           from generate_series(1, 30) as k
         ) end,
         case when r.b is not null then (
           select round(sum(greatest(0, r.a + r.b * k))::numeric, 0)
           from generate_series(1, 30) as k
         ) end
  from r;
$$;

comment on function public.trafico_web_tendencia(text, integer) is
  'Regresion lineal de visitas diarias (ultimos p_dias dias cerrados). x=0 es hoy. fiable = n>=14 (R6). proyeccion = 30 dias siguientes [{fecha, visitas}], truncada a >= 0.';

-- ---------------------------------------------------------------------------
-- 4.3 trafico_web_fdt_mes — FDT ESTIMADO del mes y proyecciones
--   Bytes de un dia y proyecto =
--       sum_rutas( v_r * coalesce(w_r, w_*) )
--     + greatest(0, V_total - sum_rutas v_r) * w_*
--   (el segundo termino reparte las visitas que la API no desglosa por ruta
--    fuera de su top N con el peso medio del proyecto).
--   Si hace falta un peso y no hay ninguno (ni el de la ruta ni el '*') el
--   dia queda NULL: se prefiere "sin estimacion" a una cifra por debajo.
--   Solo cuentan dias cerrados (< hoy).
--   Proyeccion lineal    = acumulado / dias_con_dato * dias_del_mes.
--   Proyeccion regresion = acumulado + sum_{dias restantes}(a + b*k)
--                          * bytes medios por visita del mes (a, b de
--                          trafico_web_tendencia a 90 dias).
--   R4: alerta_80 = max(proy_lineal, proy_regresion) > 80e9.
--   Filas: una por proyecto + proyecto='*' (suma de ambos; es la que cuenta
--   para el limite de 100 GB de la cuenta de Vercel).
-- ---------------------------------------------------------------------------
create or replace function public.trafico_web_fdt_mes(
  p_mes date default null
)
returns table (
  proyecto                 text,
  visitas_mes              bigint,
  bytes_acumulados         numeric,
  dias_con_dato            integer,
  dias_mes                 integer,
  dias_restantes           integer,
  bytes_medios_por_visita  numeric,
  bytes_proy_lineal        numeric,
  bytes_proy_regresion     numeric,
  limite_bytes             numeric,
  pct_limite               numeric,
  pct_proyectado           numeric,
  alerta_80                boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with rango as (
    select m.ini,
           (m.ini + interval '1 month')::date                                  as fin,   -- exclusivo
           ((m.ini + interval '1 month')::date - m.ini)                        as n_dias,
           least((m.ini + interval '1 month')::date, current_date)             as corte  -- dias < corte = cerrados
    from (select date_trunc('month', coalesce(p_mes, current_date))::date as ini) m
  ),
  proyectos as (
    select unnest(array['casa-tomas-story', 'touza-restaurant-website']) as proyecto
  ),
  d as (
    select t.fecha, t.proyecto, t.ruta, t.visitas
    from public.trafico_web_diario t, rango
    where t.fecha >= rango.ini and t.fecha < rango.corte
  ),
  por_dia as (
    select d.fecha, d.proyecto,
           max(d.visitas) filter (where d.ruta = '*')                         as v_total,
           coalesce(sum(d.visitas) filter (where d.ruta <> '*'), 0)          as v_rutas,
           sum(d.visitas::numeric * coalesce(pr.bytes_por_visita, pd.bytes_por_visita))
             filter (where d.ruta <> '*')                                     as b_rutas,
           bool_and(coalesce(pr.bytes_por_visita, pd.bytes_por_visita) is not null)
             filter (where d.ruta <> '*')                                     as rutas_con_peso,
           max(pd.bytes_por_visita)                                           as w_def
    from d
    left join public.peso_paginas pr
           on pr.proyecto = d.proyecto and pr.ruta = d.ruta and d.ruta <> '*'
    left join public.peso_paginas pd
           on pd.proyecto = d.proyecto and pd.ruta = '*'
    group by d.fecha, d.proyecto
  ),
  bytes_dia as (
    select p.fecha, p.proyecto,
           coalesce(p.v_total, p.v_rutas) as v,
           case
             when p.rutas_con_peso is false then null
             else coalesce(p.b_rutas, 0)
                  + case when greatest(0, coalesce(p.v_total, p.v_rutas) - p.v_rutas) = 0 then 0
                         else greatest(0, coalesce(p.v_total, p.v_rutas) - p.v_rutas) * p.w_def
                    end
           end as b
    from por_dia p
  ),
  por_proyecto as (
    select pj.proyecto,
           sum(b.v)::bigint                                  as visitas_mes,
           sum(b.b)                                          as acum,
           count(b.b)::int                                   as dias_dato,
           sum(b.b) / nullif(sum(b.v) filter (where b.b is not null), 0) as bmedio
    from proyectos pj
    left join bytes_dia b on b.proyecto = pj.proyecto
    group by pj.proyecto
  ),
  con_proy as (
    select pp.proyecto, pp.visitas_mes, pp.acum, pp.dias_dato, pp.bmedio,
           rango.n_dias, (rango.fin - greatest(rango.ini, rango.corte)) as restantes,
           case when pp.dias_dato > 0
                then pp.acum / pp.dias_dato * rango.n_dias end as proy_lineal,
           case when rango.fin <= rango.corte then pp.acum          -- mes ya cerrado
                when tend.pendiente is null or pp.bmedio is null then null
                else coalesce(pp.acum, 0) + pp.bmedio * (
                       select sum(greatest(0, tend.intercepto
                                              + tend.pendiente * ((greatest(rango.ini, rango.corte) + i) - current_date)))
                       from generate_series(0, rango.fin - greatest(rango.ini, rango.corte) - 1) as i)
           end as proy_regresion
    from por_proyecto pp
    cross join rango
    left join lateral public.trafico_web_tendencia(pp.proyecto, 90) tend on true
  ),
  filas as (
    select c.proyecto, c.visitas_mes, c.acum, c.dias_dato, c.n_dias, c.restantes,
           c.bmedio, c.proy_lineal, c.proy_regresion
    from con_proy c
    union all
    select '*',
           sum(c.visitas_mes)::bigint,
           sum(c.acum),
           max(c.dias_dato),
           max(c.n_dias),
           max(c.restantes),
           sum(c.acum) / nullif(sum(c.visitas_mes) filter (where c.acum is not null), 0),
           sum(c.proy_lineal),
           sum(c.proy_regresion)
    from con_proy c
  )
  select f.proyecto,
         f.visitas_mes,
         round(f.acum, 0),
         f.dias_dato,
         f.n_dias,
         f.restantes,
         round(f.bmedio, 0),
         round(f.proy_lineal, 0),
         round(f.proy_regresion, 0),
         100e9::numeric,
         round(100 * f.acum / 100e9, 2),
         round(100 * greatest(f.proy_lineal, f.proy_regresion) / 100e9, 2),
         coalesce(greatest(f.proy_lineal, f.proy_regresion) > 80e9, false)
  from filas f
  order by (f.proyecto = '*') desc, f.proyecto;
$$;

comment on function public.trafico_web_fdt_mes(date) is
  'ESTIMACION de Fast Data Transfer del mes (visitas x bytes_por_visita, con remanente fuera del top N al peso medio). Filas por proyecto + ''*'' (total). Limite 100e9 bytes; alerta_80 si max(proy_lineal, proy_regresion) > 80e9 (R4).';

-- ---------------------------------------------------------------------------
-- 4.4 trafico_web_top_paginas — rutas por visitas o por FDT estimado
--   Con p_proyecto NULL se devuelven rutas de ambas webs (la columna
--   proyecto distingue el '/' de cada una). pct_visitas es sobre el total
--   del periodo (filas '*'); pct_bytes, sobre los bytes estimados de las
--   rutas desglosadas. p_orden: 'visitas' (defecto) | 'bytes'.
-- ---------------------------------------------------------------------------
create or replace function public.trafico_web_top_paginas(
  p_proyecto text    default null,
  p_desde    date    default (current_date - 30),
  p_hasta    date    default (current_date - 1),
  p_limite   integer default 20,
  p_orden    text    default 'visitas'
)
returns table (
  proyecto          text,
  ruta              text,
  visitas           bigint,
  bytes_estimados   numeric,
  pct_visitas       numeric,
  pct_bytes         numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with d as (
    select t.proyecto, t.ruta, t.visitas
    from public.trafico_web_diario t
    where t.fecha between p_desde and p_hasta
      and (p_proyecto is null or t.proyecto = p_proyecto)
  ),
  tot as (
    select coalesce(sum(d.visitas) filter (where d.ruta = '*'),
                    sum(d.visitas) filter (where d.ruta <> '*')) as v_total
    from d
  ),
  r as (
    select d.proyecto, d.ruta,
           sum(d.visitas)::bigint as v,
           case when bool_and(coalesce(pr.bytes_por_visita, pd.bytes_por_visita) is not null)
                then sum(d.visitas::numeric * coalesce(pr.bytes_por_visita, pd.bytes_por_visita))
           end as b
    from d
    left join public.peso_paginas pr on pr.proyecto = d.proyecto and pr.ruta = d.ruta
    left join public.peso_paginas pd on pd.proyecto = d.proyecto and pd.ruta = '*'
    where d.ruta <> '*'
    group by d.proyecto, d.ruta
  ),
  tb as (select sum(r.b) as b_total from r)
  select r.proyecto,
         r.ruta,
         r.v,
         round(r.b, 0),
         round(100.0 * r.v / nullif(tot.v_total, 0), 2),
         round(100.0 * r.b / nullif(tb.b_total, 0), 2)
  from r, tot, tb
  order by case when p_orden = 'bytes' then r.b end desc nulls last,
           r.v desc,
           r.proyecto,
           r.ruta
  limit least(greatest(coalesce(p_limite, 20), 1), 100);
$$;

comment on function public.trafico_web_top_paginas(text, date, date, integer, text) is
  'Top rutas del periodo con visitas y FDT ESTIMADO (peso de la ruta o, si no hay, el ''*'' del proyecto; NULL si ninguno). p_orden visitas|bytes. Limite 1..100.';

-- ---------------------------------------------------------------------------
-- 4.5 trafico_web_desglose_resumen — reparto por device/country/referrer
--   Sin filas = la API no dio esa dimension -> la UI pinta "sin datos".
-- ---------------------------------------------------------------------------
create or replace function public.trafico_web_desglose_resumen(
  p_proyecto  text    default null,
  p_dimension text    default 'device',
  p_desde     date    default (current_date - 30),
  p_hasta     date    default (current_date - 1),
  p_limite    integer default 10
)
returns table (
  valor       text,
  visitas     bigint,
  visitantes  bigint,
  pct         numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with g as (
    select t.valor,
           sum(t.visitas)::bigint as v,
           case when count(t.visitantes) = count(*) then sum(t.visitantes)::bigint end as vis
    from public.trafico_web_desglose t
    where t.dimension = p_dimension
      and t.fecha between p_desde and p_hasta
      and (p_proyecto is null or t.proyecto = p_proyecto)
    group by t.valor
  ),
  tot as (select sum(g.v) as s from g)
  select g.valor,
         g.v,
         g.vis,
         round(100.0 * g.v / nullif(tot.s, 0), 2)
  from g, tot
  order by g.v desc, g.valor
  limit least(greatest(coalesce(p_limite, 10), 1), 100);
$$;

comment on function public.trafico_web_desglose_resumen(text, text, date, date, integer) is
  'Reparto de visitas por valor de una dimension (device|country|referrer) en el periodo. pct sobre el total de esa dimension. visitantes NULL si alguna fila no lo trae.';

-- Privilegios de las RPC: Supabase concede EXECUTE a anon por defecto en
-- funciones nuevas de public; se retira. authenticated las necesita (la RLS
-- decide que ve cada uno).
revoke all on function public.trafico_web_serie(text, date, date)                             from public, anon;
revoke all on function public.trafico_web_tendencia(text, integer)                            from public, anon;
revoke all on function public.trafico_web_fdt_mes(date)                                       from public, anon;
revoke all on function public.trafico_web_top_paginas(text, date, date, integer, text)        from public, anon;
revoke all on function public.trafico_web_desglose_resumen(text, text, date, date, integer)   from public, anon;

grant execute on function public.trafico_web_serie(text, date, date)                           to authenticated, service_role;
grant execute on function public.trafico_web_tendencia(text, integer)                          to authenticated, service_role;
grant execute on function public.trafico_web_fdt_mes(date)                                     to authenticated, service_role;
grant execute on function public.trafico_web_top_paginas(text, date, date, integer, text)      to authenticated, service_role;
grant execute on function public.trafico_web_desglose_resumen(text, text, date, date, integer) to authenticated, service_role;


-- ============================================================================
-- PIEZA 5 — Job pg_cron `sync-trafico-web` (diario 03:30 UTC)
-- ----------------------------------------------------------------------------
-- Mismo patron que 20260920010000 / 20260922160000 (pg_net + pg_cron +
-- cabecera x-webhook-secret leida de Vault), con UNA diferencia a proposito:
-- el SELECT lee el secreto con FROM vault.decrypted_secrets ... WHERE name=,
-- asi que si el secreto `trafico_web_cron_secret` todavia NO existe el
-- SELECT devuelve 0 filas y net.http_post NO se llama. El job queda
-- instalado pero mudo: no hay peticiones a una funcion aun no desplegada ni
-- 401/404 diarios en net._http_response. Se "enciende" al crear el secreto,
-- lo cual se hace DESPUES de desplegar la Edge Function (checklist).
-- 03:30 UTC: el dia anterior ya esta cerrado en UTC y en Europe/Madrid.
-- timeout 55 s: el primer run hace backfill de hasta 30 dias (Hobby solo da 31) x 2 proyectos.
-- ============================================================================

create extension if not exists pg_net;

select cron.unschedule('sync-trafico-web') where exists (
  select 1 from cron.job where jobname = 'sync-trafico-web'
);

select cron.schedule(
  'sync-trafico-web',
  '30 3 * * *',
  $$
  select net.http_post(
    url := 'https://jeamoczmbfsnwkfjxcyo.supabase.co/functions/v1/sync-trafico-web',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', s.decrypted_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  )
  from vault.decrypted_secrets s
  where s.name = 'trafico_web_cron_secret';
  $$
);

commit;

-- ============================================================================
-- CHECKLIST (pasos manuales; esta migracion NO los hace)
--
--   Orden importante: tabla/cron -> funcion desplegada -> secreto en Vault.
--
--   1. Aplicar esta migracion (supabase db push). El job queda creado pero
--      no llama a nada mientras falte el secreto de Vault (ver PIEZA 5).
--   2. Fase 2: desplegar la Edge Function y sus secrets:
--        supabase secrets set VERCEL_ANALYTICS_TOKEN=<token solo lectura, scope team>
--        supabase secrets set TRAFICO_WEB_CRON_SECRET=<valor aleatorio largo>
--        supabase functions deploy sync-trafico-web
--      (config.toml: [functions.sync-trafico-web] verify_jwt = false)
--   3. SOLO DESPUES del deploy, crear en Vault el MISMO valor:
--        select vault.create_secret('<mismo valor>', 'trafico_web_cron_secret');
--      A partir de aqui el cron de las 03:30 UTC ya llama a la funcion.
--   4. Primera ejecucion manual (backfill) sin esperar al cron:
--        select net.http_post(
--          url := 'https://jeamoczmbfsnwkfjxcyo.supabase.co/functions/v1/sync-trafico-web',
--          headers := jsonb_build_object('Content-Type','application/json',
--            'x-webhook-secret',(select decrypted_secret from vault.decrypted_secrets
--                                where name='trafico_web_cron_secret')),
--          body := '{}'::jsonb, timeout_milliseconds := 55000);
--      y revisar: select * from public.trafico_web_sync_estado;
--   5. Comprobar el job:
--        select jobname, schedule, active from cron.job where jobname = 'sync-trafico-web';
--      Debe salir exactamente 1 fila.
--   6. Dar la seccion `trafico_web` (can_view) a quien deba ver la pagina
--      (los admin la ven siempre).
--   7. Cuando se mida el transfer size real (tarea 0.3), corregir las filas
--      '*' de peso_paginas y anadir las rutas medidas.
--
-- ROLLBACK
--   select cron.unschedule('sync-trafico-web');
--   drop function if exists public.trafico_web_serie(text, date, date),
--     public.trafico_web_tendencia(text, integer), public.trafico_web_fdt_mes(date),
--     public.trafico_web_top_paginas(text, date, date, integer, text),
--     public.trafico_web_desglose_resumen(text, text, date, date, integer);
--   drop table if exists public.trafico_web_diario, public.trafico_web_desglose,
--     public.peso_paginas, public.trafico_web_sync_estado;
--   select vault... : borrar el secreto 'trafico_web_cron_secret' si se creo.
-- ============================================================================
