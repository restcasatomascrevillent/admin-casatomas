set client_encoding = 'UTF8';
-- Vuelta atrás de 20261123110000_levantar_mesas_fin_turno.sql
-- (las salida_at ya puestas por el cron se quedan: son mesas ya levantadas).
begin;
select cron.unschedule(jobid) from cron.job where jobname = 'levantar-mesas-fin-turno';
drop trigger if exists trg_reservas_salida_automatica_reset on public.reservas;
drop function if exists public.fn_reservas_salida_automatica_reset();
drop function if exists public.levantar_mesas_fin_turno();
drop function if exists public.fn_fin_turno_reserva(date, time);
alter table public.reservas drop column if exists salida_automatica;
commit;
