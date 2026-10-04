set client_encoding = 'UTF8';
-- (Primera línea a propósito: psql en una consola de Windows puede arrancar
-- en WIN1252 y leer mal las tildes.)
-- ===========================================================================
-- ROLLBACK de supabase/migrations/20261003193000_newsletter_resend_broadcasts.sql
-- ===========================================================================
--
-- Este fichero NO es una migración y no debe copiarse a supabase/migrations/
-- (ver supabase/rollbacks/README.md). Se ejecuta A MANO, entero: lleva su
-- propio begin/commit. `npx supabase db query --linked -f <este fichero>`,
-- `psql "$DB_URL" -v ON_ERROR_STOP=1 -f <este fichero>` o pegado en el SQL
-- editor.
--
-- ANTES de ejecutarlo: poner `NEWSLETTER_CANAL=transaccional` (o borrar el
-- secret) y quitar el cron diario de newsletter-sync-resend si se programó
-- (`select cron.unschedule('newsletter-sync-resend-diario');`). Sin estas
-- columnas newsletter-sync-resend falla y enviar-newsletter en modo broadcast
-- no puede sincronizar (se niega a enviar: no manda nada a medias).
--
-- Qué revierte:
--   · newsletter_suscriptores: quita resend_contact_id, resend_sincronizado_at
--     y su índice. NO toca activo/fecha_baja/origen_baja (la constancia RGPD).
--   · newsletter_envios: quita canal y resend_broadcast_id (y su CHECK/índice).
--   · Borra la tabla newsletter_sincronizaciones_resend (historial de pasadas).
--   · Borra newsletter_marcar_sincronizados() y newsletter_estadisticas_broadcasts()
--     y el índice de email_eventos por broadcast_id (los eventos se quedan).
--
-- Qué se pierde: el vínculo con los contactos de Resend (la siguiente
-- sincronización, si se vuelve a aplicar la migración, lo reconstruye por
-- email), qué envíos salieron como Broadcast y su id, y el historial de
-- pasadas. Los contactos que haya en Resend NO se borran desde aquí: si se
-- abandona Resend Marketing, bórralos en el dashboard de Resend.
--
-- Si la migración no llegó a aplicarse, ejecutar esto no cambia nada.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

drop function if exists public.newsletter_estadisticas_broadcasts(text[]);
drop function if exists public.newsletter_marcar_sincronizados(jsonb);
drop index if exists public.email_eventos_broadcast_idx;

drop table if exists public.newsletter_sincronizaciones_resend;

drop index if exists public.newsletter_envios_resend_broadcast_uidx;
alter table public.newsletter_envios drop constraint if exists newsletter_envios_canal_check;
alter table public.newsletter_envios
  drop column if exists resend_broadcast_id,
  drop column if exists canal;

drop index if exists public.newsletter_suscriptores_resend_contact_idx;
alter table public.newsletter_suscriptores
  drop column if exists resend_sincronizado_at,
  drop column if exists resend_contact_id;

commit;
