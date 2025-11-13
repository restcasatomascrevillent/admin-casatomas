-- Eliminar vista que depende de posicion_sala_id
DROP VIEW IF EXISTS vista_ocupacion CASCADE;

-- Eliminar columnas que referencian posiciones_sala
ALTER TABLE reservas DROP COLUMN IF EXISTS posicion_sala_id;
ALTER TABLE ocupacion_diaria DROP COLUMN IF EXISTS posicion_sala_id;

-- Eliminar la tabla posiciones_sala
DROP TABLE IF EXISTS posiciones_sala CASCADE;

-- Recrear vista de ocupación sin posiciones
CREATE OR REPLACE VIEW vista_ocupacion AS
SELECT 
  od.fecha,
  od.hora,
  od.sala_id,
  s.nombre as sala,
  s.numero_mesas as total_mesas_sala,
  s.capacidad_maxima,
  od.total_mesas_reservadas,
  (s.numero_mesas - od.total_mesas_reservadas) as mesas_disponibles,
  od.total_comensales,
  od.total_reservas,
  ROUND((od.total_mesas_reservadas::numeric / s.numero_mesas::numeric) * 100, 2) as porcentaje_ocupacion
FROM ocupacion_diaria od
JOIN salas s ON s.id = od.sala_id
WHERE s.activa = true;

-- Insertar datos ficticios de salas
INSERT INTO salas (nombre, descripcion, capacidad_maxima, numero_mesas, activa, caracteristicas) VALUES
('Sala Principal', 'Zona principal con vista a la calle', 80, 20, true, '{"ambiente": "elegante", "iluminacion": "natural"}'::jsonb),
('Terraza', 'Terraza exterior climatizada', 40, 10, true, '{"exterior": true, "climatizada": true}'::jsonb),
('Sala Privada', 'Reservado para eventos especiales', 30, 8, true, '{"privada": true, "sonido": "aislado"}'::jsonb),
('Barra', 'Zona de barra y mesas altas', 20, 6, true, '{"informal": true, "estilo": "casual"}'::jsonb),
('Salón VIP', 'Exclusivo para clientes VIP', 25, 6, true, '{"vip": true, "servicio": "premium"}'::jsonb);
