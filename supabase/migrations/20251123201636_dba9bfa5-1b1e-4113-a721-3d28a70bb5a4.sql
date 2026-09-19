-- Paso 1: Eliminar la constraint antigua
ALTER TABLE ocupacion_diaria 
DROP CONSTRAINT IF EXISTS ocupacion_diaria_sala_id_fkey;

-- Paso 2: Limpiar todos los registros huérfanos
DELETE FROM ocupacion_diaria
WHERE sala_id NOT IN (
  SELECT id FROM espacios_reserva
);

-- Paso 3: Crear nueva constraint apuntando a espacios_reserva
ALTER TABLE ocupacion_diaria
ADD CONSTRAINT ocupacion_diaria_sala_id_fkey 
FOREIGN KEY (sala_id) REFERENCES espacios_reserva(id) ON DELETE CASCADE;

-- Paso 4: Recalcular ocupación desde reservas válidas
INSERT INTO ocupacion_diaria (fecha, hora, espacio_id, sala_id, total_comensales, total_reservas)
SELECT 
  r.fecha,
  r.hora,
  NULL as espacio_id,
  r.sala_id,
  COALESCE(SUM(r.numero_comensales), 0),
  COUNT(*)
FROM reservas r
WHERE r.estado != 'cancelada'
GROUP BY r.fecha, r.hora, r.sala_id
ON CONFLICT (fecha, hora, sala_id) DO UPDATE SET
  total_comensales = EXCLUDED.total_comensales,
  total_reservas = EXCLUDED.total_reservas,
  updated_at = now();