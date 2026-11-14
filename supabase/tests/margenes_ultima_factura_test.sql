set client_encoding = 'UTF8';
-- Test de 20261128140000_margenes_ultima_factura contra la base de verdad (con
-- volumen_linea, unidad_agente y envase_texto reales). BEGIN … ROLLBACK: no deja
-- nada escrito. Acaba en «margenes_ultima_factura_test: OK».
--   npx supabase db query --remote=sfonaclosuafvlhutkon -f supabase/tests/margenes_ultima_factura_test.sql
-- (La lógica, con más casos, también en PGlite: npm run test:margenes-ultima-factura:db.)
--
--   T1 permisos: margenes_carta_ultima y margenes_carta_datos sin EXECUTE para el panel.
--   T2 percebe por kg (hoy = 30/06/2031): 100 €/kg en noviembre de 2030, 130 y 150 €/kg
--      el 10/06 (la línea más nueva, 150, es la última), albarán facturado y Touza a
--      1000 €/kg (no cuentan) → última 150 €/kg con su factura, anterior 130, hace
--      6 meses 100; mediana 140 aparte (2 líneas en 90 días), en la misma función.
--   T3 plato de 100 g a 22 € → coste 15 € (última factura), 75 % de la venta sin IVA,
--      coste_alto + sube_coste (+50 %); al peso: compra 150 €/kg, ×1,33, mediana 140.
--   T4 vino: botella de 75 cl a 10 € (enero) y a 12 € (junio) → coste 12 € (última),
--      mediana 11 €, factura usada con su precio por botella y por litro.
begin;

do $$
declare
  v_mar bigint; v_vin bigint; v_pc bigint; v_pv bigint; v_prov bigint;
  v_f_old bigint; v_f bigint; v_alb bigint; v_tz bigint; v_fv bigint;
  j jsonb; p jsonb; v jsonb; r record;
