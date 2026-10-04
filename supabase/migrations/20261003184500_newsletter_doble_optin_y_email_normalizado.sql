set client_encoding = 'UTF8';
-- (Primera línea a propósito: psql en una consola de Windows puede arrancar
-- en WIN1252 y leer mal las tildes de los mensajes.)
-- ============================================================================
-- Newsletter: doble opt-in (el email se verifica antes del alta), email
-- normalizado y consentimiento que sobrevive a las solicitudes pendientes
-- ----------------------------------------------------------------------------
-- NO APLICADA: la aplica el dueño a mano. Idempotente (se puede ejecutar más
-- de una vez sin efectos) y con su propio begin/commit.
--
-- REQUISITOS (el paso 0 los comprueba y se detiene sin tocar nada):
--   · 20260923210000 (reservas.solicitud_id) — ya en producción.
--   · 20261003143000_reserva_web_prueba_consentimiento.sql — ya aplicada.
--   · 20261003171500_newsletter_baja_automatica.sql — NO aplicada todavía:
--     aplicarla ANTES que esta.
--
-- PASOS (proyecto jeamoczmbfsnwkfjxcyo), desde la carpeta del repo con esta
-- rama (worktree adminpanelct-newsletter-optin o adminpanelct ya fusionado):
--   1. npx supabase db query --linked -f supabase/migrations/20261003171500_newsletter_baja_automatica.sql
--   2. npx supabase db query --linked -f supabase/migrations/20261003184500_newsletter_doble_optin_y_email_normalizado.sql
--      Leer los NOTICE: dicen si había emails duplicados (y cómo se
--      fusionaron) y si se retiraron altas sin verificar (punto 6).
--   3. npx supabase db query --linked -f supabase/tests/newsletter_doble_optin_test.sql
--      (todo dentro de BEGIN … ROLLBACK: no deja nada escrito). Opcional:
--      tests/newsletter_baja_automatica_test.sql también sigue pasando.
--   4. Desplegar las funciones que marcan la verificación (desde un worktree
--      hace falta --project-ref):
--      npx supabase functions deploy emails-reserva reservas-web --project-ref jeamoczmbfsnwkfjxcyo
--      Mientras no se desplieguen, NADIE se da de alta (nadie marca
--      email_verificado_at): es el lado seguro. Al revés (funciones antes que
--      la migración) tampoco rompe nada: la marca de verificación falla en
--      silencio (columna inexistente) y la reserva se confirma igual.
--   5. Comprobar:
--        select tgname from pg_trigger where tgrelid = 'public.reservas'::regclass
--          and (tgname like 'newsletter_%' or tgname like 'reservas_proteger_%' or tgname like 'agregar_suscriptor%');
--        -- -> newsletter_alta_reserva_verificada_ins/_upd y reservas_proteger_consentimiento_newsletter
--        --    (ningún agregar_suscriptor_*)
--        select indexdef from pg_indexes where indexname = 'newsletter_suscriptores_email_lower_key';
--   Rollback: supabase/rollbacks/20261003184500_newsletter_doble_optin_y_email_normalizado_ROLLBACK.sql
--
-- ============================================================================
-- QUÉ HACE Y POR QUÉ (revisión del 2026-10-03)
-- ============================================================================
--
-- A) DOBLE OPT-IN. Hasta ahora el trigger AFTER INSERT
--    `agregar_suscriptor_al_reservar_consentida` daba de alta (o reactivaba)
--    el email EN EL MISMO INSERT de la reserva: cualquiera podía escribir un
--    email ajeno en el formulario web, marcar la casilla y suscribirlo.
--
--    Cómo se verifica hoy el email de una reserva (lo que hay en el código):
--      · La reserva web nace 'pendiente' y NO recibe ningún correo
--        (reservas-web/index.ts, decisión del 2026-09-28).
--      · El personal la «Acepta»/«Verifica» en el panel -> 'verificada', y
--        emails-reserva manda la 'propuesta' («Confirma tu reserva») con dos
--        botones firmados (HMAC, un solo uso, 14 días) a ESE email.
--      · El cliente pulsa «Confirmo» en su correo -> la web llama a
--        emails-reserva POST /enlace/ejecutar -> 'verificada' -> 'confirmada'
--        (ejecutarContraoferta). Enlaces antiguos: reservas-web GET /confirmar.
--      · Solicitudes del bot/web: el personal manda una propuesta desde la
--        solicitud y, si el cliente la acepta desde el correo, emails-reserva
--        llama a fn_aceptar_propuesta_solicitud(p_via = 'email'), que crea la
--        reserva ya 'confirmada'.
--    O sea: 'verificada' NO demuestra nada del email (la pone el personal);
--    lo que demuestra que el cliente controla el buzón es que PULSE
--    «Confirmo» en el correo. El personal también puede pasar a 'confirmada'
--    a mano (botón «Confirmar», o una llamada) y eso NO prueba el email.
--    El estado no distingue quién confirmó, así que se añade una marca
--    explícita que solo escriben las Edge Functions de los enlaces:
--
--      reservas.email_verificado_at  — cuándo pulsó el cliente «Confirmo» (o
--        aceptó la propuesta de su solicitud) desde el enlace del correo.
--        Lo escriben emails-reserva y reservas-web (service role) con
--        `_shared/verificacion-email.ts`. «Rechazar» desde el correo NO
--        cuenta: puede ser justo el dueño del buzón diciendo «esto no es mío».
--
--    El alta pasa a dos triggers sobre esa marca:
--      · newsletter_alta_reserva_verificada_upd: AFTER UPDATE OF
--        email_verificado_at, cuando pasa de NULL a fecha.
--      · newsletter_alta_reserva_verificada_ins: AFTER INSERT con la marca ya
--        puesta (hoy no ocurre; por si algún alta futura nace verificada).
--    Y además: casilla marcada, email no vacío y reserva NO 'cancelada'.
--    Consecuencias (decididas):
--      · Casilla + INSERT -> nada. Pasa a 'verificada' -> nada. Cliente
--        pulsa «Confirmo» -> alta (o reactivación).
--      · El personal confirma a mano -> NO hay alta (no hay prueba).
--      · Cancelada antes de verificar -> no hay alta (el enlace ya no vale).
--      · Reserva sin email -> nunca hay alta.
--      · origen_alta según dónde se marcó la casilla (antes una reserva
--        'manual' quedaba como 'reserva_web'): reserva_web, solicitud_web
--        (reserva salida de una solicitud web), reserva_telefono,
--        reserva_manual. El canal manual solo puede dar alta si la reserva
--        trae casilla (el personal no puede ponerla: en la práctica, solo la
--        heredada de una solicitud -> solicitud_web) Y el cliente verifica.
--      · fecha_consentimiento = cuándo marcó la casilla
--        (reservas.consentimiento_newsletter_at; created_at en las web);
--        newsletter_suscriptores.fecha_verificacion_email = cuándo pulsó.
--
--    La marca y la casilla NO las puede escribir el personal: trigger BEFORE
--    `reservas_proteger_consentimiento_newsletter`. Con un JWT de usuario
--    (authenticated/anon: el panel, la API con sesión, RPCs SECURITY INVOKER
--    como fn_aceptar_propuesta_solicitud llamada desde el panel):
--      INSERT -> casilla false, marca NULL (salvo lo heredado de su solicitud);
--      UPDATE -> casilla, su fecha, condiciones_aceptadas_at y la marca no
--                cambian.
--    Con la service role o sin JWT (Edge Functions, pg_cron, migraciones):
--    se respeta lo que se escriba. Y para TODOS: si cambia el email de la
--    reserva (salvo a NULL, que es la anonimización de
--    ejecutar_limpieza_gdpr()), la casilla y la verificación se anulan: se
--    dieron para el email anterior.
--
--    La regla de 20261003171500 (no reactivar sin consentimiento nuevo) se
--    mantiene y se endurece: la reserva del consentimiento nuevo, además de
--    ser del mismo email y posterior a la baja (ahora por la fecha de la
--    casilla), tiene que estar verificada.
--
-- B) EMAIL NORMALIZADO. `newsletter_suscriptores.email` es UNIQUE pero
--    distingue mayúsculas: «Ana@x.es» y «ana@x.es» eran dos suscriptores.
--      · Trigger BEFORE INSERT/UPDATE OF email
--        `newsletter_suscriptores_normalizar_email`: lower(btrim(email)) para
--        CUALQUIER escritura (trigger de alta, panel, funciones, la
--        sincronización con Resend de la fase 2).
--      · Índice ÚNICO sobre lower(email) (sustituye al no único de
--        20261003171500, que usa newsletter_registrar_baja). Se mantiene el
--        UNIQUE(email) original: es el que usa ON CONFLICT (email).
--      · Duplicados ya existentes (no se ha podido consultar producción): se
--        FUSIONAN en el más antiguo (es el que recibió todos los envíos, así
--        que sus enlaces de baja siguen valiendo para todos los correos ya
--        mandados a esa persona):
--          - la baja manda: si alguno estaba de baja, el resultado queda de
--            baja (con la baja más reciente si el superviviente estaba activo);
--          - consentimiento (fecha, reserva, verificación, origen_alta): el
--            de fecha_consentimiento más reciente;
--          - nombre: el del superviviente o el primero no vacío;
--          - cada fila absorbida se guarda entera en
--            `newsletter_suscriptores_depurados` (motivo 'fusion_duplicado').
--        Un enlace de baja de una fila absorbida devolverá «enlace no válido»
--        (newsletter-baja busca por id): solo puede pasar en correos que
--        también recibió el superviviente, o si ya está de baja.
--      · newsletter-baja (busca por id) y resend-webhook (RPC
--        newsletter_registrar_baja, que ya compara con lower(trim())) no
--        necesitan cambios.
--
-- C) SOLICITUDES PENDIENTES. Si la web no puede crear la reserva (grupo
--    grande, sin aforo, para hoy...), reservas-web la deja en
--    `solicitudes_pendientes` y el consentimiento se perdía.
--      · solicitudes_pendientes.consentimiento_newsletter y
--        .condiciones_aceptadas_at: los rellena reservas-web. Mismo trigger de
--        protección (`solicitudes_proteger_consentimiento_newsletter`).
--      · Al crear una reserva con `solicitud_id` (fn_aceptar_propuesta_solicitud
--        por correo o por teléfono, y «Convertir en reserva» del panel, que
--        guarda solicitud_id), el trigger BEFORE INSERT de reservas copia la
--        casilla, su fecha (= created_at de la solicitud) y
--        condiciones_aceptadas_at desde la solicitud, SOLO si el email de la
--        reserva es el mismo que el de la solicitud. No hace falta tocar el
--        panel ni fn_aceptar_propuesta_solicitud.
--      · La reserva resultante sigue el doble opt-in normal: alta solo cuando
--        el cliente pulsa el enlace del correo (aceptar la propuesta de la
--        solicitud, o «Confirmo» en la 'propuesta' de la reserva). Convertir
--        en el panel no verifica nada por sí solo.
--
-- D) ALTAS YA HECHAS SIN VERIFICAR (punto 6): las filas de
--    newsletter_suscriptores que NACIERON del trigger viejo con una reserva
--    que no está verificada (todas las anteriores a esta migración) se
--    retiran: nunca debieron darse de alta. Si el cliente pulsa luego
--    «Confirmo», el trigger nuevo lo da de alta. Se guarda constancia en
--    newsletter_suscriptores_depurados (motivo 'alta_sin_verificar', sin el
--    email ni el nombre: puede que no sean de quien rellenó el formulario).
--    Las reactivaciones/renovaciones de suscriptores que YA existían antes de
--    esa reserva no se tocan (no se puede saber su estado anterior); solo se
--    cuentan en un NOTICE.
--    Consecuencia aceptada: si alguna de esas reservas ya estaba 'confirmada'
--    (no se sabe si por el cliente o por el personal), ese suscriptor no
--    vuelve solo.
--
-- E) SOLO EL SISTEMA ESCRIBE EN newsletter_suscriptores (punto 9, revisión
--    final del 2026-10-04). Las políticas de 20260918120000 dejaban a
--    cualquier usuario con permiso de escritura en Marketing hacer INSERT,
--    UPDATE y DELETE directos por la API (el panel no los usa: solo lee). Con
--    eso el doble opt-in y la «baja sin reactivación manual» se podían saltar:
--    INSERT de un email cualquiera ya activo, UPDATE del email de una fila
--    activa, o DELETE de una baja + INSERT nuevo (el trigger de protección es
--    solo BEFORE UPDATE). Se quitan esas tres políticas y los privilegios de
--    escritura de anon/authenticated; la lectura (SELECT con permiso de
--    Marketing) no cambia. Escriben solo los triggers SECURITY DEFINER y las
--    Edge Functions (service role). Una supresión RGPD a petición del
--    interesado se hace con su enlace de baja o, si hay que borrar la fila,
--    desde el SQL editor (postgres).
-- ============================================================================

begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- --- 0. Requisitos ---
DO $$
BEGIN
  IF to_regprocedure('public.newsletter_suscriptores_proteger_baja()') IS NULL
     OR to_regprocedure('public.newsletter_registrar_baja(text, text, uuid)') IS NULL THEN
    RAISE EXCEPTION 'Falta 20261003171500_newsletter_baja_automatica.sql: aplícala antes que esta migración.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'newsletter_suscriptores' AND column_name = 'reserva_consentimiento_id'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reservas' AND column_name = 'condiciones_aceptadas_at'
  ) THEN
    RAISE EXCEPTION 'Falta 20261003143000_reserva_web_prueba_consentimiento.sql: aplícala antes que esta migración.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reservas' AND column_name = 'solicitud_id'
  ) THEN
    RAISE EXCEPTION 'Falta reservas.solicitud_id (20260923210000_solicitud_propuesta_espacio.sql).';
  END IF;
END
$$;

-- --- 1. Columnas nuevas (todas anulables o con default constante: sin reescribir tablas) ---
ALTER TABLE public.reservas
  ADD COLUMN IF NOT EXISTS email_verificado_at timestamptz,
  ADD COLUMN IF NOT EXISTS consentimiento_newsletter_at timestamptz;

ALTER TABLE public.solicitudes_pendientes
  ADD COLUMN IF NOT EXISTS consentimiento_newsletter boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS condiciones_aceptadas_at timestamptz;

