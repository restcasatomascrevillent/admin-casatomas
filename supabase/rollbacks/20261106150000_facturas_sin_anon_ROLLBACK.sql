set client_encoding = 'UTF8';
-- Rollback de 20261106150000_facturas_sin_anon.sql: devuelve a anon los
-- privilegios que tenía el 2026-11-05 en la demo (todos, en cada tabla y vista
-- salvo nombres_linea_no_producto, que ya no los tenía). La RLS sigue
-- bloqueando a anon igual que antes. No toca datos. Se puede ejecutar dos veces.
begin;
set local lock_timeout = '5s';

do $$
declare
  t text;
begin
  foreach t in array array[
    'facturas', 'productos_factura', 'proveedores', 'proveedores_alias',
    'productos_catalogo', 'productos_catalogo_antigua', 'productos_alias', 'categorias_producto',
    'facturas_sustituciones', 'ocr_trabajos', 'ocr_trabajo_paginas', 'productos_factura_unidades_respaldo',
    'configuracion_facturas',
    'chat_facturas_conversaciones', 'chat_facturas_mensajes',
    'vista_gastos_mensuales', 'vista_gastos_proveedor_mes', 'vista_productos_top', 'vista_proveedores_resumen'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('grant all on table public.%I to anon', t);
    end if;
  end loop;
end;
$$;

commit;

select 'facturas_sin_anon: revertida' as resultado;
