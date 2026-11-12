set client_encoding = 'UTF8';
-- ROLLBACK de 20261127100000_fallos_internos_telegram: quita triggers, funciones, cron y la
-- tabla de fallos, y deja la tabla de envíos como en 20261126001000.
-- avisos_telegram_disparar sigue aceptando 'fallos' pero lo haría fallar (falta la tabla): para volver a la
-- versión anterior reaplica su definición de supabase/migrations/20261126001000_avisos_telegram.sql (sección 3).
set lock_timeout = '5s';

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') and exists (select 1 from cron.job where jobname = 'avisos-telegram-fallos') then
    perform cron.unschedule('avisos-telegram-fallos');
  end if;
end;
$$;

drop trigger if exists chat_feedback_fallo_telegram on public.chat_feedback;
drop function if exists public.chat_feedback_fallo_telegram();
drop function if exists public.registrar_fallo_interno(text, jsonb, text);
drop function if exists public.fallos_internos_reclamar(integer);
drop function if exists public.fallo_interno_registrar(text, jsonb, uuid, text);
drop table if exists public.fallos_internos cascade;
drop function if exists public.fallos_internos_despues();

delete from public.avisos_telegram_envios where tipo = 'fallo';
alter table public.avisos_telegram_envios drop column if exists fallo_id;
alter table public.avisos_telegram_envios drop constraint if exists avisos_telegram_envios_tipo_check;
alter table public.avisos_telegram_envios add constraint avisos_telegram_envios_tipo_check
  check (tipo in ('aviso', 'resumen', 'prueba', 'pendientes'));
