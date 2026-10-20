set client_encoding = 'UTF8';
-- ===========================================================================
-- ROLLBACK de supabase/migrations/20261009100000_openai_gasto_por_clave.sql
-- ===========================================================================
-- No es una migración (ver supabase/rollbacks/README.md). Se ejecuta A MANO,
-- POR TERMINAL (no en el SQL Editor):
--   npx supabase db query --linked -f supabase/rollbacks/20261009100000_openai_gasto_por_clave_ROLLBACK.sql
--
-- ANTES: el panel nuevo lee las filas 'otros:*' y la columna `reparto`, pero
-- una app antigua las ignora: se puede revertir sin tocar el panel. Restaura la
-- versión de 20261008150000 de gasto_ia_real_resumen (reparto por proyecto, sin
-- 'ajeno'), borra `openai_claves` y `openai_uso_diario` (SE PIERDEN: se
-- recuperan con la siguiente sincronización si se vuelve a aplicar) y quita los
-- helpers ia_grupo_de_funcion e ia_proceso_gasto. Los proyectos marcados 'ajeno' pasan a proceso
-- NULL (la restricción antigua no admite 'ajeno'; volverán a salir como
-- «sin_asignar»). La lista de exclusión de auditoría NO se revierte (inocua).
-- La Edge Function desplegada (sincronizar-costes-openai) fallará al escribir
-- el uso: se avisa en su respuesta (campo avisos) pero los costes se siguen
-- guardando. Redesplegar la versión anterior si molesta.
-- Imprime «openai_gasto_por_clave: revertida | 0».
-- ===========================================================================

begin;
set local lock_timeout = '5s';

drop function if exists public.gasto_ia_real_resumen(integer);

create or replace function public.gasto_ia_real_resumen(p_dias integer default 30)
returns table (
  proceso          text,
  usd_real         numeric,
  ultimo_dia_real  date,
  usd_estimado_hoy numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_dias  integer := least(greatest(coalesce(p_dias, 30), 1), 90);
  v_hoy   date    := (now() at time zone 'utc')::date;
  v_corte date;
  v_desde date;
  v_desde_est timestamptz;
begin
  if not (public.can_read_section('facturas') or coalesce(public.is_super_admin(auth.uid()), false)) then
    raise exception 'gasto_ia_real_resumen: sin permiso para ver Facturas' using errcode = '42501';
  end if;

  -- Último día CERRADO con datos de OpenAI (el de hoy es parcial y a veces aún
  -- no está publicado). Es único para todos los procesos: así lo real y lo
  -- estimado no se solapan ni dejan huecos.
  select max(c.fecha) into v_corte
    from public.openai_costes_diarios c
   where c.fecha < v_hoy;

  if v_corte is null then
    -- Sin datos reales todavía: todo es estimación sobre la ventana pedida.
    v_desde := null;
    v_desde_est := now() - make_interval(days => v_dias);
  else
    v_desde := v_corte - (v_dias - 1);
    v_desde_est := ((v_corte + 1)::timestamp at time zone 'utc');
  end if;

  return query
  with reales as (
    select coalesce(p.proceso, 'sin_asignar') as proceso,
           sum(c.usd) as usd
      from public.openai_costes_diarios c
      left join public.openai_proyectos p on p.project_id = c.project_id
     where v_corte is not null and c.fecha between v_desde and v_corte
     group by 1
  ),
  est as (
    select public.ia_proceso_de_funcion(u.funcion) as proceso,
           sum(u.coste_usd) as usd
      from public.ia_uso u
     where u.created_at >= v_desde_est
     group by 1
  ),
  procesos as (
    select unnest(array['ocr', 'chat', 'otros']) as proceso
    union select r.proceso from reales r where r.proceso = 'sin_asignar'
  )
  select pr.proceso,
         coalesce(r.usd, 0)::numeric,
         v_corte,
         coalesce(e.usd, 0)::numeric
    from procesos pr
    left join reales r on r.proceso = pr.proceso
    left join est  e on e.proceso = pr.proceso
   order by case pr.proceso when 'ocr' then 1 when 'chat' then 2 when 'otros' then 3 else 4 end;
end;
$$;

comment on function public.gasto_ia_real_resumen(integer) is
  'Gasto de OpenAI por proceso (ocr, chat, otros y sin_asignar si hay proyectos sin proceso): usd_real = lo facturado '
  '(openai_costes_diarios) en los últimos p_dias (1-90) hasta ultimo_dia_real, el último día UTC cerrado; '
  'usd_estimado_hoy = ia_uso (estimación) desde el día siguiente, lo que OpenAI aún no ha publicado. Sin datos reales '
  'ultimo_dia_real es NULL y todo el gasto va como estimado de la ventana. Exige poder ver Facturas.';

revoke all on function public.gasto_ia_real_resumen(integer) from public, anon;
grant execute on function public.gasto_ia_real_resumen(integer) to authenticated, service_role;

revoke all on function public.gasto_ia_real_resumen(integer) from public, anon;
grant execute on function public.gasto_ia_real_resumen(integer) to authenticated, service_role;

drop function if exists public.ia_grupo_de_funcion(text);
drop function if exists public.ia_proceso_gasto(text);
drop table if exists public.openai_uso_diario;
drop table if exists public.openai_claves;

update public.openai_proyectos set proceso = null where proceso in ('ajeno', 'chatweb', 'vinos');
alter table public.openai_proyectos drop constraint if exists openai_proyectos_proceso_check;
alter table public.openai_proyectos
  add constraint openai_proyectos_proceso_check
  check (proceso is null or proceso in ('ocr', 'chat', 'otros'));

commit;

select 'openai_gasto_por_clave: revertida' as resultado,
       (select count(*) from pg_proc where proname in ('ia_grupo_de_funcion', 'ia_proceso_gasto'))
       + (select count(*) from pg_class where relname in ('openai_claves', 'openai_uso_diario')) as objetos_que_quedan;
