-- Quitar trigger que intenta escribir en una tabla inexistente
DROP TRIGGER IF EXISTS trigger_cambio_estado_reserva ON public.reservas;

-- Eliminar función asociada para evitar futuras referencias
DROP FUNCTION IF EXISTS public.registrar_cambio_estado_reserva() CASCADE;