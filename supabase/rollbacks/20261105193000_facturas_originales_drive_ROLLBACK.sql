set client_encoding = 'UTF8';
-- ===========================================================================
-- ROLLBACK de migrations/20261105193000_facturas_originales_drive.sql (A MANO).
-- ===========================================================================
-- Quita PRIMERO el cron. BORRA DATOS: las columnas drive_intentos, drive_error
-- y drive_intento_at de facturas (solo el contador de fallos subiendo a Drive;
-- archivo_path y drive_url no se tocan). Los ficheros ya pasados a Drive y
-- borrados de Storage NO vuelven a Storage (siguen en Drive).
-- Los avisos «original_sin_drive» de la campana se conservan.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

select cron.unschedule('facturas-originales-drive')
 where exists (select 1 from cron.job where jobname = 'facturas-originales-drive');

drop function if exists public.facturas_originales_drive_disparar();
drop function if exists public.facturas_originales_hay_trabajo();
drop function if exists public.facturas_originales_por_pasar(integer);
drop function if exists public.facturas_original_drive_fallo(bigint, text);

drop index if exists public.facturas_archivo_path_pendiente_idx;

alter table public.facturas
  drop column if exists drive_intentos,
  drop column if exists drive_error,
  drop column if exists drive_intento_at;

commit;

select 'facturas_originales_drive: deshecha' as resultado;
