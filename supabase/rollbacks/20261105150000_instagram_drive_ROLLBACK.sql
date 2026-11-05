set client_encoding = 'UTF8';
-- ===========================================================================
-- ROLLBACK de migrations/20261105150000_instagram_drive.sql (se ejecuta A MANO).
-- ===========================================================================
-- BORRA DATOS:
--   * Las filas de public.instagram_fotos que SOLO están en Drive (ruta null):
--     su tipo y su descripción. Los ficheros siguen en Drive.
--   * Las columnas drive_id de instagram_fotos e instagram_piezas (qué
--     fichero de Drive corresponde a cada foto y a cada pieza publicada).
-- Copia antes si hace falta:
--   create table public.zz_backup_instagram_fotos_drive as table public.instagram_fotos;
--   create table public.zz_backup_instagram_piezas_drive as select id, drive_id from public.instagram_piezas where drive_id is not null;
--
-- AVISO: revertir el frontend y las Edge Functions (instagram-drive,
-- instagram-publicar) PRIMERO: escriben drive_id.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

delete from public.instagram_fotos where ruta is null;

alter table public.instagram_fotos drop constraint if exists instagram_fotos_origen_chk;
alter table public.instagram_fotos drop constraint if exists instagram_fotos_drive_id_chk;
alter table public.instagram_fotos drop constraint if exists instagram_fotos_drive_id_key;
alter table public.instagram_fotos drop constraint if exists instagram_fotos_ruta_chk;
alter table public.instagram_fotos drop column if exists drive_id;
alter table public.instagram_fotos alter column ruta set not null;
alter table public.instagram_fotos add constraint instagram_fotos_ruta_chk
  check (ruta = 'fotos/' || marca || '/subidas/' || id::text || '.jpg');
comment on column public.instagram_fotos.ruta is 'Ruta en el bucket instagram: fotos/<marca>/subidas/<id>.jpg (CHECK).';

create or replace function public.instagram_fotos_al_editar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.subida_por := coalesce(auth.uid(), new.subida_por);
    new.created_at := now();
  else
    new.id         := old.id;
    new.marca      := old.marca;
    new.ruta       := old.ruta;
    new.ancho      := old.ancho;
    new.alto       := old.alto;
    new.subida_por := old.subida_por;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;
revoke all on function public.instagram_fotos_al_editar() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.instagram_fotos_al_editar() from anon, authenticated';
  end if;
end;
$$;

alter table public.instagram_piezas drop constraint if exists instagram_piezas_drive_id_chk;
alter table public.instagram_piezas drop column if exists drive_id;

commit;
