-- RECONSTRUIDA DESDE PRODUCCION EL 27/09/2026.
-- Esta migracion se aplico desde el editor SQL de Supabase sin commitear el
-- fichero, asi que figuraba en supabase_migrations.schema_migrations pero no
-- en el repositorio, y eso bloqueaba `supabase db push` para todo el equipo.
-- El SQL de aqui abajo es EXACTAMENTE el que guarda el registro (columna
-- `statements`), no una reescritura. Ya esta aplicada: no vuelve a ejecutarse.

-- ============================================================================
-- Newsletter: alta consentida desde la reserva (RGPD)
-- ----------------------------------------------------------------------------
-- Contexto: hasta 2026-01-17 existía un trigger (agregar_suscriptor_al_reservar)
-- que daba de alta AUTOMÁTICAMENTE en newsletter_suscriptores a cualquiera que
-- reservase mesa con email, sin pedirle consentimiento. Se eliminó por RGPD
-- (ver migración 20260919120000_newsletter_baja_rgpd) y no se sustituyó por
-- nada: la migración de entonces dejó escrito que retomar la captación
-- requiere "una casilla de consentimiento explícita en los formularios de
-- reserva (web y teléfono)". Esta migración implementa esa pieza para el
-- canal web (ReservationForm.tsx en casa-tomas-story + reservas-web/index.ts):
--
-- 1) `reservas.consentimiento_newsletter`: constancia INMUTABLE, por reserva,
--    de si el cliente marcó la casilla al reservar (prueba de consentimiento,
--    RGPD Art. 7.1) — independiente del estado (activo/de baja) que tenga
--    luego ese email en newsletter_suscriptores.
-- 2) `newsletter_suscriptores.origen_alta`: mismo patrón que `origen_baja`
--    (añadido en 20260919120000), pero para el alta.
-- 3) Un trigger AFTER INSERT ON reservas, CONDICIONADO a
--    `consentimiento_newsletter = true`, que da de alta (o reactiva) al
--    suscriptor. A diferencia del trigger eliminado, aquí SIN consentimiento
--    explícito no se inserta nada — el default de la columna es `false`.
-- ============================================================================

-- --- 1. Constancia de consentimiento, por reserva ---
ALTER TABLE public.reservas
  ADD COLUMN IF NOT EXISTS consentimiento_newsletter boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.reservas.consentimiento_newsletter IS
  'Si el cliente marcó la casilla de consentimiento explícito para el newsletter al reservar (RGPD, Art. 6.1.a). Lo rellena reservas-web/index.ts desde el campo consentimiento_newsletter del body. Prueba de consentimiento de ESTA reserva; independiente del estado que tenga luego el email en newsletter_suscriptores (trg_agregar_suscriptor_consentido).';

-- --- 2. origen_alta en newsletter_suscriptores, simétrico a origen_baja ---
ALTER TABLE public.newsletter_suscriptores
  ADD COLUMN IF NOT EXISTS origen_alta text;

ALTER TABLE public.newsletter_suscriptores
  DROP CONSTRAINT IF EXISTS newsletter_suscriptores_origen_alta_check;

ALTER TABLE public.newsletter_suscriptores
  ADD CONSTRAINT newsletter_suscriptores_origen_alta_check
  CHECK (origen_alta IS NULL OR origen_alta IN ('reserva_web', 'reserva_telefono', 'panel_manual'));

COMMENT ON COLUMN public.newsletter_suscriptores.origen_alta IS
  'Cómo se dio de alta: reserva_web (casilla de consentimiento explícita en el formulario de reserva web), reserva_telefono (mismo consentimiento por teléfono, pendiente de implementar en restaurante-phone), panel_manual (alta manual desde el panel). NULL en altas anteriores a este campo.';

-- --- 3. Trigger: alta/reactivación SOLO con consentimiento explícito ---
CREATE OR REPLACE FUNCTION public.agregar_suscriptor_desde_reserva_consentida()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.newsletter_suscriptores (email, nombre, activo, origen_alta, fecha_baja, origen_baja)
  VALUES (
    NEW.email,
    NEW.nombre,
    true,
    CASE WHEN NEW.canal = 'telefono' THEN 'reserva_telefono' ELSE 'reserva_web' END,
    NULL,
    NULL
  )
  ON CONFLICT (email) DO UPDATE SET
    nombre = COALESCE(EXCLUDED.nombre, newsletter_suscriptores.nombre),
    activo = true,
    origen_alta = EXCLUDED.origen_alta,
    fecha_baja = NULL,
    origen_baja = NULL,
    updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agregar_suscriptor_al_reservar_consentida ON public.reservas;
CREATE TRIGGER agregar_suscriptor_al_reservar_consentida
AFTER INSERT ON public.reservas
FOR EACH ROW
WHEN (NEW.consentimiento_newsletter = true AND NEW.email IS NOT NULL AND NEW.email <> '')
EXECUTE FUNCTION public.agregar_suscriptor_desde_reserva_consentida();

