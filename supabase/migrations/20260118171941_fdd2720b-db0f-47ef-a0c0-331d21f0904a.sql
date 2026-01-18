-- Añadir campo para guardar la posición de la imagen en las tarjetas
ALTER TABLE public.novedades 
ADD COLUMN imagen_posicion_y integer DEFAULT 50;

-- Comentario: El valor representa el % de posición vertical (0-100), 50 = centrado