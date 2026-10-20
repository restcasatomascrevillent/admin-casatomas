-- Corregir vistas con SECURITY INVOKER (no DEFINER)
DROP VIEW IF EXISTS public.vista_estadisticas_semanales;
DROP VIEW IF EXISTS public.vista_estadisticas_mensuales;

-- Recrear vista semanal con SECURITY INVOKER
CREATE VIEW public.vista_estadisticas_semanales 
WITH (security_invoker = true) AS
SELECT 
  date_trunc('week', od.fecha)::date AS semana_inicio,
  (date_trunc('week', od.fecha) + interval '6 days')::date AS semana_fin,
  od.espacio_id,
  e.nombre AS espacio_nombre,
  SUM(od.total_reservas)::integer AS total_reservas,
  SUM(od.total_comensales)::integer AS total_comensales,
  SUM(od.reservas_confirmadas)::integer AS reservas_confirmadas,
  SUM(od.reservas_canceladas)::integer AS reservas_canceladas,
  SUM(od.reservas_no_show)::integer AS reservas_no_show,
  SUM(od.comensales_confirmados)::integer AS comensales_confirmados,
  SUM(CASE WHEN od.turno = 'comida' THEN od.total_reservas ELSE 0 END)::integer AS reservas_comida,
  SUM(CASE WHEN od.turno = 'cena' THEN od.total_reservas ELSE 0 END)::integer AS reservas_cena,
  ROUND(AVG(
    CASE WHEN e.capacidad_maxima > 0 
    THEN (od.comensales_confirmados::numeric / e.capacidad_maxima * 100) 
    ELSE 0 END
  ), 1) AS ocupacion_promedio,
  jsonb_object_agg(
    COALESCE(od.dia_semana::text, '0'), 
    COALESCE(od.total_reservas, 0)
  ) FILTER (WHERE od.dia_semana IS NOT NULL) AS distribucion_dias
FROM public.ocupacion_diaria od
JOIN public.espacios_reserva e ON od.espacio_id = e.id
GROUP BY date_trunc('week', od.fecha), od.espacio_id, e.nombre;

-- Recrear vista mensual con SECURITY INVOKER
CREATE VIEW public.vista_estadisticas_mensuales 
WITH (security_invoker = true) AS
SELECT 
  date_trunc('month', od.fecha)::date AS mes_inicio,
  (date_trunc('month', od.fecha) + interval '1 month - 1 day')::date AS mes_fin,
  od.espacio_id,
  e.nombre AS espacio_nombre,
  SUM(od.total_reservas)::integer AS total_reservas,
  SUM(od.total_comensales)::integer AS total_comensales,
  SUM(od.reservas_confirmadas)::integer AS reservas_confirmadas,
  SUM(od.reservas_canceladas)::integer AS reservas_canceladas,
  SUM(od.comensales_confirmados)::integer AS comensales_confirmados,
  ROUND(AVG(
    CASE WHEN e.capacidad_maxima > 0 
    THEN (od.comensales_confirmados::numeric / e.capacidad_maxima * 100) 
    ELSE 0 END
  ), 1) AS ocupacion_promedio
FROM public.ocupacion_diaria od
JOIN public.espacios_reserva e ON od.espacio_id = e.id
GROUP BY date_trunc('month', od.fecha), od.espacio_id, e.nombre;

-- Habilitar RLS en ocupacion_diaria
ALTER TABLE public.ocupacion_diaria ENABLE ROW LEVEL SECURITY;

-- Política de lectura para usuarios autenticados
CREATE POLICY "Authenticated users can read ocupacion_diaria"
  ON public.ocupacion_diaria
  FOR SELECT
  TO authenticated
  USING (true);

-- Solo sistema puede insertar/actualizar (a través de triggers)
CREATE POLICY "System can manage ocupacion_diaria"
  ON public.ocupacion_diaria
  FOR ALL
  USING (public.is_admin(auth.uid()));