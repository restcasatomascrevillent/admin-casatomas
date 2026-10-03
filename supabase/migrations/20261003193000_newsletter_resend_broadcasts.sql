-- ============================================================================
-- Newsletter fase 2: enviar por Resend Marketing (Broadcasts)
-- ----------------------------------------------------------------------------
-- NO APLICADA: la aplica el dueño a mano. Idempotente (se puede ejecutar más
-- de una vez sin efectos).
--
-- REQUISITO: la cadena del newsletter aplicada antes, en este orden:
--   20261003143000_reserva_web_prueba_consentimiento.sql
--   20261003171500_newsletter_baja_automatica.sql   (crea newsletter_registrar_baja)
-- Si falta la segunda, este fichero se detiene en el paso 0 sin tocar nada.
--
-- Pasos (proyecto jeamoczmbfsnwkfjxcyo, desde la carpeta adminpanelct):
--   1. npx supabase db query --linked -f supabase/migrations/20261003193000_newsletter_resend_broadcasts.sql
--   2. Comprobar (no deja nada escrito, todo dentro de BEGIN ... ROLLBACK):
--        npx supabase db query --linked -f supabase/tests/newsletter_resend_broadcasts_test.sql
--   3. Seguir con secrets, Resend y funciones en
--      docs/funcionalidades/newsletter-resend-marketing.md ("Pasos del dueño, fase 2").
--   Rollback: supabase/rollbacks/20261003193000_newsletter_resend_broadcasts_ROLLBACK.sql
--
-- QUÉ HACE Y POR QUÉ (encargo: usar los 1.000 contactos/mes del plan de
-- marketing de Resend en vez de la cuota transaccional de 100 correos/día que
-- comparten las reservas; diseño en docs/funcionalidades/newsletter-resend-marketing.md):
--
-- newsletter_suscriptores SIGUE SIENDO LA FUENTE DE VERDAD. Resend es solo el
-- cartero: la función newsletter-sync-resend copia allí a los activos (y borra
-- a los dados de baja) y trae de vuelta las bajas hechas en la página de Resend.
--
-- 1) newsletter_suscriptores.resend_contact_id / resend_sincronizado_at
--    Id del contacto en Resend y última vez que la sincronización lo dejó
--    cuadrado. Los escribe SOLO newsletter-sync-resend (vía la función del
--    punto 4). No deciden quién recibe nada: eso sigue siendo `activo`.
--
-- 2) newsletter_envios.canal ('transaccional' | 'broadcast') y
--    resend_broadcast_id. El historial distingue cómo salió cada envío. Las
--    filas antiguas quedan como 'transaccional' (es como salieron).
--
-- 3) newsletter_sincronizaciones_resend: una fila por pasada de sincronización
--    (panel, cron diario o justo antes de un envío). Sirve para el estado del
--    panel (última sincronización, contactos usados de 1.000) y como cerrojo:
--    el índice único parcial impide dos pasadas a la vez (dos Broadcasts por
--    un doble clic, o el cron pisando un envío). Las pasadas que se quedan
--    colgadas (la función murió) las cierra la siguiente pasada a los 15 min.
--    El personal de Marketing solo puede LEERLA; escribe la service role.
--
-- 4) newsletter_marcar_sincronizados(p_items jsonb): marca en un solo UPDATE
--    el resultado de la pasada ([{"id": uuid, "contact_id": text|null}]).
--    Solo service_role.
--
-- 5) newsletter_estadisticas_broadcasts(p_broadcast_ids text[]): cuenta por
--    Broadcast los eventos de Resend archivados en email_eventos (entregados,
--    abiertos, clics, rebotes, quejas). resend-webhook guarda ahora
--    metadata.broadcast_id. SECURITY INVOKER: respeta la RLS de email_eventos
--    (lectura con permiso de Marketing).
--
-- Programación diaria (pg_cron): al final, COMENTADA. No se programa sola.
-- ============================================================================

SET lock_timeout = '5s';

-- --- 0. Requisito: 20261003171500 aplicada ---
DO $$
BEGIN
  IF to_regprocedure('public.newsletter_registrar_baja(text, text, uuid)') IS NULL THEN
    RAISE EXCEPTION 'Falta public.newsletter_registrar_baja(): aplica antes 20261003143000_reserva_web_prueba_consentimiento.sql y 20261003171500_newsletter_baja_automatica.sql';
  END IF;
END
$$;

-- --- 1. Vínculo con el contacto de Resend ---
ALTER TABLE public.newsletter_suscriptores
  ADD COLUMN IF NOT EXISTS resend_contact_id text,
  ADD COLUMN IF NOT EXISTS resend_sincronizado_at timestamptz;

COMMENT ON COLUMN public.newsletter_suscriptores.resend_contact_id IS
  'Id del contacto en Resend Marketing (Contacts API global). Lo escribe solo newsletter-sync-resend; '
  'NULL si no está en Resend (dados de baja: se borran de Resend para liberar cuota). No decide quién recibe '
  'nada: la fuente de verdad es `activo`. Migración 20261003193000.';
