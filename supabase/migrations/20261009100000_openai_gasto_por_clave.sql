set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261009100000_openai_gasto_por_clave
-- ===========================================================================
-- ##   NO APLICADA: la aplica el dueño a mano (ver PASOS)                  ##
-- ===========================================================================
-- CAMBIO DE PLAN (dueño, 09/10/2026): YA NO hay un proyecto de OpenAI por
-- proceso. Hay UN proyecto «Casa Tomás» para todo el restaurante, con varias
-- CLAVES dentro (OPENAI_API_KEY_OCR, OPENAI_API_KEY_CHAT y OPENAI_API_KEY
-- general: web, vino desde foto, traducciones…). El proyecto Default queda para
-- otras cosas del dueño que NO son del restaurante.
--
-- Como OpenAI solo da el coste EXACTO por proyecto y día (/organization/costs),
-- el reparto por proceso se hace así:
--   * TOTAL real = lo facturado a los proyectos del restaurante
--     (openai_proyectos.proceso no nulo y distinto de 'ajeno').
--   * Ese total se REPARTE entre 'ocr' / 'chat' / 'chatweb' / 'vinos' / 'otros' según el coste de
--     cada clave: tokens de /usage (openai_uso_diario) × tarifa de ia_precios por
--     modelo (se acepta el modelo con sufijo de fecha: gpt-4.1-mini-2025-04-14
--     usa la tarifa de gpt-4.1-mini). Si a algún modelo le falta tarifa, el
--     reparto es a partes iguales por PETICIONES. Sin ningún uso por clave, cada
--     proyecto se queda con su propio proceso (comportamiento anterior).
--   * La suma de los procesos es EXACTAMENTE el total real (el redondeo de
--     micro-dólares se lo lleva 'otros').
--     Procesos: ocr = lectura de facturas (OPENAI_API_KEY_OCR), chat = chatbot
--     de facturas (_CHAT), chatweb = chat de la web (_CHATWEB), vinos = vino
--     desde foto (_VINOS), otros = clave general (traducciones, novedades…).
--   * 'otros' se desglosa en sub-líneas ESTIMADAS por función (ia_uso),
--     escaladas al real de 'otros': otros:traducciones, otros:novedades,
--     otros:resto.
--
-- QUÉ CREA / CAMBIA
--   1. `openai_claves(api_key_id pk, project_id, nombre, proceso)`: claves de
--      los proyectos del restaurante (las da de alta sincronizar-costes-openai
--      desde GET /v1/organization/projects/{id}/api_keys; el proceso se deduce
--      del nombre SOLO al crearla: *OCR* → ocr, *CHAT* → chat, otro → otros;
--      el dueño lo puede corregir a mano). Se audita (lo toca el dueño).
--   2. `openai_uso_diario(fecha, project_id, api_key_id, modelo, input_tokens,
--      cached_tokens, output_tokens, peticiones)`: uso por clave y modelo de
--      /usage/completions y /usage/embeddings. Dato derivado (cron cada 6 h).
--   3. `openai_proyectos.proceso` admite también 'ajeno' (Default y lo que no
--      es del restaurante: no cuenta en el total).
--   4. RPC `gasto_ia_real_resumen(integer)` NUEVA VERSIÓN. Mismas 4 columnas de
--      antes + `reparto` (clave_tarifa | clave_peticiones | proyecto |
--      sin_datos). Una app antigua ignora la columna nueva y las filas
--      'otros:*' (su nombre no coincide con ningún proceso). Los proyectos sin
--      marcar (proceso NULL) salen aparte como 'sin_asignar' y NO suman al total.
--      Sin proyectos marcados (o sin costes de ellos) devuelve ultimo_dia_real
--      NULL y el monitor sigue con el estimado de ia_uso. Sigue devolviendo
--      usd_estimado_hoy (lo que OpenAI aún no ha publicado). Ahora el estimado
--      de 'otros' también cuenta chat_web_uso (ok/error): el chat de la web no
--      escribe en ia_uso.
--   5. Helpers `ia_proceso_gasto(text)` (función de ia_uso → ocr | chat |
--      chatweb | vinos | otros) e `ia_grupo_de_funcion(text)` (sub-líneas de
--      'otros'). La RPC NO usa ia_proceso_de_funcion() (queda como está).
--
-- AUDITORÍA: openai_costes_diarios, tipo_cambio_usd_eur y openai_uso_diario son
-- datos derivados que escribe un cron; se AÑADEN a la lista de exclusión de
-- `instalar_auditoria_panel()` y `fn_audit_nueva_tabla()` (se reescriben
-- partiendo de su definición actual, sin copiar el cuerpo) y se les quita el
-- trigger si lo tenían. `openai_claves` y `openai_proyectos` SÍ se auditan.
--
-- PASOS (desde adminpanelct/, POR TERMINAL; no en el SQL Editor)
--   1. npx supabase db query --linked -f supabase/migrations/20261009100000_openai_gasto_por_clave.sql
--      Tiene que imprimir «openai_gasto_por_clave: aplicada».
--   2. npx supabase db query --linked -f supabase/tests/openai_gasto_por_clave_test.sql
--      (BEGIN … ROLLBACK). Tiene que acabar en «openai_gasto_por_clave_test: OK».
--   3. Desplegar la función: npx supabase functions deploy sincronizar-costes-openai --project-ref jeamoczmbfsnwkfjxcyo
--   4. Marcar los proyectos (una sola vez):
--        update public.openai_proyectos set proceso = 'otros'  where nombre ilike '%casa%tom%';
--        update public.openai_proyectos set proceso = 'ajeno'  where nombre ilike 'default%';
--   5. Lanzar la sincronización: select public.openai_despachar_sincronizacion_costes();
--   Deshacer: supabase/rollbacks/20261009100000_openai_gasto_por_clave_ROLLBACK.sql
--   Idempotente.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $$
begin
  if to_regclass('public.openai_proyectos') is null
     or to_regclass('public.openai_costes_diarios') is null
     or to_regclass('public.ia_uso') is null
     or to_regclass('public.ia_precios') is null
     or to_regclass('public.chat_web_uso') is null
     or to_regprocedure('public.ia_proceso_de_funcion(text)') is null
     or to_regprocedure('public.can_read_section(text)') is null
     or to_regprocedure('public.is_super_admin(uuid)') is null then
    raise exception 'openai_gasto_por_clave: falta 20261008150000_openai_costes_reales (o ia_uso / ia_precios / chat_web_uso). No se ha cambiado nada.';
  end if;
