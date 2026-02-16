
-- Step 1: Drop ALL dependent views explicitly
DROP VIEW IF EXISTS public.vista_reservas_pendientes CASCADE;
DROP VIEW IF EXISTS public.vista_ocupacion_hoy CASCADE;
DROP VIEW IF EXISTS public.vista_ocupacion CASCADE;
DROP VIEW IF EXISTS public.vista_estadisticas_semanales CASCADE;
DROP VIEW IF EXISTS public.vista_estadisticas_mensuales CASCADE;

-- Step 2: Drop trigger and function
DROP TRIGGER IF EXISTS trigger_actualizar_ocupacion ON public.reservas;
DROP FUNCTION IF EXISTS public.actualizar_ocupacion_diaria_espacios();

-- Step 3: Drop FK and sala_id from reservas
ALTER TABLE public.reservas DROP CONSTRAINT IF EXISTS reservas_sala_id_fkey;
ALTER TABLE public.reservas DROP COLUMN sala_id;

-- Step 4: Drop constraints and columns from ocupacion_diaria
ALTER TABLE public.ocupacion_diaria DROP CONSTRAINT IF EXISTS ocupacion_diaria_fecha_hora_sala_key;
ALTER TABLE public.ocupacion_diaria DROP CONSTRAINT IF EXISTS ocupacion_diaria_espacio_id_fkey;
ALTER TABLE public.ocupacion_diaria DROP CONSTRAINT IF EXISTS ocupacion_diaria_sala_id_fkey;

-- Deduplicate before dropping columns (aggregate by fecha+hora)
DELETE FROM public.ocupacion_diaria a
USING public.ocupacion_diaria b
WHERE a.fecha = b.fecha AND a.hora = b.hora AND a.id > b.id;

ALTER TABLE public.ocupacion_diaria DROP COLUMN IF EXISTS sala_id;
ALTER TABLE public.ocupacion_diaria DROP COLUMN IF EXISTS espacio_id;

-- Step 5: Add new unique constraint
ALTER TABLE public.ocupacion_diaria ADD CONSTRAINT ocupacion_diaria_fecha_hora_key UNIQUE (fecha, hora);

-- Step 6: Recreate views
CREATE VIEW public.vista_reservas_pendientes AS
SELECT r.id, r.nombre AS nombre_cliente, r.telefono, r.email, r.fecha, r.hora,
  r.numero_comensales, r.estado, r.created_at AS fecha_solicitud
FROM reservas r WHERE r.estado = 'pendiente' ORDER BY r.fecha, r.hora;

CREATE VIEW public.vista_ocupacion_hoy AS
SELECT e.id AS espacio_id, e.nombre AS espacio_nombre, e.capacidad_maxima,
  COALESCE(r.total_reservas, 0)::integer AS total_reservas,
  COALESCE(r.total_comensales, 0)::integer AS total_comensales,
  CASE WHEN e.capacidad_maxima > 0 
    THEN round(COALESCE(r.total_comensales, 0)::numeric / e.capacidad_maxima::numeric * 100, 0)
    ELSE 0 END AS porcentaje_ocupacion
FROM espacios_reserva e
LEFT JOIN LATERAL (
  SELECT COUNT(*)::bigint AS total_reservas,
    COALESCE(SUM(res.numero_comensales), 0)::bigint AS total_comensales
  FROM reservas res WHERE res.fecha = CURRENT_DATE AND res.estado = 'confirmada'
) r ON true
WHERE e.activa = true;

CREATE VIEW public.vista_ocupacion AS
SELECT od.fecha, od.hora, od.total_reservas, od.total_comensales, od.dia_semana, od.turno
FROM ocupacion_diaria od ORDER BY od.fecha, od.hora;

