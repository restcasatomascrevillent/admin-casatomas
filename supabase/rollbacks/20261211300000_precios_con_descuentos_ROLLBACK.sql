set client_encoding = 'UTF8';
-- ============================================================================
-- ROLLBACK 20261211300000_precios_con_descuentos · Facturas (17/11/2026)
-- Las mismas funciones vuelven a usar el importe impreso (sin los descuentos asociados): deshace las
-- cinco sustituciones de texto (P5 la primera, porque contiene a P2). No toca datos.
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
  foreach v_fn in array c_funciones loop
    for v_oid in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = v_fn loop
      v_def := pg_get_functiondef(v_oid);
      v_nuevo := v_def;
      -- P5 primero: su texto nuevo contiene el de P2.
      for i in 1 .. array_length(c_nuevo, 1) loop
        v_nuevo := replace(v_nuevo, c_nuevo[i], c_viejo[i]);
      end loop;
      if v_nuevo <> v_def then
        execute v_nuevo;
      end if;
    end loop;
  end loop;
end;
$$;
