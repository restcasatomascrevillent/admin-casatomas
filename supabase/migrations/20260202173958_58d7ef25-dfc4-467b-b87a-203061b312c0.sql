-- Tabla BebidasVENTA para productos de venta online
CREATE TABLE public."BebidasVENTA" (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  nombre text NOT NULL,
  categoria text,
  precio_eur double precision,
  descripcion text,
  imagen_url text,
  stock integer DEFAULT 0,
  activado boolean DEFAULT true,
  featured boolean DEFAULT false,
  orden integer,
  denominacion_origen text,
  ubicacion_pais text,
  ubicacion_region text,
  nombre_en text,
  nombre_fr text,
  descripcion_en text,
  descripcion_fr text,
  categoria_en text,
  categoria_fr text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Tabla ComidaVENTA para productos de venta online
CREATE TABLE public."ComidaVENTA" (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  nombre text NOT NULL,
  categoria text,
  precio_eur double precision,
  descripcion text,
  imagen_url text,
  stock integer DEFAULT 0,
  peso text,
  activado boolean DEFAULT true,
  featured boolean DEFAULT false,
  orden integer,
  origen text,
  nombre_en text,
  nombre_fr text,
  descripcion_en text,
  descripcion_fr text,
  categoria_en text,
  categoria_fr text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Habilitar RLS
ALTER TABLE public."BebidasVENTA" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ComidaVENTA" ENABLE ROW LEVEL SECURITY;

-- Políticas para BebidasVENTA
CREATE POLICY "Productos activados públicos" ON public."BebidasVENTA"
  FOR SELECT USING (activado = true);

CREATE POLICY "Usuarios autenticados ven todo" ON public."BebidasVENTA"
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Usuarios autenticados pueden insertar" ON public."BebidasVENTA"
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Usuarios autenticados pueden actualizar" ON public."BebidasVENTA"
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Usuarios autenticados pueden eliminar" ON public."BebidasVENTA"
  FOR DELETE TO authenticated USING (true);

-- Políticas para ComidaVENTA
CREATE POLICY "Productos activados públicos" ON public."ComidaVENTA"
  FOR SELECT USING (activado = true);

CREATE POLICY "Usuarios autenticados ven todo" ON public."ComidaVENTA"
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Usuarios autenticados pueden insertar" ON public."ComidaVENTA"
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Usuarios autenticados pueden actualizar" ON public."ComidaVENTA"
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Usuarios autenticados pueden eliminar" ON public."ComidaVENTA"
  FOR DELETE TO authenticated USING (true);

-- Bucket de storage para imágenes de ecommerce
INSERT INTO storage.buckets (id, name, public) VALUES ('ecommerce', 'ecommerce', true);

-- Políticas de storage
CREATE POLICY "Imágenes ecommerce públicas" ON storage.objects
  FOR SELECT USING (bucket_id = 'ecommerce');

CREATE POLICY "Usuarios autenticados suben imágenes ecommerce" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'ecommerce');

CREATE POLICY "Usuarios autenticados actualizan imágenes ecommerce" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'ecommerce');

CREATE POLICY "Usuarios autenticados eliminan imágenes ecommerce" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'ecommerce');

-- Triggers para updated_at
CREATE TRIGGER update_bebidas_venta_updated_at
  BEFORE UPDATE ON public."BebidasVENTA"
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_comida_venta_updated_at
  BEFORE UPDATE ON public."ComidaVENTA"
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();