begin
  -- T1 ─────────────────────────────────────────────────────────────────────
  if has_function_privilege('authenticated', 'public.margenes_carta_ultima(bigint[],date,integer)', 'execute')
     or has_function_privilege('anon', 'public.margenes_carta_ultima(bigint[],date,integer)', 'execute')
     or has_function_privilege('authenticated', 'public.margenes_carta_datos(date)', 'execute') then
    raise exception 'FALLO T1: el panel puede ejecutar una función interna';
  end if;
  update margenes_carta_config set coste_max_plato_pct = 35, multiplicador_min_peso = 2, subida_coste_pct = 10,
         iva_pct = 10, dias_referencia = 90 where id;

  -- Datos ──────────────────────────────────────────────────────────────────
  select id into v_mar from categorias_producto where clave = 'pescado_marisco.marisco';
  select id into v_vin from categorias_producto where clave = 'bebidas.vinos';
  insert into productos_catalogo (nombre, categoria_id, origen) values ('Pruebauf Percebe', v_mar, 'manual') returning id into v_pc;
  insert into productos_catalogo (nombre, categoria_id, origen, envase_cantidad, envase_unidad)
  values ('Pruebauf Tinto 75 cl', v_vin, 'manual', 0.75, 'l') returning id into v_pv;
  insert into proveedores (nombre, cif) values ('PRUEBA ULTIMA FACTURA SL', 'B00000713') returning id into v_prov;

  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total)
  values ('factura', 'PRUEBA ULTIMA FACTURA SL', 'B00000713', v_prov, 'UF-0', '2030-11-20', 220) returning id into v_f_old;
  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, producto_id) values
    (v_f_old, 'PERCEBE GALLEGO', 2, 'kg', 100, 200, v_pc);
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total)
  values ('factura', 'PRUEBA ULTIMA FACTURA SL', 'B00000713', v_prov, 'UF-1', '2031-06-10', 410) returning id into v_f;
  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, producto_id) values
    (v_f, 'PERCEBE GALLEGO', 2, 'kg', 130, 260, v_pc);
  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, producto_id, iva_pct) values
    (v_f, 'PERCEBE GALLEGO GRANDE', 1, 'kg', 150, 150, v_pc, 10);
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total)
  values ('albaran', 'PRUEBA ULTIMA FACTURA SL', 'B00000713', v_prov, 'UF-ALB', '2031-06-12', 1000) returning id into v_alb;
  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, producto_id)
  values (v_alb, 'PERCEBE GALLEGO', 1, 'kg', 1000, 1000, v_pc);
  update facturas set facturado_en_id = v_f, facturado_origen = 'manual' where id = v_alb;
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
  values ('factura', 'PRUEBA ULTIMA FACTURA SL', 'B00000713', v_prov, 'UF-TZ', '2031-06-14', 1000, 'touza') returning id into v_tz;
  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, producto_id)
  values (v_tz, 'PERCEBE GALLEGO', 1, 'kg', 1000, 1000, v_pc);
  -- Vino: 10 € la botella en enero, 12 € en junio.
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total)
  values ('factura', 'PRUEBA ULTIMA FACTURA SL', 'B00000713', v_prov, 'UF-V0', '2031-05-15', 60);
  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, producto_id)
  select id, 'PRUEBAUF TINTO 75 CL', 6, 'botella', 10, 60, v_pv from facturas where numero_documento = 'UF-V0' and proveedor_id = v_prov;
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total)
  values ('factura', 'PRUEBA ULTIMA FACTURA SL', 'B00000713', v_prov, 'UF-V1', '2031-06-20', 72) returning id into v_fv;
  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, producto_id)
  values (v_fv, 'PRUEBAUF TINTO 75 CL', 6, 'botella', 12, 72, v_pv);

  -- T2 ─────────────────────────────────────────────────────────────────────
  select * into r from margenes_carta_ultima(array[v_pc], '2031-06-30', 90);
  if r.base_eur is distinct from 150.0000 or r.base_medida is distinct from 'kg' or (r.base_factura->>'id')::bigint <> v_f
     or r.base_factura->>'proveedor' <> 'PRUEBA ULTIMA FACTURA SL' or r.base_factura->>'nombre_linea' <> 'PERCEBE GALLEGO GRANDE'
     or r.base_iva_origen <> 'linea' or r.base_iva_pct <> 10 then
    raise exception 'FALLO T2: última factura del percebe % % %', r.base_eur, r.base_medida, r.base_factura;
  end if;
  if r.base_eur_anterior is distinct from 130.0000 or r.base_eur_6m is distinct from 100.0000 or r.base_fecha_6m <> '2030-11-20' then
    raise exception 'FALLO T2: anterior % / hace 6 meses % (%)', r.base_eur_anterior, r.base_eur_6m, r.base_fecha_6m;
  end if;
  if r.mediana_eur_base is distinct from 140.0000 or r.lineas <> 2 then
    raise exception 'FALLO T2: mediana % (% líneas)', r.mediana_eur_base, r.lineas;
  end if;

  -- Carta de prueba.
  insert into "Platos" (id, nombre, categoria, precio_eur, unidad, activado, restaurante)
  values ('prueba-uf-percebe', 'PRUEBA Percebes UF', 'MARISCOS', 22, '100 g', true, true);
  insert into escandallo_platos (plato_id, producto_id, cantidad, unidad, origen)
  values ('prueba-uf-percebe', v_pc, 100, 'g', 'manual');
  insert into "Vinos" (id, nombre, categoria, precio_eur, activado, restaurante, ubicacion_pais, ubicacion_region)
  values ('prueba-uf-vino', 'PRUEBA Tinto UF', 'VINOS — PRUEBA UF', 33, true, true, 'España', 'Rioja');
  insert into vino_producto (vino_id, producto_id, origen) values ('prueba-uf-vino', v_pv, 'manual');

  j := public.margenes_carta_datos('2031-06-30');
  if j->>'coste_desde' <> 'ultima_factura' then raise exception 'FALLO T3: coste_desde %', j->>'coste_desde'; end if;

  -- T3 ─────────────────────────────────────────────────────────────────────
  select x into p from jsonb_array_elements(j->'platos') x where x->>'id' = 'prueba-uf-percebe';
  if (p->>'coste')::numeric <> 15 or (p->>'pct')::numeric <> 75 or (p->>'coste_mediana')::numeric <> 14
     or (p->>'pct_mediana')::numeric <> 70 or (p->'factura'->>'id')::bigint <> v_f then
    raise exception 'FALLO T3: plato %', p;
  end if;
  if not (p->'banderas' ? 'coste_alto') or not (p->'banderas' ? 'sube_coste') or (p->>'variacion_pct')::numeric <> 50 then
    raise exception 'FALLO T3: banderas % variación %', p->'banderas', p->>'variacion_pct';
  end if;
  if (p->'ingredientes'->0->>'eur')::numeric <> 150 or (p->'ingredientes'->0->>'eur_mediana')::numeric <> 140
     or (p->'ingredientes'->0->>'eur_anterior')::numeric <> 130 then
    raise exception 'FALLO T3: ingrediente %', p->'ingredientes'->0;
  end if;
  select x into p from jsonb_array_elements(j->'peso') x where x->>'id' = 'prueba-uf-percebe';
  if (p->>'compra_kg')::numeric <> 150 or (p->>'multiplicador')::numeric <> 1.33 or (p->>'compra_kg_mediana')::numeric <> 140
     or (p->>'compra_kg_iva')::numeric <> 165 or p->>'ultima_fecha' <> '2031-06-10' then
    raise exception 'FALLO T3: al peso %', p;
  end if;

  -- T4 ─────────────────────────────────────────────────────────────────────
  select x into v from jsonb_array_elements(j->'vinos') x where x->>'id' = 'prueba-uf-vino';
  if (v->>'coste')::numeric <> 12 or (v->>'coste_mediana')::numeric <> 11 or (v->>'multiplicador')::numeric <> 2.5
     or (v->>'coste_anterior')::numeric <> 10 or (v->'factura'->>'id')::bigint <> v_fv then
    raise exception 'FALLO T4: vino %', v;
  end if;
  if (v->'factura'->>'precio_unidad')::numeric <> 12 or (v->'factura'->>'eur_base')::numeric <> 16
     or v->'factura'->>'unidad_compra' <> 'botella' then
    raise exception 'FALLO T4: factura del vino %', v->'factura';
  end if;
end $$;

select 'margenes_ultima_factura_test: OK' as resultado;
rollback;
