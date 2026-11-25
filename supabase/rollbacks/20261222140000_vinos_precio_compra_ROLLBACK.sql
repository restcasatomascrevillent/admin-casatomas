set client_encoding = 'UTF8';
-- ROLLBACK de 20261222140000_vinos_precio_compra
-- Quita los dos crons, los disparadores, las funciones y las tablas vinos_precio_compra y
-- vinos_precio_compra_cola. No toca facturas, líneas, vinos ni enlaces: la tabla solo era una copia
-- calculada (se vuelve a rellenar entera al reaplicar la migración). El panel, sin la tabla, deja de
-- enseñar «Compra» en las tarjetas sin romper la carta.
set lock_timeout = '5s';

do $$
begin
  if to_regclass('cron.job') is not null then
    if exists (select 1 from cron.job where jobname = 'vinos-precio-compra') then
      perform cron.unschedule('vinos-precio-compra');
    end if;
    if exists (select 1 from cron.job where jobname = 'vinos-precio-compra-diario') then
      perform cron.unschedule('vinos-precio-compra-diario');
    end if;
  end if;
end;
$$;

drop trigger if exists trg_vinos_precio_compra_lineas_ins on public.productos_factura;
drop trigger if exists trg_vinos_precio_compra_lineas_upd on public.productos_factura;
drop trigger if exists trg_vinos_precio_compra_lineas_del on public.productos_factura;
drop trigger if exists trg_vinos_precio_compra_facturas_upd on public.facturas;
drop trigger if exists trg_vinos_precio_compra_enlaces on public.vino_producto;
drop trigger if exists trg_vinos_precio_compra_vinos on public."Vinos";

drop function if exists public.vinos_precio_compra_apuntar();
drop function if exists public.vinos_precio_compra_apuntar_lineas();
drop function if exists public.vinos_precio_compra_apuntar_facturas();
drop function if exists public.vinos_precio_compra_refrescar_pendiente(interval);
drop function if exists public.vinos_precio_compra_refrescar(date);

drop table if exists public.vinos_precio_compra_cola;
drop table if exists public.vinos_precio_compra;
