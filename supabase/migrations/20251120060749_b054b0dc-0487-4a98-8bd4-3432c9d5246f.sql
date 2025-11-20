-- Eliminar datos de ocupación de la terraza duplicada
DELETE FROM ocupacion_diaria WHERE espacio_id = '9b933cfb-7524-4016-bd07-9abaf4921f5a';

-- Eliminar la terraza duplicada (mantenemos la primera)
DELETE FROM espacios_reserva WHERE id = '9b933cfb-7524-4016-bd07-9abaf4921f5a' AND nombre = 'Terraza';