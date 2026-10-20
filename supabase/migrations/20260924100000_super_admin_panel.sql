-- ============================================================================
-- NO APLICADA — hay que ejecutarla manualmente contra Supabase
-- ============================================================================
--
-- Esta sesión no tiene ni debe usar credenciales de Supabase, así que esta
-- migración se entrega escrita pero SIN aplicar. Alguien con acceso al
-- proyecto debe correrla (supabase db push o el flujo habitual del repo)
-- antes de que el código del Super Admin (botón de engranaje en el sidebar,
-- /super-admin/*) funcione: hasta entonces, useSuperAdmin() y
-- useAdminFeatureToggles() fallan silenciosamente en modo "fail open" para
-- los toggles (todo visible) y "fail closed" para el acceso de super admin
-- (nadie entra), así que el resto del Admin Panel sigue funcionando igual.
--
-- Qué crea:
--   1. public.super_admins — quién puede entrar a /super-admin. Alta y baja
--      manuales por SQL (service role), sin autoservicio ni panel propio:
--      así un super admin no puede añadir a otro por error ni por un bug.
--   2. public.admin_feature_toggles — qué secciones del Admin Panel normal
--      están activas en el sidebar. Lectura para cualquier autenticado
--      (hace falta para pintar el sidebar), escritura solo para super admins.
--
-- No toca la estructura de user_roles/user_permissions ni ninguna política de
-- la Fase 2 de RLS (20260918120000_rls_por_permisos_de_seccion.sql): el
-- super admin es un nivel de acceso aparte, por encima de is_admin(), no un
-- reemplazo. Sí inserta una fila en user_roles (ver el INSERT al final): a
-- pablitocandela15@gmail.com se le da también rol 'admin' del Admin Panel
-- normal, no solo acceso a /super-admin.
-- ============================================================================

-- Tabla de super administradores (gestión manual vía SQL, no autoservicio)
CREATE TABLE public.super_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.super_admins ENABLE ROW LEVEL SECURITY;

-- Función SECURITY DEFINER para verificar si un usuario es super admin
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.super_admins
    WHERE user_id = _user_id
  )
$$;

-- Un super admin puede ver la lista completa de super admins
CREATE POLICY "Super admins pueden ver todos los super admins"
ON public.super_admins
FOR SELECT
TO authenticated
USING (public.is_super_admin(auth.uid()));

-- Cualquier usuario autenticado puede comprobar si su propia cuenta es super admin
CREATE POLICY "Usuario puede verificar su propio acceso de super admin"
ON public.super_admins
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- No se exponen políticas de INSERT/UPDATE/DELETE: el alta/baja de super
-- admins se gestiona manualmente por SQL (service role) para máxima seguridad.

-- Tabla de funcionalidades activables/desactivables del Admin Panel
CREATE TABLE public.admin_feature_toggles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_key text NOT NULL UNIQUE,
  label text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

ALTER TABLE public.admin_feature_toggles ENABLE ROW LEVEL SECURITY;

-- Cualquier usuario autenticado necesita leer los toggles para pintar el sidebar
CREATE POLICY "Usuarios autenticados pueden leer las funcionalidades"
ON public.admin_feature_toggles
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Super admins pueden crear funcionalidades"
ON public.admin_feature_toggles
FOR INSERT
TO authenticated
WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "Super admins pueden actualizar funcionalidades"
ON public.admin_feature_toggles
FOR UPDATE
TO authenticated
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "Super admins pueden eliminar funcionalidades"
ON public.admin_feature_toggles
FOR DELETE
TO authenticated
USING (public.is_super_admin(auth.uid()));

-- Seed inicial: secciones que permanecen en el Admin Panel normal
-- (dashboard queda fuera a propósito: nunca debe poder desactivarse)
INSERT INTO public.admin_feature_toggles (section_key, label, enabled) VALUES
  ('reservas', 'Reservas', true),
  ('espacios', 'Espacios', true),
  ('gestion_web', 'Gestor Web', true),
  ('marketing', 'Newsletter', true),
  ('facturas', 'Facturas', true),
  ('usuarios', 'Usuarios', true)
ON CONFLICT (section_key) DO NOTHING;

-- Otorga acceso de super admin al propietario existente del sistema y a la
-- cuenta pedida explícitamente (pablitocandela15@gmail.com). Solo enlaza
-- emails que YA existan en auth.users: si la cuenta de Supabase (login +
-- contraseña) todavía no se creó, esta fila simplemente no se inserta y hay
-- que volver a correr este INSERT después de crearla.
INSERT INTO public.super_admins (user_id, email)
SELECT id, email
FROM auth.users
WHERE email IN ('miguelbenito2003@gmail.com', 'pablitocandela15@gmail.com')
ON CONFLICT (email) DO NOTHING;

-- Además del Super Admin, pablitocandela15@gmail.com entra también como
-- 'admin' en user_roles (misma tabla y mismo rol con el que ya se sembró a
-- miguelbenito2003@gmail.com en 20251226144838): es lo que le da acceso
-- completo al Admin Panel normal (is_admin() true, bypassea todo
-- user_permissions). Sin esta fila, la cuenta solo entraría a /super-admin
-- y no vería nada del sidebar normal salvo lo que un futuro admin le
-- conceda a mano en Usuarios → Permisos.
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::app_role
FROM auth.users
WHERE email = 'pablitocandela15@gmail.com'
ON CONFLICT (user_id, role) DO NOTHING;