COMMENT ON COLUMN public.newsletter_suscriptores.resend_sincronizado_at IS
  'Última vez que newsletter-sync-resend dejó este suscriptor cuadrado con Resend. Informativo. Migración 20261003193000.';

-- Búsqueda por contacto (resend-webhook, evento contact.deleted).
CREATE INDEX IF NOT EXISTS newsletter_suscriptores_resend_contact_idx
  ON public.newsletter_suscriptores (resend_contact_id)
  WHERE resend_contact_id IS NOT NULL;

-- --- 2. Canal de cada envío ---
ALTER TABLE public.newsletter_envios
  ADD COLUMN IF NOT EXISTS canal text NOT NULL DEFAULT 'transaccional',
  ADD COLUMN IF NOT EXISTS resend_broadcast_id text;

ALTER TABLE public.newsletter_envios
  DROP CONSTRAINT IF EXISTS newsletter_envios_canal_check;
ALTER TABLE public.newsletter_envios
  ADD CONSTRAINT newsletter_envios_canal_check
  CHECK (canal IN ('transaccional', 'broadcast'));

COMMENT ON COLUMN public.newsletter_envios.canal IS
  'transaccional: un correo por suscriptor con emails.send (cuenta en la cuota de 100/día compartida con reservas). '
  'broadcast: un Broadcast de Resend Marketing al Segment del newsletter (cuenta contactos, envíos ilimitados). '
  'Lo elige el secret NEWSLETTER_CANAL de enviar-newsletter. Migración 20261003193000.';
COMMENT ON COLUMN public.newsletter_envios.resend_broadcast_id IS
  'Id del Broadcast en Resend (solo canal = broadcast). Cruza con email_eventos.metadata->>''broadcast_id''. Migración 20261003193000.';

CREATE UNIQUE INDEX IF NOT EXISTS newsletter_envios_resend_broadcast_uidx
  ON public.newsletter_envios (resend_broadcast_id)
  WHERE resend_broadcast_id IS NOT NULL;

-- --- 3. Pasadas de sincronización (estado + cerrojo) ---
CREATE TABLE IF NOT EXISTS public.newsletter_sincronizaciones_resend (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origen text NOT NULL CHECK (origen IN ('panel', 'cron', 'envio')),
  estado text NOT NULL DEFAULT 'en_curso' CHECK (estado IN ('en_curso', 'ok', 'parcial', 'error')),
  iniciada_at timestamptz NOT NULL DEFAULT now(),
  terminada_at timestamptz,
  ejecutada_por uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  segment_id text,
  contactos_resend integer,
  contactos_segmento integer,
  contactos_ajenos integer,
  destinatarios integer,
  altas integer NOT NULL DEFAULT 0,
  actualizados integer NOT NULL DEFAULT 0,
  borrados integer NOT NULL DEFAULT 0,
  bajas_resend integer NOT NULL DEFAULT 0,
  errores integer NOT NULL DEFAULT 0,
  pendientes integer NOT NULL DEFAULT 0,
  mensaje_error text,
  detalle jsonb
);

COMMENT ON TABLE public.newsletter_sincronizaciones_resend IS
  'Una fila por pasada de newsletter-sync-resend (panel, cron diario o antes de un Broadcast). Estado del panel y '
  'cerrojo (índice único parcial: una sola pasada en_curso). contactos_resend = contactos que hay en la cuenta de '
  'Resend (lo que cuenta para el límite de 1.000), contactos_ajenos = contactos de Resend que no son de esta tabla, '
  'destinatarios = activos que recibirían un Broadcast. detalle: errores por suscriptor (id, acción, motivo; sin emails). '
  'Solo escribe la service role. Migración 20261003193000.';

CREATE UNIQUE INDEX IF NOT EXISTS newsletter_sincronizaciones_resend_una_en_curso
  ON public.newsletter_sincronizaciones_resend (estado)
  WHERE estado = 'en_curso';

CREATE INDEX IF NOT EXISTS newsletter_sincronizaciones_resend_iniciada_idx
  ON public.newsletter_sincronizaciones_resend (iniciada_at DESC);

ALTER TABLE public.newsletter_sincronizaciones_resend ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS newsletter_sincronizaciones_resend_select_seccion ON public.newsletter_sincronizaciones_resend;
CREATE POLICY newsletter_sincronizaciones_resend_select_seccion ON public.newsletter_sincronizaciones_resend
  FOR SELECT TO authenticated
  USING (public.can_read_section('marketing'));

DROP POLICY IF EXISTS newsletter_sincronizaciones_resend_service_role ON public.newsletter_sincronizaciones_resend;
CREATE POLICY newsletter_sincronizaciones_resend_service_role ON public.newsletter_sincronizaciones_resend
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.newsletter_sincronizaciones_resend FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.newsletter_sincronizaciones_resend FROM authenticated;
GRANT SELECT ON public.newsletter_sincronizaciones_resend TO authenticated;

