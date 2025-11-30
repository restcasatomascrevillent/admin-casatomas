-- Actualizar función de notificación n8n con nueva URL de webhook
CREATE OR REPLACE FUNCTION public.notify_n8n_on_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  res json;
BEGIN
  IF NEW.estado IS DISTINCT FROM OLD.estado THEN
    PERFORM http_post(
      'https://n8npersonal.miguelbenito.space/webhook/79fc330e-1683-477e-815e-d4542b54d596',
      json_build_object(
        'old', to_json(OLD),
        'new', to_json(NEW)
      )::text,
      'application/json'
    );
  END IF;
  RETURN NEW;
END;
$$;