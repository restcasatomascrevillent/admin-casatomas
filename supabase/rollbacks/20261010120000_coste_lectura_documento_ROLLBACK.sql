set client_encoding = 'UTF8';
-- ===========================================================================
-- ROLLBACK de supabase/migrations/20261010120000_coste_lectura_documento.sql
-- ===========================================================================
-- No es una migración (ver supabase/rollbacks/README.md). Se ejecuta A MANO,
-- POR TERMINAL (no en el SQL Editor):
--   npx supabase db query --linked -f supabase/rollbacks/20261010120000_coste_lectura_documento_ROLLBACK.sql
--
-- Borra las RPC estadisticas_lectura y ocr_sumar_gasto y las columnas
-- facturas.coste_lectura_usd / lectura_llamadas / lectura_modelo y
-- ocr_trabajos.llamadas (SE PIERDE el coste por documento guardado; el coste de
-- los trabajos sigue en ocr_trabajos.coste_usd y el gasto en ia_uso). Las Edge
-- Functions y el panel nuevos toleran que no existan (avisan por log y no
-- pintan el coste).
-- Imprime «coste_lectura_documento: revertida | 0».
-- ===========================================================================

begin;
set local lock_timeout = '5s';

drop function if exists public.estadisticas_lectura(integer);
drop function if exists public.ocr_sumar_gasto(uuid, numeric, integer);
alter table public.facturas
  drop column if exists coste_lectura_usd,
  drop column if exists lectura_llamadas,
  drop column if exists lectura_modelo;
alter table public.ocr_trabajos drop column if exists llamadas;

commit;

select 'coste_lectura_documento: revertida' as resultado, 0 as restos;
