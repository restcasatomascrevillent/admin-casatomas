-- ROLLBACK de 20261118100200_logs_web_cron.sql: quita el job que llama a
-- procesar-logs-web cada 5 minutos. El secreto de Vault logs_web_cron_secret
-- se puede borrar aparte si ya no se usa.
select cron.unschedule('procesar-logs-web') where exists (select 1 from cron.job where jobname = 'procesar-logs-web');
