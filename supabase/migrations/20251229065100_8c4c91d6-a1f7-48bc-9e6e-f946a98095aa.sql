-- Añadir columna expanded a la tabla Platos
ALTER TABLE public."Platos" 
ADD COLUMN expanded boolean DEFAULT false;

-- Actualizar los platos de "Novedades del día" a expanded = true
UPDATE public."Platos" 
SET expanded = true 
WHERE categoria = 'Novedades del día';