CREATE VIEW public.vista_estadisticas_semanales AS
SELECT 
  date_trunc('week', od.fecha::timestamp with time zone)::date AS semana_inicio,
  (date_trunc('week', od.fecha::timestamp with time zone) + '6 days'::interval)::date AS semana_fin,
  sum(od.total_reservas)::integer AS total_reservas,
  sum(od.total_comensales)::integer AS total_comensales,
  sum(od.reservas_confirmadas)::integer AS reservas_confirmadas,
  sum(od.reservas_canceladas)::integer AS reservas_canceladas,
  sum(od.reservas_no_show)::integer AS reservas_no_show,
  sum(od.comensales_confirmados)::integer AS comensales_confirmados,
  sum(CASE WHEN od.turno = 'comida' THEN od.total_reservas ELSE 0 END)::integer AS reservas_comida,
  sum(CASE WHEN od.turno = 'cena' THEN od.total_reservas ELSE 0 END)::integer AS reservas_cena
FROM ocupacion_diaria od GROUP BY date_trunc('week', od.fecha::timestamp with time zone);

CREATE VIEW public.vista_estadisticas_mensuales AS
SELECT 
  date_trunc('month', od.fecha::timestamp with time zone)::date AS mes_inicio,
  (date_trunc('month', od.fecha::timestamp with time zone) + '1 mon -1 days'::interval)::date AS mes_fin,
  sum(od.total_reservas)::integer AS total_reservas,
  sum(od.total_comensales)::integer AS total_comensales,
  sum(od.reservas_confirmadas)::integer AS reservas_confirmadas,
  sum(od.reservas_canceladas)::integer AS reservas_canceladas,
  sum(od.comensales_confirmados)::integer AS comensales_confirmados
FROM ocupacion_diaria od GROUP BY date_trunc('month', od.fecha::timestamp with time zone);

-- Step 7: Recreate trigger function
CREATE OR REPLACE FUNCTION public.actualizar_ocupacion_diaria_espacios()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_fecha date; v_hora time;
BEGIN
  IF TG_OP = 'DELETE' THEN v_fecha := OLD.fecha; v_hora := OLD.hora;
  ELSE v_fecha := NEW.fecha; v_hora := NEW.hora; END IF;

  INSERT INTO public.ocupacion_diaria (fecha, hora, total_comensales, total_reservas,
    reservas_confirmadas, reservas_canceladas, reservas_no_show, comensales_confirmados, dia_semana, turno)
  SELECT r.fecha, r.hora, COALESCE(SUM(r.numero_comensales), 0), COUNT(*),
    COUNT(*) FILTER (WHERE r.estado = 'confirmada'), COUNT(*) FILTER (WHERE r.estado = 'cancelada'),
    COUNT(*) FILTER (WHERE r.estado = 'no_show'),
    COALESCE(SUM(r.numero_comensales) FILTER (WHERE r.estado = 'confirmada'), 0),
    EXTRACT(DOW FROM r.fecha)::integer, CASE WHEN r.hora < '16:00' THEN 'comida' ELSE 'cena' END
  FROM public.reservas r WHERE r.fecha = v_fecha AND r.hora = v_hora
  GROUP BY r.fecha, r.hora
  ON CONFLICT (fecha, hora) DO UPDATE SET
    total_comensales = EXCLUDED.total_comensales, total_reservas = EXCLUDED.total_reservas,
    reservas_confirmadas = EXCLUDED.reservas_confirmadas, reservas_canceladas = EXCLUDED.reservas_canceladas,
    reservas_no_show = EXCLUDED.reservas_no_show, comensales_confirmados = EXCLUDED.comensales_confirmados,
    dia_semana = EXCLUDED.dia_semana, turno = EXCLUDED.turno, updated_at = now();

  DELETE FROM public.ocupacion_diaria WHERE fecha = v_fecha AND hora = v_hora AND total_reservas = 0;
  RETURN COALESCE(NEW, OLD);
END; $function$;

CREATE TRIGGER trigger_actualizar_ocupacion
AFTER INSERT OR UPDATE OR DELETE ON public.reservas
FOR EACH ROW EXECUTE FUNCTION public.actualizar_ocupacion_diaria_espacios();
