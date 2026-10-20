set client_encoding = 'UTF8';
-- ===========================================================================
-- ROLLBACK de supabase/migrations/20261008110000_ia_funciones_ocr_instrumentado.sql
-- ===========================================================================
-- No es una migración (ver supabase/rollbacks/README.md). Se ejecuta A MANO,
-- POR TERMINAL (no en el SQL Editor):
--   npx supabase db query --linked -f supabase/rollbacks/20261008110000_ia_funciones_ocr_instrumentado_ROLLBACK.sql
--
-- ANTES: revertir el panel (el monitor de gasto de Facturas llama a
-- gasto_ia_resumen; sin ella dice «sin datos todavía», no se rompe).
-- Quita gasto_ia_resumen, la fila 'ocr-trabajo' de ia_funciones y devuelve
-- procesar-factura a instrumentada = false. Las filas ya escritas en ia_uso
-- por procesar-factura / ocr-trabajo SE QUEDAN (son gasto real). Si las
-- funciones siguen desplegadas con el registro, seguirán escribiendo filas.
-- Imprime «ia_funciones_ocr_instrumentado: revertida | 0».
-- ===========================================================================

begin;
set local lock_timeout = '5s';

drop function if exists public.gasto_ia_resumen(text[], integer);
delete from public.ia_funciones where funcion = 'ocr-trabajo';
update public.ia_funciones set instrumentada = false where funcion = 'procesar-factura';

commit;

select 'ia_funciones_ocr_instrumentado: revertida' as resultado,
       (select count(*) from pg_proc where proname = 'gasto_ia_resumen') as funciones_que_quedan;
