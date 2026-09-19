-- Reconstruida desde supabase_migrations.schema_migrations (version 20260130071756).
-- Se aplico directamente sobre el proyecto (dashboard / MCP) y nunca se exporto a
-- este repositorio, lo que dejaba a `supabase db push` con una fila de historial sin
-- fichero local ('Remote migration versions not found in local migrations directory').
-- YA ESTA APLICADA: db push no la ejecuta. Existe para que `db reset` / una branch
-- nueva reproduzcan el esquema real. No editar a mano.

-- Crear tabla carrito
CREATE TABLE public.carrito (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  producto_id TEXT NOT NULL,
  producto_tipo TEXT NOT NULL DEFAULT 'vino',
  cantidad INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT carrito_cantidad_check CHECK (cantidad > 0),
  CONSTRAINT carrito_producto_tipo_check CHECK (producto_tipo IN ('vino', 'bebida', 'plato', 'coctel'))
);

-- Crear índices para carrito
CREATE INDEX idx_carrito_user_id ON public.carrito(user_id);
CREATE INDEX idx_carrito_producto ON public.carrito(producto_tipo, producto_id);
CREATE UNIQUE INDEX idx_carrito_unique_item ON public.carrito(user_id, producto_tipo, producto_id);

-- Habilitar RLS en carrito
ALTER TABLE public.carrito ENABLE ROW LEVEL SECURITY;

-- Políticas RLS para carrito
CREATE POLICY "Usuarios pueden ver su propio carrito"
ON public.carrito FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Usuarios pueden añadir a su carrito"
ON public.carrito FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Usuarios pueden actualizar su carrito"
ON public.carrito FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Usuarios pueden eliminar de su carrito"
ON public.carrito FOR DELETE
USING (auth.uid() = user_id);

-- Trigger para actualizar updated_at en carrito
CREATE TRIGGER update_carrito_updated_at
BEFORE UPDATE ON public.carrito
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Crear tabla favoritos
CREATE TABLE public.favoritos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  producto_id TEXT NOT NULL,
  producto_tipo TEXT NOT NULL DEFAULT 'vino',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT favoritos_producto_tipo_check CHECK (producto_tipo IN ('vino', 'bebida', 'plato', 'coctel'))
);

-- Crear índices para favoritos
CREATE INDEX idx_favoritos_user_id ON public.favoritos(user_id);
CREATE INDEX idx_favoritos_producto ON public.favoritos(producto_tipo, producto_id);
CREATE UNIQUE INDEX idx_favoritos_unique_item ON public.favoritos(user_id, producto_tipo, producto_id);

-- Habilitar RLS en favoritos
ALTER TABLE public.favoritos ENABLE ROW LEVEL SECURITY;

-- Políticas RLS para favoritos
CREATE POLICY "Usuarios pueden ver sus propios favoritos"
ON public.favoritos FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Usuarios pueden añadir a favoritos"
ON public.favoritos FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Usuarios pueden eliminar de favoritos"
ON public.favoritos FOR DELETE
USING (auth.uid() = user_id);
