set client_encoding = 'UTF8';
-- Rollback de 20261101090100_carta_orden_sembrar.sql: vuelve a dejar Platos y
-- Vinos «sin ordenar» (orden 0), como estaban. Ojo: también borra cualquier
-- orden que el dueño haya puesto después desde Gestor web › Carta › Ordenar.
-- Los 6 vinos que tenían NULL quedan en 0 (para la web y el panel es lo mismo).
begin;
update public."Platos" set orden = 0 where orden is distinct from 0;
update public."Vinos" set orden = 0 where orden is distinct from 0;
commit;