ALTER TABLE public.newsletter_suscriptores
  ADD COLUMN IF NOT EXISTS fecha_verificacion_email timestamptz;

-- origen_alta por canal real (antes una reserva 'manual' quedaba como
-- 'reserva_web'): se añaden reserva_manual y solicitud_web.
ALTER TABLE public.newsletter_suscriptores
  DROP CONSTRAINT IF EXISTS newsletter_suscriptores_origen_alta_check;
ALTER TABLE public.newsletter_suscriptores
  ADD CONSTRAINT newsletter_suscriptores_origen_alta_check
  CHECK (origen_alta IS NULL OR origen_alta IN (
    'reserva_web', 'reserva_telefono', 'reserva_manual', 'solicitud_web', 'panel_manual'
  ));

COMMENT ON COLUMN public.newsletter_suscriptores.origen_alta IS
  'Dónde dio el consentimiento vigente: reserva_web (casilla del formulario web, reserva creada al momento), '
  'solicitud_web (casilla del formulario web; la reserva no se pudo crear y salió después de la solicitud, por '
  'el correo de propuesta o «Convertir en reserva»), reserva_telefono (consentimiento por teléfono: aún no se pide), '
  'reserva_manual (alta del panel: hoy el personal no puede marcar la casilla, así que no se da), panel_manual '
  '(alta manual: el panel no la tiene). Siempre con el email verificado por el cliente desde 20261003184500. '
  'NULL en altas anteriores a 20260926062009.';

