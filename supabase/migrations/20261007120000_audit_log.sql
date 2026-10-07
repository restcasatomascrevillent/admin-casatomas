-- Auditoría del Admin Panel: quién entró (login/logout) y quién cambió qué
-- en las tablas de configuración y permisos sensibles. Solo lo lee el
-- super_admin (ver política de SELECT más abajo); el resto del personal no
-- tiene acceso a este rastro, ni falta que le hace para su trabajo diario.
CREATE TABLE public.audit_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  actor_user_id UUID,
  actor_email TEXT,
  accion TEXT NOT NULL CHECK (accion IN ('login', 'logout', 'crear', 'actualizar', 'eliminar')),
  tabla TEXT,
  registro_id TEXT,
  detalles JSONB,
  user_agent TEXT
);

COMMENT ON TABLE public.audit_log IS 'Rastro de auditoría del Admin Panel: accesos (login/logout, escritos por el cliente al iniciar/cerrar sesión) y cambios de datos (crear/actualizar/eliminar, escritos por fn_registrar_auditoria() vía trigger en las tablas sensibles — ver abajo). "detalles" guarda {antes, despues} en los cambios de datos y {user_agent} en los accesos. Sin paginación infinita pensada: una fila por evento, se lee desde /super-admin/auditoria con filtros.';

CREATE INDEX idx_audit_log_created_at ON public.audit_log(created_at DESC);
CREATE INDEX idx_audit_log_actor ON public.audit_log(actor_user_id);
CREATE INDEX idx_audit_log_tabla ON public.audit_log(tabla);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Solo super_admins leen el rastro completo.
CREATE POLICY "super_admins leen audit_log"
  ON public.audit_log
  FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.super_admins WHERE user_id = auth.uid()));

-- Cualquier usuario autenticado puede registrar SU PROPIO login/logout (lo
-- dispara el cliente justo al iniciar/cerrar sesión, ver src/hooks/useAuth.ts).
-- Los cambios de datos (crear/actualizar/eliminar) los escribe el trigger de
-- abajo, que es SECURITY DEFINER y por tanto no necesita (ni usa) esta
-- política para insertar.
CREATE POLICY "cada usuario registra su propio acceso"
  ON public.audit_log
  FOR INSERT
  TO authenticated
  WITH CHECK (accion IN ('login', 'logout') AND actor_user_id = auth.uid());

-- Trigger genérico de auditoría: se cuelga de cualquier tabla con
-- `AFTER INSERT OR UPDATE OR DELETE ... EXECUTE FUNCTION fn_registrar_auditoria()`
-- y registra quién hizo el cambio (auth.uid(), resuelto aquí porque la
-- función es SECURITY DEFINER y sí puede leer auth.users) y el antes/después
-- como JSON. No asume que la tabla tenga una columna `id`: si no la tiene,
-- `registro_id` queda NULL en vez de romper el trigger.
CREATE OR REPLACE FUNCTION public.fn_registrar_auditoria()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_email TEXT;
  v_registro_id TEXT;
BEGIN
  SELECT email INTO v_actor_email FROM auth.users WHERE id = auth.uid();

  IF TG_OP = 'DELETE' THEN
    v_registro_id := (to_jsonb(OLD) ->> 'id');
    INSERT INTO public.audit_log (actor_user_id, actor_email, accion, tabla, registro_id, detalles)
    VALUES (auth.uid(), v_actor_email, 'eliminar', TG_TABLE_NAME, v_registro_id,
            jsonb_build_object('antes', to_jsonb(OLD)));
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    v_registro_id := (to_jsonb(NEW) ->> 'id');
    INSERT INTO public.audit_log (actor_user_id, actor_email, accion, tabla, registro_id, detalles)
    VALUES (auth.uid(), v_actor_email, 'actualizar', TG_TABLE_NAME, v_registro_id,
            jsonb_build_object('antes', to_jsonb(OLD), 'despues', to_jsonb(NEW)));
    RETURN NEW;
  ELSE
    v_registro_id := (to_jsonb(NEW) ->> 'id');
    INSERT INTO public.audit_log (actor_user_id, actor_email, accion, tabla, registro_id, detalles)
    VALUES (auth.uid(), v_actor_email, 'crear', TG_TABLE_NAME, v_registro_id,
            jsonb_build_object('despues', to_jsonb(NEW)));
    RETURN NEW;
  END IF;
END;
$$;

-- Tablas con trigger: configuración y permisos sensibles, sin rastro propio
-- hasta ahora (precios de carta ya tienen su propio historial_precios /
-- historial_ajustes_precios — no se duplica aquí para no generar ruido).
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'user_roles', 'user_permissions', 'super_admins', 'admin_feature_toggles',
    'sell_users', 'configuracion_reservas', 'configuracion_web', 'configBotWeb',
    'chat_web_config', 'gdpr_config', 'dashboard_config', 'phone_system_config',
    'user_role_presets'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_auditoria AFTER INSERT OR UPDATE OR DELETE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.fn_registrar_auditoria();', t
    );
  END LOOP;
END $$;
