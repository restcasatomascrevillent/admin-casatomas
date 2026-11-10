set client_encoding = 'UTF8';
-- ===========================================================================
-- Levantar solas las mesas al acabar el turno (10/11/2026, pedido del dueño)
-- ===========================================================================
-- «Levantar/Liberar mesa» en el panel = poner `reservas.salida_at` (la reserva
-- sigue «Llegó», la asignación no se borra). Si nadie lo pulsa, la mesa se ve
-- ocupada hasta que alguien se acuerda.
--
-- Ahora un cron (cada 10 min) levanta las reservas SENTADAS («Llegó» =
-- estado completada) sin `salida_at` cuando su turno ya ha terminado:
--
--   fin del turno = día + hora_fin del turno en configuracion_turnos (la del
--                   día de la semana; si una reserva es más tarde, su hora)
--                   + estancia del turno (configuracion_reservas:
--                   estancia_comida_minutos / estancia_cena_minutos).
--   Hoy en la demo: comida 16:00 + 105 min = 17:45; cena 23:00 + 120 = 01:00.
--   Comida/cena se separa a las 17:00, igual que `turnoDeHora` del panel.
--
-- `salida_at` se pone a esa hora de fin (no a «ahora») y se marca
-- `salida_automatica = true` para saber que no lo hizo nadie del personal.
-- Solo mira hoy y los dos días anteriores: no reescribe el histórico.
-- «Deshacer liberar» del panel sigue funcionando (pone salida_at a null).
--
-- PASOS: npx supabase db query --linked -f supabase/migrations/20261123110000_levantar_mesas_fin_turno.sql
-- ===========================================================================
begin;
set local lock_timeout = '5s';

alter table public.reservas
  add column if not exists salida_automatica boolean not null default false;

comment on column public.reservas.salida_automatica is
  'true si salida_at lo puso el cron levantar-mesas-fin-turno (nadie pulsó «Liberar mesa»).';

create or replace function public.fn_fin_turno_reserva(p_fecha date, p_hora time)
returns timestamp
language sql
stable
set search_path to 'public'
as $$
  with turno as (
    select case when p_hora < time '17:00' then 'comida' else 'cena' end as t
  ), fin_cfg as (
    select max(
             case when ct.hora_fin <= ct.hora_inicio   -- turno que cruza medianoche
                  then p_fecha + 1 + ct.hora_fin
                  else p_fecha + ct.hora_fin end) as fin
    from public.configuracion_turnos ct, turno
    where ct.activo is not false
      and extract(dow from p_fecha)::int = any (ct.dias_semana::int[])
      and (case when ct.hora_inicio < time '17:00' then 'comida' else 'cena' end) = turno.t
  )
  select greatest(coalesce(fin_cfg.fin, p_fecha + p_hora), p_fecha + p_hora)
         + make_interval(mins => coalesce(
             (select case when turno.t = 'comida' then cr.estancia_comida_minutos
                          else cr.estancia_cena_minutos end
              from public.configuracion_reservas cr limit 1),
             120))
  from fin_cfg, turno;
$$;

comment on function public.fn_fin_turno_reserva(date, time) is
  'Hora local (Europe/Madrid) a la que se da por terminado el turno de una reserva: hora_fin del turno ese día de la semana (o la hora de la reserva si es más tarde) + estancia del turno.';

create or replace function public.levantar_mesas_fin_turno()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n integer;
begin
  with candidatas as (
    select r.id,
           (public.fn_fin_turno_reserva(r.fecha, r.hora) at time zone 'Europe/Madrid') as fin
    from public.reservas r
    where r.estado = 'completada'
      and r.salida_at is null
      and r.fecha between (now() at time zone 'Europe/Madrid')::date - 2
                      and (now() at time zone 'Europe/Madrid')::date
  )
  update public.reservas r
     set salida_at = c.fin,
         salida_automatica = true
    from candidatas c
   where r.id = c.id
     and c.fin <= now()
     and r.salida_at is null;

  get diagnostics n = row_count;
  return n;
end;
$$;

comment on function public.levantar_mesas_fin_turno() is
  'Cron levantar-mesas-fin-turno: pone salida_at (fin del turno) a las reservas «Llegó» que nadie levantó. Devuelve cuántas.';

revoke all on function public.levantar_mesas_fin_turno() from public, anon, authenticated;

--  Quitar «Liberar» a mano en el panel debe borrar la marca automática.
create or replace function public.fn_reservas_salida_automatica_reset()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.salida_at is null then
    new.salida_automatica := false;
  elsif new.salida_at is distinct from old.salida_at
        and new.salida_automatica is not distinct from old.salida_automatica then
    -- la puso alguien del personal, no el cron
    new.salida_automatica := false;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reservas_salida_automatica_reset on public.reservas;
create trigger trg_reservas_salida_automatica_reset
  before update of salida_at on public.reservas
  for each row execute function public.fn_reservas_salida_automatica_reset();

select cron.unschedule(jobid) from cron.job where jobname = 'levantar-mesas-fin-turno';
select cron.schedule('levantar-mesas-fin-turno', '*/10 * * * *',
  $cron$ select public.levantar_mesas_fin_turno(); $cron$);

commit;
