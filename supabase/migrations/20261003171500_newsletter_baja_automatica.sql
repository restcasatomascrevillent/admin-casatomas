-- ============================================================================
-- Newsletter: baja automática y protección contra reactivaciones sin consentimiento
-- ----------------------------------------------------------------------------
-- NO APLICADA: la aplica el dueño a mano. Idempotente (se puede ejecutar más
-- de una vez sin efectos).
--
-- REQUISITO: aplicar ANTES 20261003143000_reserva_web_prueba_consentimiento.sql
-- (crea newsletter_suscriptores.reserva_consentimiento_id, que usa el trigger
-- de abajo). Si no está, este fichero se detiene en el paso 0 sin tocar nada.
--
-- Pasos (proyecto jeamoczmbfsnwkfjxcyo):
--   1. supabase db query --linked -f supabase/migrations/20261003143000_reserva_web_prueba_consentimiento.sql
--      (si no se ha aplicado ya)
--   2. supabase db query --linked -f supabase/migrations/20261003171500_newsletter_baja_automatica.sql
--   3. Comprobar:
--        select pg_get_constraintdef(oid) from pg_constraint
--         where conname = 'newsletter_suscriptores_origen_baja_check';
--        select tgname from pg_trigger
--         where tgrelid = 'public.newsletter_suscriptores'::regclass and not tgisinternal;
--   4. Desplegar resend-webhook y enviar-newsletter (ver
--      docs/funcionalidades/newsletter-resend-marketing.md, "Pasos del dueño").
--   Rollback: supabase/rollbacks/20261003171500_newsletter_baja_automatica_ROLLBACK.sql
--
-- QUÉ HACE Y POR QUÉ (encargo del dueño, 2026-10-03: "que en la newsletter se
-- ponga automático el darse de baja"):
--
-- 1) origen_baja admite los orígenes automáticos nuevos, además de los tres
--    de 20260919120000 (enlace_email, cabecera_one_click, panel_manual):
--      queja_spam          el destinatario marcó un correo nuestro como spam
--      rebote_permanente   el servidor del destinatario rechazó el correo
--      suprimido_resend    Resend no lo intentó (lista de supresión)
--      resend_baja_nativa  baja desde la página de preferencias de Resend
--                          (fase 2: newsletter como Broadcast)
--    Los escribe resend-webhook (eventos email.complained / email.bounced /
--    email.suppressed / contact.updated) a través de la función del punto 3.
--
-- 2) Trigger BEFORE UPDATE `newsletter_suscriptores_proteger_baja`:
--    a) Al pasar de activo a inactivo, rellena fecha_baja (now()) y
--       origen_baja ('panel_manual') si quien actualiza no los manda: nunca
--       queda una baja sin fecha ni origen.
--    b) Mientras la fila está de baja, fecha_baja y origen_baja no se pueden
--       cambiar (son la constancia RGPD de la baja).
--    c) REACTIVAR (inactivo -> activo) solo se permite con un consentimiento
--       NUEVO: `reserva_consentimiento_id` tiene que cambiar y apuntar a una
--       reserva del mismo email con consentimiento_newsletter = true creada
--       DESPUÉS de la baja. Es exactamente lo que hace el trigger de la reserva
--       (agregar_suscriptor_desde_reserva_consentida, ON CONFLICT DO UPDATE)
--       cuando alguien vuelve a marcar la casilla. Cualquier otro intento
--       (panel, API con la sesión de un usuario, service role) se rechaza.
--       · Llamada directa (pg_trigger_depth() = 1): ERROR claro.
--       · Desde otro trigger (p. ej. al insertar una reserva): NO se lanza
--         error — tumbaría la reserva del cliente —; se deja la fila de baja
--         tal cual y se emite un WARNING.
--
-- 3) Función `newsletter_registrar_baja(p_email, p_origen, p_suscriptor_id)`
--    para resend-webhook (solo service_role): da de baja por id (si el correo
--    traía la etiqueta `suscriptor`) o por email sin distinguir mayúsculas,
--    solo filas activas. Devuelve cuántas filas cambió. Índice sobre
--    lower(email) para esa búsqueda.
--
-- No cambia nada de lo que ya funciona: newsletter-baja (enlace del pie y
-- one-click) sigue escribiendo enlace_email / cabecera_one_click igual que hoy.
-- ============================================================================

-- --- 0. Requisito: 20261003143000 aplicada ---
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'newsletter_suscriptores'
      AND column_name = 'reserva_consentimiento_id'
  ) THEN
    RAISE EXCEPTION 'Falta newsletter_suscriptores.reserva_consentimiento_id: aplica antes 20261003143000_reserva_web_prueba_consentimiento.sql';
  END IF;
END
$$;

-- --- 1. Orígenes de baja automáticos ---
ALTER TABLE public.newsletter_suscriptores
  DROP CONSTRAINT IF EXISTS newsletter_suscriptores_origen_baja_check;

ALTER TABLE public.newsletter_suscriptores
  ADD CONSTRAINT newsletter_suscriptores_origen_baja_check
  CHECK (origen_baja IS NULL OR origen_baja IN (
    'enlace_email', 'cabecera_one_click', 'panel_manual',
    'queja_spam', 'rebote_permanente', 'suprimido_resend', 'resend_baja_nativa'
  ));

