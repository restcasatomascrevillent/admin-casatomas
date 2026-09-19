-- =============================================
-- SISTEMA UNIFICADO DE ESTADÍSTICAS + GDPR
-- =============================================

-- PASO 1: Extender ocupacion_diaria con métricas adicionales
ALTER TABLE public.ocupacion_diaria 
  ADD COLUMN IF NOT EXISTS reservas_confirmadas integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reservas_canceladas integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reservas_no_show integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comensales_confirmados integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dia_semana integer,
  ADD COLUMN IF NOT EXISTS turno text; -- 'comida' o 'cena'

-- PASO 2: Mejorar el trigger para capturar más estadísticas
CREATE OR REPLACE FUNCTION public.actualizar_ocupacion_diaria_espacios()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_fecha date;
  v_hora time;
  v_espacio_id uuid;
BEGIN
  -- Obtener datos de la reserva
  IF TG_OP = 'DELETE' THEN
    v_fecha := OLD.fecha;
    v_hora := OLD.hora;
    v_espacio_id := OLD.sala_id;
  ELSE
    v_fecha := NEW.fecha;
    v_hora := NEW.hora;
    v_espacio_id := NEW.sala_id;
  END IF;

  -- Recalcular estadísticas para esa fecha/hora/espacio
  INSERT INTO public.ocupacion_diaria (
    fecha,
    hora,
    espacio_id,
    sala_id,
    total_comensales,
    total_reservas,
    reservas_confirmadas,
    reservas_canceladas,
    reservas_no_show,
    comensales_confirmados,
    dia_semana,
    turno
  )
  SELECT 
    r.fecha,
    r.hora,
    r.sala_id as espacio_id,
    r.sala_id,
    COALESCE(SUM(r.numero_comensales), 0),
    COUNT(*),
    COUNT(*) FILTER (WHERE r.estado = 'confirmada'),
    COUNT(*) FILTER (WHERE r.estado = 'cancelada'),
    COUNT(*) FILTER (WHERE r.estado = 'no_show'),
    COALESCE(SUM(r.numero_comensales) FILTER (WHERE r.estado = 'confirmada'), 0),
    EXTRACT(DOW FROM r.fecha)::integer,
    CASE WHEN r.hora < '16:00' THEN 'comida' ELSE 'cena' END
  FROM public.reservas r
  WHERE r.fecha = v_fecha
    AND r.hora = v_hora
    AND r.sala_id = v_espacio_id
  GROUP BY r.fecha, r.hora, r.sala_id
  ON CONFLICT (fecha, hora, sala_id)
  DO UPDATE SET
    total_comensales = EXCLUDED.total_comensales,
    total_reservas = EXCLUDED.total_reservas,
    reservas_confirmadas = EXCLUDED.reservas_confirmadas,
    reservas_canceladas = EXCLUDED.reservas_canceladas,
    reservas_no_show = EXCLUDED.reservas_no_show,
    comensales_confirmados = EXCLUDED.comensales_confirmados,
    dia_semana = EXCLUDED.dia_semana,
    turno = EXCLUDED.turno,
    updated_at = now();

  -- Eliminar registro si no hay reservas
  DELETE FROM public.ocupacion_diaria
  WHERE fecha = v_fecha
    AND hora = v_hora
    AND sala_id = v_espacio_id
    AND total_reservas = 0;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- PASO 3: Recrear vista_ocupacion_hoy para usar ocupacion_diaria
DROP VIEW IF EXISTS public.vista_ocupacion_hoy;
CREATE VIEW public.vista_ocupacion_hoy AS
SELECT 
  e.id AS espacio_id,
  e.nombre AS espacio_nombre,
  e.capacidad_maxima,
  COALESCE(SUM(od.total_reservas) - COALESCE(SUM(od.reservas_canceladas), 0), 0)::integer AS total_reservas,
  COALESCE(SUM(od.comensales_confirmados), 0)::integer AS total_comensales,
  CASE 
    WHEN e.capacidad_maxima > 0 THEN 
      ROUND((COALESCE(SUM(od.comensales_confirmados), 0)::numeric / e.capacidad_maxima * 100), 0)
    ELSE 0 
  END AS porcentaje_ocupacion
