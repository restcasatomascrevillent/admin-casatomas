-- ===========================================================================
--  Logs web · job `procesar-logs-web` cada 5 minutos
--
--  Sin aplicar en producción: demo primero. Se aplica DESPUÉS de desplegar la
--  Edge Function `procesar-logs-web` y de crear sus secretos:
--    · secret de la función LOGS_WEB_CRON_SECRET (valor aleatorio largo)
--    · Vault 'logs_web_cron_secret' -> el MISMO valor
--    · Vault 'project_url'          -> https://<ref>.supabase.co (ya existe en la demo)
--  Si falta alguno, la migración FALLA y no cambia nada (no deja un job mudo).
--  Mismo patrón que 20261101093800_trafico_web_cron_url_desde_vault.sql.
--
--  El proceso es incremental y barato cuando no hay nada: agrupa los errores
--  nuevos, recalcula ventanas, crea/actualiza tickets pendientes (con su
--  propio tope diario), lee las integraciones y, una vez al día, purga.
--  Idempotente. Deshacer: supabase/rollbacks/20261118100200_logs_web_cron_ROLLBACK.sql
-- ===========================================================================

begin;

do $$
declare
  v_url text;
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'logs_web_cron_secret') then
    raise exception 'Falta el secreto de Vault logs_web_cron_secret (mismo valor que LOGS_WEB_CRON_SECRET de la función). No se ha cambiado nada.';
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  if v_url is null or v_url !~ '^https://[a-z0-9]+\.supabase\.co/?$' then
    raise exception 'Falta el secreto de Vault project_url (https://<ref>.supabase.co). No se ha cambiado nada.';
  end if;
end
$$;

select cron.unschedule('procesar-logs-web') where exists (select 1 from cron.job where jobname = 'procesar-logs-web');

select cron.schedule(
  'procesar-logs-web',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := rtrim(u.decrypted_secret, '/') || '/functions/v1/procesar-logs-web',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', s.decrypted_secret),
    body := '{"origen":"cron"}'::jsonb,
    timeout_milliseconds := 55000
  )
  from vault.decrypted_secrets s
  cross join vault.decrypted_secrets u
  where s.name = 'logs_web_cron_secret'
    and u.name = 'project_url';
  $$
);

commit;
