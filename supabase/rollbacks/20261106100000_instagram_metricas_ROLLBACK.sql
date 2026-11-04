set client_encoding = 'UTF8';
-- ===========================================================================
-- ROLLBACK de migrations/20261106100000_instagram_metricas.sql (se ejecuta A MANO).
-- ===========================================================================
-- BORRA DATOS: el histórico de métricas de Instagram (cuenta por día y
-- publicaciones por día de captura) y el registro de capturas. Meta guarda
-- las métricas de cada publicación hasta 2 años, pero las de la cuenta por
-- día NO se pueden volver a pedir con el mismo detalle: copia antes si hace falta:
--   create table public.zz_backup_instagram_metricas_cuenta as table public.instagram_metricas_cuenta;
--   create table public.zz_backup_instagram_metricas_publicacion as table public.instagram_metricas_publicacion;
--
-- Quita primero la tarea pg_cron «instagram-metricas-diarias» (si no, fallaría
-- cada día contra una función sin tablas). NO borra los secretos de Vault
-- (project_url lo usan otros cron; instagram_metricas_cron_secret se puede
-- borrar a mano: delete from vault.secrets where name = 'instagram_metricas_cron_secret';)
-- ni el secreto INSTAGRAM_METRICAS_CRON_SECRET de la función.
--
-- AVISO: revertir el frontend PRIMERO (la pestaña «Métricas» llama a la
-- función instagram-metricas, que lee estas tablas: sin ellas daría 500) y
-- borrar o dejar de desplegar la Edge Function instagram-metricas.
-- No toca instagram_piezas, instagram_fotos ni el bucket «instagram».
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.unschedule('instagram-metricas-diarias')
       from cron.job where jobname = 'instagram-metricas-diarias';
  end if;
end;
$$;

drop view if exists public.instagram_metricas_publicacion_ultima;
drop table if exists public.instagram_metricas_publicacion;
drop table if exists public.instagram_metricas_cuenta;
drop table if exists public.instagram_metricas_capturas;

commit;
