BEGIN;

-- Lee exclusivamente el usuario del JWT validado. No permite consultar Auth
-- de otra persona y no usa metadatos editables ni un JWT con permisos antiguos.
CREATE OR REPLACE FUNCTION private.sesion_panel_permitida()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM auth.users u WHERE u.id = auth.uid()
      AND (u.banned_until IS NULL OR u.banned_until <= now())
      AND EXISTS (SELECT 1 FROM auth.sessions s WHERE s.user_id = u.id
        AND s.id::text = auth.jwt()->>'session_id')
  )
$$;
REVOKE ALL ON FUNCTION private.sesion_panel_permitida() FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.sesion_panel_permitida() TO authenticated;

-- PostgREST valida también tokens anteriores al bloqueo, antes de cualquier
-- tabla, vista o RPC (incluidas las funciones SECURITY DEFINER).
CREATE OR REPLACE FUNCTION private.verificar_acceso_panel()
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF auth.role() = 'authenticated' THEN
    IF NOT private.sesion_panel_permitida() THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Tu acceso al panel está bloqueado';
    END IF;
  END IF;
END
$$;
REVOKE ALL ON FUNCTION private.verificar_acceso_panel() FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO anon, service_role;
GRANT EXECUTE ON FUNCTION private.verificar_acceso_panel() TO anon, authenticated, service_role;
DO $$
DECLARE v_config text;
BEGIN
  SELECT config INTO v_config FROM pg_roles r, unnest(r.rolconfig) config
    WHERE r.rolname = 'authenticator' AND config LIKE 'pgrst.db_pre_request=%';
  IF v_config IS NOT NULL AND v_config NOT IN ('pgrst.db_pre_request=', 'pgrst.db_pre_request=private.verificar_acceso_panel') THEN
    RAISE EXCEPTION 'Existe un db_pre_request que debe conservarse: %', v_config;
  END IF;
END
$$;
ALTER ROLE authenticator SET pgrst.db_pre_request = 'private.verificar_acceso_panel';
NOTIFY pgrst, 'reload config';

