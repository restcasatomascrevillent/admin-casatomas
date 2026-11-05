set client_encoding = 'UTF8';
-- ===========================================================================
-- ROLLBACK de migrations/20261106200000_facturas_cargar_qa.sql (A MANO).
-- ===========================================================================
-- No borra datos. Deshace:
--   · las RPC del panel ocr_descartar_trabajo y ocr_reintentar_trabajo (el
--     panel nuevo cae a su comportamiento anterior si no existen) y
--     ocr_caducar_duplicados;
--   · las políticas de Storage facturas_originales_insert/_update y el
--     límite del bucket a 10 MB.
-- Después hay que VOLVER A APLICAR migrations/20261105193000_facturas_originales_drive.sql
-- (idempotente) para recuperar las versiones anteriores de
-- facturas_originales_por_pasar / _hay_trabajo / _drive_disparar y
-- facturas_original_drive_fallo.
-- NO se deshacen a propósito:
--   · url_funcion_edge y las versiones de ocr_despachar,
--     productos_despachar_clasificacion y openai_despachar_sincronizacion_costes
--     que leen la URL de Vault: las anteriores llevaban fija la URL del
--     proyecto VIEJO (jeamoczmbfsnwkfjxcyo) y no funcionaban en este;
--   · los crons de emails-reserva que pasaron a leer la URL de Vault;
--   · el cron reanudar-trabajos-ocr (lo instala ya 20261005120000).
-- Los trabajos que el cron ya dio por «cancelado» (duplicados caducados) y
-- los originales que ya subió a Drive se quedan como están.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

drop function if exists public.ocr_descartar_trabajo(uuid);
drop function if exists public.ocr_reintentar_trabajo(uuid);

-- facturas_originales_drive_disparar (versión de esta migración) llama a
-- ocr_caducar_duplicados: se deja una versión que no la necesita hasta que
-- se vuelva a aplicar 20261105193000.
create or replace function public.facturas_originales_drive_disparar()
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  return false;
end;
$$;
drop function if exists public.ocr_caducar_duplicados();

drop policy if exists facturas_originales_insert on storage.objects;
create policy facturas_originales_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'facturas-originales' and public.can_write_section('facturas'));
drop policy if exists facturas_originales_update on storage.objects;
create policy facturas_originales_update on storage.objects
  for update to authenticated
  using (bucket_id = 'facturas-originales' and public.can_write_section('facturas'))
  with check (bucket_id = 'facturas-originales' and public.can_write_section('facturas'));

update storage.buckets set file_size_limit = 10485760 where id = 'facturas-originales';

commit;

select 'facturas_cargar_qa: deshecha (aplica ahora 20261105193000_facturas_originales_drive.sql)' as resultado,
       to_regprocedure('public.ocr_descartar_trabajo(uuid)') is null as sin_descartar,
       (select file_size_limit from storage.buckets where id = 'facturas-originales') as limite_bucket;
