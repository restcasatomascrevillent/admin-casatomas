set client_encoding = 'UTF8';
-- Vuelta atrás de 20261207231500_escandallos_control_enlace_producto.
begin;
drop trigger if exists escandallo_marcar_enlace_trg on public.escandallo_platos;
drop function if exists public.escandallo_marcar_enlace();
drop function if exists public.escandallos_enlaces_dudosos();
drop function if exists public.escandallo_enlace_dudoso(text, text);
alter table public.escandallo_platos drop column if exists revisar_enlace;
commit;
