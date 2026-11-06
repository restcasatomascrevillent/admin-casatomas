set client_encoding = 'UTF8';
-- ROLLBACK de 20261104151000_platos_vegetarianos.sql. Aplicar a mano SOLO si hay
-- que deshacerlo.
--
-- BORRA DATOS: se pierden las etiquetas «vegetariano»/«vegano» de los platos
-- (también las puestas a mano en el panel) y el filtro «Vegetariano» de la web
-- vuelve a no enseñar ninguno. Antes, desplegar un panel que no tenga la
-- casilla «Vegetariano» (si no, al marcarla fallaría el guardado).
begin;
set local lock_timeout = '5s';

alter table public."Platos" drop constraint if exists platos_etiquetas_dieteticas_validas;
alter table public."Platos" drop column if exists etiquetas_dieteticas;

notify pgrst, 'reload schema';
commit;
