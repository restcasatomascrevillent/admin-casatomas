
## Plan: Nueva Seccion Ecommerce para Productos de Venta

### Resumen

Crear una nueva seccion "Ecommerce" en el panel de administracion que funcione de manera similar a "Gestor Carta" pero enfocada en productos destinados a la venta online. Se crearan dos nuevas tablas en la base de datos y todos los componentes necesarios.

---

### 1. Esquema de Base de Datos

#### Tabla: BebidasVENTA

| Columna | Tipo | Descripcion |
|---------|------|-------------|
| id | text | Primary key (UUID) |
| nombre | text | Nombre del producto |
| categoria | text | Vinos Tintos, Vinos Blancos, Vinos Rosados, Champagnes, Cavas, Espumosos, Whisky |
| precio_eur | double precision | Precio de venta |
| descripcion | text | Descripcion del producto |
| imagen_url | text | URL de la imagen |
| stock | integer | Cantidad disponible |
| activado | boolean | Si esta activo para venta |
| featured | boolean | Si es producto destacado |
| orden | integer | Orden de visualizacion |
| denominacion_origen | text | D.O. para vinos |
| ubicacion_pais | text | Pais de origen |
| ubicacion_region | text | Region de origen |
| nombre_en | text | Nombre en ingles |
| nombre_fr | text | Nombre en frances |
| descripcion_en | text | Descripcion en ingles |
| descripcion_fr | text | Descripcion en frances |
| categoria_en | text | Categoria en ingles |
| categoria_fr | text | Categoria en frances |
| created_at | timestamp | Fecha de creacion |
| updated_at | timestamp | Fecha de actualizacion |

#### Tabla: ComidaVENTA

| Columna | Tipo | Descripcion |
|---------|------|-------------|
| id | text | Primary key (UUID) |
| nombre | text | Nombre del producto |
| categoria | text | Jamon, Lomo Embuchado, Chorizo, Quesos |
| precio_eur | double precision | Precio de venta |
| descripcion | text | Descripcion del producto |
| imagen_url | text | URL de la imagen |
| stock | integer | Cantidad disponible |
| peso | text | Peso del producto (ej: "100g", "1kg") |
| activado | boolean | Si esta activo para venta |
| featured | boolean | Si es producto destacado |
| orden | integer | Orden de visualizacion |
| origen | text | Origen del producto |
| nombre_en | text | Nombre en ingles |
| nombre_fr | text | Nombre en frances |
| descripcion_en | text | Descripcion en ingles |
| descripcion_fr | text | Descripcion en frances |
| categoria_en | text | Categoria en ingles |
| categoria_fr | text | Categoria en frances |
| created_at | timestamp | Fecha de creacion |
| updated_at | timestamp | Fecha de actualizacion |

#### Politicas RLS

Ambas tablas tendran:
- SELECT publico para productos activados
- SELECT autenticado para todos los productos
- INSERT/UPDATE/DELETE solo para usuarios autenticados

---

### 2. Archivos a Crear

#### Pagina Principal
```
src/pages/Ecommerce.tsx
```
- Layout similar a GestorCarta.tsx
- Tabs: "Bebidas" y "Comida"
- Filtros por categoria, estado, busqueda
- Boton "Anadir" contextual

#### Hooks de Datos
```
src/hooks/useBebidasVenta.ts
src/hooks/useComidaVenta.ts
```
- CRUD completo para cada tabla
- Extraccion de categorias unicas
- Toggle de activado/featured

#### Formularios de Creacion
```
src/components/ecommerce/BebidaVentaForm.tsx
src/components/ecommerce/ComidaVentaForm.tsx
```
- Campos especificos para cada tipo
- Selector de categoria con ComboboxCreatable
- Subida de imagen
- Campo de stock

#### Listas de Productos
```
src/components/ecommerce/ListaBebidasVenta.tsx
src/components/ecommerce/ListaComidaVenta.tsx
```
- Cards con imagen, nombre, precio, stock
- Toggle de activado/featured
- Boton eliminar con confirmacion

---

### 3. Modificaciones a Archivos Existentes

#### src/App.tsx
Anadir nueva ruta:
```tsx
<Route
  path="/ecommerce"
  element={
    <ProtectedRoute>
      <Ecommerce />
    </ProtectedRoute>
  }
/>
```

#### src/components/AppSidebar.tsx
Anadir item al menu:
```tsx
{ title: "Ecommerce", url: "/ecommerce", icon: ShoppingCart, sectionKey: "ecommerce" }
```

#### src/hooks/useUserRole.ts
Anadir seccion de permisos:
```tsx
{ key: "ecommerce", label: "Ecommerce" }
```

---

### 4. Estructura de Componentes

```text
src/
├── pages/
│   └── Ecommerce.tsx                    # Pagina principal
├── hooks/
│   ├── useBebidasVenta.ts               # Hook para BebidasVENTA
│   └── useComidaVenta.ts                # Hook para ComidaVENTA
└── components/
    └── ecommerce/
        ├── BebidaVentaForm.tsx          # Formulario bebidas
        ├── ComidaVentaForm.tsx          # Formulario comida
        ├── ListaBebidasVenta.tsx        # Lista bebidas
        └── ListaComidaVenta.tsx         # Lista comida
```

---

### 5. Categorias Predefinidas

#### BebidasVENTA
- Vinos Tintos
- Vinos Blancos
- Vinos Rosados
- Champagnes
- Cavas
- Espumosos
- Whisky

#### ComidaVENTA
- Jamon
- Lomo Embuchado
- Chorizo
- Quesos

---

### 6. Funcionalidades Clave

| Funcionalidad | Descripcion |
|---------------|-------------|
| Gestion de Stock | Campo numerico para controlar unidades disponibles |
| Productos Destacados | Toggle para marcar productos como featured |
| Traduccion Automatica | Integracion con edge function traducir-carta-auto |
| Imagenes | Subida a storage bucket "ecommerce" |
| Busqueda | Filtrado por nombre y descripcion |
| Categorias Dinamicas | Selector que permite crear nuevas categorias |

---

### 7. Storage Bucket

Crear bucket "ecommerce" para las imagenes con:
- Politica de lectura publica
- Politica de escritura para usuarios autenticados

---

### Secuencia de Implementacion

1. Crear migracion SQL con tablas, RLS y bucket
2. Crear hooks useBebidasVenta y useComidaVenta
3. Crear formularios BebidaVentaForm y ComidaVentaForm
4. Crear listas ListaBebidasVenta y ListaComidaVenta
5. Crear pagina Ecommerce.tsx
6. Actualizar AppSidebar con nuevo menu item
7. Actualizar App.tsx con nueva ruta
8. Actualizar useUserRole con seccion "ecommerce"
