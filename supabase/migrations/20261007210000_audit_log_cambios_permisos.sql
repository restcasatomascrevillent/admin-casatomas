-- Conceder, modificar o retirar accesos cambia los permisos de un usuario.
-- Un INSERT en user_permissions no representa la creación de un usuario.
BEGIN;

-- Estado efectivo del acceso; una fila ausente equivale a no ver/no editar.
-- Se conserva aparte el antes/después físico del registro para trazabilidad.
CREATE OR REPLACE FUNCTION public.fn_audit_estado_permiso(p_fila jsonb, p_referencia jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'user_id', coalesce(p_fila ->> 'user_id', p_referencia ->> 'user_id'),
    'section_key', coalesce(p_fila ->> 'section_key', p_referencia ->> 'section_key'),
    'can_view', coalesce((p_fila ->> 'can_view')::boolean, false)
                OR coalesce((p_fila ->> 'can_edit')::boolean, false),
    'can_edit', coalesce((p_fila ->> 'can_edit')::boolean, false)
  );
$$;

CREATE OR REPLACE FUNCTION public.fn_registrar_auditoria()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_email text;
  v_headers jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  v_row jsonb;
  v_antes jsonb;
  v_despues jsonb;
  v_permiso_antes jsonb;
  v_permiso_despues jsonb;
  v_subject_id uuid;
  v_subject_email text;
  v_accion text;
  v_detalles jsonb;
BEGIN
  v_antes := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END;
  v_despues := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END;
  IF TG_OP = 'UPDATE' AND (v_antes - ARRAY['created_at', 'updated_at'])
       IS NOT DISTINCT FROM (v_despues - ARRAY['created_at', 'updated_at']) THEN
    RETURN NEW;
  END IF;

  v_row := coalesce(v_despues, v_antes);
  -- La operación SQL se usa para recuperar el contexto de Auth; su acción
  -- de negocio se normaliza después. No perder el actor de altas/cascadas.
  v_accion := CASE TG_OP WHEN 'INSERT' THEN 'crear' WHEN 'DELETE' THEN 'eliminar' ELSE 'actualizar' END;
  IF v_actor_id IS NULL AND auth.role() = 'service_role' THEN
    v_actor_id := nullif(v_headers ->> 'x-audit-actor-id', '')::uuid;
  END IF;
  IF v_actor_id IS NULL AND session_user = 'supabase_auth_admin'
     AND TG_TABLE_NAME IN ('user_roles', 'user_permissions', 'super_admins', 'sell_users')
     AND TG_OP IN ('INSERT', 'DELETE') THEN
    v_subject_id := nullif(v_row ->> 'user_id', '')::uuid;
    SELECT email INTO v_subject_email FROM auth.users WHERE id = v_subject_id;
    SELECT c.actor_user_id, c.actor_email INTO v_actor_id, v_actor_email
    FROM public.audit_auth_context c
    WHERE c.operacion = v_accion AND c.expires_at >= clock_timestamp()
      AND (c.subject_user_id = v_subject_id
           OR (c.subject_user_id IS NULL AND lower(c.subject_email) = lower(v_subject_email)))
    ORDER BY c.expires_at DESC LIMIT 1;
  END IF;
  IF v_actor_id IS NOT NULL THEN
    SELECT coalesce(nullif(btrim(email), ''), v_actor_email) INTO v_actor_email
    FROM auth.users WHERE id = v_actor_id;
  END IF;

  v_detalles := CASE TG_OP
    WHEN 'DELETE' THEN jsonb_build_object('antes', v_antes)
    WHEN 'UPDATE' THEN jsonb_build_object('antes', v_antes, 'despues', v_despues)
    ELSE jsonb_build_object('despues', v_despues) END;

  IF TG_TABLE_NAME = 'user_permissions' THEN
    v_permiso_antes := public.fn_audit_estado_permiso(v_antes, v_row);
    v_permiso_despues := public.fn_audit_estado_permiso(v_despues, v_row);
    IF v_permiso_antes = v_permiso_despues THEN
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END IF;
    v_accion := 'actualizar';
    v_detalles := v_detalles || jsonb_build_object(
      'permiso_antes', v_permiso_antes,
      'permiso_despues', v_permiso_despues,
      'operacion_permiso', CASE TG_OP WHEN 'INSERT' THEN 'conceder' WHEN 'DELETE' THEN 'retirar' ELSE 'modificar' END
    );
  END IF;

  INSERT INTO public.audit_log (actor_user_id, actor_email, accion, tabla, registro_id, detalles)
  VALUES (v_actor_id, v_actor_email, v_accion, TG_TABLE_NAME,
          coalesce(v_row ->> 'id', v_row ->> 'user_id'), v_detalles);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

-- Corrige también las etiquetas de los cambios de permisos ya registrados,
-- conservando su ID, autor, fecha y snapshots originales. No elimina eventos.
UPDATE public.audit_log a
SET accion = 'actualizar',
    detalles = coalesce(a.detalles, '{}'::jsonb) || jsonb_build_object(
      'permiso_antes', public.fn_audit_estado_permiso(a.detalles -> 'antes', coalesce(a.detalles -> 'despues', a.detalles -> 'antes')),
      'permiso_despues', public.fn_audit_estado_permiso(a.detalles -> 'despues', coalesce(a.detalles -> 'despues', a.detalles -> 'antes')),
      'operacion_permiso', CASE a.accion WHEN 'crear' THEN 'conceder' WHEN 'eliminar' THEN 'retirar' ELSE 'modificar' END
    )
WHERE a.tabla = 'user_permissions';

COMMIT;