FROM public.espacios_reserva e
LEFT JOIN public.ocupacion_diaria od ON od.espacio_id = e.id 
  AND od.fecha = CURRENT_DATE
WHERE e.activa = true
GROUP BY e.id, e.nombre, e.capacidad_maxima;

-- PASO 4: Crear vista de estadísticas semanales (sin tabla adicional)
CREATE OR REPLACE VIEW public.vista_estadisticas_semanales AS
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
GROUP BY date_trunc('week', od.fecha), od.espacio_id, e.nombre
ORDER BY semana_inicio DESC;

-- PASO 5: Crear vista de estadísticas mensuales
CREATE OR REPLACE VIEW public.vista_estadisticas_mensuales AS
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
GROUP BY date_trunc('month', od.fecha), od.espacio_id, e.nombre
ORDER BY mes_inicio DESC;

-- =============================================
-- SISTEMA GDPR
-- =============================================

-- PASO 6: Tabla de configuración GDPR
CREATE TABLE IF NOT EXISTS public.gdpr_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tabla text NOT NULL UNIQUE,
  dias_retencion integer NOT NULL,
  accion text NOT NULL CHECK (accion IN ('eliminar', 'anonimizar')),
  campos_anonimizar text[],
  activo boolean DEFAULT true,
  descripcion text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Configuración inicial GDPR
INSERT INTO public.gdpr_config (tabla, dias_retencion, accion, campos_anonimizar, descripcion) VALUES
  ('reservas', 1095, 'anonimizar', ARRAY['nombre', 'email', 'telefono', 'notas_cliente'], 
   'Anonimizar datos personales de reservas después de 3 años'),
  ('blacklist', 730, 'eliminar', NULL, 
   'Eliminar entradas de blacklist después de 2 años'),
  ('resenas', 1825, 'anonimizar', ARRAY['nombre_cliente', 'email'], 
   'Anonimizar reseñas después de 5 años')
ON CONFLICT (tabla) DO NOTHING;

-- PASO 7: Tabla de auditoría GDPR
CREATE TABLE IF NOT EXISTS public.gdpr_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accion text NOT NULL,
  tabla text NOT NULL,
  registros_afectados integer DEFAULT 0,
  detalles jsonb,
  ejecutado_por text DEFAULT 'sistema',
  created_at timestamptz DEFAULT now()
);

