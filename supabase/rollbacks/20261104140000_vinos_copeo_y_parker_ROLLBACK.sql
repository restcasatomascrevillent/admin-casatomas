set client_encoding = 'UTF8';
-- ROLLBACK de 20261104140000_vinos_copeo_y_parker.sql (vino por copas y
-- puntuación Parker). Aplicar a mano SOLO si hay que deshacerlo.
--
-- BORRA DATOS: se pierden los precios de copa y las puntuaciones Parker
-- guardadas. Antes de aplicarlo, desplegar un panel y una web que no lean estas
-- columnas (la web las ignora si no vienen; el panel las pediría al guardar).
begin;
set local lock_timeout = '5s';

alter table public."Vinos"
  drop constraint if exists vinos_precio_copa_valido,
  drop constraint if exists vinos_copeo_con_precio,
  drop constraint if exists vinos_parker_valido,
  drop constraint if exists vinos_parker_anada_valida;

alter table public."Vinos"
  drop column if exists copeo,
  drop column if exists precio_copa_eur,
  drop column if exists puntuacion_parker,
  drop column if exists puntuacion_parker_anada;

notify pgrst, 'reload schema';
commit;
