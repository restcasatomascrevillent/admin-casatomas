-- Ser "admin" ya no da acceso automático a todas las secciones: ahora un
-- admin solo ve lo que le marquen sus permisos en user_permissions, igual
-- que un manager o un staff. El único acceso incondicional que queda es el
-- de super admin (tabla super_admins), consistente con SuperAdminRoute y con
-- la función admin-set-super-admin.
CREATE OR REPLACE FUNCTION public.has_section_permission(_user_id uuid, _section text, _permission text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    CASE WHEN public.is_super_admin(_user_id) THEN true
    ELSE EXISTS (
      SELECT 1 FROM public.user_permissions
      WHERE user_id = _user_id
        AND section_key = _section
        AND (
          (_permission = 'view' AND can_view = true) OR
          (_permission = 'edit' AND can_edit = true)
        )
    )
    END
$function$;

-- Si cualquier admin pudiera seguir escribiendo user_permissions, un admin
-- restringido podría auto-concederse permisos y anular la restricción de
-- arriba. Solo un super admin puede editar permisos de ahora en adelante.
DROP POLICY IF EXISTS "Admins pueden crear permisos" ON public.user_permissions;
CREATE POLICY "Super admins pueden crear permisos" ON public.user_permissions
  FOR INSERT
  WITH CHECK (is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins pueden actualizar permisos" ON public.user_permissions;
CREATE POLICY "Super admins pueden actualizar permisos" ON public.user_permissions
  FOR UPDATE
  USING (is_super_admin(auth.uid()))
  WITH CHECK (is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins pueden eliminar permisos" ON public.user_permissions;
CREATE POLICY "Super admins pueden eliminar permisos" ON public.user_permissions
  FOR DELETE
  USING (is_super_admin(auth.uid()));
