-- ROLLBACK de migrations/20261119120000_reservas_web_keep_warm.sql (CT-REM-FN-07c).
-- A mano. Quita el job de keep-warm. La función /salud puede quedarse (es
-- inocua); sin el cron, simplemente vuelve el arranque en frío ocasional.
begin;
select cron.unschedule('reservas-web-keep-warm') where exists (select 1 from cron.job where jobname = 'reservas-web-keep-warm');
commit;
