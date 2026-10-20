-- Reconstruida desde supabase_migrations.schema_migrations (version 20260130070827).
-- Se aplico directamente sobre el proyecto (dashboard / MCP) y nunca se exporto a
-- este repositorio, lo que dejaba a `supabase db push` con una fila de historial sin
-- fichero local ('Remote migration versions not found in local migrations directory').
-- YA ESTA APLICADA: db push no la ejecuta. Existe para que `db reset` / una branch
-- nueva reproduzcan el esquema real. No editar a mano.

-- Tabla de perfiles para usuarios de la tienda (los hashes de contraseña los maneja Supabase Auth automáticamente)
CREATE TABLE public.sell_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
    nombre TEXT,
    apellidos TEXT,
    telefono TEXT,
    direccion TEXT,
    ciudad TEXT,
    codigo_postal TEXT,
    pais TEXT DEFAULT 'España',
    fecha_nacimiento DATE,
    acepta_marketing BOOLEAN DEFAULT false,
    avatar_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Habilitar RLS
ALTER TABLE public.sell_users ENABLE ROW LEVEL SECURITY;

-- Políticas RLS
CREATE POLICY "Los usuarios pueden ver su propio perfil"
ON public.sell_users FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden actualizar su propio perfil"
ON public.sell_users FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden crear su propio perfil"
ON public.sell_users FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Trigger para actualizar updated_at
CREATE OR REPLACE FUNCTION public.update_sell_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER update_sell_users_updated_at
BEFORE UPDATE ON public.sell_users
FOR EACH ROW
EXECUTE FUNCTION public.update_sell_users_updated_at();

-- Función para crear perfil automáticamente al registrarse
CREATE OR REPLACE FUNCTION public.handle_new_sell_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.sell_users (user_id)
    VALUES (NEW.id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Trigger para crear perfil automáticamente
CREATE TRIGGER on_auth_user_created_sell
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_sell_user();
