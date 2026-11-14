set client_encoding = 'UTF8';
-- Test de 20261128150000_chatbot_ultima_factura (requiere 20261128140000). BEGIN … ROLLBACK:
-- no deja nada escrito. Acaba en «chatbot_ultima_factura_test: OK».
--   npx supabase db query --remote=sfonaclosuafvlhutkon -f supabase/tests/chatbot_ultima_factura_test.sql
--
-- Datos: «Zorblaxuf langostino» al kilo. PROVEEDOR B: 20 €/kg (01/03/2031) y 26 €/kg (20/06/2031,
-- la ÚLTIMA). PROVEEDOR A: 18 €/kg (10/06/2031, más nueva que la anterior de B).
--   T1 compras_producto: ultima_factura = la de B a 26 €/kg con su número, lo primero del JSON junto a
--      como_leer; por_proveedor con ultimo_precio y numero; orden precio = por la última factura
--      (A a 18 € antes que B a 26 €).
--   T2 historial_precios: ultima_factura y, por proveedor, ultimo_precio, numero y ultima_compra.
--   T3 variacion_precios con p_comparar 'anterior': 26 frente a 20 (la anterior de B, no la de A) =
--      +30 %, con anterior.numero y la media aparte; sin p_comparar (el panel), como antes (ref_precio).
--   T4 json_delante_agente pone las claves delante y deja el resto.
--   T5 (20261130180000) última factura con dos líneas del producto a 30 y 24 €/kg: misma_factura con
--      precios [24, 30] y precio_medio 27 en compras_producto e historial; variacion_precios da 27.
begin;

do $$
declare
  v_pa bigint; v_pb bigint; v_pc bigint; v_f bigint;
  j json; jb jsonb; e jsonb;
