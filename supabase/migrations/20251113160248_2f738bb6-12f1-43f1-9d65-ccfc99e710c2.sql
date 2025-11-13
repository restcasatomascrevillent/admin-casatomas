-- Simplificar la base de datos eliminando tablas que no se usan por ahora
-- Vamos a mantener solo lo esencial: salas, posiciones_sala, reservas, profiles

-- Eliminar tablas de gestión de personal (se crearán después si es necesario)
DROP TABLE IF EXISTS public.asignaciones_turno CASCADE;
DROP TABLE IF EXISTS public.trabajadores CASCADE;
DROP TABLE IF EXISTS public.turnos CASCADE;

-- Eliminar vistas que ya no son necesarias
DROP VIEW IF EXISTS public.vista_trabajadores_hoy CASCADE;
DROP VIEW IF EXISTS public.vista_ocupacion_salas CASCADE;
DROP VIEW IF EXISTS public.vista_reservas_pendientes CASCADE;

-- Recrear solo la vista de reservas pendientes que sí se usa
CREATE OR REPLACE VIEW public.vista_reservas_pendientes AS
SELECT 
  r.id,
  r.fecha,
  r.hora,
  r.nombre AS nombre_cliente,
  r.telefono,
  r.email,
  r.numero_comensales,
  s.nombre AS sala,
  r.created_at AS fecha_solicitud,
  r.estado
FROM public.reservas r
LEFT JOIN public.salas s ON r.sala_id = s.id
WHERE r.estado = 'pendiente'
ORDER BY r.fecha, r.hora;