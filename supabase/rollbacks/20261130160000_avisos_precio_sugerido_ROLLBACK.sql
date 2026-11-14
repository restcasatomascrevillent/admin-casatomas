-- Vuelta atrás de 20261130160000_avisos_precio_sugerido.
-- Los precios ya aplicados NO se deshacen (quedan en historial_ajustes_precios).
set lock_timeout = '5s';
drop function if exists public.avisos_aplicar_precio_sugerido(uuid, numeric);
drop function if exists public.avisos_precio_sugerido(uuid);
