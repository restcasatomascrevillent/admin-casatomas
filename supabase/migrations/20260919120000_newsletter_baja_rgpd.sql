-- ============================================================================
-- Newsletter: baja real con constancia (RGPD)
-- ----------------------------------------------------------------------------
-- Contexto (ver informe de la migración de los workflows de n8n "Newsletter"
-- y "Noticias" al proyecto propio):
--
-- 1) enviar-newsletter generaba un enlace de baja que apuntaba a un webhook de
--    n8n que SOLO devolvía una página de "baja confirmada" en HTML, sin tocar
--    la base de datos: el suscriptor creía haberse dado de baja y seguía
--    recibiendo correos. Además era un GET sin firmar con el email en la
--    query (?email=...): cualquiera podía dar de baja a cualquier otro, y los
--    prefetchers de los clientes de correo provocaban bajas fantasma.
--    Sustituido por supabase/functions/newsletter-baja, que verifica un token
--    HMAC por suscriptor y exige POST (o el header List-Unsubscribe-Post de
--    RFC 8058) para ejecutar la baja de verdad; un GET solo muestra una
--    página de confirmación.
--
-- 2) newsletter_envios existe desde 2026-01-12 pero enviar-newsletter nunca
--    escribía en ella: no había forma de ver el historial de envíos. Además,
--    en algún momento se añadieron a mano (sin migración) las columnas
--    tipo_newsletter y estado directamente en producción. El bloque 2 de
--    abajo reconcilia esa deriva para que el historial de migraciones vuelva
--    a reflejar el esquema real (ADD COLUMN IF NOT EXISTS: no hace nada si ya
--    están, así que es seguro aplicarlo tal cual).
--
-- 3) Hasta el 2026-01-17 existía un trigger (agregar_suscriptor_al_reservar)
--    que daba de alta automáticamente en newsletter_suscriptores a cualquiera
--    que reservase mesa, sin pedirle consentimiento para recibir marketing.
--    Se eliminó en la migración 20260117201122 y no se ha sustituido por
--    nada, pero la interfaz de Marketing > Correos seguía afirmando que los
--    suscriptores "se recopilan de las reservas" (corregido en
--    src/components/marketing/GestionCorreos.tsx). Retomar la captación
--    requiere una casilla de consentimiento explícita en los formularios de
--    reserva (web y teléfono, en otros repos) — fuera del alcance de esta
--    migración; no se ha recreado el trigger para no dar de alta a nadie sin
--    consentimiento.
-- ============================================================================

-- --- 1. Constancia de la baja: fecha y origen, para poder demostrar cumplimiento ---
ALTER TABLE public.newsletter_suscriptores
  ADD COLUMN IF NOT EXISTS fecha_baja timestamptz,
  ADD COLUMN IF NOT EXISTS origen_baja text;

ALTER TABLE public.newsletter_suscriptores
  DROP CONSTRAINT IF EXISTS newsletter_suscriptores_origen_baja_check;

ALTER TABLE public.newsletter_suscriptores
  ADD CONSTRAINT newsletter_suscriptores_origen_baja_check
  CHECK (origen_baja IS NULL OR origen_baja IN ('enlace_email', 'cabecera_one_click', 'panel_manual'));

COMMENT ON COLUMN public.newsletter_suscriptores.fecha_baja IS
  'Cuándo se dio de baja (NULL si sigue activo o nunca se ha dado de baja). Lo rellena newsletter-baja.';
COMMENT ON COLUMN public.newsletter_suscriptores.origen_baja IS
  'Cómo se dio de baja: enlace_email (clic + confirmación en el pie del correo), cabecera_one_click '
  '(botón nativo de Gmail/Outlook, RFC 8058) o panel_manual (gestión interna futura).';

-- --- 2. Reconciliar columnas de newsletter_envios ya presentes en producción ---
--     pero ausentes del historial de migraciones (se añadieron fuera de banda).
ALTER TABLE public.newsletter_envios
  ADD COLUMN IF NOT EXISTS tipo_newsletter text DEFAULT 'anuncio',
  ADD COLUMN IF NOT EXISTS estado text DEFAULT 'pendiente';

COMMENT ON COLUMN public.newsletter_envios.tipo_newsletter IS
  'anuncio | nuevo_menu | oferta (coincide con NewsletterPayload.tipo en el frontend).';
COMMENT ON COLUMN public.newsletter_envios.estado IS
  'pendiente | completado | parcial | fallido. Lo fija enviar-newsletter según cuántos envíos fallen.';