COMMENT ON COLUMN public.newsletter_suscriptores.origen_baja IS
  'Cómo se dio de baja. Lo pone el sistema, nunca el personal: enlace_email (enlace del pie + confirmación), '
  'cabecera_one_click (botón nativo de Gmail/Outlook, RFC 8058), queja_spam (marcó un correo como spam), '
  'rebote_permanente (dirección inexistente), suprimido_resend (Resend no lo intentó), resend_baja_nativa '
  '(página de baja de Resend, Broadcasts), panel_manual (baja hecha desde el panel o sin origen indicado). '
  'Inmutable mientras la fila sigue de baja (trigger newsletter_suscriptores_proteger_baja).';

-- --- 2. Trigger de protección ---
CREATE OR REPLACE FUNCTION public.newsletter_suscriptores_proteger_baja()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_consentimiento_nuevo boolean := false;
BEGIN
  -- a) Baja: siempre con fecha y origen.
  IF OLD.activo AND NOT NEW.activo THEN
    NEW.fecha_baja := COALESCE(NEW.fecha_baja, now());
    NEW.origen_baja := COALESCE(NEW.origen_baja, 'panel_manual');
    RETURN NEW;
  END IF;

  -- b) Sigue de baja: la constancia no se toca (salvo rellenar una que faltaba).
  IF NOT OLD.activo AND NOT NEW.activo THEN
    NEW.fecha_baja := COALESCE(OLD.fecha_baja, NEW.fecha_baja);
    NEW.origen_baja := COALESCE(OLD.origen_baja, NEW.origen_baja);
    RETURN NEW;
  END IF;

  -- c) Reactivación: solo con un consentimiento nuevo en una reserva.
  IF NOT OLD.activo AND NEW.activo THEN
    IF NEW.reserva_consentimiento_id IS NOT NULL
       AND NEW.reserva_consentimiento_id IS DISTINCT FROM OLD.reserva_consentimiento_id THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.reservas r
        WHERE r.id = NEW.reserva_consentimiento_id
          AND r.consentimiento_newsletter = true
          AND lower(r.email) = lower(NEW.email)
          -- Bajas antiguas sin fecha_baja: se toma updated_at (último cambio de la fila).
          AND r.created_at > COALESCE(OLD.fecha_baja, OLD.updated_at)
      ) INTO v_consentimiento_nuevo;
    END IF;

    IF v_consentimiento_nuevo THEN
      RETURN NEW;
    END IF;

    IF pg_trigger_depth() > 1 THEN
      RAISE WARNING 'newsletter: reactivación de % ignorada (sin consentimiento nuevo posterior a la baja)', OLD.id;
      NEW.activo := false;
      NEW.fecha_baja := OLD.fecha_baja;
      NEW.origen_baja := OLD.origen_baja;
      NEW.fecha_consentimiento := OLD.fecha_consentimiento;
      NEW.reserva_consentimiento_id := OLD.reserva_consentimiento_id;
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'No se puede reactivar a un suscriptor dado de baja sin un consentimiento nuevo (casilla marcada en una reserva posterior a la baja).'
      USING ERRCODE = 'check_violation',
            HINT = 'La baja del newsletter es definitiva hasta que el cliente vuelva a dar su consentimiento.';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.newsletter_suscriptores_proteger_baja() IS
  'Trigger BEFORE UPDATE de newsletter_suscriptores: completa fecha/origen de la baja, la hace inmutable y solo deja reactivar con un consentimiento nuevo (reserva posterior a la baja con consentimiento_newsletter = true). Migración 20261003171500.';

DROP TRIGGER IF EXISTS newsletter_suscriptores_proteger_baja ON public.newsletter_suscriptores;
CREATE TRIGGER newsletter_suscriptores_proteger_baja
BEFORE UPDATE ON public.newsletter_suscriptores
FOR EACH ROW
EXECUTE FUNCTION public.newsletter_suscriptores_proteger_baja();

-- --- 3. Baja automática desde resend-webhook ---
CREATE INDEX IF NOT EXISTS newsletter_suscriptores_email_lower_idx
  ON public.newsletter_suscriptores (lower(email));

CREATE OR REPLACE FUNCTION public.newsletter_registrar_baja(
  p_email text,
  p_origen text,
  p_suscriptor_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_filas integer := 0;
BEGIN
  IF p_origen IS NULL OR p_origen NOT IN ('queja_spam', 'rebote_permanente', 'suprimido_resend', 'resend_baja_nativa') THEN
    RAISE EXCEPTION 'newsletter_registrar_baja: origen no válido (%)', p_origen;
  END IF;

  UPDATE public.newsletter_suscriptores
     SET activo = false,
         fecha_baja = now(),
         origen_baja = p_origen,
         updated_at = now()
   WHERE activo
     AND (
       (p_suscriptor_id IS NOT NULL AND id = p_suscriptor_id)
       OR (p_email IS NOT NULL AND lower(email) = lower(trim(p_email)))
     );
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  RETURN v_filas;
END;
$$;

COMMENT ON FUNCTION public.newsletter_registrar_baja(text, text, uuid) IS
  'Baja automática del newsletter por un evento de Resend (queja, rebote permanente, supresión, baja en la página de Resend). Solo la llama resend-webhook con la service role. Solo toca filas activas; devuelve cuántas cambió. Migración 20261003171500.';

REVOKE ALL ON FUNCTION public.newsletter_registrar_baja(text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.newsletter_registrar_baja(text, text, uuid) TO service_role;
