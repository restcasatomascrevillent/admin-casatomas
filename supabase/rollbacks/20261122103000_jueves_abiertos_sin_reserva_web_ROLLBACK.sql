set client_encoding = 'UTF8';
-- ===========================================================================
-- VUELTA ATRÁS de 20261122103000_jueves_abiertos_sin_reserva_web.sql
-- ===========================================================================
-- Borra la columna `dias_abiertos_sin_reserva_online` y su CHECK. La regla de
-- los canales no cambia (la migración tampoco la tocó). El panel, sin la
-- columna, sigue suponiendo el jueves abierto sin reservas web (respaldo en
-- `DIAS_ABIERTOS_SIN_RESERVA_ONLINE_POR_DEFECTO`); para volver a pintarlo
-- «Cerrado» hay que revertir también el código del panel. A mano (psql / SQL
-- editor), solo para deshacer el despliegue.
-- ===========================================================================
begin;
set local lock_timeout = '5s';
alter table public.configuracion_reservas
  drop constraint if exists configuracion_reservas_dias_abiertos_sin_online_validos;
alter table public.configuracion_reservas
  drop column if exists dias_abiertos_sin_reserva_online;
commit;
