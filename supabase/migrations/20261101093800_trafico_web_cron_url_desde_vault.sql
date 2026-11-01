-- ===========================================================================
--  Tráfico web tras la migración de cuenta · job `sync-trafico-web` sin URL
--  de proyecto en duro
--
--  Sin aplicar: la aplica el dueño (demo primero).
--
--  Sustituye la PIEZA 5 de 20260923200000_trafico_web.sql, que programaba el
--  job contra el proyecto viejo (jeamoczmbfsnwkfjxcyo). Estado a 01-11-2026:
--    · PROD: el kit de migración reescribió el job con la URL de PROD y
--      funciona (llama a la función cada noche a las 03:30 UTC).
--    · DEMO: el job NO existe. El kit, en modo `internos`, omite todos los
--      cron con http_post, así que en la demo la función nunca se llama.
--
--  Igual que 20261030153000_novedades_limpiar_foto_con_secreto.sql, la URL sale
--  de Vault en cada ejecución:
--    · 'project_url'             -> https://<ref>.supabase.co
--    · 'trafico_web_cron_secret' -> el MISMO valor que el secret
--                                   TRAFICO_WEB_CRON_SECRET de la función.
--  Si falta cualquiera de los dos al aplicarla, la migración FALLA y no cambia
--  nada (no deja un job mudo). Si después se borra uno, el job no llama a
--  nadie (0 filas en el FROM), como en la versión original.
--
--  En PROD 'project_url' todavía no existe en Vault: crearlo antes es el mismo
--  paso de release que pide 20261030153000. En PROD esta migración es higiene
--  (el job actual ya es correcto); en la DEMO es lo que enciende el cron.
--
--  Idempotente. Rollback: supabase/rollbacks/20261101093800_trafico_web_cron_url_desde_vault_ROLLBACK.sql
-- ===========================================================================

begin;

do $$
declare
  v_url text;
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'trafico_web_cron_secret') then
    raise exception 'Falta el secreto de Vault trafico_web_cron_secret (mismo valor que TRAFICO_WEB_CRON_SECRET de la función). No se ha cambiado nada.';
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  if v_url is null then
    raise exception 'Falta el secreto de Vault project_url (https://<ref>.supabase.co). Créalo con: select vault.create_secret(''https://<ref>.supabase.co'', ''project_url''); No se ha cambiado nada.';
  end if;
  if v_url !~ '^https://[a-z0-9]+\.supabase\.co/?$' then
    raise exception 'El secreto de Vault project_url no tiene la forma https://<ref>.supabase.co. No se ha cambiado nada.';
  end if;
end
$$;

select cron.unschedule('sync-trafico-web') where exists (
  select 1 from cron.job where jobname = 'sync-trafico-web'
);

-- 03:30 UTC: el día anterior ya está cerrado en UTC y en Europe/Madrid.
-- timeout 55 s: un backfill pide hasta 30 días x 2 proyectos.
select cron.schedule(
  'sync-trafico-web',
  '30 3 * * *',
  $$
  select net.http_post(
    url := rtrim(u.decrypted_secret, '/') || '/functions/v1/sync-trafico-web',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', s.decrypted_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  )
  from vault.decrypted_secrets s
  cross join vault.decrypted_secrets u
  where s.name = 'trafico_web_cron_secret'
    and u.name = 'project_url';
  $$
);

commit;
