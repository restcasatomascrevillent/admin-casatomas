-- ROLLBACK de 20261122143100_resenas_cron.sql: quita el job que llama a
-- resenas-contestador dos veces al día. El secreto de Vault
-- resenas_cron_secret se puede borrar aparte si ya no se usa.
select cron.unschedule('resenas-ciclo') where exists (select 1 from cron.job where jobname = 'resenas-ciclo');
