set client_encoding = 'UTF8';
-- ============================================================================
-- 20261211300000_precios_con_descuentos · Facturas (17/11/2026)
-- Con 20261211200000 cada línea sabe su importe con los descuentos asociados (importe_neto). Aquí
-- lo usan las funciones que calculan un precio, un coste o una suma por producto o familia, en vez
-- del importe impreso sin descuento (barril de Cruzcampo 50 l: 99,57 € y no 200 €; vinos de Riscal
-- con su 20 % de bonificación):
--   márgenes de la carta (margenes_carta_costes, margenes_carta_ultima, margenes_compras_producto),
--   coste de la carta de vinos (vinos_coste_carta_datos), Análisis (tablero_compras,
--   explorar_compras_hechos), alertas e informe de precios (facturas_alertas_candidatas,
--   informe_precios_compras) y precios del copiloto (lineas_precio_agente, compras_producto_agente,
--   historial_precios_agente, serie_precios_agente, variacion_precios_agente).
-- Mismo cuerpo, cinco sustituciones de texto (las que no aparecen en una función no hacen nada):
--   P5 «pf.cantidad, pf.precio_unitario, pf.total::numeric as importe» → precio y precio unitario netos
--   P1 «coalesce(pf.precio_unitario, …»  → primero importe_neto / cantidad si la línea tiene descuento
--   P2 «pf.total::numeric as importe», P3 «pf.total as importe», P4 «pf.total::numeric as imp,»
--      → coalesce(pf.importe_neto, pf.total)
-- Lo que mira el importe IMPRESO (líneas a 0 € = regalo, abonos, «pf.total > 0») no cambia.
-- Rollback: supabase/rollbacks/20261211300000_precios_con_descuentos_ROLLBACK.sql
-- ============================================================================
set lock_timeout = '5s';

do $$
declare
  c_funciones constant text[] := array[
    'margenes_carta_costes', 'margenes_carta_ultima', 'margenes_compras_producto', 'vinos_coste_carta_datos',
    'tablero_compras', 'explorar_compras_hechos', 'facturas_alertas_candidatas', 'informe_precios_compras',
    'lineas_precio_agente', 'compras_producto_agente', 'historial_precios_agente', 'serie_precios_agente',
    'variacion_precios_agente'];
  c_viejo constant text[] := array[
    'pf.cantidad, pf.precio_unitario, pf.total::numeric as importe',
    'coalesce(pf.precio_unitario, ',
    'pf.total::numeric as importe',
    'pf.total as importe',
    'pf.total::numeric as imp,'];
  c_nuevo constant text[] := array[
    'pf.cantidad, coalesce(pf.importe_neto / nullif(pf.cantidad, 0), pf.precio_unitario) as precio_unitario, coalesce(pf.importe_neto, pf.total)::numeric as importe',
    'coalesce(pf.importe_neto / nullif(pf.cantidad, 0), pf.precio_unitario, ',
    'coalesce(pf.importe_neto, pf.total)::numeric as importe',
    'coalesce(pf.importe_neto, pf.total) as importe',
    'coalesce(pf.importe_neto, pf.total)::numeric as imp,'];
  v_fn text;
  v_oid oid;
  v_def text;
  v_nuevo text;
  i int;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'productos_factura' and column_name = 'importe_neto') then
    raise exception '20261211300000: falta 20261211200000 (productos_factura.importe_neto). No se ha cambiado nada.';
  end if;
  foreach v_fn in array c_funciones loop
    for v_oid in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = v_fn loop
      v_def := pg_get_functiondef(v_oid);
      v_nuevo := v_def;
      for i in 1 .. array_length(c_viejo, 1) loop
        v_nuevo := replace(v_nuevo, c_viejo[i], c_nuevo[i]);
      end loop;
      if v_nuevo <> v_def then
        execute v_nuevo;
        raise notice '20261211300000: % ya usa el importe con descuentos.', v_fn;
      else
        raise notice '20261211300000: % sin cambios (ya lo usaba o su cuerpo es otro).', v_fn;
      end if;
    end loop;
  end loop;
end;
$$;
