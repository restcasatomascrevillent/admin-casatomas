-- Cobertura central de las operaciones del panel, incluidas RPC, Auth y Storage.
-- Aplicar en la misma actualización que las Edge Functions con audit-client.ts.
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

-- GoTrue usa su propia conexión. El BEFORE fija el contexto para TODAS las
-- cascadas, incluso las de perfiles y documentos que no tienen user_id.
CREATE OR REPLACE FUNCTION public.fn_audit_contexto_usuario()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_fila jsonb; v_operacion text; v_contexto uuid;
BEGIN
  PERFORM set_config('audit.auth_context_id', '', true);
  -- Cambios de sesión, confirmación o refresh no son cambios de credenciales.
  IF TG_OP = 'UPDATE'
    AND (to_jsonb(OLD) -> 'encrypted_password') IS NOT DISTINCT FROM (to_jsonb(NEW) -> 'encrypted_password')
    AND (to_jsonb(OLD) -> 'email') IS NOT DISTINCT FROM (to_jsonb(NEW) -> 'email')
    AND (to_jsonb(OLD) -> 'banned_until') IS NOT DISTINCT FROM (to_jsonb(NEW) -> 'banned_until') THEN RETURN NEW; END IF;
  v_fila := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  v_operacion := CASE TG_OP WHEN 'INSERT' THEN 'crear' WHEN 'DELETE' THEN 'eliminar' ELSE 'actualizar' END;
  IF session_user = 'supabase_auth_admin' THEN
    SELECT c.id INTO v_contexto FROM public.audit_auth_context c
    WHERE c.operacion = v_operacion AND c.expires_at >= clock_timestamp()
      AND (c.subject_user_id = (v_fila ->> 'id')::uuid
        OR (c.subject_user_id IS NULL AND lower(c.subject_email) = lower(v_fila ->> 'email')))
    LIMIT 1;
    IF v_contexto IS NULL THEN RAISE EXCEPTION 'La operación de usuarios requiere al autor identificado'; END IF;
    PERFORM set_config('audit.auth_context_id', v_contexto::text, true);
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'auth.users'::regclass AND tgname = 'trg_audit_contexto_usuario') THEN
    CREATE TRIGGER trg_audit_contexto_usuario BEFORE INSERT OR UPDATE OR DELETE ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit_contexto_usuario();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fn_registrar_auditoria()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid(); v_actor_email text;
  v_headers jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  v_antes jsonb; v_despues jsonb; v_fila jsonb; v_detalles jsonb;
  v_accion text; v_tabla text; v_registro_id text; v_pk jsonb;
  v_request_id text := v_headers ->> 'x-audit-request-id';
  v_user_agent text; v_device_id text; v_ip text;
  v_contexto_id uuid; v_subject_id uuid; v_subject_email text;
  v_permiso_antes jsonb; v_permiso_despues jsonb; v_campos jsonb;
  v_tiempos text[] := ARRAY['created_at','updated_at','actualizado_en','modified_at'];
