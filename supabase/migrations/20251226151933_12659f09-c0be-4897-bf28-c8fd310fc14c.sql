-- Eliminar el trigger que causa el error (referencia a tabla profiles que no existe)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Eliminar la función obsoleta
DROP FUNCTION IF EXISTS public.handle_new_user();

-- Crear nuevo trigger para asignar rol staff automáticamente a nuevos usuarios
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

-- Crear el nuevo trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_role();