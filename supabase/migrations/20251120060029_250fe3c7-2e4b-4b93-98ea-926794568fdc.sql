-- Primero eliminar los datos de ocupación de espacios que no sean Salón, Comedor o Terraza
DELETE FROM ocupacion_diaria 
WHERE espacio_id IN (
  SELECT id FROM espacios_reserva 
  WHERE nombre NOT IN ('Salón', 'Comedor', 'Terraza')
);

-- Ahora eliminar los espacios que NO sean Salón, Comedor o Terraza
DELETE FROM espacios_reserva 
WHERE nombre NOT IN ('Salón', 'Comedor', 'Terraza');

-- Asegurarnos de que los tres espacios principales existen
-- Si no existen, los creamos con valores por defecto
INSERT INTO espacios_reserva (nombre, descripcion, capacidad_maxima, activa)
SELECT 'Salón', 'Espacio principal del restaurante', 50, true
WHERE NOT EXISTS (SELECT 1 FROM espacios_reserva WHERE nombre = 'Salón');

INSERT INTO espacios_reserva (nombre, descripcion, capacidad_maxima, activa)
SELECT 'Comedor', 'Zona de comedor interior', 40, true
WHERE NOT EXISTS (SELECT 1 FROM espacios_reserva WHERE nombre = 'Comedor');

INSERT INTO espacios_reserva (nombre, descripcion, capacidad_maxima, activa)
SELECT 'Terraza', 'Terraza exterior', 30, true
WHERE NOT EXISTS (SELECT 1 FROM espacios_reserva WHERE nombre = 'Terraza');