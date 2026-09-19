-- Agregar constraint único para ON CONFLICT en ocupacion_diaria
ALTER TABLE ocupacion_diaria 
ADD CONSTRAINT ocupacion_diaria_fecha_hora_sala_key 
UNIQUE (fecha, hora, sala_id);