begin
  insert into productos_catalogo (nombre, origen) values ('Zorblaxuf langostino', 'manual') returning id into v_pc;
  insert into proveedores (nombre, cif) values ('PRUEBA UF PROVEEDOR A', 'B00000714') returning id into v_pa;
  insert into proveedores (nombre, cif) values ('PRUEBA UF PROVEEDOR B', 'B00000715') returning id into v_pb;

  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total)
  values ('factura', 'PRUEBA UF PROVEEDOR B', 'B00000715', v_pb, 'ZUF-B1', '2031-03-01', 40) returning id into v_f;
  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, producto_id)
  values (v_f, 'ZORBLAXUF LANGOSTINO', 2, 'kg', 20, 40, v_pc);
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total)
  values ('factura', 'PRUEBA UF PROVEEDOR A', 'B00000714', v_pa, 'ZUF-A1', '2031-06-10', 36) returning id into v_f;
  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, producto_id)
  values (v_f, 'ZORBLAXUF LANGOSTINO', 2, 'kg', 18, 36, v_pc);
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total)
  values ('factura', 'PRUEBA UF PROVEEDOR B', 'B00000715', v_pb, 'ZUF-B2', '2031-06-20', 52) returning id into v_f;
  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, producto_id)
  values (v_f, 'ZORBLAXUF LANGOSTINO', 2, 'kg', 26, 52, v_pc);

  -- T1 ─────────────────────────────────────────────────────────────────────
  j := public.compras_producto_agente('zorblaxuf langostino', p_orden => 'precio', p_base => false);
  if left(j::text, 13) <> '{"como_leer":' then
    raise exception 'FALLO T1: como_leer y ultima_factura no van delante: %', left(j::text, 80);
  end if;
  jb := j::jsonb;
  if jb->'ultima_factura'->>'numero' <> 'ZUF-B2' or (jb->'ultima_factura'->>'precio_unitario')::numeric <> 26
     or jb->'ultima_factura'->>'proveedor' <> 'PRUEBA UF PROVEEDOR B' or (jb->'ultima_factura'->>'documento_id')::bigint <> v_f then
    raise exception 'FALLO T1: ultima_factura %', jb->'ultima_factura';
  end if;
  if jb->'por_proveedor'->0->>'proveedor' <> 'PRUEBA UF PROVEEDOR A' or (jb->'por_proveedor'->0->>'ultimo_precio')::numeric <> 18
     or jb->'por_proveedor'->0->>'numero' <> 'ZUF-A1'
     or (jb->'por_proveedor'->1->>'ultimo_precio')::numeric <> 26 or jb->'por_proveedor'->1->>'numero' <> 'ZUF-B2' then
    raise exception 'FALLO T1: por_proveedor %', jb->'por_proveedor';
  end if;

  -- T2 ─────────────────────────────────────────────────────────────────────
  jb := public.historial_precios_agente('zorblaxuf langostino', 20, false)::jsonb;
  if jb->'ultima_factura'->>'numero' <> 'ZUF-B2' or (jb->'ultima_factura'->>'precio_unitario')::numeric <> 26 or jb->>'como_leer' is null then
    raise exception 'FALLO T2: ultima_factura %', jb->'ultima_factura';
  end if;
  select x into e from jsonb_array_elements(jb->'por_proveedor') x where x->>'proveedor' = 'PRUEBA UF PROVEEDOR B';
  if (e->>'ultimo_precio')::numeric <> 26 or e->>'numero' <> 'ZUF-B2' or e->>'ultima_compra' <> '2031-06-20' then
    raise exception 'FALLO T2: proveedor B %', e;
  end if;
  select x into e from jsonb_array_elements(jb->'por_proveedor') x where x->>'proveedor' = 'PRUEBA UF PROVEEDOR A';
  if e->>'ultima_compra' <> '2031-06-10' or (e->>'ultimo_precio')::numeric <> 18 then
    raise exception 'FALLO T2: proveedor A (ultima_compra siempre) %', e;
  end if;

  -- T3 ─────────────────────────────────────────────────────────────────────
  jb := public.variacion_precios_agente(null, null, 10, null, 'zorblaxuf langostino', 10, null, false, 'anterior')::jsonb;
  e := jb->'productos'->0;
  if (e->>'precio')::numeric <> 26 or e->>'numero' <> 'ZUF-B2' or (e->>'variacion_pct')::numeric <> 30
     or (e->'anterior'->>'precio')::numeric <> 20 or e->'anterior'->>'numero' <> 'ZUF-B1'
     or e->'anterior'->>'proveedor' <> 'PRUEBA UF PROVEEDOR B' or e ? 'cambio_proveedor' or e->'media' is null then
    raise exception 'FALLO T3: con anterior %', e;
  end if;
  jb := public.variacion_precios_agente(null, null, 10, null, 'zorblaxuf langostino', 10, null, false)::jsonb;
  e := jb->'productos'->0;
  if e->>'ref_precio' is null or e ? 'anterior' or e ? 'media' then
    raise exception 'FALLO T3: el modo de siempre (panel) ha cambiado %', e;
  end if;
  if (public.variacion_precios_agente(p_comparar => 'otra')::jsonb) ->> 'error' is null then
    raise exception 'FALLO T3: p_comparar raro no da error';
  end if;

  -- T4 ─────────────────────────────────────────────────────────────────────
  if public.json_delante_agente('{"b": 1}'::jsonb, '{"a": 2, "b": 1, "ccc": null}'::jsonb)::text <> '{"b": 1, "a": 2, "ccc": null}' then
    raise exception 'FALLO T4: %', public.json_delante_agente('{"b": 1}'::jsonb, '{"a": 2, "b": 1, "ccc": null}'::jsonb);
  end if;
  if has_function_privilege('authenticated', 'public._factura_agente(jsonb)', 'execute') then
    raise exception 'FALLO T4: _factura_agente ejecutable por el panel';
  end if;

  -- T5 (20261130180000) ────────────────────────────────────────────────────
  -- Una factura más nueva de B con DOS líneas del producto: 2 kg a 30 €/kg y 2 kg a 24 €/kg.
  jb := public.compras_producto_agente('zorblaxuf langostino', p_base => false)::jsonb;
  if jb->'ultima_factura' ? 'misma_factura' then
    raise exception 'FALLO T5: misma_factura sin varias líneas';
  end if;
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total)
  values ('factura', 'PRUEBA UF PROVEEDOR B', 'B00000715', v_pb, 'ZUF-B3', '2031-07-01', 108) returning id into v_f;
  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, producto_id)
  values (v_f, 'ZORBLAXUF LANGOSTINO EXTRA', 2, 'kg', 30, 60, v_pc), (v_f, 'ZORBLAXUF LANGOSTINO G', 2, 'kg', 24, 48, v_pc);
  jb := public.compras_producto_agente('zorblaxuf langostino', p_base => false)::jsonb;
  e := jb->'ultima_factura'->'misma_factura';
  if jb->'ultima_factura'->>'numero' <> 'ZUF-B3' or (e->>'lineas')::int <> 2 or (e->>'precio_medio')::numeric <> 27
     or e->'precios' <> '[24, 30]'::jsonb or e->>'nota' is null then
    raise exception 'FALLO T5: compras misma_factura %', jb->'ultima_factura';
  end if;
  jb := public.historial_precios_agente('zorblaxuf langostino', 20, false)::jsonb;
  e := jb->'ultima_factura'->'misma_factura';
  if jb->'ultima_factura'->>'numero' <> 'ZUF-B3' or (e->>'lineas')::int <> 2 or (e->>'precio_medio')::numeric <> 27 then
    raise exception 'FALLO T5: historial misma_factura %', jb->'ultima_factura';
  end if;
  -- variacion_precios ya daba el precio medio de la factura: 27 frente a 26 (ZUF-B2).
  e := (public.variacion_precios_agente(null, null, 10, null, 'zorblaxuf langostino', 10, null, false, 'anterior')::jsonb)->'productos'->0;
  if (e->>'precio')::numeric <> 27 or e->'anterior'->>'numero' <> 'ZUF-B2' then
    raise exception 'FALLO T5: variacion %', e;
  end if;
end $$;

select 'chatbot_ultima_factura_test: OK' as resultado;
rollback;
