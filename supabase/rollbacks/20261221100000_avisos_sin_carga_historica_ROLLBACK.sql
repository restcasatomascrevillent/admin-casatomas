set client_encoding = 'UTF8';
-- Deshace 20261221100000_avisos_sin_carga_historica: vuelve a contar toda la carga histórica en
-- «N documentos con avisos sin revisar». Después: select public.facturas_generar_alertas();
begin;

do $rb$
declare
  v_firma text;
  v_def text;
  v_nueva text;
begin
  foreach v_firma in array array['public.facturas_alertas_candidatas(date)', 'public.facturas_alertas_tras_verificar(bigint[])', 'public.avisos_telegram_datos_semanal(date)'] loop
    if to_regprocedure(v_firma) is null then
      continue;
    end if;
    v_def := pg_get_functiondef(v_firma::regprocedure);
    v_nueva := regexp_replace(v_def, '\s+and public\.facturas_aviso_accionable\(fa\.import_clave, fa\.fecha, v_hoy\)', '', 'g');
    if v_nueva <> v_def then
      execute v_nueva;
    end if;
  end loop;
end
$rb$;

drop function if exists public.facturas_aviso_accionable(text, date, date, int);

commit;
