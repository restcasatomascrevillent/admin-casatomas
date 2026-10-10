set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261010100000_gasto_real_claves_mixtas
-- ===========================================================================
-- ##   NO APLICADA: la aplica el dueño a mano (ver PASOS)                  ##
-- ===========================================================================
-- PROBLEMA (datos reales de prod, 10/10/2026): el gasto real del restaurante
-- salía casi a cero (~0,02 $ en octubre) cuando lo gastado de verdad eran
-- varios dólares. Hasta el 09/10 TODO el restaurante iba por la clave
-- «restaurante» del proyecto Default (era OPENAI_API_KEY); el proyecto «Casa
-- tomas» y sus claves se estrenaron el 09/10. Como Default está marcado
-- 'ajeno' a nivel de proyecto (porque también alberga cosas del dueño que NO
-- son del restaurante: n8n, pruebas…), su gasto se excluía entero.
--
-- ARREGLO: el 'ajeno' deja de ser solo cosa del proyecto; también se decide
-- por CLAVE.
--   * `openai_claves.proceso` admite dos valores nuevos:
--       'ajeno' = clave que NO es del restaurante (su parte del coste se excluye)
--       'mixto' = clave que servía a varios procesos (la antigua «restaurante»)
--   * `gasto_ia_real_resumen(integer)` (mismas columnas y firma):
--       1. Para cada PROYECTO y DÍA se reparte su coste real entre las claves
--          que tuvieron uso ese día, por peso (tokens × tarifa de ia_precios,
--          como antes; si a algún modelo de ese proyecto-día le falta tarifa,
--          por peticiones). Vale también en proyectos 'ajeno'.
--       2. Las claves 'ajeno' se excluyen, y en un proyecto 'ajeno' también
--          las claves sin fila en openai_claves. Un proyecto-día 'ajeno' sin
--          uso por clave se excluye entero (no hay forma de saber de quién es).
--          Un proyecto del restaurante sin uso ese día se queda con el proceso
--          del proyecto (como antes).
--       3. Las claves 'mixto' se reparten entre procesos según el coste
--          ESTIMADO de ESE día (ia_uso + chat_web_uso para chatweb) por función
--          → proceso (ia_proceso_gasto: procesar-factura / ocr-trabajo /
--          clasificar-productos → ocr, chat-facturas → chat, chat-web →
--          chatweb, extraer-vino-foto → vinos, resto → otros). Si ese día no
--          hay ia_uso, todo a 'otros'.
--       4. Total del restaurante = suma de lo no ajeno (exacta: el redondeo
--          de micro-dólares se lo lleva 'otros'). El proyecto con proceso NULL
--          sigue saliendo aparte como 'sin_asignar' sin sumar.
--       Se mantiene la columna `reparto` (clave_tarifa | clave_peticiones |
--       proyecto | sin_datos), las filas `otros:*` y usd_estimado_hoy.
--   * DATOS (idempotente, claves del proyecto Default): «restaurante» →
--     'mixto'; «OCR facturas» → 'ocr'; «chat facturas» → 'chat'; «n8n»,
--     «n8n web», «n», «My Test Key», «pruebita» → 'ajeno'. El proyecto Default
--     sigue 'ajeno' a nivel de proyecto, pero sus claves con proceso cuentan.
--
-- IMPORTANTE (Edge Function): `sincronizar-costes-openai` ya sincroniza el uso
-- y las claves de los proyectos 'ajeno' (antes los saltaba, y sin su uso diario
-- el reparto por clave de Default no tendría pesos). Hay que REDESPLEGARLA
-- (paso 3). Las claves nuevas de un proyecto 'ajeno' entran como 'ajeno'.
--
-- COMPROBACIÓN DE DEFINICIÓN: antes de reescribir gasto_ia_real_resumen se
-- comprueba el md5 (sin CR) de la definición actual (la de 20261009100000); si
-- otra migración la ha tocado, aborta sin cambiar nada. Idempotente: si ya lleva
-- la marca de esta migración, se reescribe sin más.
--
-- PASOS (desde adminpanelct/, POR TERMINAL; no en el SQL Editor)
--   1. npx supabase db query --linked -f supabase/migrations/20261010100000_gasto_real_claves_mixtas.sql
--      Tiene que imprimir «gasto_real_claves_mixtas: aplicada».
--   2. npx supabase db query --linked -f supabase/tests/gasto_real_claves_mixtas_test.sql
--      (BEGIN … ROLLBACK). Tiene que acabar en «gasto_real_claves_mixtas_test: OK».
--   3. npx supabase functions deploy sincronizar-costes-openai --project-ref jeamoczmbfsnwkfjxcyo
--   4. select public.openai_despachar_sincronizacion_costes();  -- trae el uso de las claves de Default
--   Deshacer: supabase/rollbacks/20261010100000_gasto_real_claves_mixtas_ROLLBACK.sql
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $$
declare
  v_def text;
