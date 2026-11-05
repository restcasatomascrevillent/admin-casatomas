set client_encoding = 'UTF8';
-- Rollback de 20261105170000_explorar_compras.sql: borra explorar_compras(),
-- documentos_de_cifra() y sus ayudantes. Solo lectura: no hay datos que
-- restaurar. El explorador y «Ver documentos» de Facturas › Análisis enseñarán
-- el error con «Reintentar»; el tablero (tablero_compras) sigue. Se puede
-- ejecutar dos veces.
begin;
set local lock_timeout = '5s';

drop function if exists public.documentos_de_cifra(date, date, text, text, text, jsonb, text, text, int, int, int);
drop function if exists public.explorar_compras(date, date, text, text, text, jsonb, int);
drop function if exists public.explorar_compras_hechos(date, date, text, text, text, jsonb);
drop function if exists public.explorar_compras_etiqueta(text, text, bigint, text, text);
drop function if exists public.explorar_compras_clave(text, date, text, text, text, bigint, text);
drop function if exists public.explorar_compras_error(text, text, text, jsonb, int);
drop function if exists public.explorar_compras_por_lineas(text, text, text, jsonb);

commit;

select 'explorar_compras: revertida' as resultado;