end;
$$;

-- ─── 0. Auditoría: las tablas derivadas entran en la lista de exclusión ────
-- Se parte de la definición ACTUAL de cada función (por si otra migración la
-- ha tocado) y solo se amplía la lista; no se copia su cuerpo.
do $$
declare
  v_def text;
begin
  for v_def in
    select pg_get_functiondef(p.oid)
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('instalar_auditoria_panel', 'fn_audit_nueva_tabla')
  loop
    if position('''ia_uso'',' in v_def) > 0 and position('''openai_uso_diario''' in v_def) = 0 then
      execute replace(v_def, '''ia_uso'',',
                      '''ia_uso'',''openai_costes_diarios'',''tipo_cambio_usd_eur'',''openai_uso_diario'',');
    end if;
  end loop;
end;
$$;

-- ─── 1. 'ajeno' como proceso de proyecto ────────────────────────────────────
do $$
declare
  v_nombre text;
begin
  for v_nombre in
    select c.conname from pg_constraint c
     where c.conrelid = 'public.openai_proyectos'::regclass and c.contype = 'c'
       and pg_get_constraintdef(c.oid) ilike '%proceso%'
  loop
    execute format('alter table public.openai_proyectos drop constraint %I', v_nombre);
  end loop;
end;
$$;
alter table public.openai_proyectos
  add constraint openai_proyectos_proceso_check
  check (proceso is null or proceso in ('ocr', 'chat', 'chatweb', 'vinos', 'otros', 'ajeno'));
comment on table public.openai_proyectos is
  'Proyectos de OpenAI. proceso NULL = sin marcar (sale como sin_asignar y NO cuenta en el total); '
  '''ajeno'' = no es del restaurante (p. ej. Default): no cuenta; cualquier otro valor = del restaurante '
  '(su coste suma al total real; el reparto por proceso se hace por CLAVE con openai_claves, y solo si no hay '
  'uso por clave se usa este valor). La Edge Function sincronizar-costes-openai los da de alta y actualiza el nombre.';

-- ─── 2. Tablas nuevas ───────────────────────────────────────────────────────
create table if not exists public.openai_claves (
  api_key_id text primary key check (length(api_key_id) between 1 and 120),
  project_id text not null check (length(project_id) between 1 and 120),
  nombre     text check (nombre is null or length(nombre) <= 200),
  proceso    text not null default 'otros' check (proceso in ('ocr', 'chat', 'chatweb', 'vinos', 'otros')),
  creado_en  timestamptz not null default now()
);
comment on table public.openai_claves is
  'Claves de API de los proyectos del restaurante y el proceso al que pertenece su gasto (ocr = lectura de facturas, '
  'chat = chatbot de facturas, chatweb = chat de la web, vinos = vino desde foto, otros = clave general: traducciones, '
  'novedades…). La alta la hace sincronizar-costes-openai deduciendo el proceso del NOMBRE de la clave (solo al crearla); '
  'se puede corregir a mano. '
  'Nunca guarda el valor de la clave.';
create index if not exists idx_openai_claves_proyecto on public.openai_claves (project_id);

create table if not exists public.openai_uso_diario (
  fecha          date        not null,
  project_id     text        not null default '' check (length(project_id) <= 120),
  api_key_id     text        not null default '' check (length(api_key_id) <= 120),
  modelo         text        not null default '' check (length(modelo) <= 120),
  input_tokens   bigint      not null default 0 check (input_tokens >= 0),
  cached_tokens  bigint      not null default 0 check (cached_tokens >= 0 and cached_tokens <= input_tokens),
  output_tokens  bigint      not null default 0 check (output_tokens >= 0),
  peticiones     bigint      not null default 0 check (peticiones >= 0),
  actualizado_en timestamptz not null default now(),
  primary key (fecha, project_id, api_key_id, modelo)
);
comment on table public.openai_uso_diario is
  'Uso REAL de OpenAI (GET /v1/organization/usage/completions y /embeddings) por día UTC, proyecto, clave y modelo. '
  'input_tokens incluye los cacheados. "" = sin proyecto/clave/modelo. Lo escribe solo sincronizar-costes-openai '
  '(service_role). Sirve para repartir el coste real entre procesos (gasto_ia_real_resumen); no es una factura.';
create index if not exists idx_openai_uso_diario_clave on public.openai_uso_diario (api_key_id, fecha desc);

-- Datos derivados: sin trigger de auditoría (el event trigger puede haberlo puesto antes de la lista).
drop trigger if exists trg_auditoria on public.openai_uso_diario;
drop trigger if exists trg_auditoria on public.openai_costes_diarios;
drop trigger if exists trg_auditoria on public.tipo_cambio_usd_eur;

-- ─── 3. RLS: lectura super admin, escritura service_role ────────────────────
alter table public.openai_claves     enable row level security;
alter table public.openai_uso_diario enable row level security;

revoke all on public.openai_claves     from anon, authenticated;
revoke all on public.openai_uso_diario from anon, authenticated;
grant select on public.openai_claves     to authenticated;
grant select on public.openai_uso_diario to authenticated;
grant all on public.openai_claves     to service_role;
grant all on public.openai_uso_diario to service_role;
revoke truncate on public.openai_claves     from authenticated;
revoke truncate on public.openai_uso_diario from authenticated;

drop policy if exists openai_claves_select_super_admin on public.openai_claves;
create policy openai_claves_select_super_admin
  on public.openai_claves for select to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) );
