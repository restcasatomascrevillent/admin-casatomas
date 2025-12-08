-- Eliminar el trigger que causa el bucle de peticiones HTTP
DROP TRIGGER IF EXISTS n8n_update_trigger ON public.reservas;

-- Eliminar la función ya que no se usará más (la Edge Function la reemplaza)
DROP FUNCTION IF EXISTS public.notify_n8n_on_update();