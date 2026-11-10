set client_encoding = 'UTF8';
-- ===========================================================================
-- LOS JUEVES ABREN A RESERVAS (petición del dueño, 2026-11-10)
-- ===========================================================================
-- «En el calendario de la sección de reservas los jueves aparece cerrado y
-- están abiertos.»
--
-- CAUSA: no es un fallo de fechas ni de zona horaria. El 2026-10-13 el dueño
-- pidió no coger reservas los lunes, los JUEVES (día de tapas) y los domingos
-- por la noche, y la migración 20261013120000_cierres_reserva.sql lo dejó como
-- regla semanal en el singleton `configuracion_reservas`:
--     dias_cerrados_comida = {1,4}   dias_cerrados_cena = {0,1,4}
-- (0 = domingo … 6 = sábado). La RPC `servicios_cerrados_reserva` —la única
-- regla, la que leen el calendario del panel, el alta de reservas del panel,
-- reservas-web (la web pública) y el bot telefónico— devuelve por eso todos
-- los jueves como cerrados. Comprobado en la demo el 2026-11-10 (solo lectura):
-- esos mismos valores y ninguna excepción en `cierres_reserva`.
--
-- QUÉ HACE
--   1. Quita el 4 (jueves) de las dos listas de la regla semanal. Lunes (todo
--      el día) y domingo noche siguen cerrados: el dueño solo ha pedido los
--      jueves. Si alguien ya había cambiado la regla a mano, se respeta el
--      resto de días.
--   2. Cambia los DEFAULT de las columnas y el respaldo de la RPC (sin fila
--      de configuración) a {1} / {0,1}, para que ninguna instalación nueva
--      vuelva a cerrar los jueves.
--   3. No toca `cierres_reserva`: un jueves cerrado a mano (abierto = false)
--      sigue cerrado, y un jueves «abierto a mano» (abierto = true) queda como
--      una excepción que ya coincide con la regla (inofensiva).
--
-- Va en una transacción e idempotente: aplicarla dos veces deja lo mismo.
-- Vuelta atrás: supabase/rollbacks/20261122103000_jueves_abiertos_ROLLBACK.sql
-- Prueba (PGlite): npm run test:jueves-abiertos:db
-- ===========================================================================
begin;
set local lock_timeout = '5s';

do $$
begin
  if to_regclass('public.configuracion_reservas') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'configuracion_reservas'
         and column_name = 'dias_cerrados_comida'
     ) then
    raise exception 'Falta la migración 20261013120000_cierres_reserva.sql (dias_cerrados_comida no existe): aplíquela antes.';
  end if;
end $$;

-- 1) Regla semanal: fuera los jueves -----------------------------------------
do $$
declare v record;
begin
  for v in select id, dias_cerrados_comida, dias_cerrados_cena from public.configuracion_reservas loop
    raise notice 'configuracion_reservas %: comida % -> %, cena % -> %',
      v.id, v.dias_cerrados_comida, array_remove(v.dias_cerrados_comida, 4),
      v.dias_cerrados_cena, array_remove(v.dias_cerrados_cena, 4);
  end loop;
end $$;

update public.configuracion_reservas
set dias_cerrados_comida = array_remove(dias_cerrados_comida, 4),
    dias_cerrados_cena = array_remove(dias_cerrados_cena, 4)
where 4 = any (dias_cerrados_comida) or 4 = any (dias_cerrados_cena);

-- 2) Valores por defecto ------------------------------------------------------
alter table public.configuracion_reservas
  alter column dias_cerrados_comida set default '{1}',
  alter column dias_cerrados_cena set default '{0,1}';

create or replace function public.servicios_cerrados_reserva(p_desde date, p_hasta date)
returns table (fecha date, turno text, origen text, motivo text)
language sql
stable
security definer
set search_path = public
as $$
  with cfg as (
    select coalesce(dias_cerrados_comida, '{1}'::int[]) as comida,
           coalesce(dias_cerrados_cena, '{0,1}'::int[]) as cena
    from public.configuracion_reservas
    order by created_at
    limit 1
  ),
  cfg_o as (
    -- Sin fila de configuración: la regla por defecto (lunes y domingo noche).
    select comida, cena from cfg
    union all
    select '{1}'::int[], '{0,1}'::int[] where not exists (select 1 from cfg)
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

comment on function public.servicios_cerrados_reserva(date, date) is
  'Servicios (fecha, turno) SIN reservas por web/teléfono: regla semanal de configuracion_reservas + excepciones de cierres_reserva.';

revoke all on function public.servicios_cerrados_reserva(date, date) from public;
grant execute on function public.servicios_cerrados_reserva(date, date) to anon, authenticated, service_role;

commit;
