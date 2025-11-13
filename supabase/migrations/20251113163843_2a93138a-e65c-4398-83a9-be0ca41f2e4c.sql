-- Corregir vistas con SECURITY DEFINER para evitar bypass de RLS

-- Primero, eliminar las vistas existentes
DROP VIEW IF EXISTS public.vista_reservas_pendientes CASCADE;
DROP VIEW IF EXISTS public.vista_ocupacion CASCADE;

-- Recrear vista_ocupacion sin SECURITY DEFINER
-- Esta vista muestra ocupación sin datos personales, es segura para público
CREATE VIEW public.vista_ocupacion AS
SELECT 
  od.fecha,
  od.hora,
  s.id AS sala_id,
  s.nombre AS sala,
  s.numero_mesas AS total_mesas_sala,
  s.capacidad_maxima,
  ps.id AS posicion_id,
  ps.nombre AS posicion,
  od.total_mesas_reservadas,
  od.total_comensales,
  od.total_reservas,
  (s.numero_mesas - COALESCE(od.total_mesas_reservadas, 0)) AS mesas_disponibles,
  ROUND((COALESCE(od.total_mesas_reservadas, 0)::numeric / NULLIF(s.numero_mesas, 0)) * 100, 2) AS porcentaje_ocupacion
FROM public.ocupacion_diaria od
JOIN public.salas s ON od.sala_id = s.id
LEFT JOIN public.posiciones_sala ps ON od.posicion_sala_id = ps.id
WHERE s.activa = true;

-- Recrear vista_reservas_pendientes sin SECURITY DEFINER
-- IMPORTANTE: Esta vista contiene datos personales, solo para usuarios autenticados
CREATE VIEW public.vista_reservas_pendientes 
WITH (security_invoker = true) AS
SELECT 
  r.id,
  r.nombre AS nombre_cliente,
  r.telefono,
  r.email,
  r.fecha,
  r.hora,
  s.nombre AS sala,
  r.numero_comensales,
  r.estado,
  r.created_at AS fecha_solicitud
FROM public.reservas r
JOIN public.salas s ON r.sala_id = s.id
WHERE r.estado = 'pendiente'
ORDER BY r.created_at DESC;

-- Aplicar RLS a las vistas
ALTER VIEW public.vista_ocupacion SET (security_invoker = true);
ALTER VIEW public.vista_reservas_pendientes SET (security_invoker = true);

-- Nota: vista_ocupacion es segura para público (no contiene datos personales)
-- vista_reservas_pendientes heredará las políticas RLS de la tabla reservas