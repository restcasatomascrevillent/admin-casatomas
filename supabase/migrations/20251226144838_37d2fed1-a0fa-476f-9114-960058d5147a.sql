-- Crear enum para roles
CREATE TYPE public.app_role AS ENUM ('admin', 'manager', 'staff');

-- Tabla de roles de usuario
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL DEFAULT 'staff',
  created_at timestamptz DEFAULT now(),
  UNIQUE (user_id, role)
);

-- Habilitar RLS
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Tabla de permisos granulares por sección
CREATE TABLE public.user_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  section_key text NOT NULL,
  can_view boolean DEFAULT false,
  can_edit boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (user_id, section_key)
);

-- Habilitar RLS
ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;

-- Función SECURITY DEFINER para verificar si es admin
CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = 'admin'
  )
$$;

-- Función SECURITY DEFINER para verificar permiso de sección
CREATE OR REPLACE FUNCTION public.has_section_permission(_user_id uuid, _section text, _permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    CASE WHEN public.is_admin(_user_id) THEN true
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
$$;

-- Función para obtener rol de usuario
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id uuid)
RETURNS app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.user_roles
  WHERE user_id = _user_id
  LIMIT 1
$$;

-- Políticas RLS para user_roles
CREATE POLICY "Admins pueden ver todos los roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins pueden crear roles"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins pueden actualizar roles"
ON public.user_roles
FOR UPDATE
TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins pueden eliminar roles"
ON public.user_roles
FOR DELETE
TO authenticated
USING (public.is_admin(auth.uid()));

CREATE POLICY "Usuarios pueden ver su propio rol"
ON public.user_roles
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Políticas RLS para user_permissions
CREATE POLICY "Admins pueden ver todos los permisos"
ON public.user_permissions
FOR SELECT
TO authenticated
USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins pueden crear permisos"
ON public.user_permissions
FOR INSERT
TO authenticated
WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins pueden actualizar permisos"
ON public.user_permissions
FOR UPDATE
TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins pueden eliminar permisos"
ON public.user_permissions
FOR DELETE
TO authenticated
USING (public.is_admin(auth.uid()));

CREATE POLICY "Usuarios pueden ver sus propios permisos"
ON public.user_permissions
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Asignar al usuario existente como admin
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::app_role
FROM auth.users
WHERE email = 'miguelbenito2003@gmail.com'
ON CONFLICT (user_id, role) DO NOTHING;