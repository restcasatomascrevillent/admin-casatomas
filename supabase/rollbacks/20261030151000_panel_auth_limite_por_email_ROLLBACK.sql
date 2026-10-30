-- ROLLBACK de migrations/20261030151000_panel_auth_limite_por_email.sql (CT-REM-FN-03).
-- A mano. Efecto: vuelve a limitar solo por IP (30/min); sin tope por email.
begin;
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
REVOKE ALL ON FUNCTION public.iniciar_intento_panel(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.iniciar_intento_panel(text,text) TO service_role;
drop index if exists public.idx_audit_log_accesos_panel_email;
commit;
