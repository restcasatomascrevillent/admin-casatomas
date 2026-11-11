set client_encoding = 'UTF8';
-- Test de 20261125100000_margenes_sin_iva_tienda. BEGIN … ROLLBACK: no deja nada
-- escrito. Acaba en «margenes_sin_iva_tienda_test: OK».
--   npx supabase db query --linked -f supabase/tests/margenes_sin_iva_tienda_test.sql
--
--   T1 configuración: iva_tienda_pct 21, multiplicador_min_tienda 1,5, límite de vino
--      por defecto 2,3; internas sin EXECUTE para authenticated.
--   T2 ejemplo de control: carta 30 €, botella de 75 cl a 10 € → restaurante 2,73×;
--      tienda 21 € (carta − 30 %) → 17,36 € sin IVA → 1,74×; con límite 1,8 →
--      tienda_bajo; margen de tienda aunque la tienda esté desactivada.
--   T3 IVA de las compras: línea con 21 % → coste con IVA 12,10 € e iva_origen
--      'linea'; línea sin IVA en factura con iva/subtotal = 10 % → 'factura'.
--   T4 formato de la carta: «(Magnum)» a 60 € con la compra de 75 cl a 10 € →
--      litros 1,5, coste 20 €, formato_distinto, 2,73×; vino de carta sin formato
--      enlazado a un magnum a 30 € → botella de 0,75 l, coste 15 €.
--   T5 vino excluido de la tienda: sin margen de tienda ni tienda_bajo.
begin;

do $$
declare
  v_vin bigint; v_p75 bigint; v_pmag bigint; v_pfac bigint; v_prov bigint; v_f bigint; v_f2 bigint;
  j jsonb; v jsonb;
