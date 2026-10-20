-- Reconstruida desde supabase_migrations.schema_migrations (version 20260305175122).
-- Se aplico directamente sobre el proyecto (dashboard / MCP) y nunca se exporto a
-- este repositorio, lo que dejaba a `supabase db push` con una fila de historial sin
-- fichero local ('Remote migration versions not found in local migrations directory').
-- YA ESTA APLICADA: db push no la ejecuta. Existe para que `db reset` / una branch
-- nueva reproduzcan el esquema real. No editar a mano.

CREATE OR REPLACE FUNCTION validar_capacidad_reserva()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_capacidad_total INT;
  v_ocupacion_turno INT := 0;
  v_es_comida BOOLEAN;
BEGIN
  -- Solo validar si está en un estado que ocupa lugar
  IF NEW.estado NOT IN ('pendiente', 'verificada', 'confirmada') THEN
    RETURN NEW;
  END IF;

  -- 1. Calcular capacidad total de todos los espacios activos
  SELECT COALESCE(SUM(capacidad_maxima), 0)
  INTO v_capacidad_total
  FROM espacios_reserva
  WHERE activa = true;

  -- 2. Determinar turno (comida < 17:00, cena >= 17:00)
  v_es_comida := NEW.hora < '17:00:00'::time;

  -- 3. Bloquear transacciones concurrentes para esta misma fecha y turno
  -- Esto evita race conditions donde dos transacciones leen que hay hueco y luego insertan a la vez.
  PERFORM pg_advisory_xact_lock(
    hashtext(NEW.fecha::text),
    CASE WHEN v_es_comida THEN 1 ELSE 2 END
  );

  -- 4. Calcular ocupación actual del MISMO turno en esa fecha
  SELECT COALESCE(SUM(numero_comensales), 0)
  INTO v_ocupacion_turno
  FROM reservas
  WHERE fecha = NEW.fecha
    -- Excluir la propia reserva si es un UPDATE
    AND (TG_OP = 'INSERT' OR id != NEW.id)
    AND estado IN ('pendiente', 'verificada', 'confirmada')
    AND (
      (v_es_comida AND hora < '17:00:00'::time) OR
      (NOT v_es_comida AND hora >= '17:00:00'::time)
    );

  -- 5. Validar capacidad
  IF v_ocupacion_turno + NEW.numero_comensales > v_capacidad_total THEN
    RAISE EXCEPTION 'Aforo superado para el turno. Capacidad total: %, Ocupación actual: %, Pedidos: %', 
      v_capacidad_total, v_ocupacion_turno, NEW.numero_comensales
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validar_capacidad ON reservas;
CREATE TRIGGER trg_validar_capacidad
BEFORE INSERT OR UPDATE OF fecha, hora, numero_comensales, estado
ON reservas
FOR EACH ROW
EXECUTE FUNCTION validar_capacidad_reserva();
