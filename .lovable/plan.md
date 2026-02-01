

## Plan: Mostrar Cantidad y Unidad en Albaranes en Lugar de Precio

### Problema Detectado

Los productos de albaranes en la tabla `productos_factura` no tienen valores de precio (`precio_unitario` y `total` son `null`). Esto es correcto porque los albaranes son documentos de logística que registran cantidades, no importes.

**Datos en la base de datos:**
```
nombre: VENTRESCA ATÚN ROJO SALVAJE ALM...
cantidad: 23.480
unidad: kg
precio_unitario: null
total: null
```

### Solución

Modificar la tabla de albaranes para mostrar **Cantidad** y **Unidad** en lugar de **Precio**, ya que esos son los datos relevantes para albaranes.

---

### Cambios en TablaAlbaranes.tsx

#### 1. Actualizar cabeceras de la subtabla de productos

Cambiar de:
```
| Producto | Precio | Proveedor |
```

A:
```
| Producto | Cantidad | Unidad |
```

#### 2. Mostrar cantidad y unidad en cada fila

En lugar de `formatCurrency(p.precio)`, mostrar:
- `p.cantidad` formateado con decimales
- `p.unidad` (kg, unidades, cajas, etc.)

#### 3. Formato de cantidad

Crear una función `formatCantidad` que:
- Muestre hasta 3 decimales si es necesario
- Elimine ceros innecesarios (23.480 → 23.48)

---

### Código a Implementar

**Función de formateo:**
```typescript
const formatCantidad = (cantidad: number | undefined): string => {
  if (cantidad === undefined || cantidad === null) return "-";
  // Formatear con hasta 3 decimales, eliminando ceros finales
  return new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(cantidad);
};
```

**Cabeceras de subtabla (desktop):**
```tsx
<TableHeader>
  <TableRow className="bg-muted/30 hover:bg-muted/30">
    <TableHead className="h-8">Producto</TableHead>
    <TableHead className="w-[100px] h-8 text-right">Cantidad</TableHead>
    <TableHead className="w-[100px] h-8">Unidad</TableHead>
  </TableRow>
</TableHeader>
```

**Filas de productos:**
```tsx
{albaran.productos.map((p) => (
  <TableRow key={p.id} className="hover:bg-muted/10">
    <TableCell className="py-2">{p.producto_nombre}</TableCell>
    <TableCell className="py-2 text-right font-medium">
      {formatCantidad(p.cantidad)}
    </TableCell>
    <TableCell className="py-2 text-muted-foreground">
      {p.unidad || "-"}
    </TableCell>
  </TableRow>
))}
```

**Vista móvil actualizada:**
```tsx
{albaran.productos.map((p) => (
  <div key={p.id} className="flex justify-between text-xs">
    <span className="truncate flex-1 mr-2">{p.producto_nombre}</span>
    <span className="font-medium">
      {formatCantidad(p.cantidad)} {p.unidad || ""}
    </span>
  </div>
))}
```

---

### Resultado Visual

**Antes (mostraba "-" porque no hay precios):**
```
| Producto                              | Precio | Proveedor |
|---------------------------------------|--------|-----------|
| VENTRESCA ATÚN ROJO SALVAJE ALM...    | -      | -         |
| NAVAJA (Lote: 252580)                 | -      | -         |
```

**Después (muestra cantidad y unidad):**
```
| Producto                              | Cantidad | Unidad   |
|---------------------------------------|----------|----------|
| VENTRESCA ATÚN ROJO SALVAJE ALM...    | 23,48    | kg       |
| NAVAJA (Lote: 252580)                 | 5        | unidades |
```

---

### Archivo a Modificar

| Archivo | Cambio |
|---------|--------|
| `src/components/facturas/TablaAlbaranes.tsx` | Cambiar columnas de Precio/Proveedor por Cantidad/Unidad |

