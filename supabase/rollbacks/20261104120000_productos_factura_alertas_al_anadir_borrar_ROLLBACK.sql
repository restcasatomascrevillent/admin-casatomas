-- Rollback de 20261104120000_productos_factura_alertas_al_anadir_borrar.sql
-- Quita los triggers de INSERT/DELETE; el de UPDATE (20261010140000) se queda.
drop trigger if exists trg_productos_factura_alertas_insert on public.productos_factura;
drop trigger if exists trg_productos_factura_alertas_delete on public.productos_factura;
drop function if exists public.productos_factura_recalcular_alertas_lote();
