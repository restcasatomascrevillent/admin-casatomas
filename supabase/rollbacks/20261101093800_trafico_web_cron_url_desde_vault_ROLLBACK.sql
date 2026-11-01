-- ROLLBACK de migrations/20261101093800_trafico_web_cron_url_desde_vault.sql. A mano.
-- Deja el job como lo dejó el kit de migración en PROD: con la URL del
-- proyecto escrita en el comando (se toma ahora de Vault 'project_url').
-- En la DEMO, antes de la migración NO había job: allí basta con
--   select cron.unschedule('sync-trafico-web');
begin;
do $$
declare
  v_url text;
begin
  select rtrim(decrypted_secret, '/') into v_url from vault.decrypted_secrets where name = 'project_url';
  if v_url is null then
    raise exception 'Falta el secreto de Vault project_url: no se puede reconstruir la URL. No se ha cambiado nada.';
  end if;
  perform cron.unschedule('sync-trafico-web') from cron.job where jobname = 'sync-trafico-web';
  perform cron.schedule(
    'sync-trafico-web',
    '30 3 * * *',
    format($cmd$
  select net.http_post(
    url := %L,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', s.decrypted_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  )
  from vault.decrypted_secrets s
  where s.name = 'trafico_web_cron_secret';
  $cmd$, v_url || '/functions/v1/sync-trafico-web')
  );
end
$$;
commit;
