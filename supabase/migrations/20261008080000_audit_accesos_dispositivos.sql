-- Todos los accesos del panel, con identidad comprobada solo tras autenticar.
-- Los intentos no comprobados nunca se atribuyen al titular del email escrito.
BEGIN;
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS device_id text;
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS ip_address text;
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS request_id text;
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS session_id text;
ALTER TABLE public.audit_log DROP CONSTRAINT audit_log_accion_check;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_accion_check CHECK
 (accion IN ('login','logout','crear','actualizar','eliminar','ejecutar','intento_login','login_fallido','acceso','acceso_denegado'));
ALTER TABLE public.audit_log DROP CONSTRAINT audit_log_actor_origin_valido;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_actor_origin_valido CHECK
 (actor_origin IN ('usuario','servicio','base_de_datos','intento'));
ALTER TABLE public.audit_log DROP CONSTRAINT audit_log_solo_identidades_verificadas;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_solo_identidades_verificadas CHECK (
 btrim(actor_label) <> '' AND
 ((actor_origin = 'usuario' AND actor_user_id IS NOT NULL) OR
  actor_origin IN ('servicio','base_de_datos') OR
  (actor_origin = 'intento' AND actor_user_id IS NULL AND actor_email IS NULL
   AND accion IN ('intento_login','login_fallido') AND tabla = 'accesos_panel')));