COMMENT ON COLUMN public.reservas.email_verificado_at IS
  'Cuándo demostró el cliente que controla el email de la reserva: pulsó «Confirmo» en el correo de propuesta (emails-reserva /enlace/ejecutar o reservas-web /confirmar) o aceptó desde el correo la propuesta de su solicitud. Solo lo escriben las Edge Functions (service role); el personal no puede (trigger reservas_proteger_consentimiento_newsletter). Con consentimiento_newsletter = true dispara el alta en el newsletter (doble opt-in). Confirmar a mano NO lo rellena. Migración 20261003184500.';
COMMENT ON COLUMN public.reservas.consentimiento_newsletter_at IS
  'Cuándo marcó el cliente la casilla del newsletter: created_at en las reservas web; el created_at de la solicitud si la reserva sale de una solicitud con la casilla. NULL si no la marcó. Va a newsletter_suscriptores.fecha_consentimiento. Migración 20261003184500.';
COMMENT ON COLUMN public.reservas.consentimiento_newsletter IS
  'Si el cliente marcó la casilla OPCIONAL del newsletter al reservar en la web (RGPD, art. 6.1.a), o en la solicitud de la que sale la reserva (mismo email). Lo rellena reservas-web (solo el booleano true cuenta); el personal no lo puede poner ni cambiar, y se anula si cambia el email. El alta NO es inmediata: la hace el trigger newsletter_alta_reserva_verificada_* cuando el cliente verifica el email desde el enlace del correo (email_verificado_at). Migración 20261003184500.';
COMMENT ON COLUMN public.solicitudes_pendientes.consentimiento_newsletter IS
  'Casilla del newsletter del formulario web cuando reservas-web no pudo crear la reserva y la dejó como solicitud. Se copia a la reserva que salga de esta solicitud (mismo email). El personal no la puede poner ni cambiar. Migración 20261003184500.';
COMMENT ON COLUMN public.solicitudes_pendientes.condiciones_aceptadas_at IS
  'Cuándo aceptó el cliente la política de privacidad y las condiciones en el formulario web (casilla obligatoria). Se copia a la reserva que salga de esta solicitud. Migración 20261003184500.';
COMMENT ON COLUMN public.newsletter_suscriptores.fecha_verificacion_email IS
  'Cuándo verificó el email el suscriptor para su consentimiento vigente (reservas.email_verificado_at de reserva_consentimiento_id). NULL en altas anteriores al doble opt-in. Migración 20261003184500.';
COMMENT ON COLUMN public.newsletter_suscriptores.fecha_consentimiento IS
  'Cuándo marcó la casilla del newsletter (consentimiento vigente): reservas.consentimiento_newsletter_at (o created_at) de reserva_consentimiento_id. El alta, desde 20261003184500, solo llega tras verificar el email (fecha_verificacion_email). NULL en altas anteriores a 20261003143000.';

-- --- 2. ¿Quién escribe? (JWT de la petición) ---
-- true: sin JWT (postgres, pg_cron, migraciones, SQL editor) o service_role
-- (Edge Functions). false: authenticated / anon (panel, API con sesión).
-- Mismo cálculo que auth.role(), sin depender de ella.
CREATE OR REPLACE FUNCTION public.newsletter_peticion_privilegiada()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path TO ''
AS $$
DECLARE
  v_rol text;
BEGIN
  v_rol := nullif(current_setting('request.jwt.claim.role', true), '');
  IF v_rol IS NULL THEN
    BEGIN
      v_rol := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
    EXCEPTION WHEN others THEN
      v_rol := 'invalido';
    END;
  END IF;
  RETURN v_rol IS NULL OR v_rol = 'service_role';
END;
$$;

COMMENT ON FUNCTION public.newsletter_peticion_privilegiada() IS
  'true si la petición no trae JWT (postgres, pg_cron, migraciones) o es service_role (Edge Functions); false con un JWT de usuario (panel). La usan los triggers que protegen la casilla del newsletter y la verificación del email. Migración 20261003184500.';
REVOKE ALL ON FUNCTION public.newsletter_peticion_privilegiada() FROM PUBLIC, anon, authenticated;

