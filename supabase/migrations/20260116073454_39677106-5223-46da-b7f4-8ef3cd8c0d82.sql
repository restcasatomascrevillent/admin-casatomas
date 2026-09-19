-- Añadir columna etiqueta para las etiquetas bocadillo de las mesas
ALTER TABLE mesas
ADD COLUMN etiqueta TEXT DEFAULT NULL;