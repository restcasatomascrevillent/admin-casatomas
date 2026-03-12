

# Plan: Gestor de Reservas con Kanban por Espacios

## Resumen

Se creara un nuevo componente "Gestor de Reservas" con una vista Kanban que muestra los espacios (Comedor, Salon, Terraza) como columnas, permitiendo arrastrar y soltar reservas entre ellos para asignarlas. Se anadira un boton de acceso encima de la tarjeta de "Ocupacion Media" en la vista Hoy.

## Cambios necesarios

### 1. Base de datos: nueva columna `espacio_id` en `reservas`

Crear una migracion que anade la columna `espacio_id` (uuid, nullable, FK a `espacios_reserva`) a la tabla `reservas`. Las reservas sin espacio asignado apareceran en una columna "Sin asignar".

### 2. Nuevo componente: `GestorReservasKanban.tsx`

Crear `src/components/reservas/GestorReservasKanban.tsx`:

- **Columnas del Kanban**: Una columna "Sin asignar" + una columna por cada espacio activo (Comedor, Salon, Terraza)
- **Cabecera de columna**: Nombre del espacio, capacidad actual vs. maxima, barra de progreso
- **Tarjetas de reserva**: Nombre, hora, numero comensales, estado (badge de color), icono importante
- **Drag & Drop**: Usando `@dnd-kit/core` y `@dnd-kit/sortable` (ya instalados) para mover reservas entre columnas
- **Al soltar**: Se actualiza `espacio_id` en la base de datos
- **Filtros**: Solo reservas de hoy, excluyendo canceladas
- **Validacion de capacidad**: Aviso si se excede la capacidad maxima del espacio

### 3. Modificar `VistaHoy.tsx`

Anadir un boton "Gestor Reservas" con icono `LayoutGrid` justo encima de la tarjeta de "Ocupacion Media" (la cuarta card del grid de stats). Al hacer clic, se abre un Dialog/Sheet a pantalla completa con el componente Kanban.

### 4. Actualizar tipos de Supabase

Actualizar `src/integrations/supabase/types.ts` para reflejar la nueva columna `espacio_id` en la tabla `reservas`.

## Detalle tecnico

```text
Vista Hoy
+-------------------------------------------+
| Stats cards (4 columnas)                  |
| [Reservas] [Comensales] [Capacidad]       |
|                                           |
| [Boton: Gestor Reservas]  [Ocupacion %]   |
+-------------------------------------------+
|                                           |
| Click "Gestor Reservas" abre:             |
+-------------------------------------------+

Kanban (Dialog fullscreen)
+-------------+-------------+-------------+-------------+
| Sin asignar | Comedor     | Salon       | Terraza     |
| (12 res.)   | 24/40 pax   | 10/25 pax   | 15/40 pax   |
|             | [===----]   | [==-----]   | [==-----]   |
| [Card]      | [Card]      | [Card]      | [Card]      |
| [Card]      | [Card]      |             |             |
| [Card]      |             |             |             |
+-------------+-------------+-------------+-------------+
```

- Las tarjetas se arrastran entre columnas con `@dnd-kit`
- Al soltar, se ejecuta `UPDATE reservas SET espacio_id = ? WHERE id = ?`
- Actualizacion optimista del estado local para fluidez visual

