-- Paso 1: Eliminar triggers antiguos duplicados
DROP TRIGGER IF EXISTS trigger_actualizar_ocupacion_insert ON public.reservas;
DROP TRIGGER IF EXISTS trigger_actualizar_ocupacion_update ON public.reservas;
DROP TRIGGER IF EXISTS trigger_actualizar_ocupacion_delete ON public.reservas;

-- Paso 2: Mantener solo el trigger unificado (ya existe)
-- El trigger 'trigger_actualizar_ocupacion' ya usa la función actualizar_ocupacion_diaria_espacios()

-- Paso 3: Actualizar registros existentes para poblar espacio_id
UPDATE public.ocupacion_diaria
SET espacio_id = sala_id
WHERE espacio_id IS NULL;

-- Paso 4: Hacer espacio_id NOT NULL para mantener integridad
ALTER TABLE public.ocupacion_diaria 
  ALTER COLUMN espacio_id SET NOT NULL;

-- Paso 5: Eliminar la función antigua que ya no se usa
DROP FUNCTION IF EXISTS public.actualizar_ocupacion_diaria();

-- Paso 6: Verificar que la vista vista_ocupacion funcione correctamente
-- (No requiere cambios, ya usa ocupacion_diaria.espacio_id correctamente)