
## Plan: Visualización de Facturas y Albaranes con Productos

### Resumen
Crear una interfaz visual con dos pestanas (Facturas y Albaranes) que muestren tablas con la informacion almacenada en la base de datos, incluyendo los productos/lineas de cada documento.

---

### Estructura de Datos Actual

La informacion esta en estas tablas:
- **facturas**: Contiene tanto facturas como albaranes (campo `tipo` = 'factura' | 'albaran')
- **historial_precios**: Contiene los productos/lineas asociadas a cada factura (campo `factura_id`)

---

### Arquitectura de la Solucion

#### 1. Hook useFacturas

Crear `src/hooks/useFacturas.ts`:
- Consultar tabla `facturas` con filtro por tipo
- Incluir productos desde `historial_precios`
- Exportar funciones para facturas y albaranes por separado

```typescript
interface Factura {
  id: number;
  tipo: string;
  numero_documento: string;
  proveedor: string | null;
  cif: string | null;
  fecha: string;
  subtotal: number | null;
  iva: number | null;
  total: number | null;
  observaciones: string | null;
  productos: ProductoFactura[];
}

interface ProductoFactura {
  id: number;
  producto_nombre: string;
  precio: number;
}
```

#### 2. Componente TablaFacturas

Crear `src/components/facturas/TablaFacturas.tsx`:
- Tabla con columnas: Numero, Proveedor, CIF, Fecha, Subtotal, IVA, Total
- Filas expandibles para mostrar productos
- Busqueda por numero o proveedor
- Ordenacion por columnas

#### 3. Componente TablaAlbaranes

Crear `src/components/facturas/TablaAlbaranes.tsx`:
- Similar a TablaFacturas pero para albaranes
- Columnas adaptadas: Numero, Proveedor, Fecha, Observaciones
- Sin columnas de importe (los albaranes no tienen totales)
- Filas expandibles para productos si los tienen

#### 4. Actualizar Pagina Facturas

Modificar `src/pages/Facturas.tsx`:
- Anadir pestanas (Tabs): "Subir", "Facturas", "Albaranes", "Chat"
- Integrar las nuevas tablas
- Mantener el layout existente pero ampliado

---

### Diseno Visual

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│  FACTURAS Y ALBARANES                                                       │
│  Sube documentos y consulta la informacion almacenada                       │
├─────────────────────────────────────────────────────────────────────────────┤
│  [Subir] [Facturas] [Albaranes] [Chat]                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Pestana FACTURAS:                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ Buscar: [________________]                                              ││
│  ├───────┬────────────────────┬────────────┬────────────┬──────────────────┤│
│  │ Num   │ Proveedor          │ Fecha      │ Total      │                  ││
│  ├───────┼────────────────────┼────────────┼────────────┼──────────────────┤│
│  │ > 0002721 │ FRIO S.A.T.    │ 30/12/2025 │ 982.50 EUR │                  ││
│  ├───────┴────────────────────┴────────────┴────────────┴──────────────────┤│
│  │   Productos:                                                            ││
│  │   - VENTILADOR 10W: 87.00 EUR                                           ││
│  │   - MANO DE OBRA: 30.00 EUR                                             ││
│  │   - PROGRAMADOR CICLICO: 248.66 EUR                                     ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                             │
│  Pestana ALBARANES:                                                         │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ Buscar: [________________]                                              ││
│  ├───────┬────────────────────┬────────────┬───────────────────────────────┤│
│  │ Num   │ Proveedor          │ Fecha      │ Observaciones                 ││
│  ├───────┼────────────────────┼────────────┼───────────────────────────────┤│
│  │ 260008151 │ PROD. ALMADRABA│ 15/01/2026 │ 2 bultos, temp. congelado     ││
│  │ 2.0668571 │ COMERCIAL TABA.│ 12/01/2026 │ Devolucion envases            ││
│  │ AL26000081│ Racionalismo D.│ 07/01/2026 │ Entrega CASA TOMAS            ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### Archivos a Crear/Modificar

| Archivo | Accion |
|---------|--------|
| `src/hooks/useFacturas.ts` | **Crear** - Hook para consultar facturas/albaranes con productos |
| `src/components/facturas/TablaFacturas.tsx` | **Crear** - Tabla de facturas con expansion |
| `src/components/facturas/TablaAlbaranes.tsx` | **Crear** - Tabla de albaranes |
| `src/pages/Facturas.tsx` | **Modificar** - Agregar pestanas y nuevas tablas |

---

### Detalles Tecnicos

**Hook useFacturas**
- Usa TanStack Query para cache y revalidacion
- Consulta separada para facturas y albaranes
- Join con historial_precios para obtener productos

**Filas Expandibles**
- Usar el componente Collapsible de Radix UI
- Al hacer clic en una fila, expandir para mostrar productos
- Icono de chevron para indicar expansion

**Formato de Datos**
- Fechas formateadas con date-fns en espanol
- Importes con formato de moneda EUR
- Textos largos truncados con tooltip

**Responsive**
- En movil, ocultar columnas secundarias (CIF, Subtotal)
- Scroll horizontal si es necesario
- Cards en lugar de tabla para pantallas muy pequenas
