BEGIN;
-- No se borra el histórico. Solo se retira el ruido de la vista de negocio.
CREATE OR REPLACE FUNCTION public.audit_tabla_util(p_tabla text)
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = ''
AS $$ SELECT coalesce(p_tabla, '') <> ALL(ARRAY[
  'ocr_trabajos','ocr_trabajo_paginas','trafico_web_desglose','trafico_web_diario','trafico_web_sync_estado',
  'estadisticas_redes','usage_events','visitas_producto','peso_paginas','notificaciones_dashboard',
  'avisos_reserva_enviados','factura_contadores','imagenes_base64','n8n_chat_histories','consultas_chatbot',
  'chat_web_conversaciones','chat_web_mensajes','client_messages','productos_catalogo_antigua','noticias_hosteleria',
  'conversaciones','web_rebuild_state','newsletter_sincronizaciones_resend'
]::text[]) $$;

CREATE OR REPLACE VIEW public.audit_log_visible WITH (security_invoker = true) AS
SELECT a.*,
  CASE
    WHEN a.accion='ejecutar' AND a.detalles->>'tipo_evento' IS NOT NULL THEN a.detalles->>'tipo_evento'
    WHEN a.tabla='conversaciones' THEN CASE WHEN a.accion='eliminar' THEN 'eliminar_chat_ia' ELSE 'crear_chat_ia' END
    WHEN a.tabla='mensajes_chat' THEN CASE WHEN a.accion='eliminar' THEN 'eliminar_chat_ia' ELSE 'mensaje_ia' END
    WHEN a.tabla='user_permissions' THEN 'cambiar_permisos'
    WHEN a.tabla IN ('user_roles','super_admins') THEN 'cambiar_roles'
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

CREATE OR REPLACE FUNCTION public.listar_tablas_auditoria_panel()
RETURNS TABLE(tabla text) LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT DISTINCT a.tabla FROM public.audit_log_visible a WHERE a.tabla IS NOT NULL
  UNION
  SELECT CASE WHEN n.nspname='public' THEN c.relname ELSE n.nspname||'.'||c.relname END
  FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
  WHERE NOT t.tgisinternal AND p.proname='fn_registrar_auditoria'
    AND public.audit_tabla_util(CASE WHEN n.nspname='public' THEN c.relname ELSE n.nspname||'.'||c.relname END)
    AND EXISTS(SELECT 1 FROM public.super_admins s WHERE s.user_id=auth.uid())
  ORDER BY 1
$$;

-- Se amplía exclusivamente el detalle de chat-facturas. Las otras funciones
-- mantienen el contrato previo; ningún cuerpo arbitrario se copia al registro.
CREATE OR REPLACE FUNCTION public.registrar_accion_auditoria_panel(p_operacion text,p_detalles jsonb DEFAULT '{}')
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_headers jsonb := coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;
  v_actor uuid; v_id uuid; v_fuente text; v_detalles jsonb;