-- --- 3. Protección de la casilla y de la verificación en reservas (+ herencia de la solicitud) ---
CREATE OR REPLACE FUNCTION public.reservas_proteger_consentimiento_newsletter()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_privilegiado boolean := public.newsletter_peticion_privilegiada();
  v_sol record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT v_privilegiado THEN
      NEW.consentimiento_newsletter := false;
      NEW.consentimiento_newsletter_at := NULL;
      NEW.condiciones_aceptadas_at := NULL;
      NEW.email_verificado_at := NULL;
    END IF;

    -- Reserva que sale de una solicitud: la casilla y las condiciones son las
    -- que marcó el cliente en la solicitud, y solo valen para ese email.
    IF NEW.solicitud_id IS NOT NULL THEN
      SELECT sp.consentimiento_newsletter, sp.condiciones_aceptadas_at, sp.created_at, sp.email
        INTO v_sol
        FROM public.solicitudes_pendientes sp
       WHERE sp.id = NEW.solicitud_id;
      IF FOUND THEN
        IF v_sol.consentimiento_newsletter
           AND coalesce(btrim(v_sol.email), '') <> ''
           AND lower(btrim(v_sol.email)) = lower(btrim(coalesce(NEW.email, ''))) THEN
          NEW.consentimiento_newsletter := true;
          NEW.consentimiento_newsletter_at := coalesce(v_sol.created_at, now());
        ELSE
          NEW.consentimiento_newsletter := false;
          NEW.consentimiento_newsletter_at := NULL;
        END IF;
        NEW.condiciones_aceptadas_at := coalesce(NEW.condiciones_aceptadas_at, v_sol.condiciones_aceptadas_at);
      END IF;
    END IF;

    IF NEW.consentimiento_newsletter THEN
      NEW.consentimiento_newsletter_at := coalesce(NEW.consentimiento_newsletter_at, NEW.created_at, now());
    ELSE
      NEW.consentimiento_newsletter_at := NULL;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NOT v_privilegiado THEN
    NEW.consentimiento_newsletter := OLD.consentimiento_newsletter;
    NEW.consentimiento_newsletter_at := OLD.consentimiento_newsletter_at;
    NEW.condiciones_aceptadas_at := OLD.condiciones_aceptadas_at;
    NEW.email_verificado_at := OLD.email_verificado_at;
  END IF;

  -- Cambio de email (no la anonimización a NULL): la casilla y la
  -- verificación eran para el email anterior.
  IF NEW.email IS NOT NULL
     AND lower(btrim(NEW.email)) IS DISTINCT FROM lower(btrim(OLD.email)) THEN
    NEW.consentimiento_newsletter := false;
    NEW.consentimiento_newsletter_at := NULL;
    NEW.email_verificado_at := NULL;
  END IF;

  IF NOT NEW.consentimiento_newsletter THEN
    NEW.consentimiento_newsletter_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.reservas_proteger_consentimiento_newsletter() IS
  'BEFORE INSERT/UPDATE de reservas: el personal (JWT de usuario) no puede poner ni cambiar la casilla del newsletter, su fecha, condiciones_aceptadas_at ni email_verificado_at; una reserva con solicitud_id hereda la casilla de su solicitud si el email coincide; un cambio de email anula casilla y verificación. Migración 20261003184500.';
REVOKE ALL ON FUNCTION public.reservas_proteger_consentimiento_newsletter() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS reservas_proteger_consentimiento_newsletter ON public.reservas;
CREATE TRIGGER reservas_proteger_consentimiento_newsletter
BEFORE INSERT OR UPDATE ON public.reservas
FOR EACH ROW
EXECUTE FUNCTION public.reservas_proteger_consentimiento_newsletter();

-- --- 4. Lo mismo en solicitudes_pendientes ---
CREATE OR REPLACE FUNCTION public.solicitudes_proteger_consentimiento_newsletter()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.newsletter_peticion_privilegiada() THEN
    IF TG_OP = 'INSERT' THEN
      NEW.consentimiento_newsletter := false;
      NEW.condiciones_aceptadas_at := NULL;
    ELSE
      NEW.consentimiento_newsletter := OLD.consentimiento_newsletter;
      NEW.condiciones_aceptadas_at := OLD.condiciones_aceptadas_at;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.email IS NOT NULL
     AND lower(btrim(NEW.email)) IS DISTINCT FROM lower(btrim(OLD.email)) THEN
    NEW.consentimiento_newsletter := false;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.solicitudes_proteger_consentimiento_newsletter() IS
  'BEFORE INSERT/UPDATE de solicitudes_pendientes: el personal no puede poner ni cambiar la casilla del newsletter ni condiciones_aceptadas_at (las escribe reservas-web); un cambio de email anula la casilla. Migración 20261003184500.';
REVOKE ALL ON FUNCTION public.solicitudes_proteger_consentimiento_newsletter() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS solicitudes_proteger_consentimiento_newsletter ON public.solicitudes_pendientes;
CREATE TRIGGER solicitudes_proteger_consentimiento_newsletter
BEFORE INSERT OR UPDATE ON public.solicitudes_pendientes
FOR EACH ROW
EXECUTE FUNCTION public.solicitudes_proteger_consentimiento_newsletter();

