set client_encoding = 'UTF8';
-- Deshace 20261122190000_reservas_menu_cerrado.sql. BORRA la marca «Menú
-- cerrado» y su precio de todas las reservas (el «Menú del día», menu_del_dia,
-- no se toca). El panel de ahora aguanta sin las columnas en «Hoy» (relee sin
-- ellas), pero el alta y la edición con menú cerrado fallarían: publicar antes
-- un panel que no las escriba.
begin;

alter table public.reservas drop constraint if exists reservas_menu_precio_solo_menu_cerrado;
alter table public.reservas drop constraint if exists reservas_menu_precio_no_negativo;
alter table public.reservas
  drop column if exists menu_precio,
  drop column if exists menu_cerrado;

commit;
