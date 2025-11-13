-- Arreglar las funciones añadiendo search_path
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_cambio_estado_reserva()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF OLD.estado IS DISTINCT FROM NEW.estado THEN
    INSERT INTO historial_reservas (reserva_id, estado_anterior, estado_nuevo, modificado_por, user_id)
    VALUES (NEW.id, OLD.estado, NEW.estado, NEW.verificada_por, NEW.user_id);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.actualizar_fecha_verificacion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.estado = 'verificada' AND OLD.estado != 'verificada' THEN
    NEW.fecha_verificacion = NOW();
  END IF;
  IF NEW.estado = 'confirmada' AND OLD.estado != 'confirmada' THEN
    NEW.fecha_confirmacion = NOW();
  END IF;
  RETURN NEW;
END;
$function$;

-- Recrear las vistas sin SECURITY DEFINER (usando SECURITY INVOKER por defecto)
DROP VIEW IF EXISTS public.vista_ocupacion_salas;
CREATE VIEW public.vista_ocupacion_salas AS
SELECT 
  r.fecha,
  t.nombre AS turno,
  s.nombre AS sala,
  COUNT(*) AS total_reservas,
  SUM(r.numero_comensales) AS total_comensales,
  s.capacidad_maxima,
  ROUND((SUM(r.numero_comensales)::numeric / s.capacidad_maxima::numeric) * 100, 2) AS porcentaje_ocupacion
FROM reservas r
JOIN turnos t ON r.turno_id = t.id
JOIN salas s ON r.sala_id = s.id
WHERE r.estado IN ('verificada', 'confirmada')
GROUP BY r.fecha, t.nombre, s.nombre, s.capacidad_maxima;

DROP VIEW IF EXISTS public.vista_reservas_pendientes;
CREATE VIEW public.vista_reservas_pendientes AS
SELECT 
  r.id,
  r.fecha,
  r.hora,
  t.nombre AS turno,
  s.nombre AS sala,
  r.numero_comensales,
  CONCAT(c.nombre, ' ', c.apellidos) AS nombre_cliente,
  c.telefono,
  c.email,
  r.created_at AS fecha_solicitud
FROM reservas r
JOIN turnos t ON r.turno_id = t.id
JOIN salas s ON r.sala_id = s.id
LEFT JOIN clientes c ON r.cliente_id = c.id
WHERE r.estado = 'pendiente';

DROP VIEW IF EXISTS public.vista_trabajadores_hoy;
CREATE VIEW public.vista_trabajadores_hoy AS
SELECT 
  CURRENT_DATE AS fecha,
  CONCAT(tr.nombre, ' ', tr.apellidos) AS trabajador,
  tr.rol,
  tu.nombre AS turno,
  s.nombre AS sala,
  ps.nombre AS posicion
FROM asignaciones_turno at
JOIN trabajadores tr ON at.trabajador_id = tr.id
JOIN turnos tu ON at.turno_id = tu.id
LEFT JOIN salas s ON at.sala_id = s.id
LEFT JOIN posiciones_sala ps ON at.posicion_sala_id = ps.id
WHERE at.fecha = CURRENT_DATE;