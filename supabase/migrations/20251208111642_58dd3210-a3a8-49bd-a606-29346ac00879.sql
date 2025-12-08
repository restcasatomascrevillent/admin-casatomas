-- Eliminar el trigger que causa el bucle de peticiones HTTP
DROP TRIGGER IF EXISTS notify_n8n_on_reserva_update ON public.reservas;