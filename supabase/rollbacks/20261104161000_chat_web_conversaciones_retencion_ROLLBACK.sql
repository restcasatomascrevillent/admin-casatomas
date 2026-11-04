set client_encoding = 'UTF8';
-- ROLLBACK de 20261104161000_chat_web_conversaciones_retencion.sql: quita el
-- trabajo diario. Las conversaciones ya borradas no vuelven. OJO: la política
-- de privacidad de la web promete 12 meses; si se quita, hay que cambiarla.
select cron.unschedule('chat-web-conversaciones-retencion') where exists (
  select 1 from cron.job where jobname = 'chat-web-conversaciones-retencion'
);
