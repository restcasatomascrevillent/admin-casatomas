-- Contrato de seguridad de la gestión de usuarios. No modifica datos.
DO $$
DECLARE
  tabla text;
  operacion text;
BEGIN
  FOREACH tabla IN ARRAY ARRAY['user_roles', 'user_permissions', 'user_role_presets'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = tabla AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'Falta RLS en %', tabla;
    END IF;
    FOREACH operacion IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE'] LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = tabla AND cmd = operacion) THEN
        RAISE EXCEPTION 'Falta política de % en %', operacion, tabla;
      END IF;
    END LOOP;
    IF EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = tabla AND cmd <> 'SELECT'
      AND (
        (cmd IN ('ALL', 'UPDATE', 'DELETE') AND (qual IS NULL OR qual NOT LIKE '%is_super_admin(auth.uid())%' OR qual LIKE '%is_admin(%'))
        OR (cmd IN ('ALL', 'INSERT', 'UPDATE') AND (with_check IS NULL OR with_check NOT LIKE '%is_super_admin(auth.uid())%' OR with_check LIKE '%is_admin(%'))
      )
    ) THEN
      RAISE EXCEPTION 'Hay escrituras disponibles fuera de superadmin en %', tabla;
    END IF;
  END LOOP;
END $$;
