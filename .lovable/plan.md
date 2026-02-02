
# Plan: Seccion Ecommerce Completa

## Resumen

Transformar la seccion de Ecommerce actual en un modulo completo con navegacion por subsecciones, incluyendo gestion de productos, control de stock, metricas de ventas, analisis de clientes y mas.

---

## Estructura de Subsecciones

La pagina Ecommerce tendra navegacion por tabs principales:

1. **Dashboard** - Vista general con KPIs y metricas clave
2. **Productos** - Gestion actual de bebidas y comida (ya existe)
3. **Pedidos** - Lista de pedidos y su estado
4. **Stock** - Control de inventario y alertas
5. **Clientes** - Usuarios registrados y comportamiento
6. **Analiticas** - Graficos detallados y reportes

---

## Componentes a Crear

### 1. Dashboard Ecommerce (Widgets)

```
src/components/ecommerce/dashboard/
  - ResumenVentas.tsx        (ventas hoy/semana/mes + comparativa)
  - GraficoVentasDiarias.tsx  (grafico de barras ventas por dia)
  - ProductosMasVendidos.tsx  (top 5 productos)
  - IngresosPorCategoria.tsx  (grafico circular por categoria)
  - AlertasStock.tsx          (productos con stock bajo)
  - PedidosPendientes.tsx     (pedidos por procesar)
  - MapaVentas.tsx            (ventas por region/pais)
  - ConversionCarrito.tsx     (carritos vs compras completadas)
```

### 2. Gestion de Pedidos

```
src/components/ecommerce/pedidos/
  - ListaPedidos.tsx          (tabla con filtros)
  - DetallePedido.tsx         (modal con info completa)
  - EstadoPedidoSelector.tsx  (cambiar estado)
  - ExportarPedidos.tsx       (CSV/PDF)
```

### 3. Control de Stock

```
src/components/ecommerce/stock/
  - TablaStock.tsx            (vista consolidada)
  - HistorialStock.tsx        (movimientos)
  - AlertasStockConfig.tsx    (umbral minimo)
  - AjusteStock.tsx           (modal para ajustar)
```

### 4. Clientes

```
src/components/ecommerce/clientes/
  - ListaClientes.tsx         (usuarios sell_users)
  - DetalleCliente.tsx        (historial compras)
  - SegmentacionClientes.tsx  (por valor/frecuencia)
```

### 5. Analiticas Avanzadas

```
src/components/ecommerce/analiticas/
  - GraficoIngresosMensuales.tsx
  - EvolucionProductos.tsx
  - AnalisisMargen.tsx        (beneficio por producto)
  - ComparativaCategoiras.tsx
  - TendenciasEstacionales.tsx
```

---

## Tablas de Base de Datos Nuevas

### pedidos_ecommerce
```sql
CREATE TABLE pedidos_ecommerce (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_pedido TEXT UNIQUE NOT NULL,
  user_id UUID REFERENCES auth.users(id),
  
  -- Datos cliente (para pedidos sin registro)
  email TEXT,
  telefono TEXT,
  nombre_completo TEXT,
  
  -- Direccion envio
  direccion_envio TEXT,
  ciudad_envio TEXT,
  codigo_postal_envio TEXT,
  pais_envio TEXT DEFAULT 'Espana',
  
  -- Importes
  subtotal NUMERIC(10,2) NOT NULL,
  gastos_envio NUMERIC(10,2) DEFAULT 0,
  descuento NUMERIC(10,2) DEFAULT 0,
  iva NUMERIC(10,2),
  total NUMERIC(10,2) NOT NULL,
  
  -- Estado
  estado TEXT DEFAULT 'pendiente' CHECK (estado IN (
    'pendiente', 'confirmado', 'preparando', 
    'enviado', 'entregado', 'cancelado', 'devuelto'
  )),
  
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
```

### lineas_pedido
```sql
CREATE TABLE lineas_pedido (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id UUID REFERENCES pedidos_ecommerce(id) ON DELETE CASCADE,
  producto_id TEXT NOT NULL,
  producto_tipo TEXT NOT NULL CHECK (producto_tipo IN ('bebida', 'comida')),
  nombre_producto TEXT NOT NULL,
  cantidad INTEGER NOT NULL,
  precio_unitario NUMERIC(10,2) NOT NULL,
  total_linea NUMERIC(10,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### movimientos_stock
```sql
CREATE TABLE movimientos_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id TEXT NOT NULL,
  producto_tipo TEXT NOT NULL CHECK (producto_tipo IN ('bebida', 'comida')),
  tipo_movimiento TEXT NOT NULL CHECK (tipo_movimiento IN (
    'entrada', 'salida', 'ajuste', 'venta', 'devolucion'
  )),
  cantidad INTEGER NOT NULL,
  stock_anterior INTEGER,
  stock_nuevo INTEGER,
  motivo TEXT,
  referencia TEXT,
  usuario_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### alertas_stock
