-- Preparar esquema y RPC antes de desplegar los handlers; no amplía todavía los triggers.
BEGIN;
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS device_id text;
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS ip_address text;
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS request_id text;
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS session_id text;
ALTER TABLE public.audit_auth_context ADD COLUMN IF NOT EXISTS user_agent text;
ALTER TABLE public.audit_auth_context ADD COLUMN IF NOT EXISTS device_id text;
ALTER TABLE public.audit_auth_context ADD COLUMN IF NOT EXISTS ip_address text;

ALTER TABLE public.audit_log DROP CONSTRAINT audit_log_accion_check;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_accion_check
  CHECK (accion IN ('login','logout','crear','actualizar','eliminar','ejecutar'));

ALTER TABLE public.audit_auth_context DROP CONSTRAINT audit_auth_context_operacion_check;
ALTER TABLE public.audit_auth_context ADD CONSTRAINT audit_auth_context_operacion_check
  CHECK (operacion IN ('crear', 'actualizar', 'eliminar'));
ALTER TABLE public.audit_auth_context ADD COLUMN IF NOT EXISTS request_id text;

CREATE OR REPLACE FUNCTION public.preparar_contexto_auditoria_auth(
  p_actor_id uuid, p_operacion text, p_user_id uuid DEFAULT NULL, p_email text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_email text; v_id uuid;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = p_actor_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'El actor debe ser un usuario existente'; END IF;
  DELETE FROM public.audit_auth_context WHERE expires_at < clock_timestamp();
  INSERT INTO public.audit_auth_context (actor_user_id, actor_email, operacion, subject_user_id, subject_email, request_id,user_agent,device_id,ip_address)
  VALUES (p_actor_id, v_email, p_operacion, p_user_id, lower(nullif(btrim(p_email), '')),
    coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb ->> 'x-audit-request-id',
    coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb ->> 'x-audit-user-agent',
    coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb ->> 'x-audit-device-id',
    coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb ->> 'x-audit-ip')
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.preparar_contexto_auditoria_auth(uuid,text,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preparar_contexto_auditoria_auth(uuid,text,uuid,text) TO service_role;

-- Nunca persistir secretos, tampoco dentro de objetos o listas anidadas.
CREATE OR REPLACE FUNCTION public.fn_audit_sanitizar(p_dato jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public
AS $$
DECLARE v_resultado jsonb; v_clave text; v_valor jsonb;
BEGIN
  IF p_dato IS NULL THEN RETURN NULL; END IF;
  IF jsonb_typeof(p_dato) = 'object' THEN
    v_resultado := '{}'::jsonb;
    FOR v_clave, v_valor IN SELECT key,value FROM jsonb_each(p_dato) LOOP
      v_resultado := v_resultado || jsonb_build_object(v_clave,
        CASE WHEN v_clave ~* '(password|passwd|secret|token|api_?key|authorization|verification_code|base64|embedding)'
        THEN to_jsonb('[oculto]'::text) ELSE public.fn_audit_sanitizar(v_valor) END);
    END LOOP;
    RETURN v_resultado;
  ELSIF jsonb_typeof(p_dato) = 'array' THEN
    SELECT coalesce(jsonb_agg(public.fn_audit_sanitizar(value)), '[]'::jsonb)
    INTO v_resultado FROM jsonb_array_elements(p_dato);
    RETURN v_resultado;
  END IF;
  RETURN p_dato;
END;
$$;

-- Acciones del servidor sin una mutación SQL propia (p. ej. correo de prueba).
-- Solo service_role, y siempre con el usuario verificado por el handler.
CREATE OR REPLACE FUNCTION public.registrar_accion_auditoria_panel(p_operacion text,p_detalles jsonb DEFAULT '{}')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_headers jsonb := coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;
  v_actor uuid; v_id uuid; v_fuente text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Solo el servidor registra estas acciones'; END IF;
  v_actor := nullif(v_headers ->> 'x-audit-actor-id','')::uuid;
  v_fuente := nullif(btrim(v_headers ->> 'x-audit-source'),'');
  IF v_actor IS NULL OR v_fuente IS NULL OR nullif(btrim(p_operacion),'') IS NULL THEN RAISE EXCEPTION 'Acción sin autor u origen'; END IF;
  INSERT INTO public.audit_log(actor_user_id,accion,tabla,registro_id,detalles)
  VALUES(v_actor,'ejecutar','acciones_servidor',v_fuente,
    jsonb_build_object('operacion',p_operacion,'origen',v_fuente,'request_id',v_headers ->> 'x-audit-request-id',
      'resultado',p_detalles ->> 'resultado','codigo_http',p_detalles -> 'codigo_http')) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.registrar_accion_auditoria_panel(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_accion_auditoria_panel(text,jsonb) TO service_role;

COMMIT;