begin
  if to_regclass('public.openai_claves') is null
     or to_regclass('public.openai_uso_diario') is null
     or to_regclass('public.openai_proyectos') is null
     or to_regclass('public.openai_costes_diarios') is null
     or to_regclass('public.ia_uso') is null
     or to_regclass('public.ia_precios') is null
     or to_regclass('public.chat_web_uso') is null
     or to_regprocedure('public.ia_proceso_gasto(text)') is null
     or to_regprocedure('public.ia_grupo_de_funcion(text)') is null
     or to_regprocedure('public.can_read_section(text)') is null
     or to_regprocedure('public.is_super_admin(uuid)') is null then
    raise exception 'gasto_real_claves_mixtas: falta 20261009100000_openai_gasto_por_clave. No se ha cambiado nada.';
  end if;

  v_def := replace(pg_get_functiondef('public.gasto_ia_real_resumen(integer)'::regprocedure), chr(13), '');
  if md5(v_def) <> '9e7b982abfb2ee0bd53e8bdce67882e2'
     and position('20261010100000_gasto_real_claves_mixtas' in v_def) = 0 then
    raise exception 'gasto_real_claves_mixtas: gasto_ia_real_resumen no es la esperada (md5 %). No se ha cambiado nada.', md5(v_def);
  end if;
end;
$$;

-- ─── 1. 'ajeno' y 'mixto' como proceso de CLAVE ─────────────────────────────
do $$
declare
  v_nombre text;
begin
  for v_nombre in
    select c.conname from pg_constraint c
     where c.conrelid = 'public.openai_claves'::regclass and c.contype = 'c'
       and pg_get_constraintdef(c.oid) ilike '%proceso%'
  loop
    execute format('alter table public.openai_claves drop constraint %I', v_nombre);
  end loop;
end;
$$;
alter table public.openai_claves
  add constraint openai_claves_proceso_check
  check (proceso in ('ocr', 'chat', 'chatweb', 'vinos', 'otros', 'ajeno', 'mixto'));

comment on table public.openai_claves is
  'Claves de API de OpenAI y el proceso al que pertenece su gasto: ocr = lectura de facturas, chat = chatbot de facturas, '
  'chatweb = chat de la web, vinos = vino desde foto, otros = clave general (traducciones, novedades…), '
  'ajeno = NO es del restaurante (se excluye; vale también en proyectos ''ajeno'' como Default) y '
  'mixto = servía a varios procesos (la antigua clave «restaurante»: se reparte cada día según el coste estimado de ia_uso '
  'por función; sin ia_uso ese día va a otros). La alta la hace sincronizar-costes-openai deduciendo el proceso del NOMBRE '
  '(solo al crearla; en un proyecto ajeno entra como ajeno); se puede corregir a mano. Nunca guarda el valor de la clave.';

