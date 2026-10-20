set client_encoding = 'UTF8';
-- ===========================================================================
-- Pruebas de 20261006105000_productos_factura_iva_pct.sql
-- SQL plano con ASSERT dentro de BEGIN … ROLLBACK: no deja nada escrito.
-- DESPUÉS de aplicar la migración, POR TERMINAL:
--   npx supabase db query --linked -f supabase/tests/productos_factura_iva_pct_test.sql
-- Si termina sin ERROR e imprime «productos_factura_iva_pct_test: OK», todo ha pasado.
--
-- Cubre: columna iva_pct numeric NULL sin default y su CHECK 0..30; un
-- INSERT normal la deja NULL; la sustitución en sitio (ocr_sustituir_factura)
-- guarda el tipo que trae cada línea, NULL en las que no lo traen, y sigue
-- guardando bultos (sobre una COPIA de la factura 54); permisos.
-- ===========================================================================

begin;

do $$
declare
  v_user  uuid;
  v_dup   uuid := '00000000-0000-4000-8000-0000000000c1';
  v_copia bigint;
  v_lineas integer;
  v_updated timestamp;
  j jsonb;
  r record;
  rechazado boolean := false;
begin
  select id into v_user from auth.users order by created_at limit 1;
  assert v_user is not null, 'T0: no hay ningún usuario en auth.users';

  -- T1. Columna y CHECK.
  assert exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'productos_factura' and column_name = 'iva_pct'
                    and data_type = 'numeric' and is_nullable = 'YES' and column_default is null),
    'T1: productos_factura.iva_pct no es numeric NULL sin default';
  assert exists (select 1 from pg_constraint
                  where conrelid = 'public.productos_factura'::regclass and conname = 'productos_factura_iva_pct_rango'),
    'T1: falta el CHECK productos_factura_iva_pct_rango';

  -- T2. Permisos de la función reescrita.
  assert not has_function_privilege('authenticated', 'public.ocr_sustituir_factura(bigint,uuid,uuid,jsonb,jsonb,jsonb,text)', 'execute'),
    'T2: authenticated no debe ejecutar ocr_sustituir_factura';
  assert not has_function_privilege('anon', 'public.ocr_sustituir_factura(bigint,uuid,uuid,jsonb,jsonb,jsonb,text)', 'execute'),
    'T2: anon no debe ejecutar ocr_sustituir_factura';
  assert has_function_privilege('service_role', 'public.ocr_sustituir_factura(bigint,uuid,uuid,jsonb,jsonb,jsonb,text)', 'execute'),
    'T2: service_role debe ejecutar ocr_sustituir_factura';

  -- T3. Copia de la 54; un INSERT sin tipo lo deja NULL.
  insert into public.facturas (tipo, proveedor, cif, numero_documento, fecha, subtotal, iva, total, total_origen,
                               observaciones, resumen, verificada, archivo_path, alertas_validacion)
  select tipo, proveedor, cif, 'TEST-IVA-' || numero_documento, fecha, subtotal, iva, total, total_origen,
         observaciones, resumen, verificada, archivo_path, alertas_validacion
    from public.facturas where id = 54
  returning id into v_copia;
  insert into public.productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, pagina, orden)
  select v_copia, nombre, cantidad, unidad, precio_unitario, total, pagina, orden
    from public.productos_factura where factura_id = 54 order by orden;
  select count(*) into v_lineas from public.productos_factura where factura_id = v_copia;
  assert v_lineas > 0, 'T3: la copia no tiene líneas';
  assert not exists (select 1 from public.productos_factura where factura_id = v_copia and iva_pct is not null),
    'T3: un INSERT sin iva_pct debe dejarlo NULL';
  select updated_at into v_updated from public.facturas where id = v_copia;

  -- T4. El CHECK rechaza un tipo imposible.
  begin
    update public.productos_factura set iva_pct = 110 where factura_id = v_copia and orden = 0;
  exception when check_violation then
    rechazado := true;
  end;
  assert rechazado, 'T4: el CHECK debería rechazar iva_pct = 110';

  -- T5. Sustitución con tipos por línea (y bultos, que no se pierden).
  insert into public.ocr_trabajos (id, creado_por, num_paginas, origen, nombre_original, estado)
  values (v_dup, v_user, 1, 'sincrono', 'ML101511.pdf', 'duplicado');
  j := public.ocr_sustituir_factura(v_copia, v_dup, v_user,
    jsonb_build_object('tipo', 'factura', 'proveedor', 'LUGA SABORES S.L. (TEST)', 'cif', 'B-54529045',
                       'numero_documento', 'TEST-IVA-ML/101511', 'fecha', '2025-12-31', 'subtotal', 1673.19,
                       'iva', 165.15, 'total', 1838.34, 'total_origen', 'deducido', 'resumen', 'prueba', 'paginas', 1),
    '[{"nombre":"PICOS Sin Gluten","cantidad":2,"unidad":"ud","precio_unitario":9.03,"total":18.07,"orden":0,"iva_pct":4},
      {"nombre":"NATOP 2L","cantidad":24,"unidad":"kg","bultos":12,"precio_unitario":4.14,"total":99.46,"orden":1,"iva_pct":10},
      {"nombre":"JAMON CEBO CAMPO","cantidad":75.48,"unidad":"kg","bultos":8,"precio_unitario":20.5,"total":1547.26,"orden":2,"iva_pct":10},
      {"nombre":"ESPINAS SALMONETE","cantidad":2,"unidad":"kg","precio_unitario":4.2,"total":8.4,"orden":3}]'::jsonb,
    jsonb_build_object('lineas', v_lineas, 'updated_at', v_updated), null);
  assert (j->>'lineas')::int = 4, format('T5: resultado inesperado %s', j);

  select string_agg(coalesce(iva_pct::text, 'null'), ',' order by orden) as t,
         string_agg(coalesce(bultos::text, 'null'), ',' order by orden) as b
    into r from public.productos_factura where factura_id = v_copia;
  assert r.t = '4,10,10,null', format('T5: iva_pct por orden %s (se esperaba 4,10,10,null)', r.t);
  assert r.b = 'null,12,8,null', format('T5: bultos por orden %s (se esperaba null,12,8,null)', r.b);
  select subtotal, iva, total into r from public.facturas where id = v_copia;
  assert r.subtotal = 1673.19 and r.iva = 165.15 and r.total = 1838.34, 'T5: cabecera de la sustitución';

  -- T6. El historial se rehace igual que antes.
  assert (select count(*) from public.historial_precios where factura_id = v_copia) = 4, 'T6: historial con 4 filas';

  -- T7. La 54 original no se ha tocado.
  assert (select count(*) from public.productos_factura where factura_id = 54) = 54, 'T7: la 54 sigue con sus 54 líneas';
end;
$$;

select 'productos_factura_iva_pct_test: OK' as resultado;

rollback;
