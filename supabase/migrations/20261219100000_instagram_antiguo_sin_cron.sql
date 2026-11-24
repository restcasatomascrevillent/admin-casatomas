set client_encoding = 'UTF8';
-- ============================================================================
-- Instagram antiguo del panel: sin tareas automáticas (23/11/2026, PR «Redes»)
-- ----------------------------------------------------------------------------
-- La sección RRSS/Instagram del panel deja de estar accesible: la sustituye
-- «Redes» (rrss embebido, docs/redes-rrss.md). Antes de quitar sus pantallas, que
-- no quede nada que se publique solo sin que nadie lo vea (revisión de seguridad
-- M4): se quitan sus tres tareas de pg_cron.
--
--   instagram-programador       cada 5 min: publicaba lo programado y cerraba reels
--   instagram-metricas-diarias  05:00: capturaba métricas de la cuenta
--   instagram-limpieza-bucket   03:30: limpiaba el cubo `instagram`
--
-- NO se borra nada más: ni tablas, ni funciones, ni lo que estuviera programado
-- (`instagram_programaciones` queda como esté, sin publicarse). Las Edge Functions
-- `instagram-*` siguen desplegadas; su retirada irá en el PR del borrado, con el
-- «sí» del dueño. Demo primero; en producción, solo con la release y su «sí».
-- Vuelta atrás: supabase/rollbacks/20261219100000_instagram_antiguo_sin_cron_ROLLBACK.sql
-- (OJO: al volver, lo que siga programado y vencido se publicaría en 5 minutos).
-- Tiene que terminar en «instagram_antiguo_sin_cron: aplicado».
-- ============================================================================
do $$
declare
  v_quitadas integer := 0;
begin
  if to_regnamespace('cron') is null then
    raise notice 'instagram_antiguo_sin_cron: pg_cron no está instalado; no hay tareas que quitar.';
  else
    execute $q$
      select count(cron.unschedule(jobid))::int from cron.job
       where jobname in ('instagram-programador', 'instagram-metricas-diarias', 'instagram-limpieza-bucket')
    $q$ into v_quitadas;
    raise notice 'instagram_antiguo_sin_cron: % tareas quitadas', v_quitadas;
  end if;
  raise notice 'instagram_antiguo_sin_cron: aplicado';
end;
$$;