comment on table public.openai_proyectos is
  'Proyectos de OpenAI. proceso NULL = sin marcar (sale como sin_asignar y NO cuenta en el total); '
  '''ajeno'' = proyecto que no es (todo) del restaurante, p. ej. Default: su coste se reparte entre sus claves por uso y '
  'solo cuentan las claves con proceso distinto de ajeno (openai_claves.proceso); cualquier otro valor = del restaurante '
  '(su coste suma al total real; el reparto por proceso se hace por CLAVE con openai_claves, y solo si no hay '
  'uso por clave ese día se usa este valor). La Edge Function sincronizar-costes-openai los da de alta y actualiza el nombre.';

-- ─── 2. Datos: claves del proyecto Default (idempotente) ────────────────────
update public.openai_claves k
   set proceso = case k.nombre
                   when 'restaurante'   then 'mixto'
                   when 'OCR facturas'  then 'ocr'
                   when 'chat facturas' then 'chat'
                   else 'ajeno' end
  from public.openai_proyectos p
 where p.project_id = k.project_id
   and p.nombre ilike 'default%'
   and k.nombre in ('restaurante', 'OCR facturas', 'chat facturas', 'n8n', 'n8n web', 'n', 'My Test Key', 'pruebita')
   and k.proceso is distinct from case k.nombre
                   when 'restaurante'   then 'mixto'
                   when 'OCR facturas'  then 'ocr'
                   when 'chat facturas' then 'chat'
                   else 'ajeno' end;

-- ─── 3. Resumen del gasto real por proceso (claves mixtas / ajenas) ─────────
create or replace function public.gasto_ia_real_resumen(p_dias integer default 30)
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
-- 20261010100000_gasto_real_claves_mixtas: reparto por proyecto y día; claves ajeno (excluidas) y mixto (según ia_uso del día).
declare
  v_dias      integer := least(greatest(coalesce(p_dias, 30), 1), 90);
  v_hoy       date    := (now() at time zone 'utc')::date;
  v_corte     date;
  v_desde     date;
  v_desde_ts  timestamptz;       -- inicio (UTC) de la ventana real
  v_desde_est timestamptz;       -- inicio (UTC) de lo que OpenAI aún no ha publicado
  v_sin_asig  numeric := 0;      -- real de proyectos sin marcar (informativo)
begin
  if not (public.can_read_section('facturas') or coalesce(public.is_super_admin(auth.uid()), false)) then
    raise exception 'gasto_ia_real_resumen: sin permiso para ver Facturas' using errcode = '42501';
  end if;

  -- Último día CERRADO con costes que cuentan para el restaurante: de un
  -- proyecto marcado que no sea 'ajeno', o de un proyecto 'ajeno' con alguna
  -- clave que no sea 'ajeno'. El de hoy es parcial. Único para todos los
  -- procesos: lo real y lo estimado no se solapan ni dejan huecos.
  select max(c.fecha) into v_corte
    from public.openai_costes_diarios c
    join public.openai_proyectos p on p.project_id = c.project_id
   where c.fecha < v_hoy and p.proceso is not null
     and (p.proceso <> 'ajeno'
          or exists (select 1 from public.openai_claves k
                      where k.project_id = p.project_id and k.proceso <> 'ajeno'));

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

  select coalesce(sum(c.usd), 0)
    into v_sin_asig
    from public.openai_costes_diarios c
    left join public.openai_proyectos p on p.project_id = c.project_id
   where c.fecha between v_desde and v_corte and p.proceso is null;

  return query
  with proy as (
    select p.project_id, p.proceso as proc_proy
      from public.openai_proyectos p
     where p.proceso is not null
  ),
  cd as (
    -- Coste real por proyecto y día (los proyectos sin marcar no entran: sin_asignar).
    select c.fecha, c.project_id, sum(c.usd) as usd
      from public.openai_costes_diarios c
      join proy on proy.project_id = c.project_id
     where c.fecha between v_desde and v_corte
     group by c.fecha, c.project_id
  ),
  uso as (
    -- Uso por clave valorado con ia_precios (acepta el modelo con sufijo de
    -- fecha: gpt-4.1-mini-2025-04-14 → gpt-4.1-mini). Una clave sin fila en
    -- openai_claves es 'otros' en un proyecto del restaurante y 'ajeno' en uno ajeno.
    select u.fecha, u.project_id,
           coalesce(k.proceso, case when pj.proc_proy <> 'ajeno' then 'otros' else 'ajeno' end) as cls,
           u.peticiones,
           (t.modelo is not null) as con_tarifa,
           case when t.modelo is null then 0 else
             ( greatest(u.input_tokens - u.cached_tokens, 0) * t.usd_por_m_input
               + u.cached_tokens * coalesce(t.usd_por_m_cached, t.usd_por_m_input)
               + u.output_tokens * t.usd_por_m_output ) / 1000000.0
           end as usd
      from public.openai_uso_diario u
      join proy pj on pj.project_id = u.project_id
      left join public.openai_claves k on k.api_key_id = u.api_key_id
      left join lateral (
        select p.* from public.ia_precios p
         where p.modelo = u.modelo or left(u.modelo, length(p.modelo) + 1) = p.modelo || '-'
         order by length(p.modelo) desc
         limit 1
      ) t on true
     where u.fecha between v_desde and v_corte
  ),
  modo_dia as (
    -- Por proyecto y día: si a algún modelo le falta tarifa, a partes iguales por peticiones.
    select x.fecha, x.project_id,
           case when bool_or(not x.con_tarifa) and sum(x.peticiones) > 0 then 'clave_peticiones'
                when not bool_or(not x.con_tarifa) and sum(x.usd) > 0 then 'clave_tarifa'
                else null end as m
      from uso x
     group by x.fecha, x.project_id
  ),
  pesos as (
    select x.fecha, x.project_id, x.cls,
           case md.m when 'clave_peticiones' then sum(x.peticiones)
                     when 'clave_tarifa' then sum(x.usd)
                     else 0 end as w
      from uso x
      join modo_dia md on md.fecha = x.fecha and md.project_id = x.project_id
     group by x.fecha, x.project_id, x.cls, md.m
  ),
  pesos_tot as (
    select pe.fecha, pe.project_id, sum(pe.w) as tot
      from pesos pe group by pe.fecha, pe.project_id
     having sum(pe.w) > 0
  ),
  asig as (
    -- Coste de cada proyecto-día repartido entre las clases de clave. Sin pesos
    -- ese día: un proyecto del restaurante se queda con su proceso; uno 'ajeno'
    -- no se puede atribuir a nadie y se excluye.
    select cd.fecha, pe.cls, cd.usd * pe.w / pt.tot as usd
      from cd
      join pesos_tot pt on pt.fecha = cd.fecha and pt.project_id = cd.project_id
      join pesos pe on pe.fecha = cd.fecha and pe.project_id = cd.project_id and pe.w > 0
    union all
    select cd.fecha, proy.proc_proy, cd.usd
      from cd
      join proy on proy.project_id = cd.project_id
     where not exists (select 1 from pesos_tot pt where pt.fecha = cd.fecha and pt.project_id = cd.project_id)
  ),
  fuente as (
    -- Estimado de ia_uso + chat_web_uso (ok/error) por función desde el inicio de la ventana.
    select u.funcion, u.coste_usd, u.created_at from public.ia_uso u
     where u.created_at >= v_desde_ts
    union all
    select 'chat-web', w.coste_usd, w.created_at from public.chat_web_uso w
     where w.estado in ('ok', 'error') and w.created_at >= v_desde_ts
  ),
  est_dia as (
    -- Coste estimado por día UTC y proceso, solo la parte ya publicada por OpenAI.
    select (f.created_at at time zone 'utc')::date as fecha,
           public.ia_proceso_gasto(f.funcion) as proc,
           sum(f.coste_usd) as c
      from fuente f
     where f.created_at < v_desde_est
     group by 1, 2
  ),
  est_tot as (
    select e.fecha, sum(e.c) as tot from est_dia e group by e.fecha having sum(e.c) > 0
  ),
  mixto_dia as (
    select a.fecha, sum(a.usd) as usd from asig a where a.cls = 'mixto' group by a.fecha
  ),
  mixto_rep as (
    -- Las claves mixtas, entre procesos según el estimado de ese día; sin ia_uso, a 'otros'.
    select m.fecha,
           case when et.tot is null then 'otros' else e.proc end as proc,
           case when et.tot is null then m.usd else m.usd * e.c / et.tot end as usd
      from mixto_dia m
      left join est_tot et on et.fecha = m.fecha
      left join est_dia e on e.fecha = m.fecha and et.tot is not null
  ),
  directo as (
    select a.cls as proc, sum(a.usd) as usd
      from asig a where a.cls not in ('mixto', 'ajeno') group by a.cls
    union all
    select mr.proc, sum(mr.usd) from mixto_rep mr group by mr.proc
  ),
  por_proc as (
    select d.proc, sum(d.usd) as usd from directo d group by d.proc
  ),
  tot_real as (
    select round(coalesce(sum(pp.usd), 0), 6) as t from por_proc pp
  ),
  modo as (
    -- Cómo se ha repartido el real (el peor caso gana: peticiones > tarifa > proyecto).
    select case when exists (select 1 from modo_dia md where md.m = 'clave_peticiones') then 'clave_peticiones'
                when exists (select 1 from modo_dia md where md.m = 'clave_tarifa') then 'clave_tarifa'
                else 'proyecto' end as m
  ),
  procs as (
    select unnest(array['ocr', 'chat', 'chatweb', 'vinos', 'otros']) as proc
  ),
  base as (
    select pr.proc, round(coalesce(pp.usd, 0), 6) as r
      from procs pr left join por_proc pp on pp.proc = pr.proc
  ),
  reales as (
    -- La suma es EXACTAMENTE el total real: el redondeo se lo lleva «otros».
    select b.proc,
           case when b.proc = 'otros'
                then (select t.t from tot_real t) - coalesce((select sum(b2.r) from base b2 where b2.proc <> 'otros'), 0)
                else b.r end as r
      from base b
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
  select f.nombre, f.real_usd::numeric, v_corte, f.hoy_usd::numeric, (select m.m from modo m)
    from filas f
   order by f.ord, f.nombre;
end;
$$;

comment on function public.gasto_ia_real_resumen(integer) is
  'Gasto REAL de OpenAI del restaurante en los últimos p_dias (1-90) hasta ultimo_dia_real (último día UTC cerrado), '
  'repartido en ocr / chat / chatweb / vinos / otros. Para cada proyecto y día, su coste se reparte entre las claves con '
  'uso (openai_uso_diario × ia_precios; reparto = clave_tarifa | clave_peticiones | proyecto): las claves ajeno '
  '(openai_claves.proceso) se excluyen, también en proyectos ajeno (Default); las mixto se reparten entre procesos según '
  'el coste estimado de ia_uso + chat_web_uso de ESE día (sin ia_uso, a otros); un proyecto del restaurante sin uso ese día '
  'se queda con su proceso y uno ajeno se excluye. La suma es el total real no ajeno exacto. Filas otros:traducciones / '
  'novedades / resto = desglose ESTIMADO de «otros» (ia_uso) escalado a su real. sin_asignar = proyectos sin marcar '
  '(no suma al total). usd_estimado_hoy = ia_uso + chat_web_uso desde el día siguiente, lo que OpenAI aún no ha '
  'publicado. Sin gasto real del restaurante ultimo_dia_real es NULL y todo es estimado. Exige poder ver Facturas.';

revoke all on function public.gasto_ia_real_resumen(integer) from public, anon;
grant execute on function public.gasto_ia_real_resumen(integer) to authenticated, service_role;

commit;

select 'gasto_real_claves_mixtas: aplicada' as resultado,
       (select count(*) from public.openai_claves where proceso in ('ajeno', 'mixto')) as claves_ajeno_mixto;
