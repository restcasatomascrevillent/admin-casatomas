-- Recrear vista con security_invoker
DROP VIEW IF EXISTS public.vista_ocupacion_hoy;

CREATE OR REPLACE VIEW public.vista_ocupacion_hoy 
WITH (security_invoker=on) AS
SELECT 
  e.id as espacio_id,
  e.nombre as espacio_nombre,
  e.capacidad_maxima,
  COUNT(r.id) as total_reservas,
  COALESCE(SUM(r.numero_comensales), 0) as total_comensales,
  ROUND(
    CASE 
      WHEN e.capacidad_maxima > 0 
      THEN (COALESCE(SUM(r.numero_comensales), 0)::numeric / e.capacidad_maxima * 100)
      ELSE 0 
    END, 1
  ) as porcentaje_ocupacion
FROM public.espacios_reserva e
LEFT JOIN public.reservas r ON r.sala_id = e.id 
  AND r.fecha = CURRENT_DATE 
  AND r.estado NOT IN ('cancelada')
WHERE e.activa = true
GROUP BY e.id, e.nombre, e.capacidad_maxima;