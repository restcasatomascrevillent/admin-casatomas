
-- Fix vista_ocupacion_hoy to show global totals instead of duplicating across espacios
DROP VIEW IF EXISTS public.vista_ocupacion_hoy;

CREATE OR REPLACE VIEW public.vista_ocupacion_hoy
WITH (security_invoker = true)
AS
SELECT
  NULL::uuid AS espacio_id,
  'Global'::text AS espacio_nombre,
  (SELECT COALESCE(SUM(capacidad_maxima), 0) FROM espacios_reserva WHERE activa = true)::integer AS capacidad_maxima,
  COALESCE(COUNT(*)::integer, 0) AS total_reservas,
  COALESCE(SUM(numero_comensales)::integer, 0) AS total_comensales,
  CASE 
    WHEN (SELECT COALESCE(SUM(capacidad_maxima), 0) FROM espacios_reserva WHERE activa = true) > 0 
    THEN ROUND(COALESCE(SUM(numero_comensales), 0)::numeric / (SELECT SUM(capacidad_maxima) FROM espacios_reserva WHERE activa = true)::numeric * 100, 0)
    ELSE 0
  END AS porcentaje_ocupacion
FROM reservas
WHERE fecha = CURRENT_DATE AND estado = 'confirmada';
