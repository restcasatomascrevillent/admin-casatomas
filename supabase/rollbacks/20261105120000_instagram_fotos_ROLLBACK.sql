set client_encoding = 'UTF8';
-- ===========================================================================
-- ROLLBACK de migrations/20261105120000_instagram_fotos.sql (se ejecuta A MANO).
-- ===========================================================================
-- BORRA DATOS: la tabla public.instagram_fotos (qué fotos subieron los
-- usuarios, su tipo y su descripción). Copia antes si hace falta:
--   create table public.zz_backup_instagram_fotos as table public.instagram_fotos;
--
-- NO borra los ficheros fotos/<marca>/subidas/*.jpg del bucket «instagram»:
-- las URL públicas siguen funcionando. Para quitarlos, desde el panel de
-- Supabase (Storage) o con remove() de supabase-js.
--
-- Las piezas que usen una foto subida dejarán de validar («La foto … no está
-- en el catálogo de fotos») hasta que se vuelva a aplicar la migración.
--
-- AVISO: revertir el frontend PRIMERO (el selector de fotos lee
-- instagram_fotos; sin la tabla daría 42P01 / PGRST205).
-- ===========================================================================

begin;
set local lock_timeout = '5s';

drop table if exists public.instagram_fotos;
drop function if exists public.instagram_fotos_al_editar();

commit;
