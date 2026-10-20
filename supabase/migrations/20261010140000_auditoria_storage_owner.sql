set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261010140000_auditoria_storage_owner
-- ===========================================================================
-- ##   NO APLICADA: la aplica el dueño a mano (ver PASOS)                  ##
-- ===========================================================================
-- ARREGLO URGENTE: toda subida a Supabase Storage desde el panel falla con
-- HTTP 500 «database error, code: 28000» (facturas, fotos de vinos, novedades,
-- ecommerce…).
--
-- CAUSA. storage.objects tiene el trigger de auditoría trg_auditoria
-- (public.fn_registrar_auditoria). Inserta en public.audit_log, cuyo BEFORE
-- trigger fn_identificar_actor_auditoria lanza 28000 si no identifica al actor.
-- El servicio Storage hace el INSERT sin las claims del usuario: auth.uid() es
-- NULL, y cae en «no se ha identificado al responsable». Con claims de
-- usuario sí funcionaba, por eso los tests no lo vieron.
--
-- QUÉ CAMBIA (solo fn_registrar_auditoria, y solo para el esquema storage):
--   Si no hay actor, el responsable es el propietario de la propia fila
--   (owner_id, o owner; Storage rellena owner_id con el sub del JWT), siempre
--   que exista en auth.users. Sin propietario válido (subida anónima en bucket
--   público) y fuera de service_role: no se bloquea ni se audita (como las
--   escrituras anónimas de la web). Nada más de la auditoría se relaja.
--   Nota: en un DELETE el propietario de la fila puede no ser quien borra; se
--   atribuye al propietario (Storage no pasa las claims del que borra).
--
-- Comprueba el md5 (sin CR) de la función actual: si no es el esperado
-- (162df5ca163bf209e2bf2ea9bd6648db) ni esta migración ya está aplicada,
-- ABORTA sin cambiar nada. Idempotente.
--
-- PASOS (desde adminpanelct/, POR TERMINAL; no en el SQL Editor)
--   1. npx supabase db query --linked -f supabase/migrations/20261010140000_auditoria_storage_owner.sql
--      Tiene que imprimir «auditoria_storage_owner: aplicada».
--   2. npx supabase db query --linked -f supabase/tests/auditoria_storage_owner_test.sql
--      (BEGIN … ROLLBACK). Tiene que acabar en «auditoria_storage_owner_test: OK».
--   Deshacer: supabase/rollbacks/20261010140000_auditoria_storage_owner_ROLLBACK.sql
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $$
declare v_md5 text; v_src text;
begin
  select md5(replace(pg_get_functiondef(p.oid), E'', '')), p.prosrc into v_md5, v_src
    from pg_proc p where p.oid = to_regprocedure('public.fn_registrar_auditoria()');
  if v_md5 is null then
    raise exception 'auditoria_storage_owner: no existe public.fn_registrar_auditoria(). No se ha cambiado nada.';
  end if;
  if position('auditoria_storage_owner' in v_src) = 0 and v_md5 <> '162df5ca163bf209e2bf2ea9bd6648db' then
    raise exception 'auditoria_storage_owner: fn_registrar_auditoria tiene un md5 inesperado (%), distinto del de 20261007220000 (162df5ca163bf209e2bf2ea9bd6648db). Alguien la ha cambiado: revisar antes de reescribirla. No se ha cambiado nada.', v_md5;
  end if;
end;
$$;

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

do $$
begin
  if position('auditoria_storage_owner' in (select prosrc from pg_proc where oid = to_regprocedure('public.fn_registrar_auditoria()'))) = 0 then
    raise exception 'auditoria_storage_owner: la función no quedó reescrita';
  end if;
end;
$$;

commit;

select 'auditoria_storage_owner: aplicada' as resultado;
