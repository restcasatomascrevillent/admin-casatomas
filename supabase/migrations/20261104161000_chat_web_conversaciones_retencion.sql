set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261104161000_chat_web_conversaciones_retencion — Borrar las conversaciones del chat de la web a los 12 meses
-- ===========================================================================
-- La política de privacidad de la web (revisada el 04/11/2026 a petición del
-- dueño: «básate en la información real de la web») dice que las
-- conversaciones del asistente de la web (chat) se conservan como máximo 12
-- meses. Hasta ahora nada las borraba (solo chat_web_uso, a los 90 días).
--
-- QUÉ HACE: un trabajo diario de pg_cron (03:35 UTC) borra las conversaciones
-- cuya última actividad (updated_at, o created_at si no hay) tiene más de 12
-- meses. Sus mensajes (chat_web_mensajes) se borran con ellas por la FK
-- ON DELETE CASCADE. Mismo patrón unschedule + schedule idempotente que
-- 'chat-web-uso-retencion' (20260926121000).
--
-- APLICAR (una a una, nunca `db push`): demo primero (sfonaclosuafvlhutkon),
-- producción (haqmmdfdzzatdnrrcgez) solo tras aceptar el PR y con el «sí» del
-- dueño. Idempotente.
-- Deshacer: supabase/rollbacks/20261104161000_chat_web_conversaciones_retencion_ROLLBACK.sql
-- Comprobar: select jobname, schedule, active from cron.job where jobname = 'chat-web-conversaciones-retencion';
-- ===========================================================================

create extension if not exists pg_cron;

select cron.unschedule('chat-web-conversaciones-retencion') where exists (
  select 1 from cron.job where jobname = 'chat-web-conversaciones-retencion'
);

select cron.schedule(
  'chat-web-conversaciones-retencion',
  '35 3 * * *',
  $$ delete from public.chat_web_conversaciones where coalesce(updated_at, created_at) < now() - interval '12 months'; $$
);
