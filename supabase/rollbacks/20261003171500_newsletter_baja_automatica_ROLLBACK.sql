set client_encoding = 'UTF8';
-- (Primera línea a propósito: psql en una consola de Windows puede arrancar
-- en WIN1252 y leer mal las tildes.)
-- ===========================================================================
-- ROLLBACK de supabase/migrations/20261003171500_newsletter_baja_automatica.sql
-- ===========================================================================
--
-- Este fichero NO es una migración y no debe copiarse a supabase/migrations/
-- (ver supabase/rollbacks/README.md). Se ejecuta A MANO, entero: lleva su
-- propio begin/commit. `npx supabase db query --linked -f <este fichero>`,
-- `psql "$DB_URL" -v ON_ERROR_STOP=1 -f <este fichero>` o pegado en el SQL
-- editor.
--
-- Qué revierte:
--   · Quita el trigger newsletter_suscriptores_proteger_baja y su función:
--     vuelve a poderse reactivar a mano (desde el panel o la API) a alguien
--     que se dio de baja, sin consentimiento nuevo.
--   · Quita newsletter_registrar_baja() y el índice sobre lower(email):
--     resend-webhook caerá a su UPDATE directo por id/email exacto (ya lo
--     tiene previsto) y fallará contra el CHECK del punto siguiente, así que
--     las quejas/rebotes dejarán de dar de baja (se quedará en el log).
--   · Devuelve el CHECK de origen_baja a los tres valores de 20260919120000
--     (enlace_email, cabecera_one_click, panel_manual).
--
-- Qué se pierde: nada guardado, salvo que ya haya bajas con los orígenes
-- nuevos (queja_spam, rebote_permanente, suprimido_resend, resend_baja_nativa).
-- En ese caso el rollback ABORTA sin tocar nada: esas filas son la constancia
-- RGPD de la baja y no se reescriben a ciegas. Si aun así hay que revertir,
-- decide a mano qué origen ponerles (no las reactives: siguen de baja).
--
-- Si la migración no llegó a aplicarse, ejecutar esto no cambia nada.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $$
declare
  v_n integer;
begin
  select count(*) into v_n
  from public.newsletter_suscriptores
  where origen_baja in ('queja_spam', 'rebote_permanente', 'suprimido_resend', 'resend_baja_nativa');
  if v_n > 0 then
    raise exception 'Hay % suscriptores dados de baja con orígenes nuevos; el CHECK antiguo no los admite. Rollback abortado sin cambios.', v_n;
  end if;
end
$$;

drop trigger if exists newsletter_suscriptores_proteger_baja on public.newsletter_suscriptores;
drop function if exists public.newsletter_suscriptores_proteger_baja();
drop function if exists public.newsletter_registrar_baja(text, text, uuid);
drop index if exists public.newsletter_suscriptores_email_lower_idx;

alter table public.newsletter_suscriptores
  drop constraint if exists newsletter_suscriptores_origen_baja_check;
alter table public.newsletter_suscriptores
  add constraint newsletter_suscriptores_origen_baja_check
  check (origen_baja is null or origen_baja in ('enlace_email', 'cabecera_one_click', 'panel_manual'));

comment on column public.newsletter_suscriptores.origen_baja is
  'Cómo se dio de baja: enlace_email (clic + confirmación en el pie del correo), cabecera_one_click '
  '(botón nativo de Gmail/Outlook, RFC 8058) o panel_manual (gestión interna futura).';

commit;
