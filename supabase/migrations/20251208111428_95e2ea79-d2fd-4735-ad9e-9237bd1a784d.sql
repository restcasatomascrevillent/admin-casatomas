CREATE OR REPLACE FUNCTION public.notify_n8n_on_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.estado IS DISTINCT FROM OLD.estado THEN
    BEGIN
      -- Intentar enviar webhook con timeout
      PERFORM http_set_curlopt('CURLOPT_TIMEOUT', '5');
      PERFORM http_post(
        'https://n8npersonal.miguelbenito.space/webhook/79fc330e-1683-477e-815e-d4542b54d596',
        json_build_object(
          'old', to_json(OLD),
          'new', to_json(NEW)
        )::text,
        'application/json'
      );
    EXCEPTION WHEN OTHERS THEN
      -- Si falla el webhook, loguear pero NO bloquear la transacción
      RAISE WARNING 'Error enviando webhook n8n: %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$function$;