-- --- 5. Email normalizado: fusión de duplicados, trigger e índice único ---
CREATE TABLE IF NOT EXISTS public.newsletter_suscriptores_depurados (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  suscriptor_id uuid NOT NULL,
  motivo text NOT NULL CHECK (motivo IN ('fusion_duplicado', 'alta_sin_verificar')),
  superviviente_id uuid,
  reserva_id uuid,
  fila jsonb NOT NULL,
  depurado_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.newsletter_suscriptores_depurados IS
  'Constancia de las filas de newsletter_suscriptores que retiró la migración 20261003184500: fusion_duplicado (mismo email con otras mayúsculas/espacios; fila entera, absorbida por superviviente_id) y alta_sin_verificar (alta del trigger antiguo sin email verificado; sin email ni nombre). Solo service_role.';

ALTER TABLE public.newsletter_suscriptores_depurados ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.newsletter_suscriptores_depurados FROM anon, authenticated;
GRANT ALL ON TABLE public.newsletter_suscriptores_depurados TO service_role;

DO $$
DECLARE
  g record;
  v_sup public.newsletter_suscriptores%ROWTYPE;
  v_baja public.newsletter_suscriptores%ROWTYPE;
  v_cons public.newsletter_suscriptores%ROWTYPE;
  v_activo boolean;
  v_nombre text;
  v_creado timestamptz;
  v_hay_baja boolean;
  v_hay_cons boolean;
  v_grupos integer := 0;
  v_absorbidas integer := 0;
  v_n integer;
BEGIN
  FOR g IN
    SELECT lower(btrim(email)) AS e
      FROM public.newsletter_suscriptores
     GROUP BY 1
    HAVING count(*) > 1
  LOOP
    v_grupos := v_grupos + 1;

    -- Superviviente: el más antiguo (recibió todos los envíos de esa persona).
    SELECT * INTO v_sup FROM public.newsletter_suscriptores
     WHERE lower(btrim(email)) = g.e ORDER BY created_at, id LIMIT 1;

    SELECT bool_and(activo), min(created_at) INTO v_activo, v_creado
      FROM public.newsletter_suscriptores WHERE lower(btrim(email)) = g.e;

    SELECT * INTO v_baja FROM public.newsletter_suscriptores
     WHERE lower(btrim(email)) = g.e AND NOT activo
     ORDER BY fecha_baja DESC NULLS LAST, updated_at DESC LIMIT 1;
    v_hay_baja := FOUND;

    SELECT * INTO v_cons FROM public.newsletter_suscriptores
     WHERE lower(btrim(email)) = g.e AND fecha_consentimiento IS NOT NULL
     ORDER BY fecha_consentimiento DESC, updated_at DESC LIMIT 1;
    v_hay_cons := FOUND;

    SELECT coalesce(nullif(btrim(v_sup.nombre), ''),
                    (SELECT nombre FROM public.newsletter_suscriptores
                      WHERE lower(btrim(email)) = g.e AND coalesce(btrim(nombre), '') <> ''
                      ORDER BY created_at LIMIT 1))
      INTO v_nombre;

    INSERT INTO public.newsletter_suscriptores_depurados (suscriptor_id, motivo, superviviente_id, reserva_id, fila)
    SELECT s.id, 'fusion_duplicado', v_sup.id, s.reserva_consentimiento_id, to_jsonb(s)
      FROM public.newsletter_suscriptores s
     WHERE lower(btrim(s.email)) = g.e AND s.id <> v_sup.id;

    DELETE FROM public.newsletter_suscriptores
     WHERE lower(btrim(email)) = g.e AND id <> v_sup.id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_absorbidas := v_absorbidas + v_n;

    -- El trigger newsletter_suscriptores_proteger_baja (20261003171500) sigue
    -- activo: de activo a baja respeta la fecha/origen que se le dan; si el
    -- superviviente ya estaba de baja conserva la suya; reactivar no es
    -- posible aquí (bool_and).
    UPDATE public.newsletter_suscriptores
       SET email = g.e,
           nombre = v_nombre,
           created_at = v_creado,
           activo = v_activo,
           fecha_baja = CASE WHEN v_activo THEN NULL
                             WHEN v_sup.activo AND v_hay_baja THEN v_baja.fecha_baja
                             ELSE fecha_baja END,
           origen_baja = CASE WHEN v_activo THEN NULL
                              WHEN v_sup.activo AND v_hay_baja THEN v_baja.origen_baja
                              ELSE origen_baja END,
           fecha_consentimiento = CASE WHEN v_hay_cons THEN v_cons.fecha_consentimiento ELSE fecha_consentimiento END,
           reserva_consentimiento_id = CASE WHEN v_hay_cons THEN v_cons.reserva_consentimiento_id ELSE reserva_consentimiento_id END,
           fecha_verificacion_email = CASE WHEN v_hay_cons THEN v_cons.fecha_verificacion_email ELSE fecha_verificacion_email END,
           origen_alta = CASE WHEN v_hay_cons THEN coalesce(v_cons.origen_alta, origen_alta) ELSE origen_alta END,
           updated_at = now()
     WHERE id = v_sup.id;

    RAISE NOTICE 'newsletter: email duplicado % -> fusionado en % (activo = %)', g.e, v_sup.id, v_activo;
  END LOOP;

  IF v_grupos > 0 THEN
    RAISE NOTICE 'newsletter: % emails duplicados, % filas absorbidas (copia en newsletter_suscriptores_depurados, motivo fusion_duplicado).', v_grupos, v_absorbidas;
  ELSE
    RAISE NOTICE 'newsletter: no había emails duplicados por mayúsculas/espacios.';
  END IF;
END
$$;

-- Emails que solo difieren en mayúsculas/espacios de sí mismos (sin duplicado).
UPDATE public.newsletter_suscriptores
   SET email = lower(btrim(email))
 WHERE email IS DISTINCT FROM lower(btrim(email));

CREATE OR REPLACE FUNCTION public.newsletter_suscriptores_normalizar_email()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  NEW.email := lower(btrim(NEW.email));
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.newsletter_suscriptores_normalizar_email() IS
  'BEFORE INSERT/UPDATE OF email de newsletter_suscriptores: guarda el email en minúsculas y sin espacios, venga de donde venga la escritura. Migración 20261003184500.';
REVOKE ALL ON FUNCTION public.newsletter_suscriptores_normalizar_email() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS newsletter_suscriptores_normalizar_email ON public.newsletter_suscriptores;
CREATE TRIGGER newsletter_suscriptores_normalizar_email
BEFORE INSERT OR UPDATE OF email ON public.newsletter_suscriptores
FOR EACH ROW
EXECUTE FUNCTION public.newsletter_suscriptores_normalizar_email();

CREATE UNIQUE INDEX IF NOT EXISTS newsletter_suscriptores_email_lower_key
  ON public.newsletter_suscriptores (lower(email));
-- El índice no único de 20261003171500 queda cubierto por el único.
DROP INDEX IF EXISTS public.newsletter_suscriptores_email_lower_idx;

-- --- 6. Retirar las altas que el trigger antiguo hizo sin email verificado ---
DO $$
DECLARE
  v_retiradas integer;
  v_dudosas integer;
BEGIN
  WITH candidatas AS (
    SELECT s.*
      FROM public.newsletter_suscriptores s
      JOIN public.reservas r ON r.id = s.reserva_consentimiento_id
     WHERE s.activo
       AND r.email_verificado_at IS NULL
       AND s.fecha_verificacion_email IS NULL     -- las altas del trigger nuevo la traen: re-ejecutar no las toca
       AND s.origen_alta IN ('reserva_web', 'reserva_telefono')
       AND s.created_at >= r.created_at          -- la fila nació con esa reserva
  ), constancia AS (
    INSERT INTO public.newsletter_suscriptores_depurados (suscriptor_id, motivo, reserva_id, fila)
    SELECT c.id, 'alta_sin_verificar', c.reserva_consentimiento_id, to_jsonb(c) - 'email' - 'nombre'
      FROM candidatas c
    RETURNING suscriptor_id
  )
  DELETE FROM public.newsletter_suscriptores
   WHERE id IN (SELECT suscriptor_id FROM constancia);
  GET DIAGNOSTICS v_retiradas = ROW_COUNT;

  SELECT count(*) INTO v_dudosas
    FROM public.newsletter_suscriptores s
    JOIN public.reservas r ON r.id = s.reserva_consentimiento_id
   WHERE s.activo AND r.email_verificado_at IS NULL AND s.fecha_verificacion_email IS NULL
     AND s.created_at < r.created_at;

  RAISE NOTICE 'newsletter: % altas sin email verificado retiradas (vuelven solas si el cliente pulsa «Confirmo»); % suscriptores anteriores con un consentimiento renovado sin verificar se dejan como estaban.', v_retiradas, v_dudosas;
END
$$;

-- --- 7. Alta (doble opt-in): solo con el email verificado ---
CREATE OR REPLACE FUNCTION public.newsletter_alta_por_reserva_verificada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_email text := lower(btrim(NEW.email));
  v_fecha timestamptz;
  v_origen text;
BEGIN
  IF v_email IS NULL OR v_email = ''
     OR NOT NEW.consentimiento_newsletter
     OR NEW.email_verificado_at IS NULL
     OR NEW.estado = 'cancelada' THEN
    RETURN NEW;
  END IF;

  v_fecha := coalesce(NEW.consentimiento_newsletter_at, NEW.created_at, now());
  -- Dónde se marcó la casilla (ver el CHECK de origen_alta, punto 1). Una
  -- reserva con solicitud_id solo trae casilla si la heredó de su solicitud,
  -- y esa casilla solo la escribe reservas-web: es el formulario web, aunque
  -- la reserva final sea 'telefono' (fn_aceptar_propuesta_solicitud) o
  -- 'manual' («Convertir en reserva»).
  v_origen := CASE
    WHEN NEW.solicitud_id IS NOT NULL THEN 'solicitud_web'
    WHEN NEW.canal = 'telefono' THEN 'reserva_telefono'
    WHEN NEW.canal = 'manual' THEN 'reserva_manual'
    ELSE 'reserva_web'          -- 'web' (y NULL: el default de la columna es 'web')
  END;

  INSERT INTO public.newsletter_suscriptores AS s (
    email, nombre, activo, origen_alta, fecha_baja, origen_baja,
    fecha_consentimiento, reserva_consentimiento_id, fecha_verificacion_email
  )
  VALUES (v_email, NEW.nombre, true, v_origen, NULL, NULL, v_fecha, NEW.id, NEW.email_verificado_at)
  ON CONFLICT (email) DO UPDATE SET
    nombre = coalesce(EXCLUDED.nombre, s.nombre),
    activo = true,
    fecha_baja = NULL,
    origen_baja = NULL,
    -- Activo con un consentimiento MÁS RECIENTE ya guardado: se conserva ese.
    -- De baja: se propone este y decide newsletter_suscriptores_proteger_baja.
    origen_alta = CASE WHEN s.activo AND s.fecha_consentimiento > EXCLUDED.fecha_consentimiento
                       THEN s.origen_alta ELSE EXCLUDED.origen_alta END,
    fecha_consentimiento = CASE WHEN s.activo AND s.fecha_consentimiento > EXCLUDED.fecha_consentimiento
                                THEN s.fecha_consentimiento ELSE EXCLUDED.fecha_consentimiento END,
    reserva_consentimiento_id = CASE WHEN s.activo AND s.fecha_consentimiento > EXCLUDED.fecha_consentimiento
                                     THEN s.reserva_consentimiento_id ELSE EXCLUDED.reserva_consentimiento_id END,
    fecha_verificacion_email = CASE WHEN s.activo AND s.fecha_consentimiento > EXCLUDED.fecha_consentimiento
                                    THEN s.fecha_verificacion_email ELSE EXCLUDED.fecha_verificacion_email END,
    updated_at = now();

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.newsletter_alta_por_reserva_verificada() IS
  'Alta/reactivación en el newsletter (doble opt-in): reserva con consentimiento_newsletter = true cuyo email acaba de verificarse (email_verificado_at), con email y no cancelada. fecha_consentimiento = fecha de la casilla; fecha_verificacion_email = la de la verificación. Reactivar a un dado de baja lo decide newsletter_suscriptores_proteger_baja. Migración 20261003184500.';
REVOKE ALL ON FUNCTION public.newsletter_alta_por_reserva_verificada() FROM PUBLIC, anon, authenticated;

-- Fuera el alta en el INSERT (20260926062009 / 20261003143000).
DROP TRIGGER IF EXISTS agregar_suscriptor_al_reservar_consentida ON public.reservas;
DROP FUNCTION IF EXISTS public.agregar_suscriptor_desde_reserva_consentida();

DROP TRIGGER IF EXISTS newsletter_alta_reserva_verificada_upd ON public.reservas;
CREATE TRIGGER newsletter_alta_reserva_verificada_upd
AFTER UPDATE OF email_verificado_at ON public.reservas
FOR EACH ROW
WHEN (OLD.email_verificado_at IS NULL AND NEW.email_verificado_at IS NOT NULL AND NEW.consentimiento_newsletter)
EXECUTE FUNCTION public.newsletter_alta_por_reserva_verificada();

DROP TRIGGER IF EXISTS newsletter_alta_reserva_verificada_ins ON public.reservas;
CREATE TRIGGER newsletter_alta_reserva_verificada_ins
AFTER INSERT ON public.reservas
FOR EACH ROW
WHEN (NEW.email_verificado_at IS NOT NULL AND NEW.consentimiento_newsletter)
EXECUTE FUNCTION public.newsletter_alta_por_reserva_verificada();

-- --- 8. No reactivar sin consentimiento nuevo: ahora también verificado ---
-- Igual que en 20261003171500 salvo la condición de la reserva del
-- consentimiento nuevo (punto c): verificada, mismo email normalizado y con la
-- CASILLA posterior a la baja.
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

  -- c) Reactivación: solo con un consentimiento nuevo, verificado, en una reserva.
  IF NOT OLD.activo AND NEW.activo THEN
    IF NEW.reserva_consentimiento_id IS NOT NULL
       AND NEW.reserva_consentimiento_id IS DISTINCT FROM OLD.reserva_consentimiento_id THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.reservas r
        WHERE r.id = NEW.reserva_consentimiento_id
          AND r.consentimiento_newsletter = true
          AND r.email_verificado_at IS NOT NULL
          AND lower(btrim(r.email)) = lower(btrim(NEW.email))
          -- Bajas antiguas sin fecha_baja: se toma updated_at (último cambio de la fila).
          AND COALESCE(r.consentimiento_newsletter_at, r.created_at) > COALESCE(OLD.fecha_baja, OLD.updated_at)
      ) INTO v_consentimiento_nuevo;
    END IF;

    IF v_consentimiento_nuevo THEN
      RETURN NEW;
    END IF;

    IF pg_trigger_depth() > 1 THEN
      RAISE WARNING 'newsletter: reactivación de % ignorada (sin consentimiento nuevo y verificado posterior a la baja)', OLD.id;
      NEW.activo := false;
      NEW.fecha_baja := OLD.fecha_baja;
      NEW.origen_baja := OLD.origen_baja;
      NEW.fecha_consentimiento := OLD.fecha_consentimiento;
      NEW.reserva_consentimiento_id := OLD.reserva_consentimiento_id;
      NEW.fecha_verificacion_email := OLD.fecha_verificacion_email;
      NEW.origen_alta := OLD.origen_alta;
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'No se puede reactivar a un suscriptor dado de baja sin un consentimiento nuevo (casilla marcada en una reserva posterior a la baja y email verificado).'
      USING ERRCODE = 'check_violation',
            HINT = 'La baja del newsletter es definitiva hasta que el cliente vuelva a dar su consentimiento y confirme su email.';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.newsletter_suscriptores_proteger_baja() IS
  'Trigger BEFORE UPDATE de newsletter_suscriptores: completa fecha/origen de la baja, la hace inmutable y solo deja reactivar con un consentimiento nuevo (reserva del mismo email, casilla posterior a la baja y email verificado). Migraciones 20261003171500 y 20261003184500.';

-- --- 9. Solo el sistema escribe en newsletter_suscriptores (punto E) ---
-- El personal LEE (newsletter_suscriptores_select_seccion, sin cambios); nadie
-- con un JWT de usuario puede dar de alta, cambiar ni borrar filas.
DROP POLICY IF EXISTS "newsletter_suscriptores_insert_seccion" ON public.newsletter_suscriptores;
DROP POLICY IF EXISTS "newsletter_suscriptores_update_seccion" ON public.newsletter_suscriptores;
DROP POLICY IF EXISTS "newsletter_suscriptores_delete_seccion" ON public.newsletter_suscriptores;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.newsletter_suscriptores FROM anon, authenticated;

commit;
