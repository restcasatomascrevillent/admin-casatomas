set client_encoding = 'UTF8';
-- Deshace 20261122200000_reservas_zona_preferida.sql. BORRA el «¿Dentro o fuera?» de todas las reservas
-- (la sala asignada, espacio_id, no se toca). El panel aguanta sin la columna en «Hoy» (relee sin ella) y el
-- alta la omite avisando, pero editar «dentro o fuera» fallaría: mejor publicar antes un panel que no la use.
begin;

alter table public.reservas drop constraint if exists reservas_zona_preferida_valida;
alter table public.reservas drop column if exists zona_preferida;

notify pgrst, 'reload schema';

commit;
