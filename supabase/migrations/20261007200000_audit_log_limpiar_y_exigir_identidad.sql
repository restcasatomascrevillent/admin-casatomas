-- Borrado completo solicitado por el propietario. No conserva históricos.
-- Instala primero la validación y vacía la tabla dentro de una transacción:
-- ningún escritor puede insertar entre la limpieza y la nueva protección.
BEGIN;
LOCK TABLE public.audit_log IN ACCESS EXCLUSIVE MODE;

CREATE OR REPLACE FUNCTION public.fn_identificar_actor_auditoria()
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
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Auditoría: el usuario responsable no existe; operación cancelada'
        USING ERRCODE = '28000';
    END IF;
    -- El email recibido por HTTP nunca se usa como prueba de identidad.
    NEW.actor_email := nullif(btrim(v_email), '');
    NEW.actor_origin := 'usuario';
    NEW.actor_label := coalesce(NEW.actor_email, 'Usuario · ' || NEW.actor_user_id::text);
  ELSIF v_role = 'service_role' THEN
    v_source := nullif(btrim(v_headers ->> 'x-audit-source'), '');
    IF v_source IS NULL OR v_source IN ('admin-create-user', 'admin-delete-user', 'admin-set-super-admin') THEN
      RAISE EXCEPTION 'Auditoría: falta el usuario responsable o la identidad del proceso; operación cancelada'
        USING ERRCODE = '28000';
    END IF;
    NEW.actor_email := NULL;
    NEW.actor_origin := 'servicio';
    NEW.actor_label := 'API · service_role · ' || v_source;
  ELSIF v_role IS NULL AND session_user NOT IN ('supabase_auth_admin', 'authenticator', 'anon', 'authenticated', 'service_role') THEN
    -- Una conexión SQL directa tiene una cuenta de base de datos concreta.
    -- current_user sería el dueño de SECURITY DEFINER: se usa session_user.
    NEW.actor_email := NULL;
    NEW.actor_origin := 'base_de_datos';
    NEW.actor_label := 'Base de datos · ' || session_user;
  ELSE
    -- GoTrue requiere el contexto con el administrador iniciador. No se
    -- permite sustituirlo por una etiqueta genérica de sistema. Las sesiones
    -- anónimas y las sesiones autenticadas sin UUID válido también se rechazan.
    RAISE EXCEPTION 'Auditoría: no se ha identificado al responsable; operación cancelada'
      USING ERRCODE = '28000';
  END IF;

  IF NEW.accion IN ('login', 'logout') AND NEW.actor_origin <> 'usuario' THEN
    RAISE EXCEPTION 'Auditoría: un acceso necesita un usuario identificado'
      USING ERRCODE = '28000';
  END IF;
  RETURN NEW;
END;
$$;

DELETE FROM public.audit_log;

-- Tras vaciar el histórico, ninguna fila futura puede ser un histórico
-- sin autor ni tener una identidad vacía. Los checks no dependen del cliente.
ALTER TABLE public.audit_log
  ADD CONSTRAINT audit_log_solo_identidades_verificadas
  CHECK (
    actor_origin IN ('usuario', 'servicio', 'base_de_datos')
    AND btrim(actor_label) <> ''
    AND (actor_origin <> 'usuario' OR actor_user_id IS NOT NULL)
  );
COMMENT ON CONSTRAINT audit_log_solo_identidades_verificadas ON public.audit_log
  IS 'La auditoría exige un usuario existente, un proceso de servicio identificado o una cuenta SQL directa. Si no se puede identificar, se cancela la operación original.';
COMMIT;

-- Comprobación inmediata: los tres contadores deben devolver 0.
SELECT
  count(*) AS registros_restantes,
  count(*) FILTER (WHERE actor_label IS NULL OR btrim(actor_label) = '') AS sin_identidad,
  count(*) FILTER (WHERE actor_origin = 'historico') AS historicos_sin_autor
FROM public.audit_log;
