

## Tablas de Facturas y Albaranes: Drive URL + Observaciones + Selector de columnas

### Resumen

Se van a hacer tres cosas:
1. Mostrar el **drive_url** como boton en **ambas** tablas (facturas ya lo tiene, falta en albaranes)
2. Mostrar **observaciones** en la tabla de facturas (ya esta en albaranes)
3. Agregar un **selector de columnas** configurable para que puedas elegir que campos mostrar/ocultar en cada tabla

### Todos los campos disponibles

Estos son todos los campos de la tabla `facturas` en Supabase que se podran activar/desactivar:

| Campo | Descripcion |
|---|---|
| Numero | Numero de documento |
| Proveedor | Nombre del proveedor |
| CIF | Identificacion fiscal |
| Fecha | Fecha del documento |
| Subtotal | Importe sin IVA |
| IVA | Importe del IVA |
| Total | Importe total |
| Observaciones | Notas del documento |
| Items | Cantidad de productos |
| Doc (Drive) | Enlace al documento en Google Drive |
| Procesado en | Fecha/hora de procesamiento |
| Creado | Fecha de creacion del registro |

### Cambios por archivo

#### 1. `src/hooks/useFacturas.ts`
- Agregar campos `procesado_en`, `created_at`, `updated_at` a la interfaz `Factura`
- Mapear estos campos en la funcion `fetchDocumentosConProductos`

#### 2. `src/components/facturas/TablaFacturas.tsx`
- Agregar columna **Observaciones** (con tooltip para textos largos)
- Agregar columna **Procesado en** y **Creado**
- Agregar un **boton de configuracion** (icono engranaje) que abre un popover con checkboxes para elegir que columnas mostrar
- Estado de columnas visibles guardado con `useState` con valores por defecto razonables (Numero, Proveedor, Fecha, Total, Items, Doc activos por defecto)
- En la subtabla de productos agregar Cantidad, Unidad, Precio unitario

#### 3. `src/components/facturas/TablaAlbaranes.tsx`
- Agregar boton **Doc (Drive)** igual que en facturas
- Agregar columnas opcionales: CIF, Subtotal, IVA, Total, Procesado en, Creado
- Agregar el mismo **selector de columnas** con checkboxes
- Por defecto mostrar: Numero, Proveedor, Fecha, Observaciones, Items, Doc
- En la subtabla de productos agregar Precio unitario y Total

#### 4. Mecanismo del selector de columnas (ambas tablas)
- Un boton con icono de engranaje/columnas junto al buscador
- Al hacer clic abre un `Popover` con una lista de checkboxes, uno por cada campo
- Al marcar/desmarcar, la columna aparece/desaparece de la tabla
- Se usa estado local (`useState`) para guardar la seleccion

### Detalles tecnicos

- Se reutiliza el componente `Popover` de Radix UI y `Checkbox` ya existentes
- Las columnas se renderizan condicionalmente segun el estado de visibilidad
- El `colSpan` de la fila expandible de productos se calcula dinamicamente segun columnas visibles
- Los campos `embedding` y `embedding_observaciones` NO se incluyen (son datos internos del chatbot)
- El campo `updated_at` se omite del selector por ser redundante con `procesado_en` y `creado`
- Vista mobile: se mantiene el formato de tarjetas, mostrando todos los datos en la seccion expandible sin necesidad del selector de columnas

