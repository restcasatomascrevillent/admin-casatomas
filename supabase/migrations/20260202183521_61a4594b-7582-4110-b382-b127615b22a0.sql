-- =============================================
-- TABLAS ECOMMERCE COMPLETAS
-- =============================================

-- 1. Tabla de pedidos
CREATE TABLE public.pedidos_ecommerce (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_pedido TEXT UNIQUE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  
  -- Datos cliente
  email TEXT,
  telefono TEXT,
  nombre_completo TEXT,
  
  -- Direccion envio
  direccion_envio TEXT,
  ciudad_envio TEXT,
  codigo_postal_envio TEXT,
  pais_envio TEXT DEFAULT 'España',
  
  -- Importes
  subtotal NUMERIC(10,2) NOT NULL DEFAULT 0,
  gastos_envio NUMERIC(10,2) DEFAULT 0,
  descuento NUMERIC(10,2) DEFAULT 0,
  iva NUMERIC(10,2) DEFAULT 0,
  total NUMERIC(10,2) NOT NULL DEFAULT 0,
  
  -- Estado
  estado TEXT DEFAULT 'pendiente',
  
  -- Pago
  metodo_pago TEXT,
  referencia_pago TEXT,
  pagado BOOLEAN DEFAULT false,
  fecha_pago TIMESTAMPTZ,
  
  -- Envio
  transportista TEXT,
  numero_seguimiento TEXT,
  fecha_envio TIMESTAMPTZ,
  fecha_entrega TIMESTAMPTZ,
  
  -- Notas
  notas_cliente TEXT,
  notas_internas TEXT,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Lineas de pedido
CREATE TABLE public.lineas_pedido (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id UUID REFERENCES public.pedidos_ecommerce(id) ON DELETE CASCADE NOT NULL,
  producto_id TEXT NOT NULL,
  producto_tipo TEXT NOT NULL,
  nombre_producto TEXT NOT NULL,
  cantidad INTEGER NOT NULL DEFAULT 1,
  precio_unitario NUMERIC(10,2) NOT NULL,
  total_linea NUMERIC(10,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Movimientos de stock
CREATE TABLE public.movimientos_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id TEXT NOT NULL,
  producto_tipo TEXT NOT NULL,
  tipo_movimiento TEXT NOT NULL,
  cantidad INTEGER NOT NULL,
  stock_anterior INTEGER,
  stock_nuevo INTEGER,
  motivo TEXT,
  referencia TEXT,
  usuario_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Configuracion alertas stock
CREATE TABLE public.alertas_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id TEXT NOT NULL,
  producto_tipo TEXT NOT NULL,
  stock_minimo INTEGER DEFAULT 5,
  notificar_email BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(producto_id, producto_tipo)
);

-- 5. Visitas a productos (analytics)
CREATE TABLE public.visitas_producto (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id TEXT NOT NULL,
  producto_tipo TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id TEXT,
  ip_address TEXT,
  user_agent TEXT,
  referer TEXT,
  pais TEXT,
  ciudad TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- =============================================
-- INDICES
-- =============================================
CREATE INDEX idx_pedidos_estado ON public.pedidos_ecommerce(estado);
CREATE INDEX idx_pedidos_fecha ON public.pedidos_ecommerce(created_at);
CREATE INDEX idx_pedidos_user ON public.pedidos_ecommerce(user_id);
CREATE INDEX idx_lineas_pedido ON public.lineas_pedido(pedido_id);
CREATE INDEX idx_movimientos_producto ON public.movimientos_stock(producto_id, producto_tipo);
CREATE INDEX idx_visitas_producto ON public.visitas_producto(producto_id, producto_tipo);
CREATE INDEX idx_visitas_fecha ON public.visitas_producto(created_at);

-- =============================================
-- TRIGGERS
-- =============================================
CREATE TRIGGER update_pedidos_updated_at
  BEFORE UPDATE ON public.pedidos_ecommerce
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_alertas_stock_updated_at
  BEFORE UPDATE ON public.alertas_stock
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- RLS POLICIES
-- =============================================

-- Pedidos
ALTER TABLE public.pedidos_ecommerce ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins pueden ver todos los pedidos"
  ON public.pedidos_ecommerce FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins pueden insertar pedidos"
  ON public.pedidos_ecommerce FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins pueden actualizar pedidos"
  ON public.pedidos_ecommerce FOR UPDATE
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins pueden eliminar pedidos"
  ON public.pedidos_ecommerce FOR DELETE
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- Lineas pedido
ALTER TABLE public.lineas_pedido ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins pueden ver lineas pedido"
  ON public.lineas_pedido FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins pueden gestionar lineas pedido"
  ON public.lineas_pedido FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- Movimientos stock
ALTER TABLE public.movimientos_stock ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins pueden ver movimientos stock"
  ON public.movimientos_stock FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins pueden gestionar movimientos stock"
  ON public.movimientos_stock FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- Alertas stock
ALTER TABLE public.alertas_stock ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins pueden ver alertas stock"
  ON public.alertas_stock FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins pueden gestionar alertas stock"
  ON public.alertas_stock FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- Visitas producto (público para insertar, solo admins para ver)
ALTER TABLE public.visitas_producto ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Cualquiera puede registrar visitas"
  ON public.visitas_producto FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Admins pueden ver visitas"
  ON public.visitas_producto FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- =============================================
-- VISTAS PARA ANALYTICS
-- =============================================

CREATE OR REPLACE VIEW public.vista_ventas_diarias WITH (security_invoker = on) AS
SELECT 
  DATE(created_at) as fecha,
  COUNT(*) as num_pedidos,
  SUM(total) as total_ventas,
  AVG(total) as ticket_medio
FROM public.pedidos_ecommerce
WHERE estado NOT IN ('cancelado', 'devuelto')
GROUP BY DATE(created_at);

CREATE OR REPLACE VIEW public.vista_productos_vendidos WITH (security_invoker = on) AS
SELECT 
  lp.producto_id,
  lp.producto_tipo,
  lp.nombre_producto,
  SUM(lp.cantidad) as unidades_vendidas,
  SUM(lp.total_linea) as total_ingresos
FROM public.lineas_pedido lp
JOIN public.pedidos_ecommerce p ON lp.pedido_id = p.id
WHERE p.estado NOT IN ('cancelado', 'devuelto')
GROUP BY lp.producto_id, lp.producto_tipo, lp.nombre_producto;

CREATE OR REPLACE VIEW public.vista_stock_consolidado WITH (security_invoker = on) AS
SELECT 
  id,
  nombre,
  'bebida' as tipo,
  categoria,
  stock,
  precio_eur,
  activado
FROM public."BebidasVENTA"
UNION ALL
SELECT 
  id,
  nombre,
  'comida' as tipo,
  categoria,
  stock,
  precio_eur,
  activado
FROM public."ComidaVENTA";