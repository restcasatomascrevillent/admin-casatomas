-- Vuelta atrás de 20261122200000_turnos_horas_fijas_jueves_tapas.sql
-- Deja el jueves por la noche con la «Cena» general (horas por escalera) y
-- la franja de mesa como antes (hora + tiempo de ocupación, sin recorte).

-- 1. La franja de mesa, como en 20261005130000.
create or replace function public.fn_franja_ocupacion_mesa(p_fecha date, p_hora time)
returns tsrange
language sql
stable
set search_path = public
as $$
  select tsrange(p_fecha + p_hora,
                 p_fecha + p_hora + make_interval(mins => public.fn_minutos_ocupacion_mesa(p_hora)),
                 '[)');
$$;

comment on function public.fn_franja_ocupacion_mesa(date, time) is
  'Franja [inicio, fin) en la que una reserva ocupa su mesa: de su hora a hora + fn_minutos_ocupacion_mesa. Dos reservas pueden compartir mesa si sus franjas no se solapan. Migración 20261005130000_mesas_ocupacion_por_tiempo.';

drop function if exists public.fn_minutos_hasta_siguiente_turno_fijo(date, time);

-- 2. Datos: el periodo de tapas fuera y el jueves de vuelta a la cena general.
do $$
begin
  if exists (select 1 from public.configuracion_turnos where nombre_periodo = 'Cena · Jueves de tapas' and espacio_id is null) then
    delete from public.configuracion_turnos where nombre_periodo = 'Cena · Jueves de tapas' and espacio_id is null;
    update public.configuracion_turnos
       set dias_semana = (select array_agg(d order by d) from unnest(array_append(dias_semana, 4)) as d),
           updated_at = now()
     where id = (
       select id from public.configuracion_turnos
       where espacio_id is null and activo is not false and hora_inicio >= time '17:00'
         and not (4 = any (dias_semana)) and cardinality(dias_semana) > 0
       order by hora_inicio
       limit 1
     );
  end if;
end $$;

-- 3. La columna.
alter table public.configuracion_turnos drop constraint if exists configuracion_turnos_horas_fijas_check;
alter table public.configuracion_turnos drop column if exists horas_fijas;
