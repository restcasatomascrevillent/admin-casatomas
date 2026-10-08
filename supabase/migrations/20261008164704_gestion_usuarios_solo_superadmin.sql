-- El panel normal conserva la consulta. Toda escritura de usuarios, roles
-- y permisos queda reservada a superadmins; no cambia ningún acceso asignado.
BEGIN;

DROP POLICY IF EXISTS "Admins pueden crear roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins pueden actualizar roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins pueden eliminar roles" ON public.user_roles;
CREATE POLICY "Super admins pueden crear roles" ON public.user_roles
  FOR INSERT TO authenticated WITH CHECK ((select public.is_super_admin(auth.uid())));
CREATE POLICY "Super admins pueden actualizar roles" ON public.user_roles
  FOR UPDATE TO authenticated USING ((select public.is_super_admin(auth.uid())))
  WITH CHECK ((select public.is_super_admin(auth.uid())));
CREATE POLICY "Super admins pueden eliminar roles" ON public.user_roles
  FOR DELETE TO authenticated USING ((select public.is_super_admin(auth.uid())));

DROP POLICY IF EXISTS "Admins can create role presets" ON public.user_role_presets;
DROP POLICY IF EXISTS "Admins can update role presets" ON public.user_role_presets;
DROP POLICY IF EXISTS "Admins can delete role presets" ON public.user_role_presets;
CREATE POLICY "Super admins can create role presets" ON public.user_role_presets
  FOR INSERT TO authenticated WITH CHECK ((select public.is_super_admin(auth.uid())));
CREATE POLICY "Super admins can update role presets" ON public.user_role_presets
  FOR UPDATE TO authenticated USING ((select public.is_super_admin(auth.uid())))
  WITH CHECK ((select public.is_super_admin(auth.uid())));
CREATE POLICY "Super admins can delete role presets" ON public.user_role_presets
  FOR DELETE TO authenticated USING ((select public.is_super_admin(auth.uid())));

-- SELECT también para un superadmin que no tenga un rol admin adicional.
CREATE POLICY "Super admins pueden consultar roles" ON public.user_roles
  FOR SELECT TO authenticated USING ((select public.is_super_admin(auth.uid())));
CREATE POLICY "Super admins pueden consultar permisos" ON public.user_permissions
  FOR SELECT TO authenticated USING ((select public.is_super_admin(auth.uid())));
CREATE POLICY "Super admins pueden consultar roles preconfigurados" ON public.user_role_presets
  FOR SELECT TO authenticated USING ((select public.is_super_admin(auth.uid())));

COMMIT;
