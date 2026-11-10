set client_encoding = 'UTF8';
-- Test de 20261121100000_alertas_proveedor_nuevo_sin_campana. BEGIN … ROLLBACK.
-- Genera las alertas y comprueba que ninguna de proveedor nuevo queda sin leer
-- (las antiguas ya leídas sin la marca «campana» no cuentan).
begin;
do $$
declare n int;
begin
  perform public.facturas_generar_alertas();
  select count(*) into n from notificaciones_dashboard
   where tipo = 'facturas_proveedor_nuevo' and not coalesce(leida, false);
  if n > 0 then raise exception 'FALLO: % avisos de proveedor nuevo siguen en la campana', n; end if;
  if position('facturas_proveedor_nuevo' in pg_get_functiondef('public.facturas_generar_alertas(date)'::regprocedure)) = 0 then
    raise exception 'FALLO: la función no trata proveedor nuevo';
  end if;
end $$;
select 'alertas_proveedor_nuevo_sin_campana_test: OK' as resultado;
rollback;
