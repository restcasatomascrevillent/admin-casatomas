-- Revierte migrations/20261026120000_ia_precios_replicate_fondo.sql.
-- Solo borra la tarifa: las filas de ia_uso ya registradas se quedan (su coste
-- pasa a salir NULL). Revertir antes la función si se quiere dejar de usarla.
begin;
set local lock_timeout = '5s';
delete from public.ia_precios where modelo = 'replicate:men1scus/birefnet';
commit;
