
# Plan: Sistema de Tickets/Ventas Presenciales (TPV)

## Resumen

Añadir la funcionalidad de crear tickets de venta presencial (punto de venta / TPV) en el modulo de Ecommerce, permitiendo registrar ventas realizadas en persona sin pasar por la tienda online.

---

## Cambios en Base de Datos

### Modificar tabla pedidos_ecommerce

Añadir campos para distinguir el origen de la venta:

```sql
ALTER TABLE pedidos_ecommerce
ADD COLUMN tipo_venta TEXT DEFAULT 'online' CHECK (tipo_venta IN ('online', 'presencial')),
ADD COLUMN vendedor_id UUID REFERENCES auth.users(id),
ADD COLUMN caja TEXT,
ADD COLUMN numero_ticket TEXT;
```

| Campo | Descripcion |
|-------|-------------|
| tipo_venta | 'online' o 'presencial' |
| vendedor_id | Usuario que realizo la venta presencial |
| caja | Identificador de caja/terminal |
| numero_ticket | Numero de ticket impreso |

---

## Nuevos Componentes

### TPV / Punto de Venta

```
src/components/ecommerce/tpv/
  - TPVContainer.tsx          (contenedor principal del TPV)
  - ProductoPicker.tsx        (selector de productos con busqueda)
  - CarritoTPV.tsx            (lineas del ticket actual)
  - ResumenTicket.tsx         (totales y finalizacion)
  - TecladoNumerico.tsx       (para cantidades)
  - MetodoPagoSelector.tsx    (efectivo, tarjeta, etc)
  - TicketImprimible.tsx      (formato para imprimir)
```

### Flujo del TPV

1. **Seleccion de productos**: Buscar y añadir productos al carrito
2. **Ajustar cantidades**: Modificar unidades de cada linea
3. **Aplicar descuentos**: Descuento por linea o global
4. **Seleccionar pago**: Efectivo, tarjeta, mixto
5. **Finalizar venta**: Crear pedido con tipo_venta='presencial'
6. **Imprimir/guardar**: Generar ticket

---

## Componente Principal: TPVContainer

Interface tipo punto de venta con:

- Panel izquierdo: Grid de productos con categorias
- Panel derecho: Carrito actual con lineas
- Barra inferior: Totales y boton de cobrar

```text
+---------------------------+------------------+
|  [Categorias]             |  TICKET #1234    |
|  +-------+  +-------+     |                  |
|  | Prod1 |  | Prod2 |     |  Vino Rioja x2   |
|  +-------+  +-------+     |  Jamon 500g x1   |
|  +-------+  +-------+     |  ---------------  |
|  | Prod3 |  | Prod4 |     |  Subtotal: 45€   |
|  +-------+  +-------+     |  IVA: 9.45€      |
|                           |  TOTAL: 54.45€   |
+---------------------------+------------------+
| [Buscar producto...]    [COBRAR] [CANCELAR]  |
+----------------------------------------------+
```

---

## Logica de Stock

Al finalizar una venta presencial:

1. Crear pedido en `pedidos_ecommerce` con `tipo_venta = 'presencial'`
2. Crear lineas en `lineas_pedido`
3. Registrar movimiento de stock con `tipo_movimiento = 'venta'` y `referencia = numero_ticket`
4. Actualizar stock de productos (resta automatica)

Se reutiliza el hook `useMovimientosStock` existente.

---

## Hook useTPV

Nuevo hook para gestionar el estado del punto de venta:

```typescript
src/hooks/useTPV.ts

interface LineaTPV {
  producto_id: string;
  producto_tipo: 'bebida' | 'comida';
  nombre: string;
  precio: number;
  cantidad: number;
  descuento?: number;
}

interface useTPVReturn {
  lineas: LineaTPV[];
  addProducto: (producto) => void;
  removeLinea: (index) => void;
  updateCantidad: (index, cantidad) => void;
  aplicarDescuento: (descuento) => void;
  calcularTotales: () => { subtotal, iva, total };
  finalizarVenta: (metodoPago) => Promise<pedido>;
  cancelar: () => void;
  numeroTicket: string;
}
```

---

## Integracion con Pedidos

El hook `usePedidosEcommerce` se amplia para:

- Filtrar por `tipo_venta` (online/presencial)
- Generar `numero_ticket` automatico para ventas presenciales (formato: TPV-YYYYMMDD-XXX)
- El estado de ventas presenciales es `entregado` + `pagado = true` al crearse

---

## Modificar ListaPedidos

Añadir:
- Filtro por tipo de venta
- Indicador visual (badge) para diferenciar online vs presencial
- Columna de vendedor para ventas presenciales

---

## Integracion en Ecommerce.tsx

Añadir nueva pestaña "TPV":

```tsx
<TabsTrigger value="tpv" className="gap-2 py-2">
  <Receipt className="h-4 w-4" />
  <span className="hidden sm:inline">TPV</span>
</TabsTrigger>

<TabsContent value="tpv">
  <TPVContainer />
</TabsContent>
```

---

## Metodos de Pago

Selector con opciones:

- Efectivo (con calculo de cambio)
- Tarjeta
- Bizum
- Mixto (combinacion)

Para efectivo, mostrar campo "Importe recibido" y calcular cambio automaticamente.

---

## Analiticas

Actualizar `SeccionAnaliticas` para:

- Mostrar desglose ventas online vs presenciales
- Graficos separados por canal
- Rendimiento por vendedor (ventas presenciales)

---

## Vista de Ticket Imprimible

Componente `TicketImprimible` con formato para impresion termica:

- Logo/nombre establecimiento
- Numero ticket y fecha
- Lineas de productos
- Totales (subtotal, IVA, total)
- Metodo de pago
- Vendedor

Usar `window.print()` con estilos CSS para impresion.

---

## Archivos a Crear

| Archivo | Descripcion |
|---------|-------------|
| src/components/ecommerce/tpv/TPVContainer.tsx | Contenedor principal TPV |
| src/components/ecommerce/tpv/ProductoPicker.tsx | Selector de productos |
| src/components/ecommerce/tpv/CarritoTPV.tsx | Lineas del ticket |
| src/components/ecommerce/tpv/MetodoPagoModal.tsx | Modal para finalizar cobro |
| src/components/ecommerce/tpv/TicketImprimible.tsx | Ticket para imprimir |
| src/hooks/useTPV.ts | Logica del punto de venta |

## Archivos a Modificar

| Archivo | Cambios |
|---------|---------|
| src/pages/Ecommerce.tsx | Añadir pestaña TPV |
| src/hooks/usePedidosEcommerce.ts | Soportar tipo_venta y filtros |
| src/components/ecommerce/pedidos/ListaPedidos.tsx | Filtro y badges tipo venta |
| src/components/ecommerce/analiticas/SeccionAnaliticas.tsx | Desglose por canal |

---

## Orden de Implementacion

1. Migracion de base de datos (nuevos campos)
2. Actualizar tipos en hooks existentes
3. Crear hook useTPV
4. Desarrollar componentes TPV (ProductoPicker, CarritoTPV, etc)
5. Crear TPVContainer
6. Integrar en Ecommerce.tsx
7. Actualizar ListaPedidos con filtros
8. Añadir metricas a Analiticas
