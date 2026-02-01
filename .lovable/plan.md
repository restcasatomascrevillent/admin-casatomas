
## Plan: Mejorar Alineación de Tabla de Facturas con Productos en Columnas

### Problema Detectado
La tabla actual tiene las columnas de datos desalineadas con las cabeceras. Además, cuando se expande una fila para ver los productos, estos se muestran como una lista simple en lugar de una tabla con columnas alineadas.

### Solución

Reestructurar la tabla para usar `table-layout: fixed` con anchos de columna explícitos, y mostrar los productos en una subtabla con las mismas proporciones de columnas.

---

### Cambios en TablaFacturas.tsx

#### 1. Aplicar layout fijo con anchos específicos

```tsx
<Table className="table-fixed">
  <TableHeader>
    <TableRow className="bg-muted/50">
      <TableHead className="w-[40px]"></TableHead>
      <TableHead className="w-[120px]">Número</TableHead>
      <TableHead className="w-[180px]">Proveedor</TableHead>
      <TableHead className="w-[110px] hidden md:table-cell">CIF</TableHead>
      <TableHead className="w-[100px]">Fecha</TableHead>
      <TableHead className="w-[100px] hidden lg:table-cell text-right">Subtotal</TableHead>
      <TableHead className="w-[90px] hidden lg:table-cell text-right">IVA</TableHead>
      <TableHead className="w-[100px] text-right">Total</TableHead>
      <TableHead className="w-[60px] text-center">Items</TableHead>
    </TableRow>
  </TableHeader>
</Table>
```

#### 2. Separar fila de datos y fila de productos

Cambiar de usar `Collapsible` envolviendo `TableRow` a usar Fragment con dos filas separadas:

```tsx
const FilaFactura = ({ factura, isMobile }: FilaFacturaProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const tieneProductos = factura.productos.length > 0;

  // Para desktop: usar dos TableRow separados
  return (
    <>
      <TableRow 
        className="cursor-pointer hover:bg-muted/50"
        onClick={() => tieneProductos && setIsOpen(!isOpen)}
      >
        <TableCell className="w-[40px]">
          {tieneProductos && (isOpen ? <ChevronDown /> : <ChevronRight />)}
        </TableCell>
        <TableCell className="w-[120px] font-medium">{factura.numero_documento}</TableCell>
        {/* ... resto de celdas con mismos anchos ... */}
      </TableRow>
      
      {isOpen && tieneProductos && (
        <TableRow className="bg-muted/20">
          <TableCell colSpan={9} className="p-0">
            <Table className="table-fixed">
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="w-[40px]"></TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead className="w-[100px] text-right">Precio</TableHead>
                  <TableHead className="w-[100px] text-right">Proveedor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {factura.productos.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="w-[40px]"></TableCell>
                    <TableCell>{p.producto_nombre}</TableCell>
                    <TableCell className="text-right">{formatCurrency(p.precio)}</TableCell>
                    <TableCell className="text-right">{p.proveedor || "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableCell>
        </TableRow>
      )}
    </>
  );
};
```

---

### Mejoras Visuales Adicionales

| Mejora | Descripción |
|--------|-------------|
| Fondo en cabecera | Añadir `bg-muted/50` a la fila de cabecera para distinguirla |
| Anchos fijos | Usar `table-fixed` con valores en píxeles para cada columna |
| Subtabla de productos | Los productos se muestran en una tabla anidada con columnas: Producto, Precio, Proveedor |
| Eliminar Collapsible | Usar estado `isOpen` simple con onClick en lugar de Collapsible wrapper |
| Bordes sutiles | Añadir separadores visuales entre productos |

---

### Archivo a Modificar

| Archivo | Cambio |
|---------|--------|
| `src/components/facturas/TablaFacturas.tsx` | Reestructurar con layout fijo y subtabla de productos |
