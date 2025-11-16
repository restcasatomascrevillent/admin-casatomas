-- Eliminar trigger que causa error al actualizar estado de reservas
DROP TRIGGER IF EXISTS trigger_fecha_verificacion ON public.reservas;
DROP TRIGGER IF EXISTS actualizar_fecha_verificacion ON public.reservas;

-- Eliminar la función asociada que ya no se necesita
DROP FUNCTION IF EXISTS public.actualizar_fecha_verificacion() CASCADE;