set client_encoding = 'UTF8';
-- Rollback de 20261105150500_tablero_compras.sql: borra tablero_compras() y
-- es_linea_no_producto_tablero(). Solo lectura: no hay datos que restaurar.
-- La pestaña Facturas › Análisis dejará de cargar el tablero (mostrará el error
-- con «Reintentar»). Se puede ejecutar dos veces.
begin;
set local lock_timeout = '5s';

drop function if exists public.tablero_compras(date, date, text);
drop function if exists public.es_linea_no_producto_tablero(text, text);

commit;

select 'tablero_compras: revertida' as resultado;
