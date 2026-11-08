set client_encoding = 'UTF8';
-- Deshace 20261117100000_carta_fotos_originales.sql: borra la tabla (y con
-- ella sus políticas y triggers) y su función. Los ficheros originales
-- SIGUEN en Google Drive (marketing/carta/<marca>); Instagram vuelve a usar
-- la versión web de la foto. Se puede aplicar dos veces.
begin;
set local lock_timeout = '5s';
drop table if exists public.carta_fotos_originales;
drop function if exists public.carta_fotos_originales_al_editar();
do $$
begin
  raise notice 'carta_fotos_originales: rollback aplicado (los originales siguen en Drive)';
end;
$$;
commit;
