-- Conserva la identidad del actor, incluida la creación/baja vía GoTrue:
-- las cabeceras del cliente administrativo no llegan a sus cascadas SQL.
-- No se atribuyen cambios al user_id del registro: ese es el destinatario.
CREATE TABLE public.audit_auth_context (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL,
  actor_email text,
  operacion text NOT NULL CHECK (operacion IN ('crear', 'eliminar')),
  subject_user_id uuid,
  subject_email text,
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp() + interval '2 minutes',
  CHECK (subject_user_id IS NOT NULL OR nullif(btrim(subject_email), '') IS NOT NULL)
);
ALTER TABLE public.audit_auth_context ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_auth_context FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.audit_auth_context TO service_role;
CREATE UNIQUE INDEX audit_auth_context_subject_id ON public.audit_auth_context (subject_user_id);
CREATE UNIQUE INDEX audit_auth_context_subject_email ON public.audit_auth_context (lower(subject_email));

CREATE FUNCTION public.preparar_contexto_auditoria_auth(
  p_actor_id uuid, p_operacion text, p_user_id uuid DEFAULT NULL, p_email text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_email text;
  v_id uuid;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = p_actor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El actor de la operación debe ser un usuario existente';
  END IF;
  DELETE FROM public.audit_auth_context WHERE expires_at < clock_timestamp();
  INSERT INTO public.audit_auth_context (actor_user_id, actor_email, operacion, subject_user_id, subject_email)
  VALUES (p_actor_id, v_email, p_operacion, p_user_id, lower(nullif(btrim(p_email), '')))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.preparar_contexto_auditoria_auth(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preparar_contexto_auditoria_auth(uuid, text, uuid, text) TO service_role;

ALTER TABLE public.audit_log ADD COLUMN actor_label text;
ALTER TABLE public.audit_log ADD COLUMN actor_origin text;

-- Recuperación solo con pruebas: el UUID del actor o su email ya guardado.
-- Los registros sin ninguno conservan una referencia histórica individual;
-- nunca se les inventa un autor ni se clasifican como automáticos.
UPDATE public.audit_log a
SET actor_email = coalesce(
  nullif(btrim(a.actor_email), ''),
  (SELECT nullif(btrim(u.email), '') FROM auth.users u WHERE u.id = a.actor_user_id),
  (SELECT nullif(btrim(h.actor_email), '') FROM public.audit_log h
   WHERE h.actor_user_id = a.actor_user_id AND nullif(btrim(h.actor_email), '') IS NOT NULL
   ORDER BY h.created_at DESC, h.id LIMIT 1)
);
UPDATE public.audit_log
SET actor_origin = CASE WHEN actor_user_id IS NOT NULL OR actor_email IS NOT NULL THEN 'usuario' ELSE 'historico' END,
    actor_label = coalesce(actor_email, 'Usuario · ' || actor_user_id::text, 'Registro histórico · ' || id::text);

CREATE OR REPLACE FUNCTION public.fn_registrar_auditoria()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_email text;
  v_headers jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  v_row jsonb;
  v_subject_id uuid;
  v_subject_email text;
  v_accion text;
  v_detalles jsonb;
BEGIN
  v_row := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  v_accion := CASE TG_OP WHEN 'INSERT' THEN 'crear' WHEN 'DELETE' THEN 'eliminar' ELSE 'actualizar' END;

  -- Solo la conexión privilegiada puede aportar estas cabeceras. Un cliente
  -- anónimo/autenticado no puede suplantar otro actor con una cabecera HTTP.
  IF v_actor_id IS NULL AND auth.role() = 'service_role' THEN
    v_actor_id := nullif(v_headers ->> 'x-audit-actor-id', '')::uuid;
  END IF;

  -- Alta/baja de Auth: sus triggers y cascadas usan supabase_auth_admin,
  -- sin JWT del iniciador. Contexto breve creado por la Edge Function.
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
    WHEN 'DELETE' THEN jsonb_build_object('antes', to_jsonb(OLD))
    WHEN 'UPDATE' THEN jsonb_build_object('antes', to_jsonb(OLD), 'despues', to_jsonb(NEW))
    ELSE jsonb_build_object('despues', to_jsonb(NEW)) END;
  INSERT INTO public.audit_log (actor_user_id, actor_email, accion, tabla, registro_id, detalles)
  VALUES (v_actor_id, v_actor_email, v_accion, TG_TABLE_NAME,
          coalesce(v_row ->> 'id', v_row ->> 'user_id'), v_detalles);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

-- Normaliza TODOS los inserts, incluidos login/logout. La identidad de una
-- sesión autenticada se obtiene en servidor, no del email enviado por JS.
CREATE FUNCTION public.fn_identificar_actor_auditoria()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_email text;
  v_role text := nullif(auth.role(), '');
  v_headers jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  v_source text;
BEGIN
  IF auth.uid() IS NOT NULL THEN NEW.actor_user_id := auth.uid(); END IF;
  IF NEW.actor_user_id IS NOT NULL THEN
    SELECT email INTO v_email FROM auth.users WHERE id = NEW.actor_user_id;
    NEW.actor_email := coalesce(nullif(btrim(v_email), ''), nullif(btrim(NEW.actor_email), ''));
    NEW.actor_origin := 'usuario';
    NEW.actor_label := coalesce(NEW.actor_email, 'Usuario · ' || NEW.actor_user_id::text);
  ELSE
    NEW.actor_email := NULL;
    NEW.actor_origin := CASE WHEN v_role IS NULL THEN 'base_de_datos' ELSE 'servicio' END;
    v_source := CASE WHEN v_role = 'service_role' THEN nullif(btrim(v_headers ->> 'x-audit-source'), '') END;
    NEW.actor_label := CASE WHEN v_role IS NULL THEN 'Base de datos · ' || session_user
      ELSE 'API · ' || v_role || coalesce(' · ' || v_source, '') END;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_identificar_actor_auditoria BEFORE INSERT ON public.audit_log
FOR EACH ROW EXECUTE FUNCTION public.fn_identificar_actor_auditoria();

ALTER TABLE public.audit_log ALTER COLUMN actor_label SET NOT NULL;
ALTER TABLE public.audit_log ALTER COLUMN actor_origin SET NOT NULL;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_actor_label_no_vacio CHECK (btrim(actor_label) <> '');
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_actor_origin_valido
  CHECK (actor_origin IN ('usuario', 'servicio', 'base_de_datos', 'historico'));
COMMENT ON COLUMN public.audit_log.actor_label IS 'Identidad persistente del usuario o de la conexión que ejecutó la acción. Los históricos sin evidencia de autor conservan su ID y se distinguen explícitamente.';
