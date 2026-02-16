

# Eliminar `sala_id` del flujo de reservas

## Resumen

Se eliminara completamente el concepto de "sala" (sala_id) del flujo de reservas. Esto afecta a la base de datos, formularios, listados, calendario y la pagina de Gestion de Salas (que se eliminara).

## Cambios en Base de Datos

1. **Migracion SQL**: 
   - Eliminar la constraint `reservas_sala_id_fkey` (foreign key)
   - Hacer `sala_id` nullable primero, luego eliminarlo de la tabla `reservas`
   - Actualizar la vista `vista_ocupacion_hoy` si depende de `sala_id`
   - Actualizar el trigger `actualizar_ocupacion_diaria_espacios` que usa `sala_id` de reservas
   - Actualizar la constraint unica de `ocupacion_diaria` que incluye `sala_id`

2. **Tipos TypeScript** (`src/integrations/supabase/types.ts`):
   - Eliminar `sala_id` de las interfaces Row, Insert y Update de `reservas`
   - Eliminar la relacion `reservas_sala_id_fkey`

## Pagina eliminada

- **`src/pages/GestionSalas.tsx`**: Se elimina completamente (su unica funcion era asignar salas a reservas via drag-and-drop)
- **`src/App.tsx`**: Eliminar la ruta `/reservas/gestion` y el import de `GestionSalas`

## Componentes modificados

### Formularios
- **`src/components/reservas/FormularioReserva.tsx`**: Eliminar `sala_id` del schema zod, del formulario y del insert a Supabase
- **`src/components/reservas/ModalVerificacionReserva.tsx`**: Eliminar el campo de seleccion de sala, el estado `salaId`, y la referencia en el update. Quitar la validacion de `salaId` como obligatorio
- **`src/components/reservas/GenerarReservasFicticias.tsx`**: Eliminar `sala_id` de los datos ficticios (ya no necesitara buscar espacios)

### Vistas y listados
- **`src/components/reservas/VistaHoy.tsx`**: 
  - Eliminar la tarjeta "Gestion de Salas" (link a `/reservas/gestion`)
  - Eliminar el join con `espacios_reserva:sala_id` en la query
- **`src/components/reservas/CalendarioOcupacion.tsx`**: Eliminar la agrupacion por `sala_id`/espacio en el panel lateral. Mostrar las reservas del dia sin agrupar
- **`src/components/reservas/CalendarioReservaPublica.tsx`**: Eliminar la seleccion de sala. Simplificar para que no dependa de `sala_id`

### Hooks
- **`src/hooks/useOcupacionHoy.ts`**: Eliminar `useReservasHoyPorEspacio` que filtra por `sala_id`. Quitar el join `espacios_reserva!reservas_sala_id_fkey`
- **`src/hooks/useDisponibilidad.ts`**: Refactorizar para que no dependa de `sala_id` en reservas. Las funciones de disponibilidad seguiran usando `espacios_reserva` directamente pero sin relacion con reservas
- **`src/components/reservas/SelectorHorasDisponibles.tsx`**: Adaptar para funcionar sin `salaId` obligatorio
- **`src/hooks/useAsignacionesMesa.ts`**: Eliminar referencia a `sala_id` en el select de reservas

## Seccion tecnica - Detalles de la migracion

```text
Orden de ejecucion:
1. Migracion SQL (eliminar FK, luego columna)
2. Actualizar types.ts
3. Eliminar GestionSalas.tsx y su ruta
4. Modificar formularios (FormularioReserva, ModalVerificacion)
5. Modificar vistas (VistaHoy, Calendario, etc.)
6. Modificar hooks (useDisponibilidad, useOcupacionHoy)
7. Adaptar GenerarReservasFicticias
```

La migracion SQL sera:
```text
ALTER TABLE reservas DROP CONSTRAINT IF EXISTS reservas_sala_id_fkey;
ALTER TABLE reservas ALTER COLUMN sala_id DROP NOT NULL;
ALTER TABLE reservas DROP COLUMN sala_id;
```

Tambien hay que actualizar el trigger `actualizar_ocupacion_diaria_espacios` y la tabla `ocupacion_diaria` ya que dependen de `sala_id` de reservas.

## Notas importantes

- Los datos existentes en Live tienen 1317 reservas con `sala_id`. Al eliminar la columna se perdera esa informacion. Si se necesita preservar, hay que correr la migracion en Live antes de publicar.
- La pagina de **Espacios** (`src/pages/Espacios.tsx`) y los espacios de reserva como entidad independiente NO se eliminan, ya que pueden usarse para otros propositos (planos 2D, capacidad general).

