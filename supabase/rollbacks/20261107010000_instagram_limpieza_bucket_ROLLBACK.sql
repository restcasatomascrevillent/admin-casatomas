set client_encoding = 'UTF8';
-- ===========================================================================
-- ROLLBACK de migrations/20261107010000_instagram_limpieza_bucket.sql (A MANO).
-- ===========================================================================
-- BORRA DATOS: la columna instagram_piezas.imagen_borrada_at. Los JPEG ya
-- borrados NO vuelven (se regeneran desde el panel). Copia antes si hace falta:
--   create table public.zz_backup_instagram_imagen_borrada as select id, imagen_borrada_at from public.instagram_piezas where imagen_borrada_at is not null;
--
-- Quita PRIMERO el cron. Devuelve instagram_programacion_pieza a su versión
-- de 20261106110000 (sin la comprobación de imagen_borrada_at).
-- ===========================================================================

begin;
set local lock_timeout = '5s';

select cron.unschedule('instagram-limpieza-bucket')
 where exists (select 1 from cron.job where jobname = 'instagram-limpieza-bucket');

drop function if exists public.instagram_piezas_reclamar_jpeg_caducados(integer, integer);

create or replace function public.instagram_programacion_pieza(p_pieza_id uuid)
returns public.instagram_piezas
language plpgsql
volatile
set search_path = ''
as $$
declare
  v public.instagram_piezas;
begin
  select * into v from public.instagram_piezas where id = p_pieza_id for update;
  if not found then
    raise exception 'No existe esa pieza' using errcode = 'P0002';
  end if;
  if v.media_id is not null or v.estado = 'publicada' then
    raise exception 'Esa pieza ya está publicada' using errcode = '22023';
  end if;
  if v.imagen_ruta is null then
    raise exception 'La pieza no tiene imagen: genérala antes de programarla' using errcode = '22023';
  end if;
  return v;
end;
$$;
revoke all on function public.instagram_programacion_pieza(uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.instagram_programacion_pieza(uuid) from anon, authenticated';
  end if;
end;
$$;

drop trigger if exists instagram_piezas_imagen_borrada on public.instagram_piezas;
drop function if exists public.instagram_piezas_imagen_borrada();
alter table public.instagram_piezas drop column if exists imagen_borrada_at;

commit;

select 'instagram_limpieza_bucket: deshecha' as resultado;
