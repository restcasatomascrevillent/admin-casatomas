set client_encoding = 'UTF8';
-- ROLLBACK de 20261126001000_avisos_telegram: quita los dos crons, las funciones y las
-- tablas de configuración y registro de Telegram. Los avisos del panel no cambian.
-- La Edge Function avisos-telegram, si está desplegada, responde que falta la migración.
set lock_timeout = '5s';

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    if exists (select 1 from cron.job where jobname = 'avisos-telegram-pendientes') then
      perform cron.unschedule('avisos-telegram-pendientes');
    end if;
    if exists (select 1 from cron.job where jobname = 'avisos-telegram-resumen') then
      perform cron.unschedule('avisos-telegram-resumen');
    end if;
  end if;
end;
$$;

drop function if exists public.avisos_telegram_disparar(text);
drop function if exists public.avisos_telegram_hay_pendientes();
drop function if exists public.avisos_telegram_en_silencio(integer, integer, integer);
drop table if exists public.avisos_telegram_envios;
drop table if exists public.avisos_telegram_config;
drop function if exists public.avisos_telegram_config_antes();
