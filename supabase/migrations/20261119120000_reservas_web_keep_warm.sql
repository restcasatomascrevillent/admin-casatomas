-- ===========================================================================
--  CT-REM-FN-07c · reservas-web: cron de keep-warm (anti arranque en frío)
--
--  Problema (medido en QA, 2026-11): la 1.ª consulta de disponibilidad tras un
--  rato sin tráfico tardaba ~22 s porque el isolate de la Edge Function arranca
--  en frío. En caliente, ~1,5-2,2 s incluso con varias consultas a la vez. Es
--  coste de arranque, no un colapso por carga.
--
--  Solución: un job de pg_cron pide `GET /reservas-web/salud` cada 5 minutos.
--  `/salud` no toca la BD ni revela nada (ver rutas.ts / handleSalud); solo
--  mantiene vivo el isolate para que el primer visitante no espere el arranque.
--
--  Sin aplicar en producción: demo primero. Requiere (ya presentes en el
--  proyecto, igual que 20261118100200_logs_web_cron.sql):
--    · extensiones pg_cron y pg_net
--    · Vault 'project_url' -> https://<ref>.supabase.co
--  `/salud` es público (la función tiene verify_jwt desactivado, como el resto
--  de rutas web), así que NO hace falta apikey ni secreto para la sonda.
--  Si falta project_url, la migración FALLA y no deja un job mudo.
--  Idempotente. Deshacer: supabase/rollbacks/20261119120000_reservas_web_keep_warm_ROLLBACK.sql
-- ===========================================================================

begin;

do $$
declare
  v_url text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  if v_url is null or v_url !~ '^https://[a-z0-9]+\.supabase\.co/?$' then
    raise exception 'Falta el secreto de Vault project_url (https://<ref>.supabase.co). No se ha cambiado nada.';
  end if;
end
$$;

select cron.unschedule('reservas-web-keep-warm') where exists (select 1 from cron.job where jobname = 'reservas-web-keep-warm');

select cron.schedule(
  'reservas-web-keep-warm',
  '*/5 * * * *',
  $$
  select net.http_get(
    url := rtrim(u.decrypted_secret, '/') || '/functions/v1/reservas-web/salud',
    timeout_milliseconds := 10000
  )
  from vault.decrypted_secrets u
  where u.name = 'project_url';
  $$
);

commit;

-- COMPROBACIÓN POST-MIGRACIÓN (manual)
-- select jobname, schedule, active from cron.job where jobname = 'reservas-web-keep-warm';
-- -- últimas ejecuciones:
-- select status, return_message, start_time from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'reservas-web-keep-warm')
--   order by start_time desc limit 5;
