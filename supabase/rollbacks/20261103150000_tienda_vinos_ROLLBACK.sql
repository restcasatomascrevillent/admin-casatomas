set client_encoding = 'UTF8';
-- ROLLBACK de 20261103150000_tienda_vinos.sql (Tienda de vinos, escaparate).
-- Aplicar a mano SOLO si hay que deshacerlo. Borra la configuración de la
-- tienda (visible sí/no, descuento, vinos quitados de la venta, textos), la
-- RPC del panel, la función del precio y el interruptor del Super Admin.
-- No toca Vinos ni ninguna otra tabla. Tampoco borra los permisos de la
-- sección 'tienda' en user_permissions (inofensivos sin la pantalla).
-- Antes, quitar (o comprobar) la sección Tienda de la web: la web lee esta
-- tabla en vivo con la clave anon.
begin;
set local lock_timeout = '5s';

drop function if exists public.tienda_marcar_vinos(text[], boolean);
drop table if exists public.configuracion_tienda;
drop function if exists public.configuracion_tienda_al_editar();
drop function if exists public.tienda_precio_venta(numeric, numeric);

do $$
begin
  if to_regclass('public.admin_feature_toggles') is not null then
    delete from public.admin_feature_toggles where section_key = 'tienda';
  end if;
end;
$$;

commit;