-- PASO 8: Función de limpieza automática GDPR
CREATE OR REPLACE FUNCTION public.ejecutar_limpieza_gdpr()
RETURNS TABLE(tabla text, accion text, registros_procesados integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_config RECORD;
  v_count integer;
  v_fecha_limite date;
BEGIN
  FOR v_config IN SELECT * FROM gdpr_config WHERE activo = true
  LOOP
    v_count := 0;
    v_fecha_limite := CURRENT_DATE - v_config.dias_retencion;
    
    -- Procesar según la tabla y acción
    IF v_config.tabla = 'reservas' AND v_config.accion = 'anonimizar' THEN
      UPDATE reservas SET
        nombre = 'Cliente Anonimizado',
        email = NULL,
        telefono = NULL,
        notas_cliente = NULL
      WHERE fecha < v_fecha_limite
        AND nombre IS DISTINCT FROM 'Cliente Anonimizado';
      GET DIAGNOSTICS v_count = ROW_COUNT;
      
    ELSIF v_config.tabla = 'resenas' AND v_config.accion = 'anonimizar' THEN
      UPDATE resenas SET
        nombre_cliente = 'Cliente Anonimizado',
        email = NULL
      WHERE fecha < v_fecha_limite
        AND nombre_cliente IS DISTINCT FROM 'Cliente Anonimizado';
      GET DIAGNOSTICS v_count = ROW_COUNT;
      
    ELSIF v_config.tabla = 'blacklist' AND v_config.accion = 'eliminar' THEN
      DELETE FROM blacklist 
      WHERE created_at < v_fecha_limite::timestamptz;
      GET DIAGNOSTICS v_count = ROW_COUNT;
    END IF;
    
    -- Registrar en auditoría si hubo cambios
    IF v_count > 0 THEN
      INSERT INTO gdpr_audit_log (accion, tabla, registros_afectados, detalles)
      VALUES (
        v_config.accion,
        v_config.tabla,
        v_count,
        jsonb_build_object(
          'dias_retencion', v_config.dias_retencion,
          'fecha_limite', v_fecha_limite,
          'campos_afectados', v_config.campos_anonimizar
        )
      );
    END IF;
    
    tabla := v_config.tabla;
    accion := v_config.accion;
    registros_procesados := v_count;
    RETURN NEXT;
  END LOOP;
END;
$function$;

-- PASO 9: Función para recalcular ocupación histórica (útil para poblar datos iniciales)
CREATE OR REPLACE FUNCTION public.recalcular_ocupacion_historica(fecha_desde date DEFAULT NULL, fecha_hasta date DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer := 0;
  v_fecha_inicio date;
  v_fecha_fin date;
BEGIN
  v_fecha_inicio := COALESCE(fecha_desde, CURRENT_DATE - interval '1 year');
  v_fecha_fin := COALESCE(fecha_hasta, CURRENT_DATE);
  
  -- Limpiar datos existentes en el rango
  DELETE FROM ocupacion_diaria 
  WHERE fecha BETWEEN v_fecha_inicio AND v_fecha_fin;
  
  -- Insertar datos agregados desde reservas
  INSERT INTO ocupacion_diaria (
    fecha, hora, espacio_id, sala_id,
    total_comensales, total_reservas,
    reservas_confirmadas, reservas_canceladas, reservas_no_show,
    comensales_confirmados, dia_semana, turno
  )
  SELECT 
    r.fecha,
    r.hora,
    r.sala_id,
    r.sala_id,
    SUM(r.numero_comensales),
    COUNT(*),
    COUNT(*) FILTER (WHERE r.estado = 'confirmada'),
    COUNT(*) FILTER (WHERE r.estado = 'cancelada'),
    COUNT(*) FILTER (WHERE r.estado = 'no_show'),
    COALESCE(SUM(r.numero_comensales) FILTER (WHERE r.estado = 'confirmada'), 0),
    EXTRACT(DOW FROM r.fecha)::integer,
    CASE WHEN r.hora < '16:00' THEN 'comida' ELSE 'cena' END
  FROM reservas r
  WHERE r.fecha BETWEEN v_fecha_inicio AND v_fecha_fin
  GROUP BY r.fecha, r.hora, r.sala_id
  ON CONFLICT (fecha, hora, sala_id) DO UPDATE SET
    total_comensales = EXCLUDED.total_comensales,
    total_reservas = EXCLUDED.total_reservas,
    reservas_confirmadas = EXCLUDED.reservas_confirmadas,
    reservas_canceladas = EXCLUDED.reservas_canceladas,
    reservas_no_show = EXCLUDED.reservas_no_show,
    comensales_confirmados = EXCLUDED.comensales_confirmados,
    dia_semana = EXCLUDED.dia_semana,
    turno = EXCLUDED.turno,
    updated_at = now();
  
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

-- PASO 10: Poblar datos históricos existentes
SELECT public.recalcular_ocupacion_historica();

-- PASO 11: RLS para las nuevas tablas
ALTER TABLE public.gdpr_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gdpr_audit_log ENABLE ROW LEVEL SECURITY;

-- Solo admins pueden ver/modificar configuración GDPR
CREATE POLICY "Admins can manage gdpr_config"
  ON public.gdpr_config
  FOR ALL
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins can view gdpr_audit_log"
  ON public.gdpr_audit_log
  FOR SELECT
  USING (public.is_admin(auth.uid()));

-- Trigger para updated_at en gdpr_config
CREATE TRIGGER update_gdpr_config_updated_at
  BEFORE UPDATE ON public.gdpr_config
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();