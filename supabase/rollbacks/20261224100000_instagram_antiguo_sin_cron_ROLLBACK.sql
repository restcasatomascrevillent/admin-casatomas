set client_encoding = 'UTF8';
-- ============================================================================
-- ROLLBACK de 20261224100000_instagram_antiguo_sin_cron
-- ----------------------------------------------------------------------------
-- Vuelve a programar las tres tareas del Instagram antiguo, con la misma llamada
-- que tenían (20261109100000_instagram_video.sql, 20261106100000_instagram_metricas.sql
-- y 20261107010000_instagram_limpieza_bucket.sql).
--
-- ⚠ ANTES de ejecutarlo: revisar `instagram_programaciones` (estado 'programada' o
-- 'publicando') y las piezas 'procesando'. Lo vencido se publicaría en 5 minutos
-- con el token del panel, aunque ya se haya publicado desde rrss (doble publicación).
-- Tiene que terminar en «instagram_antiguo_sin_cron ROLLBACK: aplicado».
-- ============================================================================
do $do$
begin
  if to_regnamespace('cron') is null then
    raise notice 'instagram_antiguo_sin_cron ROLLBACK: pg_cron no está instalado; nada que programar.';
    raise notice 'instagram_antiguo_sin_cron ROLLBACK: aplicado';
    return;
  end if;

  execute $q$select cron.unschedule(jobid) from cron.job where jobname = 'instagram-programador'$q$;
  perform cron.schedule(
    'instagram-programador',
    '*/5 * * * *',
    $cron$
  select net.http_post(
    url := rtrim(u.decrypted_secret, '/') || '/functions/v1/instagram-programador',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', s.decrypted_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  )
  from vault.decrypted_secrets s
  cross join vault.decrypted_secrets u
  where s.name = 'instagram_programador_secret'
    and u.name = 'project_url'
    and (exists (
      select 1 from public.instagram_programaciones p
       where (p.estado = 'programada' and p.siguiente_intento_at <= now())
          or (p.estado = 'publicando' and p.bloqueada_hasta < now())
    ) or exists (
      select 1 from public.instagram_piezas pz
       where pz.estado = 'procesando' and pz.procesando_accion in ('prueba', 'publicar')
    ));
  $cron$
  );

  execute $q$select cron.unschedule(jobid) from cron.job where jobname = 'instagram-metricas-diarias'$q$;
  perform cron.schedule(
    'instagram-metricas-diarias',
    '0 5 * * *',
    $cron$
  select net.http_post(
    url := rtrim(u.decrypted_secret, '/') || '/functions/v1/instagram-metricas',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', s.decrypted_secret
    ),
    body := '{"accion":"capturar"}'::jsonb,
    timeout_milliseconds := 120000
  )
  from vault.decrypted_secrets s
  cross join vault.decrypted_secrets u
  where s.name = 'instagram_metricas_cron_secret'
    and u.name = 'project_url';
  $cron$
  );

  execute $q$select cron.unschedule(jobid) from cron.job where jobname = 'instagram-limpieza-bucket'$q$;
  perform cron.schedule(
    'instagram-limpieza-bucket',
    '30 3 * * *',
    $cron$
  select net.http_post(
    url := rtrim(u.decrypted_secret, '/') || '/functions/v1/instagram-programador',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', s.decrypted_secret
    ),
    body := '{"accion":"limpiar"}'::jsonb,
    timeout_milliseconds := 60000
  )
  from vault.decrypted_secrets s
  cross join vault.decrypted_secrets u
  where s.name = 'instagram_programador_secret'
    and u.name = 'project_url';
  $cron$
  );

  raise notice 'instagram_antiguo_sin_cron ROLLBACK: aplicado';
end;
$do$;
