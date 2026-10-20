set client_encoding = 'UTF8';
-- ===========================================================================
-- Pruebas de 20261005150000_productos_factura_bultos.sql
-- SQL plano con ASSERT dentro de BEGIN … ROLLBACK: no deja nada escrito.
-- DESPUÉS de aplicar la migración:
--   npx supabase db query --linked -f supabase/tests/productos_factura_bultos_test.sql
-- Si termina sin ERROR e imprime «productos_factura_bultos_test: OK», todo ha pasado.
--
-- Cubre: columna bultos numeric NULL; un INSERT normal la deja NULL; la
-- sustitución en sitio (ocr_sustituir_factura) guarda los bultos que trae
-- cada línea y NULL en las que no los traen, sin cambiar lo demás (sobre una
-- COPIA de la factura 54); permisos (authenticated/anon no ejecutan).
-- ===========================================================================

begin;

do $$
declare
  v_user  uuid;
  v_dup   uuid := '00000000-0000-4000-8000-0000000000b1';
  v_copia bigint;
  v_lineas integer;
  v_updated timestamp;
  j jsonb;
  r record;
begin
  select id into v_user from auth.users order by created_at limit 1;
  assert v_user is not null, 'T0: no hay ningún usuario en auth.users';

  -- T1. Columna.
  assert exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'productos_factura' and column_name = 'bultos'
                    and data_type = 'numeric' and is_nullable = 'YES' and column_default is null),
    'T1: productos_factura.bultos no es numeric NULL sin default';

  -- T2. Permisos de la función reescrita.
  assert not has_function_privilege('authenticated', 'public.ocr_sustituir_factura(bigint,uuid,uuid,jsonb,jsonb,jsonb,text)', 'execute'),
    'T2: authenticated no debe ejecutar ocr_sustituir_factura';
  assert not has_function_privilege('anon', 'public.ocr_sustituir_factura(bigint,uuid,uuid,jsonb,jsonb,jsonb,text)', 'execute'),
    'T2: anon no debe ejecutar ocr_sustituir_factura';
  assert has_function_privilege('service_role', 'public.ocr_sustituir_factura(bigint,uuid,uuid,jsonb,jsonb,jsonb,text)', 'execute'),
    'T2: service_role debe ejecutar ocr_sustituir_factura';

  -- T3. Copia de la 54; un INSERT sin bultos los deja NULL.
  insert into public.facturas (tipo, proveedor, cif, numero_documento, fecha, subtotal, iva, total, total_origen,
                               observaciones, resumen, verificada, archivo_path, alertas_validacion)
  select tipo, proveedor, cif, 'TEST-BULTOS-' || numero_documento, fecha, subtotal, iva, total, total_origen,
         observaciones, resumen, verificada, archivo_path, alertas_validacion
    from public.facturas where id = 54
  returning id into v_copia;
  insert into public.productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, pagina, orden)
  select v_copia, nombre, cantidad, unidad, precio_unitario, total, pagina, orden
    from public.productos_factura where factura_id = 54 order by orden;
  select count(*) into v_lineas from public.productos_factura where factura_id = v_copia;
  assert v_lineas > 0, 'T3: la copia no tiene líneas';
  assert not exists (select 1 from public.productos_factura where factura_id = v_copia and bultos is not null),
    'T3: un INSERT sin bultos debe dejarlos NULL';
  select updated_at into v_updated from public.facturas where id = v_copia;

  -- T4. Sustitución con bultos en las líneas por kilo.
  insert into public.ocr_trabajos (id, creado_por, num_paginas, origen, nombre_original, estado)
  values (v_dup, v_user, 1, 'sincrono', 'ML101511.pdf', 'duplicado');
  j := public.ocr_sustituir_factura(v_copia, v_dup, v_user,
    jsonb_build_object('tipo', 'factura', 'proveedor', 'LUGA SABORES S.L. (TEST)', 'cif', 'B-54529045',
                       'numero_documento', 'TEST-BULTOS-ML/101511', 'fecha', '2025-12-31', 'subtotal', null,
                       'iva', null, 'total', 1663.12, 'total_origen', 'deducido', 'resumen', 'prueba', 'paginas', 1),
    '[{"nombre":"PICOS Sin Gluten","cantidad":2,"unidad":"ud","precio_unitario":9.03,"total":18.07,"orden":0},
      {"nombre":"NATOP 2L","cantidad":24,"unidad":"kg","bultos":12,"precio_unitario":4.14,"total":99.46,"orden":1},
      {"nombre":"JAMON CEBO CAMPO","cantidad":75.48,"unidad":"kg","bultos":8,"precio_unitario":20.5,"total":1547.26,"orden":2},
      {"nombre":"ESPINAS SALMONETE","cantidad":2,"unidad":"kg","bultos":null,"precio_unitario":4.2,"total":8.4,"orden":3}]'::jsonb,
    jsonb_build_object('lineas', v_lineas, 'updated_at', v_updated), null);
  assert (j->>'lineas')::int = 4, format('T4: resultado inesperado %s', j);

  select string_agg(coalesce(bultos::text, 'null'), ',' order by orden) as b,
         string_agg(round(cantidad, 2)::text || ' ' || unidad, ',' order by orden) as c
    into r from public.productos_factura where factura_id = v_copia;
  assert r.b = 'null,12,8,null', format('T4: bultos por orden %s (se esperaba null,12,8,null)', r.b);
  assert r.c = '2.00 ud,24.00 kg,75.48 kg,2.00 kg', format('T4: cantidades/unidades %s', r.c);

  -- T5. El historial se rehace igual que antes (precio por kilo tal cual).
  assert (select count(*) from public.historial_precios where factura_id = v_copia) = 4, 'T5: historial con 4 filas';
  assert exists (select 1 from public.historial_precios where factura_id = v_copia and producto_nombre = 'NATOP 2L' and precio = 4.14),
    'T5: el precio por kilo va al historial sin tocar';

  -- T6. La 54 original no se ha tocado.
  assert (select count(*) from public.productos_factura where factura_id = 54) = 54, 'T6: la 54 sigue con sus 54 líneas';
end;
$$;

select 'productos_factura_bultos_test: OK' as resultado;

rollback;
