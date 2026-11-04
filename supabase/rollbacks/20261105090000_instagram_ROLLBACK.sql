set client_encoding = 'UTF8';
-- ===========================================================================
-- ROLLBACK de migrations/20261105090000_instagram.sql (se ejecuta A MANO).
-- ===========================================================================
-- BORRA DATOS: la tabla public.instagram_piezas con todas las piezas (datos,
-- pies de foto, ids y enlaces de Instagram). Copia antes si hace falta:
--   create table public.zz_backup_instagram_piezas as table public.instagram_piezas;
--
-- Quita las 4 políticas instagram_objetos_* de storage.objects: desde ese
-- momento el panel ya no puede subir ni borrar en el bucket (service_role sí).
--
-- NO borra el bucket «instagram» ni sus ficheros (fotos e imágenes
-- generadas): las URL públicas siguen funcionando. Para quitarlo del
-- todo, vaciarlo y borrarlo desde el panel de Supabase (Storage).
--
-- AVISO: revertir el frontend PRIMERO (la sección Instagram del panel lee y
-- escribe instagram_piezas; sin la tabla daría 42P01 / PGRST205).
-- ===========================================================================

begin;
set local lock_timeout = '5s';

drop policy if exists instagram_objetos_select_seccion on storage.objects;
drop policy if exists instagram_objetos_insert_seccion on storage.objects;
drop policy if exists instagram_objetos_update_seccion on storage.objects;
drop policy if exists instagram_objetos_delete_seccion on storage.objects;

drop table if exists public.instagram_piezas;
drop function if exists public.instagram_piezas_al_editar();

commit;