```sql
CREATE TABLE alertas_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id TEXT NOT NULL,
  producto_tipo TEXT NOT NULL,
  stock_minimo INTEGER DEFAULT 5,
  notificar_email BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(producto_id, producto_tipo)
);
```

### visitas_producto
```sql
CREATE TABLE visitas_producto (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id TEXT NOT NULL,
  producto_tipo TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id),
  session_id TEXT,
  ip_address TEXT,
  user_agent TEXT,
  referer TEXT,
  pais TEXT,
  ciudad TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

---

## Hooks Nuevos

```
src/hooks/
  - usePedidosEcommerce.ts    (CRUD pedidos)
  - useLineasPedido.ts        (items de pedido)
  - useMovimientosStock.ts    (historial stock)
  - useAlertasStock.ts        (configuracion alertas)
  - useVisitasProducto.ts     (analiticas visitas)
  - useEcommerceStats.ts      (estadisticas agregadas)
  - useClientesEcommerce.ts   (gestion sell_users)
```

---

## Metricas y KPIs

El dashboard mostrara:

**Ventas**
- Ventas de hoy / esta semana / este mes
- Comparativa con periodo anterior (%)
- Ticket medio
- Numero de pedidos

**Productos**
- Top 5 mas vendidos
- Productos sin stock
- Productos con stock bajo
- Productos mas visitados vs vendidos (conversion)

**Clientes**
- Nuevos clientes (semana/mes)
- Clientes recurrentes vs nuevos
- Valor medio por cliente
- Carritos abandonados

**Geografico**
- Ventas por region/pais
- Coste medio de envio por zona

**Margenes**
- Ingresos totales
- Beneficio estimado (si se añade coste)
- Margen por categoria

---

## Vistas SQL para Analiticas

```sql
-- Vista resumen ventas diarias
CREATE VIEW vista_ventas_diarias AS
SELECT 
  DATE(created_at) as fecha,
  COUNT(*) as num_pedidos,
  SUM(total) as total_ventas,
  AVG(total) as ticket_medio
FROM pedidos_ecommerce
WHERE estado NOT IN ('cancelado', 'devuelto')
GROUP BY DATE(created_at);

-- Vista productos mas vendidos
CREATE VIEW vista_productos_vendidos AS
SELECT 
  lp.producto_id,
  lp.producto_tipo,
  lp.nombre_producto,
  SUM(lp.cantidad) as unidades_vendidas,
  SUM(lp.total_linea) as total_ingresos
FROM lineas_pedido lp
JOIN pedidos_ecommerce p ON lp.pedido_id = p.id
WHERE p.estado NOT IN ('cancelado', 'devuelto')
GROUP BY lp.producto_id, lp.producto_tipo, lp.nombre_producto;
```

---

## Modificaciones a Pagina Principal

El archivo `src/pages/Ecommerce.tsx` se reestructurara con navegacion por subsecciones:

```tsx
<Tabs value={seccion} onValueChange={setSeccion}>
  <TabsList>
    <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
    <TabsTrigger value="productos">Productos</TabsTrigger>
    <TabsTrigger value="pedidos">Pedidos</TabsTrigger>
    <TabsTrigger value="stock">Stock</TabsTrigger>
    <TabsTrigger value="clientes">Clientes</TabsTrigger>
    <TabsTrigger value="analiticas">Analiticas</TabsTrigger>
  </TabsList>
  
  <TabsContent value="dashboard">
    <DashboardEcommerce />
  </TabsContent>
  
  {/* ... demas secciones */}
</Tabs>
```

---

## Seguridad (RLS)

Todas las tablas nuevas tendran RLS habilitado:
- Solo usuarios autenticados pueden ver/editar pedidos
- Clientes solo ven sus propios pedidos
- Admins pueden ver todo

---

## Orden de Implementacion

1. Crear tablas de base de datos y vistas
2. Crear hooks para acceso a datos
3. Implementar Dashboard con widgets principales
4. Desarrollar gestion de Pedidos
5. Implementar control de Stock
6. Crear seccion Clientes
7. Desarrollar Analiticas avanzadas
8. Reestructurar pagina principal con navegacion

---

## Detalles Tecnicos

- Se reutilizara el patron de widgets del Dashboard principal
- Graficos con Recharts (ya instalado)
- Tablas con componentes UI existentes
- Exportacion PDF con jsPDF (ya instalado)
- Formularios con react-hook-form y zod

