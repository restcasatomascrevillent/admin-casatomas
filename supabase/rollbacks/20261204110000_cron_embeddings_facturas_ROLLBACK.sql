-- Vuelta atrás de 20261204110000: el despachador vuelve a mirar solo los nombres.
create or replace function public.embeddings_nombres_despachar()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_url     text;
  v_secreto text;
begin
  if not exists (select 1 from public.productos_nombre_embedding where embedding is null) then
    return 0;
  end if;
  v_url := public.url_funcion_edge('embeddings-nombres');
  select s.decrypted_secret into v_secreto
    from vault.decrypted_secrets s where s.name = 'ocr_trabajos_secret' limit 1;
  if v_url is null or v_secreto is null or v_secreto = '' then
    return 0;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-ocr-secret', v_secreto),
    body := jsonb_build_object('modo', 'cron'),
    timeout_milliseconds := 10000);
  return 1;
end;
$function$;