BEGIN
  v_antes := CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END;
  v_despues := CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END;
  v_fila := coalesce(v_despues, v_antes);
  v_tabla := CASE WHEN TG_TABLE_SCHEMA = 'public' THEN TG_TABLE_NAME ELSE TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME END;
  v_accion := CASE TG_OP WHEN 'INSERT' THEN 'crear' WHEN 'DELETE' THEN 'eliminar' ELSE 'actualizar' END;
  IF TG_OP = 'UPDATE' AND (v_antes - v_tiempos) IS NOT DISTINCT FROM (v_despues - v_tiempos) THEN RETURN NEW; END IF;

  IF v_actor_id IS NULL AND auth.role() = 'service_role' THEN
    v_actor_id := nullif(v_headers ->> 'x-audit-actor-id', '')::uuid;
  END IF;
  IF v_actor_id IS NULL AND session_user = 'supabase_auth_admin' THEN
    v_contexto_id := nullif(current_setting('audit.auth_context_id', true), '')::uuid;
    IF v_contexto_id IS NOT NULL THEN
      SELECT c.actor_user_id, c.actor_email, c.request_id,c.user_agent,c.device_id,c.ip_address INTO v_actor_id, v_actor_email, v_request_id,v_user_agent,v_device_id,v_ip
      FROM public.audit_auth_context c WHERE c.id = v_contexto_id AND c.expires_at >= clock_timestamp();
    END IF;
    -- Compatibilidad con una cascada que llega sin el BEFORE del usuario.
    IF v_actor_id IS NULL THEN
      v_subject_id := nullif(coalesce(v_fila ->> 'user_id', CASE WHEN TG_TABLE_NAME IN ('users','profiles') THEN v_fila ->> 'id' END), '')::uuid;
      SELECT email INTO v_subject_email FROM auth.users WHERE id = v_subject_id;
      SELECT c.actor_user_id, c.actor_email, c.request_id,c.user_agent,c.device_id,c.ip_address INTO v_actor_id, v_actor_email, v_request_id,v_user_agent,v_device_id,v_ip
      FROM public.audit_auth_context c
      WHERE c.operacion = v_accion AND c.expires_at >= clock_timestamp()
        AND (c.subject_user_id = v_subject_id OR
          (c.subject_user_id IS NULL AND lower(c.subject_email) = lower(coalesce(v_subject_email,v_fila ->> 'email'))))
      LIMIT 1;
    END IF;
  END IF;

  -- Las escrituras públicas anónimas de la web no son operaciones del panel.
  -- Los 13 controles sensibles originales continúan rechazándolas.
  IF v_actor_id IS NULL AND auth.role() = 'anon' AND TG_TABLE_SCHEMA <> 'auth'
     AND TG_TABLE_NAME <> ALL(ARRAY['user_roles','user_permissions','super_admins','admin_feature_toggles','sell_users',
       'configuracion_reservas','configuracion_web','configBotWeb','chat_web_config','gdpr_config','dashboard_config',
       'phone_system_config','user_role_presets']) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF v_actor_id IS NOT NULL THEN
    SELECT coalesce(nullif(btrim(email), ''), v_actor_email) INTO v_actor_email FROM auth.users WHERE id = v_actor_id;
  END IF;

  IF TG_TABLE_SCHEMA = 'auth' THEN
    IF TG_OP = 'UPDATE'
      AND (v_antes -> 'encrypted_password') IS NOT DISTINCT FROM (v_despues -> 'encrypted_password')
      AND (v_antes -> 'email') IS NOT DISTINCT FROM (v_despues -> 'email')
      AND (v_antes -> 'banned_until') IS NOT DISTINCT FROM (v_despues -> 'banned_until') THEN RETURN NEW; END IF;
    v_detalles := jsonb_build_object('credenciales_actualizadas', TG_OP = 'UPDATE' AND
      (v_antes -> 'encrypted_password') IS DISTINCT FROM (v_despues -> 'encrypted_password'));
    v_antes := CASE WHEN v_antes IS NULL THEN NULL ELSE jsonb_build_object('id',v_antes -> 'id','email',v_antes -> 'email','banned_until',v_antes -> 'banned_until') END;
    v_despues := CASE WHEN v_despues IS NULL THEN NULL ELSE jsonb_build_object('id',v_despues -> 'id','email',v_despues -> 'email','banned_until',v_despues -> 'banned_until') END;
  ELSE v_detalles := '{}'::jsonb;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    SELECT coalesce(jsonb_agg(k), '[]'::jsonb) INTO v_campos FROM (
      SELECT key AS k FROM jsonb_object_keys(coalesce(v_antes,'{}') || coalesce(v_despues,'{}')) key
      WHERE key <> ALL(v_tiempos) AND (v_antes -> key) IS DISTINCT FROM (v_despues -> key)
    ) cambios;
    v_detalles := v_detalles || jsonb_build_object('campos_modificados',v_campos);
  END IF;
  v_detalles := v_detalles || CASE TG_OP
    WHEN 'DELETE' THEN jsonb_build_object('antes',public.fn_audit_sanitizar(v_antes))
    WHEN 'UPDATE' THEN jsonb_build_object('antes',public.fn_audit_sanitizar(v_antes),'despues',public.fn_audit_sanitizar(v_despues))
    ELSE jsonb_build_object('despues',public.fn_audit_sanitizar(v_despues)) END;

  IF TG_TABLE_NAME = 'user_permissions' THEN
    v_permiso_antes := public.fn_audit_estado_permiso(v_antes,v_fila);
    v_permiso_despues := public.fn_audit_estado_permiso(v_despues,v_fila);
    IF v_permiso_antes = v_permiso_despues THEN
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
    END IF;
    v_accion := 'actualizar';
    v_detalles := v_detalles || jsonb_build_object('permiso_antes',v_permiso_antes,'permiso_despues',v_permiso_despues,
      'operacion_permiso',CASE TG_OP WHEN 'INSERT' THEN 'conceder' WHEN 'DELETE' THEN 'retirar' ELSE 'modificar' END);
  ELSIF TG_TABLE_NAME IN ('user_roles','super_admins','asignaciones_mesa','asignaciones_sala','asignaciones_area') THEN
    v_accion := 'actualizar';
    v_detalles := v_detalles || jsonb_build_object('operacion_asignacion',CASE TG_OP WHEN 'INSERT' THEN 'asignar' WHEN 'DELETE' THEN 'retirar' ELSE 'modificar' END);
  END IF;

  SELECT jsonb_object_agg(a.attname, v_fila -> a.attname) INTO v_pk
  FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
  WHERE c.contype = 'p' AND c.conrelid = TG_RELID;
  v_registro_id := coalesce(v_fila ->> 'id', v_pk::text, v_fila ->> 'user_id', 'huella:' || md5(v_fila::text));
  v_detalles := v_detalles || jsonb_build_object('operacion_sql',TG_OP,'request_id',v_request_id);
  INSERT INTO public.audit_log(actor_user_id,actor_email,accion,tabla,registro_id,detalles,user_agent,device_id,ip_address,request_id)
  VALUES(v_actor_id,v_actor_email,v_accion,v_tabla,v_registro_id,v_detalles,v_user_agent,v_device_id,v_ip,v_request_id);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END;
