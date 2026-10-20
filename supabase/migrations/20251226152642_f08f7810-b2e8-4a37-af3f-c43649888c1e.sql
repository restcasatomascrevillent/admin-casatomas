-- Primero, eliminar duplicados si existen (mantener solo el primer rol por usuario)
DELETE FROM public.user_roles a
USING public.user_roles b
WHERE a.id > b.id AND a.user_id = b.user_id;

-- Eliminar el constraint actual UNIQUE(user_id, role)
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_user_id_role_key;

-- Añadir nuevo constraint UNIQUE(user_id) para un solo rol por usuario
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_user_id_key UNIQUE (user_id);

-- Recrear la función del trigger con el ON CONFLICT correcto
CREATE OR REPLACE FUNCTION public.handle_new_user_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Insertar rol por defecto "staff" para nuevos usuarios
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'staff')
  ON CONFLICT (user_id) DO NOTHING;
  
  -- Insertar permisos básicos (solo dashboard con vista)
  INSERT INTO public.user_permissions (user_id, section_key, can_view, can_edit)
  VALUES (NEW.id, 'dashboard', true, false)
  ON CONFLICT (user_id, section_key) DO NOTHING;
  
  RETURN NEW;
END;
$$;