CREATE INDEX IF NOT EXISTS idx_audit_dispositivo ON public.audit_log(device_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_accesos_ip ON public.audit_log(ip_address,created_at DESC) WHERE tabla='accesos_panel';

CREATE OR REPLACE FUNCTION public.fn_identificar_actor_auditoria()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 v_email text; v_role text := nullif(auth.role(),'');
 v_headers jsonb := coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;
 v_claims jsonb := coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
 v_source text := nullif(btrim(v_headers->>'x-audit-source'),'');
 v_client text := v_headers->>'x-client-info';
BEGIN
 -- Metadatos informativos del transporte. Las cabeceras no prueban quién actúa.
 IF v_role = 'service_role' THEN
   NEW.user_agent := left(coalesce(v_headers->>'x-audit-user-agent',NEW.user_agent),1024);
   NEW.device_id := left(coalesce(v_headers->>'x-audit-device-id',NEW.device_id),128);
   NEW.ip_address := left(coalesce(v_headers->>'x-audit-ip',NEW.ip_address),128);
   NEW.request_id := left(coalesce(v_headers->>'x-audit-request-id',NEW.request_id),128);
 ELSIF v_role IS NOT NULL THEN
   NEW.user_agent := left(coalesce(v_headers->>'user-agent',NEW.user_agent),1024);
   NEW.device_id := CASE WHEN v_client LIKE 'adminpanel/%' THEN left(split_part(v_client,'/',2),128) END;
   NEW.request_id := CASE WHEN v_client LIKE 'adminpanel/%' THEN left(split_part(v_client,'/',3),128) END;
   NEW.ip_address := left(split_part(v_headers->>'x-forwarded-for',',',1),128);
   NEW.session_id := left(v_claims->>'session_id',128);
 END IF;
 IF auth.uid() IS NOT NULL THEN NEW.actor_user_id := auth.uid(); END IF;
 IF NEW.actor_user_id IS NOT NULL THEN
   SELECT email INTO v_email FROM auth.users WHERE id=NEW.actor_user_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'Auditoría: el usuario responsable no existe' USING ERRCODE='28000'; END IF;
   NEW.actor_email := nullif(btrim(v_email),'');
   NEW.actor_origin := 'usuario';
   NEW.actor_label := coalesce(NEW.actor_email,'Usuario · '||NEW.actor_user_id::text);
 ELSIF v_role='service_role' AND v_source='panel-auth' AND NEW.accion IN ('intento_login','login_fallido') AND NEW.tabla='accesos_panel' THEN
   NEW.actor_email := NULL; NEW.actor_origin := 'intento';
   NEW.actor_label := coalesce(nullif(left(NEW.detalles->>'email_introducido',255),''),'Sin correo introducido') || ' · identidad no verificada';
 ELSIF v_role='service_role' THEN
   IF v_source IS NULL OR v_source IN ('admin-create-user','admin-delete-user','admin-set-super-admin','admin-update-user-password') THEN
     RAISE EXCEPTION 'Auditoría: falta el usuario responsable o el origen del proceso' USING ERRCODE='28000';
   END IF;
   NEW.actor_email := NULL; NEW.actor_origin := 'servicio'; NEW.actor_label := 'API · service_role · '||v_source;
 ELSIF v_role IS NULL AND session_user NOT IN ('supabase_auth_admin','authenticator','anon','authenticated','service_role') THEN
   NEW.actor_email := NULL; NEW.actor_origin := 'base_de_datos'; NEW.actor_label := 'Base de datos · '||session_user;
 ELSE RAISE EXCEPTION 'Auditoría: no se ha identificado al responsable' USING ERRCODE='28000';
 END IF;
 IF NEW.accion IN ('login','logout','acceso','acceso_denegado') AND NEW.actor_origin<>'usuario' THEN
   RAISE EXCEPTION 'El acceso requiere un usuario verificado' USING ERRCODE='28000';
 END IF;
 NEW.detalles := public.fn_audit_sanitizar(NEW.detalles);
 RETURN NEW;
END $$;

-- Estas RPC son exclusivas del servidor: un cliente anónimo nunca puede
-- fabricar accesos correctos ni elegir el UUID al que atribuir un intento.
CREATE OR REPLACE FUNCTION public.iniciar_intento_panel(p_email text,p_ruta text DEFAULT '/auth')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 v_headers jsonb := coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;
 v_ip text; v_email text:=left(lower(btrim(coalesce(p_email,''))),255); v_id uuid; v_n bigint;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR v_headers->>'x-audit-source' IS DISTINCT FROM 'panel-auth' THEN RAISE EXCEPTION 'Solo panel-auth'; END IF;
 v_ip := left(coalesce(nullif(v_headers->>'x-audit-ip',''), 'sin-ip'),128);
 PERFORM pg_advisory_xact_lock(hashtextextended('panel-auth:'||v_ip,0));
 SELECT count(*) INTO v_n FROM public.audit_log WHERE tabla='accesos_panel'
  AND detalles ? 'email_introducido' AND ip_address IS NOT DISTINCT FROM nullif(v_ip,'sin-ip')
  AND created_at > clock_timestamp()-interval '1 minute';
 INSERT INTO public.audit_log(accion,tabla,detalles)
 VALUES(CASE WHEN v_n>=30 THEN 'login_fallido' ELSE 'intento_login' END,'accesos_panel',
  jsonb_build_object('email_introducido',v_email,'ruta',CASE WHEN p_ruta='/super-admin/login' THEN p_ruta ELSE '/auth' END,
   'resultado',CASE WHEN v_n>=30 THEN 'limite_intentos' ELSE 'pendiente' END,'identidad_verificada',false)) RETURNING id INTO v_id;
 RETURN jsonb_build_object('id',v_id,'permitido',v_n<30);
END $$;

CREATE OR REPLACE FUNCTION public.finalizar_intento_panel(p_id uuid,p_actor uuid DEFAULT NULL,p_resultado text DEFAULT 'credenciales_invalidas',p_session_id text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 v_headers jsonb:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;
 v_email text; v_intento public.audit_log%ROWTYPE;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR v_headers->>'x-audit-source' IS DISTINCT FROM 'panel-auth' THEN RAISE EXCEPTION 'Solo panel-auth'; END IF;
 SELECT * INTO v_intento FROM public.audit_log WHERE id=p_id AND tabla='accesos_panel' AND accion='intento_login' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'El intento no existe o ya terminó'; END IF;
 IF v_intento.request_id IS DISTINCT FROM v_headers->>'x-audit-request-id' THEN RAISE EXCEPTION 'El intento pertenece a otra petición'; END IF;
 IF p_actor IS NOT NULL THEN
   SELECT email INTO v_email FROM auth.users WHERE id=p_actor;
   IF NOT FOUND OR lower(v_email) IS DISTINCT FROM v_intento.detalles->>'email_introducido' THEN RAISE EXCEPTION 'Usuario no verificado para este intento'; END IF;
 END IF;
 UPDATE public.audit_log SET
  accion=CASE WHEN p_actor IS NULL THEN 'login_fallido' ELSE 'login' END,
  actor_user_id=p_actor,actor_email=v_email,
  actor_origin=CASE WHEN p_actor IS NULL THEN 'intento' ELSE 'usuario' END,
  actor_label=CASE WHEN p_actor IS NULL THEN actor_label ELSE coalesce(nullif(v_email,''),'Usuario · '||p_actor::text) END,
  session_id=CASE WHEN p_actor IS NOT NULL THEN left(p_session_id,128) END,
  detalles=detalles||jsonb_build_object('resultado',CASE WHEN p_actor IS NOT NULL THEN 'correcto'
    WHEN p_resultado IN ('credenciales_invalidas','error_servicio','peticion_invalida') THEN p_resultado ELSE 'credenciales_invalidas' END,
    'identidad_verificada',p_actor IS NOT NULL,'finalizado_en',clock_timestamp())
 WHERE id=p_id;
END $$;
REVOKE ALL ON FUNCTION public.iniciar_intento_panel(text,text), public.finalizar_intento_panel(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.iniciar_intento_panel(text,text), public.finalizar_intento_panel(uuid,uuid,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.registrar_acceso_panel(p_tipo text,p_ruta text DEFAULT '/')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid;
BEGIN
 IF auth.uid() IS NULL OR p_tipo NOT IN ('acceso','acceso_denegado','logout') THEN RAISE EXCEPTION 'Acceso no permitido'; END IF;
 INSERT INTO public.audit_log(actor_user_id,accion,tabla,detalles)
 VALUES(auth.uid(),p_tipo,'accesos_panel',jsonb_build_object('ruta',left(split_part(coalesce(p_ruta,'/'),'?',1),200),
  'resultado',CASE p_tipo WHEN 'acceso_denegado' THEN 'denegado' WHEN 'logout' THEN 'cierre_solicitado' ELSE 'sesion_validada' END,
  'identidad_verificada',true)) RETURNING id INTO v_id;
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.registrar_acceso_panel(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.registrar_acceso_panel(text,text) TO authenticated;
-- La identidad y los metadatos se resuelven en las RPC, no en INSERT público.
DROP POLICY IF EXISTS "cada usuario registra su propio acceso" ON public.audit_log;

-- Auditoría de todas las personas: sin filtro implícito por auth.uid(). La RLS
-- de lectura ya restringe el conjunto completo exclusivamente al super admin.
CREATE OR REPLACE FUNCTION public.listar_tablas_auditoria_panel()
RETURNS TABLE(tabla text) LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT DISTINCT CASE WHEN n.nspname='public' THEN c.relname ELSE n.nspname||'.'||c.relname END
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE t.tgfoid='public.fn_registrar_auditoria()'::regprocedure AND NOT t.tgisinternal AND t.tgenabled<>'D'
 AND EXISTS(SELECT 1 FROM public.super_admins WHERE user_id=auth.uid())
 UNION SELECT unnest(ARRAY['acciones_servidor','accesos_panel']) WHERE EXISTS(SELECT 1 FROM public.super_admins WHERE user_id=auth.uid()) ORDER BY 1;
$$;
-- Efecto externo del editor VAPI: conserva un único evento con el resultado
-- comunicado por el cliente. No permite etiquetar como CRUD ni elegir autor.
CREATE OR REPLACE FUNCTION public.auditar_prompt_vapi(p_evento uuid DEFAULT NULL,p_resultado text DEFAULT 'pendiente')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.super_admins WHERE user_id=auth.uid()) THEN RAISE EXCEPTION 'Solo super admin'; END IF;
 IF p_evento IS NULL THEN
   INSERT INTO public.audit_log(actor_user_id,accion,tabla,registro_id,detalles)
   VALUES(auth.uid(),'ejecutar','acciones_servidor','vapi_prompt',jsonb_build_object('operacion','editar_prompt_vapi','resultado','pendiente','origen','panel')) RETURNING id INTO v_id;
 ELSE
   IF p_resultado NOT IN ('completada','fallida') THEN RAISE EXCEPTION 'Resultado inválido'; END IF;
   UPDATE public.audit_log SET detalles=detalles||jsonb_build_object('resultado',p_resultado,'resultado_comunicado_por','cliente','finalizado_en',clock_timestamp())
   WHERE id=p_evento AND actor_user_id=auth.uid() AND registro_id='vapi_prompt' AND accion='ejecutar' AND detalles->>'resultado'='pendiente' RETURNING id INTO v_id;
   IF v_id IS NULL THEN RAISE EXCEPTION 'Evento no válido'; END IF;
 END IF;
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.auditar_prompt_vapi(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.auditar_prompt_vapi(uuid,text) TO authenticated;

-- Aplicar esta migración DESPUÉS de desplegar panel-auth.
CREATE OR REPLACE FUNCTION public.version_auditoria_panel()
RETURNS integer LANGUAGE sql STABLE AS $$ SELECT 2 $$;
GRANT EXECUTE ON FUNCTION public.version_auditoria_panel() TO anon,authenticated;
COMMIT;
