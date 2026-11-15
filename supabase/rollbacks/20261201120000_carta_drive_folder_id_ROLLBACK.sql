set client_encoding = 'UTF8';
-- Deshace 20261201120000_carta_drive_folder_id.sql: quita drive_folder_id de
-- "Platos" y "Vinos" (con sus CHECK) y devuelve carta_tocar_updated_at() a la
-- versión de 20261102140000. Las carpetas SIGUEN en Google Drive; solo se
-- pierde el enlace guardado (el panel vuelve a buscarlas por nombre). Se puede
-- aplicar dos veces.
begin;
set local lock_timeout = '5s';

create or replace function public.carta_tocar_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.carta_tocar_updated_at() from public, anon, authenticated;

alter table public."Platos" drop constraint if exists platos_drive_folder_id_chk;
alter table public."Vinos"  drop constraint if exists vinos_drive_folder_id_chk;
alter table public."Platos" drop column if exists drive_folder_id;
alter table public."Vinos"  drop column if exists drive_folder_id;

do $$
begin
  raise notice 'carta_drive_folder_id: rollback aplicado (las carpetas siguen en Drive)';
end;
$$;
commit;
