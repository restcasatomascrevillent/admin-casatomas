-- Plantillas de roles para preconfigurar permisos reutilizables
CREATE TABLE IF NOT EXISTS public.user_role_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  base_role public.app_role NOT NULL DEFAULT 'staff',
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_role_presets_name_not_empty CHECK (char_length(trim(name)) > 0),
  CONSTRAINT user_role_presets_permissions_is_array CHECK (jsonb_typeof(permissions) = 'array'),
  CONSTRAINT user_role_presets_base_role_check CHECK (
    base_role IN ('manager'::public.app_role, 'staff'::public.app_role)
  )
);

ALTER TABLE public.user_role_presets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view role presets" ON public.user_role_presets;
CREATE POLICY "Admins can view role presets"
ON public.user_role_presets
FOR SELECT
TO authenticated
USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can create role presets" ON public.user_role_presets;
CREATE POLICY "Admins can create role presets"
ON public.user_role_presets
FOR INSERT
TO authenticated
WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can update role presets" ON public.user_role_presets;
CREATE POLICY "Admins can update role presets"
ON public.user_role_presets
FOR UPDATE
TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can delete role presets" ON public.user_role_presets;
CREATE POLICY "Admins can delete role presets"
ON public.user_role_presets
FOR DELETE
TO authenticated
USING (public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.set_user_role_presets_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_role_presets_updated_at ON public.user_role_presets;
CREATE TRIGGER trg_user_role_presets_updated_at
BEFORE UPDATE ON public.user_role_presets
FOR EACH ROW
EXECUTE FUNCTION public.set_user_role_presets_updated_at();