-- Indicador mínimo para cerrar todas las pantallas abiertas por Realtime.
-- El usuario solo puede leer su propio estado; nunca escribirlo.
CREATE TABLE public.user_access_status (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  access_blocked boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- La operación ya se audita en auth.users: evita un segundo evento técnico.
DROP TRIGGER IF EXISTS trg_auditoria ON public.user_access_status;
ALTER TABLE public.user_access_status ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_access_status FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_access_status TO authenticated;
GRANT ALL ON public.user_access_status TO service_role;
CREATE POLICY "Leer estado propio de acceso" ON public.user_access_status
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_access_status;

CREATE OR REPLACE FUNCTION private.sincronizar_bloqueo_usuario()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_bloqueado boolean := NEW.banned_until IS NOT NULL AND NEW.banned_until > now();
BEGIN
  INSERT INTO public.user_access_status(user_id, access_blocked, updated_at)
    VALUES (NEW.id, v_bloqueado, now())
    ON CONFLICT (user_id) DO UPDATE SET access_blocked = EXCLUDED.access_blocked, updated_at = EXCLUDED.updated_at;
  IF v_bloqueado THEN
    -- No se borra el usuario ni sus roles, permisos, documentos o historial.
    DELETE FROM auth.refresh_tokens WHERE user_id = NEW.id::text;
    DELETE FROM auth.sessions WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION private.sincronizar_bloqueo_usuario() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER sincronizar_bloqueo_usuario AFTER UPDATE OF banned_until ON auth.users
  FOR EACH ROW WHEN (OLD.banned_until IS DISTINCT FROM NEW.banned_until)
  EXECUTE FUNCTION private.sincronizar_bloqueo_usuario();

-- Realtime y Storage no ejecutan db_pre_request: añade una restricción que
-- se combina por AND con los permisos existentes. Mantiene el acceso público
-- anónimo y los procesos con service_role. La tabla de estado es la excepción
-- para poder recibir precisamente el evento que cierra la sesión bloqueada.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r','p') AND c.relrowsecurity AND NOT c.relispartition
      AND (n.nspname = 'public' OR (n.nspname = 'storage' AND c.relname IN ('objects','buckets')))
      AND c.relname <> 'user_access_status'
  LOOP
    EXECUTE format('CREATE POLICY acceso_panel_no_bloqueado ON %I.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT private.sesion_panel_permitida())) WITH CHECK ((SELECT private.sesion_panel_permitida()))', r.nspname, r.relname);
  END LOOP;
END
$$;

CREATE OR REPLACE VIEW public.audit_log_visible WITH (security_invoker = true) AS
SELECT a.*,
  CASE
    WHEN a.accion='ejecutar' AND a.detalles->>'tipo_evento' IS NOT NULL THEN a.detalles->>'tipo_evento'
    WHEN a.tabla='conversaciones' THEN CASE WHEN a.accion='eliminar' THEN 'eliminar_chat_ia' ELSE 'crear_chat_ia' END
    WHEN a.tabla='mensajes_chat' THEN CASE WHEN a.accion='eliminar' THEN 'eliminar_chat_ia' ELSE 'mensaje_ia' END
    WHEN a.tabla='user_permissions' THEN 'cambiar_permisos'
    WHEN a.tabla IN ('user_roles','super_admins') THEN 'cambiar_roles'
    WHEN a.accion='actualizar' AND a.tabla='auth.users'
      AND (a.detalles->'antes'->'banned_until') IS DISTINCT FROM (a.detalles->'despues'->'banned_until')
      THEN CASE WHEN nullif(a.detalles->'despues'->>'banned_until','')::timestamptz > a.created_at
        THEN 'bloquear_acceso' ELSE 'desbloquear_acceso' END
    WHEN a.detalles->>'credenciales_actualizadas'='true' THEN 'cambiar_credenciales'
    WHEN a.accion='actualizar' AND a.tabla='cheques_regalo' AND (
      (a.detalles->'antes'->'usado') IS DISTINCT FROM (a.detalles->'despues'->'usado') OR
      (a.detalles->'antes'->'canjeado_en') IS DISTINCT FROM (a.detalles->'despues'->'canjeado_en')) THEN 'canjear_cheque'
    WHEN a.accion='actualizar' AND (a.detalles->'antes'->'precio_eur') IS DISTINCT FROM (a.detalles->'despues'->'precio_eur') THEN 'cambiar_precio'
    WHEN a.accion='actualizar' AND (a.detalles->'antes'->'activado') IS DISTINCT FROM (a.detalles->'despues'->'activado') THEN 'cambiar_visibilidad'
    ELSE a.accion
  END AS tipo_evento,
  CASE WHEN a.accion IN ('login_fallido','acceso_denegado') THEN 'fallida' ELSE coalesce(a.detalles->>'resultado','completada') END AS resultado,
  a.accion NOT IN ('acceso','intento_login') AS visible_por_defecto,
  concat_ws(' ', a.actor_label, a.tabla, a.detalles->>'pregunta', a.detalles->>'respuesta', a.detalles->'despues'->>'nombre', a.detalles->'antes'->>'nombre', a.detalles->'despues'->>'contenido', a.detalles->'antes'->>'contenido', a.detalles->'despues'->>'content', a.detalles->'antes'->>'content', a.detalles->>'operacion') AS texto_busqueda
FROM public.audit_log a
WHERE public.audit_tabla_util(a.tabla) OR (a.tabla='conversaciones' AND a.accion IN ('crear','eliminar'));
REVOKE ALL ON public.audit_log_visible FROM PUBLIC, anon;
GRANT SELECT ON public.audit_log_visible TO authenticated, service_role;

COMMIT;
