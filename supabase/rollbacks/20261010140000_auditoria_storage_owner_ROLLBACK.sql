set client_encoding = 'UTF8';
-- ===========================================================================
-- ROLLBACK de supabase/migrations/20261010140000_auditoria_storage_owner.sql
-- ===========================================================================
-- No es una migración (ver supabase/rollbacks/README.md). Se ejecuta A MANO,
-- POR TERMINAL (no en el SQL Editor):
--   npx supabase db query --linked -f supabase/rollbacks/20261010140000_auditoria_storage_owner_ROLLBACK.sql
--
-- Devuelve public.fn_registrar_auditoria a su definición EXACTA anterior
-- (md5 sin CR 162df5ca163bf209e2bf2ea9bd6648db, la de 20261007220000) y lo comprueba.
-- OJO: con ella, toda subida a Supabase Storage vuelve a fallar con 28000.
-- Imprime «auditoria_storage_owner: revertida | 0».
-- ===========================================================================

begin;
set local lock_timeout = '5s';

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
$function$;

do $$
declare v_md5 text;
begin
  select md5(replace(pg_get_functiondef(p.oid), E'', '')) into v_md5
    from pg_proc p where p.oid = to_regprocedure('public.fn_registrar_auditoria()');
  if v_md5 is distinct from '162df5ca163bf209e2bf2ea9bd6648db' then
    raise exception 'auditoria_storage_owner rollback: el md5 resultante (%) no es el original 162df5ca163bf209e2bf2ea9bd6648db', v_md5;
  end if;
end;
$$;

commit;

select 'auditoria_storage_owner: revertida | 0' as resultado;
