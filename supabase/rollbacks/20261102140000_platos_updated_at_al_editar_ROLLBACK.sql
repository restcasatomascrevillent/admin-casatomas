set client_encoding = 'UTF8';
-- Rollback de 20261102140000_platos_updated_at_al_editar.sql
begin;
drop trigger if exists trg_platos_updated_at on public."Platos";
drop function if exists public.carta_tocar_updated_at();
commit;
