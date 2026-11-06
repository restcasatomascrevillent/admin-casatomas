set client_encoding = 'UTF8';
-- ===========================================================================
-- ROLLBACK de migrations/20261107000000_instagram_publicacion_servidor.sql (A MANO).
-- ===========================================================================
-- BORRA DATOS: la columna instagram_piezas.alt_text (los textos alternativos
-- guardados) y la tabla de cerrojos (solo cerrojos de minutos). Copia antes
-- si hace falta:
--   create table public.zz_backup_instagram_alt_text as select id, alt_text from public.instagram_piezas where alt_text is not null;
--
-- Si 20261107010000_instagram_limpieza_bucket está aplicada, deshazla ANTES
-- (su RPC lee instagram_publicaciones_en_curso).
--
-- Tras deshacerla, el panel vuelve a poder escribir el estado de publicación
-- (como antes). Las Edge Functions siguen funcionando: escriben con
-- service_role y, sin la RPC del cerrojo, publican sin cerrojo.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

drop function if exists public.instagram_pieza_liberar_publicacion(uuid, uuid);
drop function if exists public.instagram_pieza_reservar_publicacion(uuid, integer, boolean);
drop table if exists public.instagram_publicaciones_en_curso;

drop trigger if exists instagram_piezas_proteger_publicacion on public.instagram_piezas;
drop function if exists public.instagram_piezas_proteger_publicacion();

alter table public.instagram_piezas drop constraint if exists instagram_piezas_alt_text_chk;
alter table public.instagram_piezas drop column if exists alt_text;

commit;

select 'instagram_publicacion_servidor: deshecha' as resultado;
