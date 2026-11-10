set client_encoding = 'UTF8';
-- ROLLBACK de 20261122093000_platos_aptitudes_manuales.sql. Aplicar a mano SOLO
-- si hay que deshacerlo.
--
-- BORRA DATOS: se pierde lo marcado a mano en «Apto para celíacos» y «Apto sin
-- lactosa»; los platos vuelven a decidirse solo por sus alérgenos. Antes,
-- desplegar un panel (y una web) que no usen estas columnas: si no, al cambiar
-- esos interruptores fallaría el guardado.
begin;
set local lock_timeout = '5s';

alter table public."Platos" drop column if exists apto_celiacos;
alter table public."Platos" drop column if exists apto_sin_lactosa;

notify pgrst, 'reload schema';
commit;