begin
  -- T1 ─────────────────────────────────────────────────────────────────────
  if (select column_default from information_schema.columns
       where table_schema = 'public' and table_name = 'margenes_carta_config' and column_name = 'multiplicador_min_vino') !~ '2\.3' then
    raise exception 'FALLO T1: el límite del vino por defecto no es 2,3';
  end if;
  if has_function_privilege('authenticated', 'public.margenes_carta_datos(date)', 'execute')
     or has_function_privilege('authenticated', 'public.margenes_carta_iva(bigint[],date,integer)', 'execute') then
    raise exception 'FALLO T1: authenticated puede ejecutar una función interna';
  end if;
  update margenes_carta_config set multiplicador_min_vino = 2.3, multiplicador_min_tienda = 1.8,
         iva_pct = 10, iva_tienda_pct = 21, dias_referencia = 90 where id;
  update configuracion_tienda set activa = false, descuento_pct = 30, vinos_excluidos = array['prueba-f5-excluido'] where id;

  -- Datos ──────────────────────────────────────────────────────────────────
  select id into v_vin from categorias_producto where clave = 'bebidas.vinos';
  insert into productos_catalogo (nombre, categoria_id, origen, envase_cantidad, envase_unidad)
  values ('Pruebaf5 Tinto 75 cl', v_vin, 'manual', 0.75, 'l') returning id into v_p75;
  insert into productos_catalogo (nombre, categoria_id, origen, envase_cantidad, envase_unidad)
  values ('Pruebaf5 Blanco Magnum', v_vin, 'manual', 1.5, 'l') returning id into v_pmag;
  insert into productos_catalogo (nombre, categoria_id, origen, envase_cantidad, envase_unidad)
  values ('Pruebaf5 Rosado 75 cl', v_vin, 'manual', 0.75, 'l') returning id into v_pfac;
  insert into proveedores (nombre, cif) values ('PRUEBA FASE5 SL', 'B00000625') returning id into v_prov;
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, subtotal, iva, total)
  values ('factura', 'PRUEBA FASE5 SL', 'B00000625', v_prov, 'F5-1', '2031-06-10', 90, 18.9, 108.9) returning id into v_f;
  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, producto_id, iva_pct) values
    (v_f, 'PRUEBAF5 TINTO 75 CL', 6, 'botella', 10, 60, v_p75, 21),
    (v_f, 'PRUEBAF5 BLANCO MAGNUM 1,5L', 1, 'botella', 30, 30, v_pmag, 21);
  -- Factura sin IVA por línea: general 10 % (10 / 100).
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, subtotal, iva, total)
  values ('factura', 'PRUEBA FASE5 SL', 'B00000625', v_prov, 'F5-2', '2031-06-11', 100, 10, 110) returning id into v_f2;
  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, producto_id)
  values (v_f2, 'PRUEBAF5 ROSADO 75 CL', 10, 'botella', 10, 100, v_pfac);

  insert into "Vinos" (id, nombre, categoria, precio_eur, activado, restaurante, ubicacion_pais, ubicacion_region) values
    ('prueba-f5-control', 'PRUEBA Tinto control', 'VINOS — PRUEBA F5', 30, true, true, 'España', 'Rioja'),
    ('prueba-f5-magnum', 'PRUEBA Tinto (Magnum)', 'VINOS — PRUEBA F5', 60, true, true, 'España', 'Rioja'),
    ('prueba-f5-botella', 'PRUEBA Blanco 2022', 'VINOS — PRUEBA F5', 40, true, true, 'España', 'Rioja'),
    ('prueba-f5-excluido', 'PRUEBA Rosado', 'VINOS — PRUEBA F5', 30, true, true, 'España', 'Rioja');
  insert into vino_producto (vino_id, producto_id, origen) values
    ('prueba-f5-control', v_p75, 'manual'), ('prueba-f5-magnum', v_p75, 'manual'),
    ('prueba-f5-botella', v_pmag, 'manual'), ('prueba-f5-excluido', v_pfac, 'manual');

  j := public.margenes_carta_datos('2031-06-30');
  if (j->'config'->>'iva_tienda_pct')::numeric <> 21 or (j->'config'->>'multiplicador_min_tienda')::numeric <> 1.8
     or (j->'tienda'->>'activa')::boolean then
    raise exception 'FALLO T1: config % tienda %', j->'config', j->'tienda';
  end if;

  -- T2 ─────────────────────────────────────────────────────────────────────
  select x into v from jsonb_array_elements(j->'vinos') x where x->>'id' = 'prueba-f5-control';
  if (v->>'coste')::numeric <> 10 or (v->>'multiplicador')::numeric <> 2.73 or (v->'banderas' ? 'multiplicador_bajo') then
    raise exception 'FALLO T2: restaurante %', v;
  end if;
  if (v->>'precio_tienda')::numeric <> 21 or (v->>'venta_tienda')::numeric <> 17.3554
     or (v->>'multiplicador_tienda')::numeric <> 1.74 or not (v->'banderas' ? 'tienda_bajo') or not (v->>'en_tienda')::boolean then
    raise exception 'FALLO T2: tienda %', v;
  end if;
  if round((v->>'venta_tienda')::numeric, 2) <> 17.36 then
    raise exception 'FALLO T2: venta de tienda sin IVA %', v->>'venta_tienda';
  end if;

  -- T3 ─────────────────────────────────────────────────────────────────────
  if (v->>'coste_iva')::numeric <> 12.1 or v->>'iva_origen' <> 'linea' or (v->>'iva_compra_pct')::numeric <> 21 then
    raise exception 'FALLO T3: IVA de línea %', v;
  end if;
  select x into v from jsonb_array_elements(j->'vinos') x where x->>'id' = 'prueba-f5-excluido';
  if v->>'iva_origen' <> 'factura' or (v->>'iva_compra_pct')::numeric <> 10 or (v->>'coste_iva')::numeric <> 11 then
    raise exception 'FALLO T3: IVA de factura %', v;
  end if;

  -- T5 ─────────────────────────────────────────────────────────────────────
  if (v->>'en_tienda')::boolean or v->>'multiplicador_tienda' is not null or (v->'banderas' ? 'tienda_bajo') then
    raise exception 'FALLO T5: vino excluido con margen de tienda %', v;
  end if;

  -- T4 ─────────────────────────────────────────────────────────────────────
  select x into v from jsonb_array_elements(j->'vinos') x where x->>'id' = 'prueba-f5-magnum';
  if (v->>'litros')::numeric <> 1.5 or (v->>'coste')::numeric <> 20 or not (v->>'formato_distinto')::boolean
     or not (v->'banderas' ? 'formato_distinto') or (v->>'multiplicador')::numeric <> 2.73 or (v->>'litros_producto')::numeric <> 0.75 then
    raise exception 'FALLO T4: magnum desde 75 cl %', v;
  end if;
  select x into v from jsonb_array_elements(j->'vinos') x where x->>'id' = 'prueba-f5-botella';
  if (v->>'litros')::numeric <> 0.75 or (v->>'coste')::numeric <> 15 or not (v->>'formato_distinto')::boolean then
    raise exception 'FALLO T4: botella desde magnum %', v;
  end if;
  select x into v from jsonb_array_elements(j->'vinos') x where x->>'id' = 'prueba-f5-control';
  if (v->>'formato_distinto')::boolean or (v->'banderas' ? 'formato_distinto') then
    raise exception 'FALLO T4: mismo formato marcado como distinto %', v;
  end if;
end $$;

select 'margenes_sin_iva_tienda_test: OK' as resultado;
rollback;
