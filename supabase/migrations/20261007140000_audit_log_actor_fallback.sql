-- `auth.uid()` es NULL cuando quien escribe es un Edge Function conectada
-- con la service role key (admin-create-user, admin-delete-user,
-- admin-set-super-admin): esas conexiones no llevan el JWT del usuario, así
-- que no hay "usuario actual" en Postgres y las filas de auditoría quedaban
-- con actor "—" aunque sí sabíamos perfectamente quién las disparó (esas
-- funciones ya resuelven `currentUser` para comprobar permisos).
--
-- Arreglo: esas Edge Functions ahora mandan quién es el actor en dos
-- cabeceras HTTP propias (`x-audit-actor-id` / `x-audit-actor-email`) en el
-- cliente de service role que usan para escribir. PostgREST expone todas
-- las cabeceras de la petición en `current_setting('request.headers', true)`
-- (JSON), así que el trigger las lee de ahí cuando `auth.uid()` no basta.
CREATE OR REPLACE FUNCTION public.fn_registrar_auditoria()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_actor_email TEXT;
  v_registro_id TEXT;
  v_headers JSON;
BEGIN
  v_actor_id := auth.uid();

  IF v_actor_id IS NOT NULL THEN
    SELECT email INTO v_actor_email FROM auth.users WHERE id = v_actor_id;
  ELSE
    -- Conexión de service role (sin JWT): intenta la cabecera que mandan las
    -- Edge Functions admin-*. Cualquier fallo aquí (cabecera ausente, JSON
    -- raro, uuid inválido) deja el actor en NULL — nunca debe romper la
    -- escritura original por un problema de auditoría.
    BEGIN
      v_headers := current_setting('request.headers', true)::json;
      v_actor_id := NULLIF(v_headers ->> 'x-audit-actor-id', '')::uuid;
      v_actor_email := NULLIF(v_headers ->> 'x-audit-actor-email', '');
    EXCEPTION WHEN OTHERS THEN
      v_actor_id := NULL;
      v_actor_email := NULL;
    END;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_registro_id := (to_jsonb(OLD) ->> 'id');
    INSERT INTO public.audit_log (actor_user_id, actor_email, accion, tabla, registro_id, detalles)
    VALUES (v_actor_id, v_actor_email, 'eliminar', TG_TABLE_NAME, v_registro_id,
            jsonb_build_object('antes', to_jsonb(OLD)));
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    v_registro_id := (to_jsonb(NEW) ->> 'id');
    INSERT INTO public.audit_log (actor_user_id, actor_email, accion, tabla, registro_id, detalles)
    VALUES (v_actor_id, v_actor_email, 'actualizar', TG_TABLE_NAME, v_registro_id,
            jsonb_build_object('antes', to_jsonb(OLD), 'despues', to_jsonb(NEW)));
    RETURN NEW;
  ELSE
    v_registro_id := (to_jsonb(NEW) ->> 'id');
    INSERT INTO public.audit_log (actor_user_id, actor_email, accion, tabla, registro_id, detalles)
    VALUES (v_actor_id, v_actor_email, 'crear', TG_TABLE_NAME, v_registro_id,
            jsonb_build_object('despues', to_jsonb(NEW)));
    RETURN NEW;
  END IF;
END;
$$;
