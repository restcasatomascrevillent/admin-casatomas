-- Eliminar el trigger primero
DROP TRIGGER IF EXISTS agregar_suscriptor_al_reservar ON public.reservas;

-- Ahora eliminar la función
DROP FUNCTION IF EXISTS public.agregar_suscriptor_desde_reserva();