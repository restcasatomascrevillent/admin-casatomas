set client_encoding = 'UTF8';
-- ROLLBACK de 20261107120000_reservas_mesa_fijada.sql. Aplicar a mano SOLO si
-- hay que deshacerlo.
--
-- BORRA DATOS: se pierde qué reservas tenían la mesa fijada (las mesas
-- asignadas no se tocan). Antes, desplegar un panel que no pida la columna
-- `mesa_fijada` (si no, «Hoy» fallaría al leer las reservas).
begin;
set local lock_timeout = '5s';

alter table public.reservas drop column if exists mesa_fijada;

notify pgrst, 'reload schema';
commit;
