-- ============================================================================
-- Reserva web: prueba de consentimiento (RGPD) — condiciones y newsletter
-- ----------------------------------------------------------------------------
-- NO APLICADA. Idempotente: se puede ejecutar más de una vez sin efectos.
-- Aplicar con: supabase db query --linked -f <este fichero>
--
-- Contexto: 20260926062009 creó `reservas.consentimiento_newsletter` y el
-- trigger `agregar_suscriptor_al_reservar_consentida`, y escribió (en su
-- cabecera y en el COMMENT de la columna) que reservas-web/index.ts rellenaba
-- la columna desde el body. ERA FALSO: reservas-web nunca leyó ese campo, así
-- que todas las reservas web guardaban false y nadie se daba de alta. Desde
-- el 2026-10-03 reservas-web lee del body `consentimiento_newsletter` y
-- `acepta_condiciones` (solo `=== true` cuenta) y exige el segundo.
--
-- Esta migración añade lo mínimo para poder DEMOSTRAR esos consentimientos
-- (RGPD art. 7.1: el responsable debe poder demostrar que el interesado
-- consintió):
--
-- 1) `reservas.condiciones_aceptadas_at`: cuándo marcó el cliente la casilla
--    obligatoria (política de privacidad + condiciones de la reserva). NULL
--    en reservas de otros canales, en las web anteriores a este cambio y en
--    las que entren con el interruptor RESERVAS_WEB_CONDICIONES_OBLIGATORIAS
--    a "false". El consentimiento al newsletter de cada reserva ya queda en
--    `consentimiento_newsletter` + `created_at` de la propia fila.
--
-- 2) `newsletter_suscriptores.fecha_consentimiento` y
--    `newsletter_suscriptores.reserva_consentimiento_id`: la prueba tiene que
--    vivir también en el suscriptor, porque `ejecutar_limpieza_gdpr()`
--    anonimiza las reservas antiguas (email = NULL): pasado el plazo de
--    retención ya no se podría enlazar un suscriptor ACTIVO con la reserva
--    en la que consintió. Con estas dos columnas el suscriptor guarda cuándo
--    consintió (o renovó el consentimiento) y en qué reserva — que, aun
--    anonimizada, conserva `consentimiento_newsletter = true`, `created_at`
--    y `condiciones_aceptadas_at`.
--
-- 3) La función del trigger se redefine SOLO para rellenar esas dos columnas.
--    El resto del comportamiento NO cambia: alta, o reactivación de un email
--    que se había dado de baja, únicamente cuando la reserva nueva trae
--    `consentimiento_newsletter = true` (una casilla nueva marcada = un
--    consentimiento nuevo y explícito). Sin casilla no se toca nada, tampoco
--    a quien se dio de baja.
--
-- 4) El COMMENT de `reservas.consentimiento_newsletter` citaba un trigger que
--    no existe (`trg_agregar_suscriptor_consentido`); se corrige con el
--    nombre real. Lo de «lo rellena reservas-web/index.ts» pasa a ser cierto
--    con el despliegue de la función del 2026-10-03.
-- ============================================================================

-- --- 1. Constancia de la aceptación de las condiciones, por reserva ---
ALTER TABLE public.reservas
  ADD COLUMN IF NOT EXISTS condiciones_aceptadas_at timestamptz;

COMMENT ON COLUMN public.reservas.condiciones_aceptadas_at IS
  'Cuándo aceptó el cliente la política de privacidad y las condiciones de la reserva (casilla obligatoria acepta_condiciones del formulario web). Lo rellena reservas-web/index.ts. NULL en reservas de otros canales, en las web anteriores al 2026-10-03 o si se desactivó la exigencia con el secret RESERVAS_WEB_CONDICIONES_OBLIGATORIAS=false.';

COMMENT ON COLUMN public.reservas.consentimiento_newsletter IS
  'Si el cliente marcó la casilla OPCIONAL de consentimiento explícito para el newsletter al reservar (RGPD, Art. 6.1.a). Lo rellena reservas-web/index.ts desde el campo consentimiento_newsletter del body (solo el booleano true cuenta). Prueba de consentimiento de ESTA reserva (fecha = created_at); independiente del estado que tenga luego el email en newsletter_suscriptores. Si es true, el trigger agregar_suscriptor_al_reservar_consentida da de alta o reactiva el email.';

-- --- 2. Prueba de consentimiento en el propio suscriptor ---
ALTER TABLE public.newsletter_suscriptores
  ADD COLUMN IF NOT EXISTS fecha_consentimiento timestamptz,
  ADD COLUMN IF NOT EXISTS reserva_consentimiento_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'newsletter_suscriptores_reserva_consentimiento_id_fkey'
      AND conrelid = 'public.newsletter_suscriptores'::regclass
  ) THEN
    ALTER TABLE public.newsletter_suscriptores
      ADD CONSTRAINT newsletter_suscriptores_reserva_consentimiento_id_fkey
      FOREIGN KEY (reserva_consentimiento_id) REFERENCES public.reservas(id) ON DELETE SET NULL;
  END IF;
END
$$;

COMMENT ON COLUMN public.newsletter_suscriptores.fecha_consentimiento IS
  'Cuándo dio (o renovó) el consentimiento explícito para el newsletter. Lo rellena el trigger agregar_suscriptor_al_reservar_consentida con el created_at de la reserva. NULL en altas anteriores a este campo.';
COMMENT ON COLUMN public.newsletter_suscriptores.reserva_consentimiento_id IS
  'Reserva en la que se dio el último consentimiento (consentimiento_newsletter = true). Sobrevive a la anonimización de ejecutar_limpieza_gdpr(), que borra el email de la reserva pero no la fila. NULL si la reserva se borra o en altas anteriores a este campo.';

-- --- 3. Trigger: mismo comportamiento + prueba de consentimiento ---
CREATE OR REPLACE FUNCTION public.agregar_suscriptor_desde_reserva_consentida()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.newsletter_suscriptores (
    email, nombre, activo, origen_alta, fecha_baja, origen_baja,
    fecha_consentimiento, reserva_consentimiento_id
  )
  VALUES (
    NEW.email,
    NEW.nombre,
    true,
    CASE WHEN NEW.canal = 'telefono' THEN 'reserva_telefono' ELSE 'reserva_web' END,
    NULL,
    NULL,
    COALESCE(NEW.created_at, now()),
    NEW.id
  )
  ON CONFLICT (email) DO UPDATE SET
    nombre = COALESCE(EXCLUDED.nombre, newsletter_suscriptores.nombre),
    activo = true,
    origen_alta = EXCLUDED.origen_alta,
    fecha_baja = NULL,
    origen_baja = NULL,
    fecha_consentimiento = EXCLUDED.fecha_consentimiento,
    reserva_consentimiento_id = EXCLUDED.reserva_consentimiento_id,
    updated_at = now();

  RETURN NEW;
END;
$$;

-- El trigger (AFTER INSERT ... WHEN consentimiento_newsletter = true AND email
-- no vacío) ya existe desde 20260926062009 y apunta a esta función: no se toca.
