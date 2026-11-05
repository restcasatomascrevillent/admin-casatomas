set client_encoding = 'UTF8';
-- ===========================================================================
-- facturas_sin_anon · 20261106150000 · 2026-11-06
-- ===========================================================================
--
-- Fallo 9 de QA (defensa extra): las tablas y vistas de Facturas tenían TODOS
-- los privilegios para anon (select, insert, update, delete, truncate…). La
-- RLS ya lo bloquea (ninguna política es para anon y las vistas son
-- security_invoker), pero si alguien desactivara la RLS por error, la clave
-- pública de la web lo vería todo. Se quitan a anon.
--
-- Comprobado antes (2026-11-06): ni la web pública (web-casatomas: src, api,
-- supabase) ni ninguna página sin sesión del panel leen estas tablas; el panel
-- entra como authenticated y las Edge Functions (chat-facturas, OCR) como
-- authenticated o service_role. authenticated y service_role no cambian.
--
-- Fuera a propósito: lo de cheques regalo (facturas_cheques,
-- plantilla_factura_cheques, factura_contadores) y oficiososia_* (otros
-- dominios, con sus propios tests).
--
-- Idempotente; si una tabla no existe (otro entorno) se salta.
-- Test: supabase/tests/facturas_sin_anon_test.sql
-- Rollback: supabase/rollbacks/20261106150000_facturas_sin_anon_ROLLBACK.sql
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $$
declare
  t text;
begin
  foreach t in array array[
    'facturas', 'productos_factura', 'proveedores', 'proveedores_alias',
    'productos_catalogo', 'productos_catalogo_antigua', 'productos_alias', 'categorias_producto',
    'facturas_sustituciones', 'ocr_trabajos', 'ocr_trabajo_paginas', 'productos_factura_unidades_respaldo',
    'configuracion_facturas', 'nombres_linea_no_producto',
    -- vistas (security_invoker) sobre las tablas de arriba
    'chat_facturas_conversaciones', 'chat_facturas_mensajes',
    'vista_gastos_mensuales', 'vista_gastos_proveedor_mes', 'vista_productos_top', 'vista_proveedores_resumen'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke all on table public.%I from anon', t);
    end if;
  end loop;
end;
$$;

commit;
