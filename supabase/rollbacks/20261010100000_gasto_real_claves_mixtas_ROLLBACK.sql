set client_encoding = 'UTF8';
-- ===========================================================================
-- ROLLBACK de supabase/migrations/20261010100000_gasto_real_claves_mixtas.sql
-- ===========================================================================
-- No es una migración (ver supabase/rollbacks/README.md). Se ejecuta A MANO,
-- POR TERMINAL (no en el SQL Editor):
--   npx supabase db query --linked -f supabase/rollbacks/20261010100000_gasto_real_claves_mixtas_ROLLBACK.sql
--
-- Restaura la versión de gasto_ia_real_resumen de 20261009100000 (reparto
-- global por clave sin 'ajeno'/'mixto' a nivel de clave: el proyecto Default,
-- marcado 'ajeno', vuelve a excluirse ENTERO y el gasto real del restaurante
-- vuelve a salir casi a cero), pasa las claves 'ajeno'/'mixto' a 'otros' (es lo
-- que eran antes del cambio de datos) y repone la restricción de 5 valores.
-- La Edge Function redesplegada sigue sincronizando el uso de los proyectos
-- ajenos: es inocua con la RPC antigua (la ignora), pero sus claves nuevas
-- entrarían como 'ajeno' y fallarían contra la restricción antigua (avisos).
-- Imprime «gasto_real_claves_mixtas: revertida | 0».
-- ===========================================================================

begin;
set local lock_timeout = '5s';

update public.openai_claves set proceso = 'otros' where proceso in ('ajeno', 'mixto');
alter table public.openai_claves drop constraint if exists openai_claves_proceso_check;
alter table public.openai_claves
  add constraint openai_claves_proceso_check
  check (proceso in ('ocr', 'chat', 'chatweb', 'vinos', 'otros'));

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

select 'gasto_real_claves_mixtas: revertida' as resultado,
       (select count(*) from public.openai_claves where proceso in ('ajeno', 'mixto')) as objetos_que_quedan;
