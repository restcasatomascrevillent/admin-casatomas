set client_encoding = 'UTF8';
-- ===========================================================================
--  Reseñas · ciclo automático dos veces al día (job `resenas-ciclo`)
--
--  Demo primero. Se aplica DESPUÉS de 20261122143000_resenas_contestador.sql,
--  de desplegar las Edge Functions `sync-google-reviews` y
--  `resenas-contestador`, y de crear sus secretos:
--    · secret de la función RESENAS_CRON_SECRET (valor aleatorio largo)
--    · Vault 'resenas_cron_secret' -> el MISMO valor
--    · Vault 'project_url'         -> https://<ref>.supabase.co (ya existe)
--  Si falta alguno, la migración FALLA y no cambia nada (no deja un job mudo).
--  Mismo patrón que 20261118100200_logs_web_cron.sql.
--
--  Cada ciclo (resenas-contestador, accion «ciclo»): trae las reseñas de la
--  ficha (Places API: 1 consulta, unas 60 al mes, dentro de las 1.000
--  gratuitas), y de Business Profile si la cuenta está conectada; propone
--  respuesta a las nuevas (máx. 10 por ciclo) y, SOLO si el dueño encendió la
--  respuesta automática, publica las de las estrellas elegidas.
--  08:10 y 20:10 UTC (09:10 y 21:10 en invierno en España).
--  Idempotente. Deshacer: supabase/rollbacks/20261122143100_resenas_cron_ROLLBACK.sql
-- ===========================================================================

begin;

do $$
declare
  v_url text;
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'resenas_cron_secret') then
    raise exception 'Falta el secreto de Vault resenas_cron_secret (mismo valor que RESENAS_CRON_SECRET de la función). No se ha cambiado nada.';
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  if v_url is null or v_url !~ '^https://[a-z0-9]+\.supabase\.co/?$' then
    raise exception 'Falta el secreto de Vault project_url (https://<ref>.supabase.co). No se ha cambiado nada.';
  end if;
end
$$;

select cron.unschedule('resenas-ciclo') where exists (select 1 from cron.job where jobname = 'resenas-ciclo');

select cron.schedule(
  'resenas-ciclo',
  '10 8,20 * * *',
  $$
  select net.http_post(
    url := rtrim(u.decrypted_secret, '/') || '/functions/v1/resenas-contestador',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', s.decrypted_secret),
    body := '{"accion":"ciclo","origen":"cron"}'::jsonb,
    timeout_milliseconds := 120000
  )
  from vault.decrypted_secrets s
  cross join vault.decrypted_secrets u
  where s.name = 'resenas_cron_secret'
    and u.name = 'project_url';
  $$
);

commit;