-- --- 4. Marcar el resultado de una pasada ---
CREATE OR REPLACE FUNCTION public.newsletter_marcar_sincronizados(p_items jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_filas integer := 0;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'newsletter_marcar_sincronizados: p_items debe ser un array JSON';
  END IF;

  UPDATE public.newsletter_suscriptores s
     SET resend_contact_id = NULLIF(i.contact_id, ''),
         resend_sincronizado_at = now()
    FROM jsonb_to_recordset(p_items) AS i(id uuid, contact_id text)
   WHERE s.id = i.id;
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  RETURN v_filas;
END;
$$;

COMMENT ON FUNCTION public.newsletter_marcar_sincronizados(jsonb) IS
  'newsletter-sync-resend: guarda resend_contact_id (NULL = ya no está en Resend) y resend_sincronizado_at = now() '
  'para [{"id": uuid, "contact_id": text|null}]. No toca activo/fecha_baja/origen_baja. Solo service_role. Migración 20261003193000.';

REVOKE ALL ON FUNCTION public.newsletter_marcar_sincronizados(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.newsletter_marcar_sincronizados(jsonb) TO service_role;

-- --- 5. Estadísticas por Broadcast (desde los eventos que archiva resend-webhook) ---
CREATE INDEX IF NOT EXISTS email_eventos_broadcast_idx
  ON public.email_eventos ((metadata ->> 'broadcast_id'))
  WHERE metadata ? 'broadcast_id';

CREATE OR REPLACE FUNCTION public.newsletter_estadisticas_broadcasts(p_broadcast_ids text[])
RETURNS TABLE (broadcast_id text, tipo_evento text, eventos bigint, destinatarios bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT e.metadata ->> 'broadcast_id' AS broadcast_id,
         e.tipo_evento,
         count(*) AS eventos,
         count(DISTINCT lower(e.email_destinatario)) AS destinatarios
    FROM public.email_eventos e
   WHERE e.metadata ? 'broadcast_id'
     AND e.metadata ->> 'broadcast_id' = ANY (p_broadcast_ids)
   GROUP BY 1, 2;
$$;

COMMENT ON FUNCTION public.newsletter_estadisticas_broadcasts(text[]) IS
  'Eventos de Resend (delivered, opened, clicked, bounced, complained...) por Broadcast, con destinatarios distintos. '
  'SECURITY INVOKER: respeta la RLS de email_eventos (lectura con permiso de Marketing). Migración 20261003193000.';

REVOKE ALL ON FUNCTION public.newsletter_estadisticas_broadcasts(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.newsletter_estadisticas_broadcasts(text[]) TO authenticated, service_role;

RESET lock_timeout;

-- ============================================================================
-- 6. SINCRONIZACIÓN DIARIA — NO SE PROGRAMA AQUÍ (decisión del dueño)
-- ----------------------------------------------------------------------------
-- newsletter-sync-resend acepta llamadas sin usuario si traen la cabecera
-- x-webhook-secret igual al secret NEWSLETTER_SYNC_CRON_SECRET (falla cerrado
-- si falta). Dos formas de programarla, elige UNA:
--
-- A) pg_cron + pg_net + Vault (mismo patrón que emails-reserva y
--    sync-trafico-web; pg_net lo instala 20260920010000 — compruébalo con
--    `select extname from pg_extension where extname in ('pg_cron','pg_net');`
--    y si no está: `create extension if not exists pg_net;`):
--
--   select vault.create_secret('<valor-aleatorio-largo>', 'newsletter_sync_cron_secret');
--   -- y el MISMO valor como secret de la función:
--   --   npx supabase secrets set NEWSLETTER_SYNC_CRON_SECRET=<el-mismo-valor> --project-ref jeamoczmbfsnwkfjxcyo
--
--   select cron.unschedule('newsletter-sync-resend-diario') where exists (
--     select 1 from cron.job where jobname = 'newsletter-sync-resend-diario'
--   );
--   select cron.schedule(
--     'newsletter-sync-resend-diario',
--     '30 5 * * *',   -- 05:30 UTC (~06:30-07:30 Madrid), lejos de los envíos
--     $cron$
--     select net.http_post(
--       url := 'https://jeamoczmbfsnwkfjxcyo.supabase.co/functions/v1/newsletter-sync-resend',
--       headers := jsonb_build_object(
--         'Content-Type', 'application/json',
--         'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'newsletter_sync_cron_secret')
--       ),
--       body := '{"accion":"sincronizar"}'::jsonb,
--       timeout_milliseconds := 150000
--     );
--     $cron$
--   );
--
-- B) Sin pg_net: Dashboard de Supabase -> Integrations -> Cron -> "Create job"
--    -> tipo "Supabase Edge Function", función newsletter-sync-resend, método
--    POST, cada día a las 05:30 UTC, cabecera x-webhook-secret con el valor de
--    NEWSLETTER_SYNC_CRON_SECRET y cuerpo {"accion":"sincronizar"}.
--    (No queda en git: apúntalo en docs/funcionalidades/newsletter-resend-marketing.md.)
-- ============================================================================
