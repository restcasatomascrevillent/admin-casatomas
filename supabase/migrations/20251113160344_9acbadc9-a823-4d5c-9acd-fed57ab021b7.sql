-- Simplificar tabla de reservas eliminando referencias a turnos y posiciones
ALTER TABLE public.reservas
DROP COLUMN IF EXISTS turno_id CASCADE,
DROP COLUMN IF EXISTS posicion_sala_id CASCADE,
DROP COLUMN IF EXISTS verificada_por CASCADE,
DROP COLUMN IF EXISTS fecha_verificacion CASCADE,
DROP COLUMN IF EXISTS fecha_confirmacion CASCADE,
DROP COLUMN IF EXISTS notas_internas CASCADE;

-- Recrear vista de reservas pendientes sin turno
DROP VIEW IF EXISTS public.vista_reservas_pendientes CASCADE;

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