$$;

-- La instalación incluye las tablas actuales aunque se hayan añadido por una
-- migración ajena al catálogo del frontend. Se excluyen logs derivados y copias.
CREATE OR REPLACE FUNCTION public.instalar_auditoria_panel()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT n.nspname AS esquema,c.relname AS tabla FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r','p') AND NOT c.relispartition AND n.nspname = 'public'
      AND c.relname NOT IN ('audit_log','audit_auth_context','historial_precios','historial_ajustes_precios',
        'gdpr_audit_log','ocupacion_diaria','ia_uso','rate_limit_log','chat_web_uso','metricas')
      AND c.relname !~ '(respaldo|descartadas|depurados|^zz_|_backup|^backup_)'
    UNION ALL SELECT 'auth','users'
    UNION ALL SELECT 'storage','objects' WHERE to_regclass('storage.objects') IS NOT NULL
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = to_regclass(format('%I.%I',r.esquema,r.tabla))
      AND t.tgfoid = 'public.fn_registrar_auditoria()'::regprocedure AND NOT t.tgisinternal) THEN
      EXECUTE format('CREATE TRIGGER trg_auditoria AFTER INSERT OR UPDATE OR DELETE ON %I.%I FOR EACH ROW EXECUTE FUNCTION public.fn_registrar_auditoria()',r.esquema,r.tabla);
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.instalar_auditoria_panel() FROM PUBLIC,anon,authenticated,service_role;
SELECT public.instalar_auditoria_panel();

-- Las nuevas tablas del panel también reciben el trigger automáticamente.
-- Solo el objeto recién creado: no bloquear todas las tablas por cada DDL.
CREATE OR REPLACE FUNCTION public.fn_audit_nueva_tabla()
RETURNS event_trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT n.nspname AS esquema,c.relname AS tabla FROM pg_event_trigger_ddl_commands() d
    JOIN pg_class c ON c.oid = d.objid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE d.object_type IN ('table','partitioned table') AND c.relkind IN ('r','p') AND NOT c.relispartition
      AND n.nspname = 'public'
      AND c.relname NOT IN ('audit_log','audit_auth_context','historial_precios','historial_ajustes_precios',
        'gdpr_audit_log','ocupacion_diaria','ia_uso','rate_limit_log','chat_web_uso','metricas')
      AND c.relname !~ '(respaldo|descartadas|depurados|^zz_|_backup|^backup_)'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_auditoria ON %I.%I',r.esquema,r.tabla);
    EXECUTE format('CREATE TRIGGER trg_auditoria AFTER INSERT OR UPDATE OR DELETE ON %I.%I FOR EACH ROW EXECUTE FUNCTION public.fn_registrar_auditoria()',r.esquema,r.tabla);
  END LOOP;
END;
$$;
DROP EVENT TRIGGER IF EXISTS audit_panel_nuevas_tablas;
CREATE EVENT TRIGGER audit_panel_nuevas_tablas ON ddl_command_end
WHEN TAG IN ('CREATE TABLE','CREATE TABLE AS','SELECT INTO')
EXECUTE FUNCTION public.fn_audit_nueva_tabla();

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

CREATE OR REPLACE FUNCTION public.listar_tablas_auditoria_panel()
RETURNS TABLE(tabla text) LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT DISTINCT CASE WHEN n.nspname = 'public' THEN c.relname ELSE n.nspname || '.' || c.relname END
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE t.tgfoid = 'public.fn_registrar_auditoria()'::regprocedure AND NOT t.tgisinternal AND t.tgenabled <> 'D'
    AND EXISTS(SELECT 1 FROM public.super_admins WHERE user_id = auth.uid())
  UNION SELECT 'acciones_servidor' WHERE EXISTS(SELECT 1 FROM public.super_admins WHERE user_id = auth.uid())
  ORDER BY 1;
$$;
REVOKE ALL ON FUNCTION public.listar_tablas_auditoria_panel() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.listar_tablas_auditoria_panel() TO authenticated;

-- Corregir asignaciones previas; conservar autor, fecha y snapshots.
UPDATE public.audit_log SET accion = 'actualizar'
WHERE tabla IN ('user_roles','super_admins','asignaciones_mesa','asignaciones_sala','asignaciones_area');
COMMIT;

SELECT count(*) AS sin_identidad FROM public.audit_log
WHERE actor_label IS NULL OR btrim(actor_label) = '' OR actor_origin = 'historico';