drop policy if exists openai_claves_service_role on public.openai_claves;
create policy openai_claves_service_role
  on public.openai_claves for all to service_role using (true) with check (true);

drop policy if exists openai_uso_diario_select_super_admin on public.openai_uso_diario;
create policy openai_uso_diario_select_super_admin
  on public.openai_uso_diario for select to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) );
drop policy if exists openai_uso_diario_service_role on public.openai_uso_diario;
create policy openai_uso_diario_service_role
  on public.openai_uso_diario for all to service_role using (true) with check (true);

-- ─── 4. Helpers: proceso de gasto y sub-línea de «otros» ────────────────────
create or replace function public.ia_proceso_gasto(p_funcion text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_funcion in ('procesar-factura', 'ocr-trabajo', 'clasificar-productos') then 'ocr'
    when p_funcion = 'chat-facturas' then 'chat'
    when p_funcion = 'chat-web' then 'chatweb'
    when p_funcion = 'extraer-vino-foto' then 'vinos'
    else 'otros'
  end;
$$;
comment on function public.ia_proceso_gasto(text) is
  'Proceso de gasto de una función de ia_uso según la clave que usa (_shared/clave-openai.ts): ocr, chat, chatweb '
  '(chat-web), vinos (extraer-vino-foto) u otros (clave general).';
revoke all on function public.ia_proceso_gasto(text) from public, anon;
grant execute on function public.ia_proceso_gasto(text) to authenticated, service_role;

create or replace function public.ia_grupo_de_funcion(p_funcion text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_funcion like 'traducir%' then 'traducciones'
    when p_funcion = 'format-novedad' then 'novedades'
    else 'resto'
  end;
$$;
comment on function public.ia_grupo_de_funcion(text) is
  'Sub-línea de «otros» en el monitor de gasto: traducciones (traducir-*), novedades (format-novedad) o resto.';
revoke all on function public.ia_grupo_de_funcion(text) from public, anon;
grant execute on function public.ia_grupo_de_funcion(text) to authenticated, service_role;

-- ─── 5. Resumen del gasto real por proceso (nueva versión) ──────────────────
drop function if exists public.gasto_ia_real_resumen(integer);

create function public.gasto_ia_real_resumen(p_dias integer default 30)
returns table (
  proceso          text,
  usd_real         numeric,
  ultimo_dia_real  date,
  usd_estimado_hoy numeric,
  reparto          text
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_dias      integer := least(greatest(coalesce(p_dias, 30), 1), 90);
  v_hoy       date    := (now() at time zone 'utc')::date;
  v_corte     date;
  v_desde     date;
  v_desde_ts  timestamptz;       -- inicio (UTC) de la ventana real
  v_desde_est timestamptz;       -- inicio (UTC) de lo que OpenAI aún no ha publicado
  v_total     numeric := 0;      -- real de los proyectos del restaurante
  v_sin_asig  numeric := 0;      -- real de proyectos sin marcar (informativo)
begin
  if not (public.can_read_section('facturas') or coalesce(public.is_super_admin(auth.uid()), false)) then
    raise exception 'gasto_ia_real_resumen: sin permiso para ver Facturas' using errcode = '42501';
  end if;

  -- Último día CERRADO con costes de los proyectos del restaurante (el de hoy
  -- es parcial). Único para todos los procesos: lo real y lo estimado no se
  -- solapan ni dejan huecos.
  select max(c.fecha) into v_corte
    from public.openai_costes_diarios c
    join public.openai_proyectos p on p.project_id = c.project_id
   where c.fecha < v_hoy and p.proceso is not null and p.proceso <> 'ajeno';

  if v_corte is null then
    -- Sin datos reales del restaurante: todo es estimación sobre la ventana pedida.
    return query
    with fuente as (
      select u.funcion, u.coste_usd from public.ia_uso u
       where u.created_at >= now() - make_interval(days => v_dias)
      union all
      select 'chat-web', w.coste_usd from public.chat_web_uso w
       where w.estado in ('ok', 'error') and w.created_at >= now() - make_interval(days => v_dias)
    )
    select pr.proc, 0::numeric, null::date,
           coalesce((select sum(f.coste_usd) from fuente f where public.ia_proceso_gasto(f.funcion) = pr.proc), 0)::numeric,
           'sin_datos'::text
      from (select unnest(array['ocr', 'chat', 'chatweb', 'vinos', 'otros']) as proc) pr
     order by array_position(array['ocr', 'chat', 'chatweb', 'vinos', 'otros'], pr.proc);
    return;
  end if;

  v_desde     := v_corte - (v_dias - 1);
  v_desde_ts  := (v_desde::timestamp at time zone 'utc');
  v_desde_est := ((v_corte + 1)::timestamp at time zone 'utc');

  select coalesce(sum(c.usd) filter (where p.proceso is not null and p.proceso <> 'ajeno'), 0),
         coalesce(sum(c.usd) filter (where p.proceso is null), 0)
    into v_total, v_sin_asig
    from public.openai_costes_diarios c
    left join public.openai_proyectos p on p.project_id = c.project_id
   where c.fecha between v_desde and v_corte;

  return query
  with uso as (
    -- Uso de los proyectos del restaurante, valorado con ia_precios (acepta el
    -- modelo con sufijo de fecha: gpt-4.1-mini-2025-04-14 → gpt-4.1-mini).
    select coalesce(k.proceso, 'otros') as proc,
           u.peticiones,
           (t.modelo is not null) as con_tarifa,
           case when t.modelo is null then 0 else
             ( greatest(u.input_tokens - u.cached_tokens, 0) * t.usd_por_m_input
               + u.cached_tokens * coalesce(t.usd_por_m_cached, t.usd_por_m_input)
               + u.output_tokens * t.usd_por_m_output ) / 1000000.0
           end as usd
      from public.openai_uso_diario u
      join public.openai_proyectos pj
        on pj.project_id = u.project_id and pj.proceso is not null and pj.proceso <> 'ajeno'
      left join public.openai_claves k on k.api_key_id = u.api_key_id
      left join lateral (
        select p.* from public.ia_precios p
         where p.modelo = u.modelo or left(u.modelo, length(p.modelo) + 1) = p.modelo || '-'
         order by length(p.modelo) desc
         limit 1
      ) t on true
     where u.fecha between v_desde and v_corte
  ),
  meta as (
    select coalesce(bool_or(not con_tarifa), false) as sin_tarifa,
           coalesce(sum(usd), 0) as su,
           coalesce(sum(peticiones), 0) as sp
      from uso
  ),
  modo as (
    -- Si a algún modelo le falta tarifa: a partes iguales por peticiones.
    -- Sin ningún uso por clave: cada proyecto se queda con su propio proceso.
    select case when m.sin_tarifa and m.sp > 0 then 'clave_peticiones'
                when not m.sin_tarifa and m.su > 0 then 'clave_tarifa'
                else 'proyecto' end as m
      from meta m
  ),
  procs as (
    select unnest(array['ocr', 'chat', 'chatweb', 'vinos', 'otros']) as proc
  ),
  pesos as (
    select pr.proc,
           case (select m from modo)
             when 'clave_peticiones' then coalesce((select sum(x.peticiones) from uso x where x.proc = pr.proc), 0)
             when 'clave_tarifa'     then coalesce((select sum(x.usd) from uso x where x.proc = pr.proc), 0)
             else coalesce((select sum(c.usd)
                              from public.openai_costes_diarios c
                              join public.openai_proyectos p on p.project_id = c.project_id
                             where c.fecha between v_desde and v_corte and p.proceso = pr.proc), 0)
           end as w
      from procs pr
  ),
  base as (
    select pe.proc,
           round(coalesce(v_total * pe.w / nullif((select sum(p2.w) from pesos p2), 0), 0), 6) as r
      from pesos pe
  ),
  reales as (
    -- La suma es EXACTAMENTE el total real: el redondeo se lo lleva «otros».
    select b.proc,
           case when b.proc = 'otros'
                then v_total - coalesce((select sum(b2.r) from base b2 where b2.proc <> 'otros'), 0)
                else b.r end as r
      from base b
  ),
  fuente as (
    select u.funcion, u.coste_usd, u.created_at from public.ia_uso u
     where u.created_at >= v_desde_ts
    union all
    select 'chat-web', w.coste_usd, w.created_at from public.chat_web_uso w
     where w.estado in ('ok', 'error') and w.created_at >= v_desde_ts
  ),
  est as (
    select public.ia_proceso_gasto(f.funcion) as proc,
           public.ia_grupo_de_funcion(f.funcion) as grp,
           coalesce(sum(f.coste_usd) filter (where f.created_at >= v_desde_est), 0) as hoy,
           coalesce(sum(f.coste_usd) filter (where f.created_at <  v_desde_est), 0) as ventana
      from fuente f
     group by 1, 2
  ),
  grupos as (
    select e.grp, sum(e.ventana) as ventana, sum(e.hoy) as hoy
      from est e where e.proc = 'otros' group by e.grp
  ),
  suma as (select coalesce(sum(g.ventana), 0) as total from grupos g),
  otros_real as (select re.r from reales re where re.proc = 'otros'),
  filas as (
    select array_position(array['ocr', 'chat', 'chatweb', 'vinos', 'otros'], re.proc) as ord,
           re.proc as nombre, re.r as real_usd,
           coalesce((select sum(e.hoy) from est e where e.proc = re.proc), 0) as hoy_usd
      from reales re
    union all
    select 6, 'sin_asignar', v_sin_asig, 0::numeric where v_sin_asig > 0
    union all
    select 7, 'otros:' || g.grp,
           case when s.total > 0 then (select o.r from otros_real o) * g.ventana / s.total
                when g.grp = 'resto' then (select o.r from otros_real o)
                else 0 end,
           g.hoy
      from grupos g cross join suma s
     where g.ventana > 0 or g.hoy > 0
    union all
    select 7, 'otros:resto', (select o.r from otros_real o), 0::numeric
      from suma s
     where s.total = 0 and (select o.r from otros_real o) > 0
       and not exists (select 1 from grupos g where g.grp = 'resto' and (g.ventana > 0 or g.hoy > 0))
  )
  select f.nombre, f.real_usd::numeric, v_corte, f.hoy_usd::numeric, (select m from modo)
    from filas f
   order by f.ord, f.nombre;
end;
$$;

comment on function public.gasto_ia_real_resumen(integer) is
  'Gasto REAL de OpenAI de los proyectos del restaurante (openai_proyectos.proceso no nulo y distinto de ajeno) en los '
  'últimos p_dias (1-90) hasta ultimo_dia_real (último día UTC cerrado), repartido en ocr / chat / chatweb / vinos / otros '
  'por el coste de cada clave (openai_uso_diario × ia_precios; reparto = clave_tarifa | clave_peticiones | proyecto) de modo '
  'que la suma es el total real exacto. Filas otros:traducciones / novedades / resto = desglose ESTIMADO de «otros» '
  '(ia_uso) escalado a su real. sin_asignar = proyectos sin marcar (no suma al total). usd_estimado_hoy = ia_uso + '
  'chat_web_uso desde el día siguiente, lo que OpenAI aún no ha publicado. Sin gasto real del restaurante ultimo_dia_real '
  'es NULL y todo es estimado. Exige poder ver Facturas.';

revoke all on function public.gasto_ia_real_resumen(integer) from public, anon;
grant execute on function public.gasto_ia_real_resumen(integer) to authenticated, service_role;

commit;

select 'openai_gasto_por_clave: aplicada' as resultado,
       exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'openai_claves') as claves_creada,
       exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'openai_uso_diario') as uso_creada;
