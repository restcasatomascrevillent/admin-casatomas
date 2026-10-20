-- ===========================================================================
-- ROLLBACK de supabase/migrations/20260925120000_reconstruir_facturas_productos_proveedores.sql
-- ===========================================================================
--
-- Este fichero NO es una migracion y no debe copiarse a
-- supabase/migrations/ (ver supabase/rollbacks/README.md sobre por que
-- viven aqui separados). Se ejecuta a mano (psql / SQL editor) y solo
-- para deshacer un despliegue que salio mal.
--
-- AVISO SERIO, DISTINTO AL RESTO DE FICHEROS DE ESTA CARPETA
--   Este rollback hace DROP TABLE de `facturas`, `productos_factura` y
--   `proveedores`. En el proyecto real (jeamoczmbfsnwkfjxcyo) esas tres
--   tablas tienen datos de negocio de verdad -- facturas y albaranes
--   escaneados por OCR, con meses de historico -- que ya existian ANTES
--   de la migracion que este fichero revierte (esa migracion es un
--   CREATE TABLE IF NOT EXISTS: no creo esos datos, se limito a
--   documentar el esquema que ya habia). Ejecutar este rollback contra
--   produccion no "deshace un despliegue": BORRA TODAS LAS FACTURAS,
--   ALBARANES, LINEAS Y PROVEEDORES REALES, sin ninguna copia previa ni
--   en este fichero ni en la migracion que revierte.
--
--   Este fichero solo tiene sentido contra un entorno DESECHABLE
--   levantado a partir de esa misma migracion (un `supabase db reset`
--   de prueba, una preview branch) para comprobar que el CREATE TABLE
--   reconstruido es idempotente y limpio. Contra el proyecto real: NUNCA.
--
-- QUE REVIERTE Y QUE NO
--   SI revierte: las 3 tablas (con sus indices, policies y triggers
--   propios, que Postgres suelta solos al hacer DROP TABLE) y la funcion
--   `verificar_duplicado_factura` con sus GRANT/REVOKE.
--
--   NO revierte -- y no debe intentarlo -- las funciones de trigger
--   `actualizar_updated_at()` y `actualizar_historial_precios()` que
--   tambien crea esa migracion. La primera la sigue usando HOY el
--   trigger `trigger_productos_catalogo_updated` de `productos_catalogo`,
--   tabla ajena a esta reconstruccion: borrarla rompe ese trigger aunque
--   `productos_catalogo` no se toque para nada aqui. Si de verdad hace
--   falta quitarlas, comprobar primero contra el catalogo real que nada
--   mas las usa (misma consulta que trae la seccion 4 de la cabecera de
--   20260925120000_reconstruir_facturas_productos_proveedores.sql):
--
--   select tgrelid::regclass, tgname
--   from pg_trigger t join pg_proc p on p.oid = t.tgfoid
--   where p.proname in ('actualizar_updated_at', 'actualizar_historial_precios')
--     and not t.tgisinternal;
--
-- CUANDO USAR ESTO
--   Solo para limpiar un entorno de pruebas desechable despues de haber
--   aplicado la migracion companera. Nunca contra jeamoczmbfsnwkfjxcyo.
-- ---------------------------------------------------------------------------

begin;

drop function if exists public.verificar_duplicado_factura(
  character varying, character varying, date, numeric
);

-- productos_factura primero: tiene la FK hacia facturas.
drop table if exists public.productos_factura;
drop table if exists public.facturas;
drop table if exists public.proveedores;

commit;

-- ---------------------------------------------------------------------------
-- CONSULTA DE VERIFICACION -- ejecutar despues de este rollback:
--
-- select to_regclass('public.facturas') as facturas,
--        to_regclass('public.productos_factura') as productos_factura,
--        to_regclass('public.proveedores') as proveedores;
-- -- debe devolver NULL en las 3 columnas.
--
-- select proname from pg_proc where proname = 'verificar_duplicado_factura';
-- -- debe devolver 0 filas.
--
-- select proname from pg_proc where proname in ('actualizar_updated_at', 'actualizar_historial_precios');
-- -- debe seguir devolviendo las 2 (no las toca este rollback, ver aviso de arriba).
-- ---------------------------------------------------------------------------
