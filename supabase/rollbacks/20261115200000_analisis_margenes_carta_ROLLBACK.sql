set client_encoding = 'UTF8';
-- ROLLBACK de 20261115200000_analisis_margenes_carta (Análisis general › Márgenes de carta).
-- Borra las RPC y las cuatro tablas: SE PIERDE el escandallo (estimado y corregido),
-- el mapeo de vinos, lo marcado como revisado y los umbrales. Desplegar antes el panel
-- sin la sección «Análisis general» (si no, la pantalla da error al cargar).
-- Copia previa, si se quiere conservar lo corregido a mano:
--   create table zz_backup_escandallo_platos as select * from escandallo_platos;
--   create table zz_backup_vino_producto as select * from vino_producto;
--   create table zz_backup_margenes_carta_revision as select * from margenes_carta_revision;
set lock_timeout = '5s';

drop function if exists public.margenes_compras_producto(bigint, integer);
drop function if exists public.margenes_buscar_productos(text, integer);
drop function if exists public.margenes_guardar_config(jsonb);
drop function if exists public.margenes_marcar_revisado(text, text, boolean);
drop function if exists public.margenes_guardar_vino(text, bigint, text);
drop function if exists public.margenes_guardar_escandallo(text, jsonb);
drop function if exists public.margenes_exigir_edicion();
drop function if exists public.margenes_carta(date);
drop function if exists public.margenes_gramos_venta(text);
drop function if exists public.margenes_carta_costes(bigint[], date, integer);

drop table if exists public.margenes_carta_revision;
drop table if exists public.vino_producto;
drop table if exists public.escandallo_platos;
drop table if exists public.margenes_carta_config;

select 'analisis_margenes_carta: deshecha' as resultado;
