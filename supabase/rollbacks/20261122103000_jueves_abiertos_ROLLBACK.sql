set client_encoding = 'UTF8';
-- ===========================================================================
-- VUELTA ATRÁS de 20261122103000_jueves_abiertos.sql
-- ===========================================================================
-- Vuelve a cerrar los JUEVES (todo el día) en la regla semanal, como dejó
-- 20261013120000_cierres_reserva.sql, y devuelve los DEFAULT y el respaldo de
-- la RPC a {1,4} / {0,1,4}. Ejecutar A MANO (psql / SQL editor) solo para
-- deshacer el despliegue.
--
-- OJO: vuelve a dejar sin reservas web/teléfono TODOS los jueves desde ese
-- momento (el panel solo avisa). Las reservas que ya existan un jueves no se
-- tocan. Conviene revertir también el código del panel (CIERRE_SEMANAL_POR_DEFECTO
-- en supabase/functions/_shared/cierres.ts), aunque solo se usa de respaldo.
-- ===========================================================================
begin;
set local lock_timeout = '5s';

update public.configuracion_reservas
set dias_cerrados_comida = case when 4 = any (dias_cerrados_comida) then dias_cerrados_comida
                                else array(select unnest(dias_cerrados_comida || 4) order by 1) end,
    dias_cerrados_cena = case when 4 = any (dias_cerrados_cena) then dias_cerrados_cena
                              else array(select unnest(dias_cerrados_cena || 4) order by 1) end;

alter table public.configuracion_reservas
  alter column dias_cerrados_comida set default '{1,4}',
  alter column dias_cerrados_cena set default '{0,1,4}';

create or replace function public.servicios_cerrados_reserva(p_desde date, p_hasta date)
returns table (fecha date, turno text, origen text, motivo text)
language sql
stable
security definer
set search_path = public
as $$
  with cfg as (
    select coalesce(dias_cerrados_comida, '{1,4}'::int[]) as comida,
           coalesce(dias_cerrados_cena, '{0,1,4}'::int[]) as cena
    from public.configuracion_reservas
    order by created_at
    limit 1
  ),
  cfg_o as (
    select comida, cena from cfg
    union all
    select '{1,4}'::int[], '{0,1,4}'::int[] where not exists (select 1 from cfg)
  ),
  dias as (
    select d::date as fecha
    from generate_series(p_desde, least(p_hasta, p_desde + 400), interval '1 day') d
    where p_desde is not null and p_hasta is not null and p_hasta >= p_desde
  ),
  servicios as (
    select dias.fecha, t.turno,
           case t.turno
             when 'comida' then extract(dow from dias.fecha)::int = any (cfg_o.comida)
             else extract(dow from dias.fecha)::int = any (cfg_o.cena)
           end as cierra_semanal
    from dias
    cross join cfg_o
    cross join (values ('comida'), ('cena')) as t(turno)
  )
  select s.fecha, s.turno,
         case when c.fecha is not null then 'manual' else 'semanal' end as origen,
         c.motivo
  from servicios s
  left join public.cierres_reserva c on c.fecha = s.fecha and c.turno = s.turno
  where coalesce(not c.abierto, s.cierra_semanal)
  order by s.fecha, s.turno;
$$;

revoke all on function public.servicios_cerrados_reserva(date, date) from public;
grant execute on function public.servicios_cerrados_reserva(date, date) to anon, authenticated, service_role;

commit;
