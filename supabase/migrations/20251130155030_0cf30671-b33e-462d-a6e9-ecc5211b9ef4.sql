-- Recrear vistas con security_invoker=on para que respeten RLS

-- 1. Vista de ocupación (debe ser pública para que clientes vean disponibilidad)
DROP VIEW IF EXISTS public.vista_ocupacion;
CREATE VIEW public.vista_ocupacion
WITH (security_invoker=on)
AS
SELECT 
  od.fecha,
  od.hora,
  od.espacio_id,
  er.nombre AS espacio,
  od.total_reservas,
  od.total_comensales,
  er.capacidad_maxima,
  CASE
    WHEN er.capacidad_maxima > 0 THEN round(od.total_comensales::numeric / er.capacidad_maxima::numeric * 100::numeric, 2)
    ELSE 0::numeric
  END AS porcentaje_ocupacion,
  GREATEST(0, er.capacidad_maxima - od.total_comensales) AS capacidad_disponible
FROM ocupacion_diaria od
JOIN espacios_reserva er ON od.espacio_id = er.id
ORDER BY od.fecha, od.hora, er.nombre;

-- 2. Vista de reservas pendientes (privada - solo gestión interna)
DROP VIEW IF EXISTS public.vista_reservas_pendientes;
CREATE VIEW public.vista_reservas_pendientes
WITH (security_invoker=on)
AS
SELECT 
  r.id,
  r.nombre AS nombre_cliente,
  r.telefono,
  r.email,
  r.fecha,
  r.hora,
  r.numero_comensales,
  e.nombre AS sala,
  r.estado,
  r.created_at AS fecha_solicitud
FROM reservas r
LEFT JOIN espacios_reserva e ON r.sala_id = e.id
WHERE r.estado = 'pendiente'
ORDER BY r.fecha, r.hora;

-- 3. Vista de turnos con áreas (privada - solo gestión interna)
DROP VIEW IF EXISTS public.vista_turnos_con_areas;
CREATE VIEW public.vista_turnos_con_areas
WITH (security_invoker=on)
AS
SELECT 
  t.id,
  t.trabajador_id,
  t.fecha,
  t.hora_inicio,
  t.hora_fin,
  t.estado,
  t.notas,
  t.created_at,
  t.updated_at,
  (tr.nombre || ' ' || tr.apellidos) AS trabajador_nombre,
  tr.puesto,
  COALESCE(array_agg(a.nombre) FILTER (WHERE a.nombre IS NOT NULL), ARRAY[]::varchar[]) AS areas_asignadas,
  COALESCE(array_agg(aa.area_id) FILTER (WHERE aa.area_id IS NOT NULL), ARRAY[]::uuid[]) AS areas_ids
FROM turnos t
LEFT JOIN trabajadores tr ON t.trabajador_id = tr.id
LEFT JOIN asignaciones_area aa ON t.id = aa.turno_id
LEFT JOIN areas_trabajo a ON aa.area_id = a.id
GROUP BY t.id, t.trabajador_id, t.fecha, t.hora_inicio, t.hora_fin, t.estado, t.notas, t.created_at, t.updated_at, tr.nombre, tr.apellidos, tr.puesto;