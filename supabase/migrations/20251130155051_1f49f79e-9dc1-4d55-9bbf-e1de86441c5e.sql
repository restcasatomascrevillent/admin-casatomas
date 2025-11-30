-- Corregir funciones sin search_path definido

-- 1. Función de actualización de ocupación
CREATE OR REPLACE FUNCTION public.actualizar_ocupacion_diaria_espacios()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Recalcular estadísticas para esa fecha/hora/espacio (excluyendo canceladas)
  INSERT INTO public.ocupacion_diaria (
    fecha,
    hora,
    espacio_id,
    sala_id,
    total_comensales,
    total_reservas
  )
  SELECT 
    r.fecha,
    r.hora,
    r.sala_id as espacio_id,
    r.sala_id,
    COALESCE(SUM(r.numero_comensales), 0),
    COUNT(*)
  FROM public.reservas r
  WHERE r.fecha = v_fecha
    AND r.hora = v_hora
    AND r.sala_id = v_espacio_id
    AND r.estado != 'cancelada'
  GROUP BY r.fecha, r.hora, r.sala_id
  ON CONFLICT (fecha, hora, sala_id)
  DO UPDATE SET
    total_comensales = EXCLUDED.total_comensales,
    total_reservas = EXCLUDED.total_reservas,
    updated_at = now();

  -- Eliminar registro si no hay reservas
  DELETE FROM public.ocupacion_diaria
  WHERE fecha = v_fecha
    AND hora = v_hora
    AND sala_id = v_espacio_id
    AND total_reservas = 0;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 2. Función de actualización de timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- 3. Función de cálculo de horas trabajadas
CREATE OR REPLACE FUNCTION public.calcular_horas_trabajadas()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.hora_salida IS NOT NULL THEN
    NEW.horas_trabajadas := EXTRACT(EPOCH FROM (NEW.hora_salida - NEW.hora_entrada)) / 3600;
  END IF;
  RETURN NEW;
END;
$$;

-- 4. Función de notificación n8n (si se usa)
CREATE OR REPLACE FUNCTION public.notify_n8n_on_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  res json;
BEGIN
  IF NEW.estado IS DISTINCT FROM OLD.estado THEN
    PERFORM http_post(
      'https://oficiososia.app.n8n.cloud/webhook-test/79fc330e-1683-477e-815e-d4542b54d596',
      json_build_object(
        'old', to_json(OLD),
        'new', to_json(NEW)
      )::text,
      'application/json'
    );
  END IF;
  RETURN NEW;
END;
$$;