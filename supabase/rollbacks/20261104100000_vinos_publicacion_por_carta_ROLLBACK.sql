set client_encoding = 'UTF8';
-- ROLLBACK de 20261104100000_vinos_publicacion_por_carta.sql (un interruptor
-- por carta en Vinos y sin publicar sin origen). Aplicar a mano SOLO si hay
-- que deshacerlo.
--
-- Quita el trigger y las dos funciones: `activado` vuelve a ser una columna
-- que se escribe a mano (el panel antiguo con «Activo») y la base de datos deja
-- de exigir país, región y denominación para publicar. Quita también los
-- comentarios de las columnas.
--
-- NO cambia datos: los vinos que la migración sacó de las dos cartas (los que
-- ya estaban ocultos y los de «… ORIGEN PENDIENTE»: restaurante = false,
-- touza = false, activado = false) siguen ocultos. Para volver a publicar los
-- de origen pendiente como antes habría que encenderlos a mano (en la demo,
-- 18: los de esas categorías que no estaban ocultos antes de la migración).
begin;
set local lock_timeout = '5s';

drop trigger if exists trg_vinos_publicacion_por_carta on public."Vinos";
drop function if exists public.vinos_publicacion_por_carta();
drop function if exists public.vino_categoria_origen_pendiente(text);

comment on column public."Vinos".activado is null;
comment on column public."Vinos".restaurante is null;
comment on column public."Vinos".touza is null;

commit;
