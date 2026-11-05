set client_encoding = 'UTF8';
-- Rollback de 20261105190000_compras_lista_ligera.sql: borra documentos_lista(),
-- buscar_documentos_compras(), documento_compras(), la columna generada
-- productos_factura.nombre_busqueda y sus dos funciones de apoyo. Solo lectura:
-- no hay datos que restaurar. El panel vuelve solo a la carga de antes
-- (documentos con todas sus líneas) al no encontrar las funciones.
-- Se puede ejecutar dos veces.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '10min';  -- quitar la columna reescribe la tabla

drop function if exists public.documentos_lista();
drop function if exists public.buscar_documentos_compras(text);
drop function if exists public.documento_compras(bigint);
alter table public.productos_factura drop column if exists nombre_busqueda;
drop function if exists public.es_servicio_compras(text);
drop function if exists public.texto_busqueda_compras(text);

commit;

select 'compras_lista_ligera: revertida' as resultado;
