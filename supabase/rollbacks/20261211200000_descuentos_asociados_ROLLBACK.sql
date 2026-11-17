set client_encoding = 'UTF8';
-- ============================================================================
-- ROLLBACK 20261211200000_descuentos_asociados · Facturas (17/11/2026)
-- Quita la asociación de descuentos: triggers, funciones, la tabla de repartos y la columna
-- importe_neto. Lo impreso (total de cada línea) nunca se tocó, así que no hay datos que devolver.
-- Ojo: las funciones que lean importe_neto (migraciones posteriores) hay que revertirlas antes.
-- ============================================================================
set lock_timeout = '5s';

drop trigger if exists trg_productos_factura_descuentos_ins on public.productos_factura;
drop trigger if exists trg_productos_factura_descuentos_upd on public.productos_factura;
drop trigger if exists trg_productos_factura_descuentos_del on public.productos_factura;
drop function if exists public.trg_productos_factura_descuentos();
drop function if exists public.facturas_asociar_descuentos(bigint[]);
drop table if exists public.productos_factura_descuentos;
drop function if exists public.es_linea_descuento(text);
alter table public.productos_factura drop column if exists importe_neto;
