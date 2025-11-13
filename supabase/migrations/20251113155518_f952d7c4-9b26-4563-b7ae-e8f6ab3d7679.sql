-- Migración para consolidar datos de cliente en tabla reservas

-- 1. Eliminar vistas que dependen de la estructura actual
DROP VIEW IF EXISTS public.vista_reservas_pendientes CASCADE;
DROP VIEW IF EXISTS public.vista_ocupacion_salas CASCADE;
DROP VIEW IF EXISTS public.vista_trabajadores_hoy CASCADE;

-- 2. Añadir campos de cliente directamente a reservas
ALTER TABLE public.reservas
ADD COLUMN IF NOT EXISTS nombre VARCHAR(255),
ADD COLUMN IF NOT EXISTS telefono VARCHAR(50),
ADD COLUMN IF NOT EXISTS email VARCHAR(255);

-- 3. Migrar datos existentes de clientes a reservas (si hay datos)
UPDATE public.reservas r
SET 
  nombre = CONCAT(c.nombre, ' ', COALESCE(c.apellidos, '')),
  telefono = c.telefono,
  email = c.email
FROM public.clientes c
WHERE r.cliente_id = c.id;

-- 4. Eliminar la columna cliente_id de reservas
ALTER TABLE public.reservas
DROP COLUMN IF EXISTS cliente_id CASCADE;

-- 5. Eliminar tablas que ya no se necesitan
DROP TABLE IF EXISTS public.historial_reservas CASCADE;
DROP TABLE IF EXISTS public.clientes CASCADE;
DROP TABLE IF EXISTS public.metricas_productividad CASCADE;
DROP TABLE IF EXISTS public.historico_ocupacion CASCADE;

-- 6. Recrear vista de reservas pendientes con nueva estructura
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
  t.nombre AS turno,
  r.created_at AS fecha_solicitud
FROM public.reservas r
LEFT JOIN public.salas s ON r.sala_id = s.id
LEFT JOIN public.turnos t ON r.turno_id = t.id
WHERE r.estado = 'pendiente'
ORDER BY r.fecha, r.hora;

-- 7. Recrear vista de ocupación de salas
CREATE OR REPLACE VIEW public.vista_ocupacion_salas AS
SELECT 
  r.fecha,
  s.nombre AS sala,
  t.nombre AS turno,
  COUNT(r.id) AS total_reservas,
  SUM(r.numero_comensales) AS total_comensales,
  s.capacidad_maxima,
  ROUND((SUM(r.numero_comensales)::numeric / s.capacidad_maxima::numeric * 100), 2) AS porcentaje_ocupacion
FROM public.reservas r
INNER JOIN public.salas s ON r.sala_id = s.id
INNER JOIN public.turnos t ON r.turno_id = t.id
WHERE r.estado IN ('confirmada', 'verificada')
GROUP BY r.fecha, s.nombre, t.nombre, s.capacidad_maxima
ORDER BY r.fecha, s.nombre, t.nombre;

-- 8. Recrear vista de trabajadores hoy
CREATE OR REPLACE VIEW public.vista_trabajadores_hoy AS
SELECT 
  CONCAT(tr.nombre, ' ', tr.apellidos) AS trabajador,
  tr.rol,
  t.nombre AS turno,
  s.nombre AS sala,
  p.nombre AS posicion,
  a.fecha
FROM public.asignaciones_turno a
INNER JOIN public.trabajadores tr ON a.trabajador_id = tr.id
INNER JOIN public.turnos t ON a.turno_id = t.id
LEFT JOIN public.salas s ON a.sala_id = s.id
LEFT JOIN public.posiciones_sala p ON a.posicion_sala_id = p.id
WHERE a.fecha = CURRENT_DATE
ORDER BY t.hora_inicio, tr.nombre;