BEGIN
  IF current_user <> 'service_role' THEN RAISE EXCEPTION 'Solo el servidor registra estas acciones'; END IF;
  v_actor := nullif(v_headers->>'x-audit-actor-id','')::uuid;
  v_fuente := nullif(btrim(v_headers->>'x-audit-source'),'');
  IF v_actor IS NULL OR v_fuente IS NULL OR nullif(btrim(p_operacion),'') IS NULL THEN RAISE EXCEPTION 'Acción sin autor u origen'; END IF;
  v_detalles := jsonb_build_object('operacion',p_operacion,'origen',v_fuente,'request_id',v_headers->>'x-audit-request-id',
    'resultado',p_detalles->>'resultado','codigo_http',p_detalles->'codigo_http');
  IF v_fuente='chat-facturas' AND p_operacion='chat-facturas' THEN
    v_detalles := v_detalles || public.fn_audit_sanitizar(jsonb_build_object(
      'tipo_evento',CASE WHEN p_detalles->>'tipo_evento'='regeneracion_ia' THEN 'regeneracion_ia' ELSE 'consulta_ia' END,
      'pregunta',left(p_detalles->>'pregunta',16000),'respuesta',left(p_detalles->>'respuesta',32000),
      'conversacion_id',p_detalles->>'conversacion_id','herramientas',p_detalles->'herramientas',
      'duracion_ms',p_detalles->'duracion_ms','adjuntos',p_detalles->'adjuntos'));
  END IF;
  INSERT INTO public.audit_log(actor_user_id,accion,tabla,registro_id,detalles)
  VALUES(v_actor,'ejecutar','acciones_servidor',v_fuente,v_detalles) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.registrar_accion_auditoria_panel(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_accion_auditoria_panel(text,jsonb) TO service_role;

CREATE INDEX IF NOT EXISTS audit_log_reversion_original_unica
ON public.audit_log ((detalles->>'evento_original_id')) WHERE accion='ejecutar' AND detalles->>'tipo_evento'='reversion';

-- Ventana persistente por usuario: ni reiniciar un worker ni cambiar de IP la reinicia.
CREATE OR REPLACE FUNCTION public.iniciar_validacion_reversion(p_actor uuid,p_evento uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_num integer;
BEGIN
  IF current_user <> 'service_role' OR NOT EXISTS(SELECT 1 FROM public.super_admins WHERE user_id=p_actor) THEN
    RAISE EXCEPTION 'Solo superadmin' USING ERRCODE='42501';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('validar-reversion:'||p_actor::text,0));
  SELECT count(*) INTO v_num FROM public.audit_log WHERE actor_user_id=p_actor
    AND detalles->>'tipo_evento'='validar_reversion' AND created_at > clock_timestamp()-interval '1 minute';
  IF v_num>=5 THEN RETURN false; END IF;
  INSERT INTO public.audit_log(actor_user_id,accion,tabla,registro_id,detalles)
    VALUES(p_actor,'ejecutar','acciones_servidor',p_evento::text,jsonb_build_object('tipo_evento','validar_reversion','operacion','Validación de credenciales para revertir','resultado','pendiente','evento_original_id',p_evento));
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.iniciar_validacion_reversion(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.iniciar_validacion_reversion(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.revertir_cambio_auditoria(p_evento uuid,p_actor uuid,p_confirmar boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_evento public.audit_log%ROWTYPE; v_tabla text; v_op text;
  v_actual jsonb; v_antes jsonb; v_despues jsonb; v_objetivo jsonb;
  v_pk text[]; v_cond text; v_columnas text; v_valores text; v_cambios text; v_fila jsonb;
  v_tiempos text[] := ARRAY['created_at','updated_at','actualizado_en','modified_at'];
  v_fk record; v_fk_cond text; v_depende boolean; v_id uuid;
BEGIN
  IF current_user <> 'service_role' OR NOT EXISTS(SELECT 1 FROM public.super_admins WHERE user_id=p_actor) THEN
    RAISE EXCEPTION 'Solo superadmin' USING ERRCODE='42501';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reversion:'||p_evento::text,0));
  SELECT * INTO v_evento FROM public.audit_log WHERE id=p_evento;
  IF NOT FOUND THEN RAISE EXCEPTION 'El registro de auditoría no existe'; END IF;
  IF EXISTS(SELECT 1 FROM public.audit_log WHERE accion='ejecutar' AND detalles->>'tipo_evento'='reversion' AND detalles->>'evento_original_id'=p_evento::text) THEN
    RAISE EXCEPTION 'Este cambio ya se ha revertido';
  END IF;
  v_tabla:=v_evento.tabla;
  IF v_tabla IS NULL OR v_tabla <> ALL(ARRAY['Platos','Vinos','Bebidas','Cocteles','menus_diarios','tapas','novedades','resenas',
    'configuracion_web','configuracion_reservas','configuracion_turnos','dashboard_config','configBotWeb','chat_web_config',
    'plantilla_cheques_regalo','plantilla_factura_cheques','plantillas_email_reserva','oficiososia_borradores',
    'user_permissions','user_roles','admin_feature_toggles','user_role_presets'])
    OR v_evento.accion NOT IN ('crear','actualizar','eliminar') THEN
    RAISE EXCEPTION 'Este registro requiere una operación específica y no admite restauración automática';
  END IF;
  v_op:=coalesce(v_evento.detalles->>'operacion_sql',CASE v_evento.accion WHEN 'crear' THEN 'INSERT' WHEN 'eliminar' THEN 'DELETE' ELSE 'UPDATE' END);
  v_antes:=v_evento.detalles->'antes'; v_despues:=v_evento.detalles->'despues';
  IF coalesce(v_antes::text,'')||coalesce(v_despues::text,'') LIKE '%[oculto]%' THEN RAISE EXCEPTION 'No se puede restaurar un registro con valores ocultos'; END IF;
  IF (v_op='UPDATE' AND (v_antes IS NULL OR v_despues IS NULL)) OR (v_op='INSERT' AND v_despues IS NULL) OR (v_op='DELETE' AND v_antes IS NULL) THEN
    RAISE EXCEPTION 'No se conservan suficientes datos para restaurar este cambio';
  END IF;
  v_fila:=coalesce(v_despues,v_antes);
  SELECT array_agg(a.attname ORDER BY k.orden) INTO v_pk FROM pg_catalog.pg_constraint c
    CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY k(num,orden)
    JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.num
    WHERE c.contype='p' AND c.conrelid=to_regclass(format('public.%I',v_tabla));
  IF v_pk IS NULL THEN RAISE EXCEPTION 'No se puede identificar el registro de forma segura'; END IF;
  SELECT string_agg(format('to_jsonb(t)->%L IS NOT DISTINCT FROM $1->%L',k,k),' AND ') INTO v_cond FROM unnest(v_pk) k;
  EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE %s FOR UPDATE',v_tabla,v_cond) INTO v_actual USING v_fila;
  IF v_op='DELETE' THEN
    IF v_actual IS NOT NULL THEN RAISE EXCEPTION 'Ya existe un registro con esa identidad'; END IF;
    v_objetivo:=v_antes;
  ELSE
    IF v_actual IS NULL THEN RAISE EXCEPTION 'El registro ya no existe'; END IF;
    IF (public.fn_audit_sanitizar(v_actual)-v_tiempos) IS DISTINCT FROM (v_despues-v_tiempos) THEN
      RAISE EXCEPTION 'Hay cambios posteriores. No se han sobrescrito';
    END IF;
    v_objetivo:=CASE WHEN v_op='INSERT' THEN NULL ELSE v_antes END;
  END IF;
  -- Impide borrar en cascada otras entidades al deshacer una creación.
  IF v_op='INSERT' THEN
    FOR v_fk IN SELECT c.*,n.nspname AS esquema,h.relname AS tabla FROM pg_catalog.pg_constraint c
      JOIN pg_catalog.pg_class h ON h.oid=c.conrelid JOIN pg_catalog.pg_namespace n ON n.oid=h.relnamespace
      WHERE c.contype='f' AND c.confrelid=to_regclass(format('public.%I',v_tabla)) LOOP
      SELECT string_agg(format('to_jsonb(h)->%L = $1->%L',a.attname,b.attname),' AND ') INTO v_fk_cond
        FROM unnest(v_fk.conkey,v_fk.confkey) k(a_num,b_num)
        JOIN pg_catalog.pg_attribute a ON a.attrelid=v_fk.conrelid AND a.attnum=k.a_num
        JOIN pg_catalog.pg_attribute b ON b.attrelid=v_fk.confrelid AND b.attnum=k.b_num;
      EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.%I h WHERE %s)',v_fk.esquema,v_fk.tabla,v_fk_cond) INTO v_depende USING v_actual;
      IF v_depende THEN RAISE EXCEPTION 'Hay registros relacionados. No se puede deshacer esta creación automáticamente'; END IF;
    END LOOP;
  END IF;
  IF NOT p_confirmar THEN RETURN jsonb_build_object('evento_id',p_evento,'tabla',v_tabla,'operacion',CASE v_op WHEN 'INSERT' THEN 'eliminar' WHEN 'DELETE' THEN 'restaurar' ELSE 'restaurar_valores' END,'actual',public.fn_audit_sanitizar(v_actual),'restaurado',v_objetivo); END IF;
  IF v_op='INSERT' THEN
    EXECUTE format('DELETE FROM public.%I t WHERE %s',v_tabla,v_cond) USING v_fila;
  ELSIF v_op='UPDATE' THEN
    SELECT string_agg(format('%I = r.%I',a.attname,a.attname),',') INTO v_cambios
      FROM pg_catalog.pg_attribute a WHERE a.attrelid=to_regclass(format('public.%I',v_tabla)) AND a.attnum>0 AND NOT a.attisdropped
      AND a.attgenerated='' AND a.attidentity='' AND a.attname<>ALL(v_pk) AND a.attname<>ALL(v_tiempos)
      AND v_antes ? a.attname AND (v_antes->a.attname) IS DISTINCT FROM (v_despues->a.attname);
    IF v_cambios IS NULL THEN RAISE EXCEPTION 'No hay campos restaurables en este cambio'; END IF;
    EXECUTE format('UPDATE public.%I t SET %s FROM jsonb_populate_record(NULL::public.%I,$2) r WHERE %s',v_tabla,v_cambios,v_tabla,v_cond) USING v_fila,v_antes;
  ELSIF v_op='DELETE' THEN
    SELECT string_agg(format('%I',a.attname),','),string_agg(format('r.%I',a.attname),',') INTO v_columnas,v_valores
      FROM pg_catalog.pg_attribute a WHERE a.attrelid=to_regclass(format('public.%I',v_tabla)) AND a.attnum>0 AND NOT a.attisdropped
      AND a.attgenerated='' AND v_antes ? a.attname;
    EXECUTE format('INSERT INTO public.%I (%s) OVERRIDING SYSTEM VALUE SELECT %s FROM jsonb_populate_record(NULL::public.%I,$1) r',v_tabla,v_columnas,v_valores,v_tabla) USING v_antes;
  ELSE RAISE EXCEPTION 'Operación no restaurable'; END IF;
  INSERT INTO public.audit_log(actor_user_id,accion,tabla,registro_id,detalles)
    VALUES(p_actor,'ejecutar',v_tabla,v_evento.registro_id,jsonb_build_object('tipo_evento','reversion','operacion','Revertir cambio','evento_original_id',p_evento,'resultado','completada','antes',public.fn_audit_sanitizar(v_actual),'despues',v_objetivo)) RETURNING id INTO v_id;
  RETURN jsonb_build_object('success',true,'evento_reversion_id',v_id);
END $$;
REVOKE ALL ON FUNCTION public.revertir_cambio_auditoria(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.revertir_cambio_auditoria(uuid,uuid,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_registrar_auditoria()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  IF TG_TABLE_SCHEMA = 'public' AND ((NOT public.audit_tabla_util(TG_TABLE_NAME) AND TG_TABLE_NAME<>'conversaciones') OR TG_TABLE_NAME='mensajes_chat' OR (TG_TABLE_NAME='conversaciones' AND TG_OP='UPDATE')) THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
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

  -- auditoria_storage_owner: Storage inserta en storage.objects SIN las claims
  -- del usuario (auth.uid() llega NULL) pero rellena owner_id con el sub del
  -- JWT. Para ese esquema, y solo si aún no hay actor, el responsable es el
  -- propietario de la fila. Sin propietario válido (subida anónima en un bucket
  -- público) se trata como las escrituras anónimas: ni se bloquea ni se audita.
  -- El service_role sigue sus reglas de siempre.
  IF v_actor_id IS NULL AND TG_TABLE_SCHEMA = 'storage' THEN
    v_subject_id := NULL;
    BEGIN
      v_subject_id := nullif(coalesce(v_fila ->> 'owner_id', v_fila ->> 'owner'), '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN v_subject_id := NULL;
    END;
    IF v_subject_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_subject_id) THEN
      v_subject_id := NULL;
    END IF;
    v_actor_id := v_subject_id;
    IF v_actor_id IS NULL AND coalesce(auth.role(), '') <> 'service_role' THEN
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
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
$function$;

COMMIT;
