set client_encoding = 'UTF8';
-- Rollback de 20261101140000_carta_sin_foto_no_expandida.sql: quita los
-- triggers y la función. No vuelve a marcar como expandidos los platos/vinos
-- sin foto (eso era el fallo).
begin;
drop trigger if exists trg_platos_sin_foto_no_expandida on public."Platos";
drop trigger if exists trg_vinos_sin_foto_no_expandida on public."Vinos";
drop function if exists public.carta_sin_foto_no_expandida();
commit;
