set client_encoding = 'UTF8';
-- ===========================================================================
-- Pruebas de 20261010150000_ocr_paginas_duplicados.sql
-- SQL plano con ASSERT dentro de BEGIN … ROLLBACK: no deja nada escrito, y
-- las peticiones de pg_net que se encolen aquí se descartan con el ROLLBACK
-- (net.http_post solo envía tras COMMIT). DESPUÉS de aplicar la migración:
--   npx supabase db query --linked -f supabase/tests/ocr_paginas_duplicados_test.sql
-- Si termina sin ERROR e imprime «ocr_paginas_duplicados_test: OK», todo ha pasado.
--
-- Cubre:
--   T1 duplicados con datos de prueba: mismo número + otro proveedor → no;
--      mismo proveedor (por nombre o CIF) → sí; sin proveedor → solo con el
--      mismo total y fecha; verificar_duplicado_factura igual.
--   T2 casos reales (si siguen en la BD): el albarán B-16385 leído en la foto
--      de Nicolás y Valero NO casa con la 338 de Congelados Pinto; el de Pinto sí.
--   T3 resumen: páginas de las líneas, importes y trabajo en marcha.
--   T4 «Sustituir»: aborta con 0 líneas, con trabajo en marcha y entre páginas.
--   T5 «Añadir como página»: añade sin borrar, recalcula, cierra el trabajo,
--      deja auditoría; no se puede repetir; guarda de concurrencia.
--   T6 topes del despacho: 3 consolidaciones y 12 piezas; la cola da paso.
--   T7 permisos: anon/authenticated no ejecutan las RPC de service_role.
-- ===========================================================================

begin;

do $$
declare
  v_user uuid;
  v_fa   bigint;
  v_fb   bigint;
  v_t    uuid := '00000000-0000-4000-8000-00000000a101';
  v_t2   uuid := '00000000-0000-4000-8000-00000000a102';
  v_tp   uuid := '00000000-0000-4000-8000-00000000a103';
  v_tc   uuid;
  j      jsonb;
  js     json;
  n      integer;
  v_upd  timestamp;
  v_ok   boolean;
begin
  select id into v_user from auth.users order by created_at limit 1;
  assert v_user is not null, 'T0: no hay ningún usuario en auth.users';

  -- ─── T1. Duplicados con datos de prueba ──────────────────────────────────
  insert into public.facturas (tipo, proveedor, cif, numero_documento, fecha, subtotal, iva, total, total_origen)
  values ('albaran', 'A1 PRUEBA CONGELADOS SL', 'B99999901', 'A1-16385', date '2099-10-06', 265.76, 26.05, 291.81, 'leido')
  returning id into v_fa;
  insert into public.productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, pagina, orden)
  values (v_fa, 'A1 BROCOLI', 5, 'kg', 2, 10, 1, 0), (v_fa, 'A1 LUBINA', 5, 'kg', 51.152, 255.76, 1, 1);

  -- Mismo número, OTRO proveedor (otro CIF, otro total): no es duplicado.
  j := public.ocr_factura_existente('A1-16385', 'A1 PRUEBA DISTRIBUCIONES GASTRONOMICAS', 'B99999902', date '2099-10-06', 88.76);
  assert j is null, format('T1a: otro proveedor no es duplicado (%s)', j);
  -- Mismo número y proveedor por nombre (el número escrito distinto).
  j := public.ocr_factura_existente('A1 16385', 'A1 Prueba Congelados, S.L.', null, date '2099-10-07', 1);
  assert (j->>'id')::bigint = v_fa, format('T1b: mismo proveedor por nombre (%s)', j);
  assert j->>'motivo' = 'numero_proveedor', format('T1b: motivo (%s)', j);
  -- Mismo número y CIF (nombre ilegible).
  j := public.ocr_factura_existente('A1-16385', 'XXXX', 'b-99999901', null, null);
  assert (j->>'id')::bigint = v_fa, format('T1c: mismo CIF (%s)', j);
  -- El CIF de Casa Tomás no identifica al proveedor.
  j := public.ocr_factura_existente('A1-16385', '', 'B54583356', date '2099-10-01', 5);
  assert j is null, format('T1d: el CIF del cliente no casa (%s)', j);
  -- Sin proveedor: solo con el mismo total y fecha.
  j := public.ocr_factura_existente('A1-16385', '', null, date '2099-10-06', 291.81);
  assert (j->>'id')::bigint = v_fa, format('T1e: sin proveedor, mismo total y fecha (%s)', j);
  j := public.ocr_factura_existente('A1-16385', '', null, date '2099-10-06', 88.76);
  assert j is null, format('T1f: sin proveedor y otro total (%s)', j);
  -- Sin número coincidente: mismo proveedor + fecha + total.
  j := public.ocr_factura_existente('A1-OTRO', 'A1 PRUEBA CONGELADOS SL', null, date '2099-10-06', 291.81);
  assert (j->>'id')::bigint = v_fa and j->>'motivo' = 'datos_coincidentes', format('T1g: datos coincidentes (%s)', j);
  -- verificar_duplicado_factura (respaldo de las Edge Functions).
  js := public.verificar_duplicado_factura('A1-16385', 'A1 PRUEBA DISTRIBUCIONES GASTRONOMICAS', date '2099-10-06', 88.76);
  assert not (js->>'es_duplicado')::boolean, format('T1h: verificar, otro proveedor (%s)', left(js::text, 200));
  js := public.verificar_duplicado_factura('A1-16385', 'A1 PRUEBA CONGELADOS SL', date '2099-10-09', 3);
  assert (js->>'es_duplicado')::boolean and js->>'motivo' = 'numero_documento', 'T1i: verificar, mismo proveedor';
  js := public.verificar_duplicado_factura('A1-16385', '', date '2099-10-06', 291.81);
  assert (js->>'es_duplicado')::boolean, 'T1j: verificar, sin proveedor con mismo total y fecha';
  js := public.verificar_duplicado_factura('A1-16385', '', date '2099-10-06', 1);
  assert not (js->>'es_duplicado')::boolean, 'T1k: verificar, sin proveedor y otro total';

  -- ─── T2. Casos reales de la revisión (si siguen en la BD) ────────────────
  if exists (select 1 from public.facturas where id = 338 and numero_documento = 'B-16385') then
    j := public.ocr_factura_existente('B-16385', 'DISTRIBUCIONES GASTRONOMICAS NICOLAS Y VALERO SRL', 'B06805246', date '2026-10-06', 88.76);
    assert j is null or (j->>'id')::bigint <> 338, format('T2a: el albarán de Nicolás y Valero no casa con la 338 (%s)', j->>'id');
    js := public.verificar_duplicado_factura('B-16385', 'Distribuciones Gastronómicas Nicolás y Valero, S.R.L.', date '2026-10-06', 88.76);
    assert not (js->>'es_duplicado')::boolean, 'T2b: verificar tampoco lo casa con la 338';
    j := public.ocr_factura_existente('B-16385', (select proveedor from public.facturas where id = 338),
                                      (select cif from public.facturas where id = 338), date '2026-10-06', 291.81);
    assert (j->>'id')::bigint = 338, format('T2c: la 338 sigue siendo duplicado de sí misma (%s)', j->>'id');
  else
    raise notice 'T2: la 338 ya no está como B-16385; se omite';
  end if;
  if exists (select 1 from public.facturas where id = 54 and numero_documento = 'ML/101511') then
    j := public.ocr_factura_existente('ML/101511', 'LUGA SABORES S.L.', null, '2025-12-31', 0);
    assert (j->>'id')::bigint = 54, format('T2d: Luga por número y proveedor (%s)', j->>'id');
  end if;

  -- ─── T3. Resumen ─────────────────────────────────────────────────────────
  insert into public.ocr_trabajos (id, creado_por, num_paginas, origen, nombre_original, estado)
  values (gen_random_uuid(), v_user, 1, 'imagen', 'a1-x.jpg', 'completado') returning id into v_tc;
  j := public.ocr_resumen_factura_datos(v_fa);
  assert (j->>'lineas')::int = 2 and j->'paginas_lineas' = '[1]'::jsonb, format('T3a: resumen (%s)', j);
  assert j->'totales_lineas' = '[10, 255.76]'::jsonb, format('T3b: importes de línea (%s)', j->'totales_lineas');
  assert not (j->>'trabajo_pendiente')::boolean, 'T3c: sin trabajo en marcha';

  -- ─── T4. «Sustituir» con guardas ─────────────────────────────────────────
  insert into public.facturas (tipo, proveedor, numero_documento, fecha, total)
  values ('albaran', 'A1 PRUEBA SIN LINEAS', 'A1-VACIA', date '2099-10-06', 10) returning id into v_fb;
  insert into public.ocr_trabajos (id, creado_por, num_paginas, origen, nombre_original, estado)
  values (v_t, v_user, 1, 'sincrono', 'a1-sust.jpg', 'duplicado');
  begin
    perform public.ocr_sustituir_factura(v_fb, v_t, v_user, '{"numero_documento":"A1-VACIA"}'::jsonb, '[]'::jsonb, '{}'::jsonb, null);
    assert false, 'T4a: debería abortar con 0 líneas';
  exception when raise_exception then
    assert sqlerrm like 'SUSTITUCIÓN ABORTADA: la factura % no tiene líneas%', 'T4a: mensaje: ' || sqlerrm;
  end;
  -- Trabajo de la existente aún en marcha.
  update public.ocr_trabajos set estado = 'consolidando', lease_hasta = now() + interval '1 minute' where id = v_tc;
  update public.facturas set ocr_trabajo_id = v_tc where id = v_fa;
  assert (public.ocr_resumen_factura_datos(v_fa)->>'trabajo_pendiente')::boolean, 'T4b: resumen con trabajo en marcha';
  begin
    perform public.ocr_sustituir_factura(v_fa, v_t, v_user, '{"numero_documento":"A1-16385"}'::jsonb, '[]'::jsonb, '{}'::jsonb, null);
    assert false, 'T4b: debería abortar con el trabajo en marcha';
  exception when raise_exception then
    assert sqlerrm like '%aún se está leyendo o guardando%', 'T4b: mensaje: ' || sqlerrm;
  end;
  update public.ocr_trabajos set estado = 'completado', lease_hasta = null where id = v_tc;
  -- Entre páginas: nunca.
  update public.ocr_trabajos set documento_pendiente = '{"pagina":{"actual":2,"total":2}}'::jsonb where id = v_t;
  begin
    perform public.ocr_sustituir_factura(v_fa, v_t, v_user, '{"numero_documento":"A1-16385"}'::jsonb, '[]'::jsonb, '{}'::jsonb, null);
    assert false, 'T4c: debería abortar entre páginas';
  exception when raise_exception then
    assert sqlerrm like '%se añade como página, no se sustituye%', 'T4c: mensaje: ' || sqlerrm;
  end;
  -- Guarda de concurrencia con el mensaje nuevo.
  update public.ocr_trabajos set documento_pendiente = null where id = v_t;
  begin
    perform public.ocr_sustituir_factura(v_fa, v_t, v_user, '{"numero_documento":"A1-16385"}'::jsonb, '[]'::jsonb, '{"lineas":7}'::jsonb, null);
    assert false, 'T4d: debería abortar con otro nº de líneas';
  exception when raise_exception then
    assert sqlerrm like '%ha cambiado desde que la viste%Revisa y confirma de nuevo.', 'T4d: mensaje: ' || sqlerrm;
  end;
  assert (select count(*) from public.productos_factura where factura_id = v_fa) = 2, 'T4e: nada tocado';

  -- ─── T5. «Añadir como página» ────────────────────────────────────────────
  -- La existente es la página 1 sin pie (total deducido 265,76); llega la 2/2 con el pie impreso.
  update public.facturas set subtotal = 265.76, iva = null, total = 265.76, total_origen = 'deducido' where id = v_fa;
  select updated_at into v_upd from public.facturas where id = v_fa;
  insert into public.ocr_trabajos (id, creado_por, num_paginas, origen, nombre_original, estado, documento_pendiente)
  values (v_tp, v_user, 1, 'imagen', 'a1-pag2.jpg', 'duplicado', '{"pagina":{"actual":2,"total":2}}'::jsonb);
  begin
    perform public.ocr_anadir_pagina(v_fa, v_tp, v_user, 2, 2, '{}'::jsonb, '[]'::jsonb, '{"lineas":5}'::jsonb, null);
    assert false, 'T5a: debería abortar con otro nº de líneas';
  exception when raise_exception then
    assert sqlerrm like 'AÑADIDO ABORTADO: la factura % ha cambiado desde que la viste%', 'T5a: mensaje: ' || sqlerrm;
  end;
  j := public.ocr_anadir_pagina(
    v_fa, v_tp, v_user, 2, 2,
    '{"proveedor":"A1 PRUEBA CONGELADOS SL","fecha":"2099-10-06","subtotal":936.04,"iva":93.60,"total":1029.64,"total_origen":"leido"}'::jsonb,
    '[{"nombre":"A1 GAMBA ROJA","cantidad":1.5,"unidad":"kg","precio_unitario":178,"total":267,"iva_pct":10},
      {"nombre":"A1 EMBALAJE","cantidad":1,"unidad":"ud","precio_unitario":1.82,"total":1.82}]'::jsonb,
    jsonb_build_object('lineas', 2, 'updated_at', v_upd), 'a1/pag2.jpg');
  assert (j->>'lineas_antes')::int = 2 and (j->>'lineas_anadidas')::int = 2 and (j->>'lineas')::int = 4, format('T5b: líneas (%s)', j);
  assert (j->>'total')::numeric = 1029.64 and j->>'total_origen' = 'leido', format('T5c: el pie impreso de la última página manda (%s)', j);
  assert j->'paginas_lineas' = '[1, 2]'::jsonb and (j->>'paginas')::int = 2, format('T5d: páginas (%s)', j);
  assert (select count(*) from public.productos_factura where factura_id = v_fa and pagina = 1) = 2, 'T5e: las líneas de la página 1 siguen';
  assert (select array_agg(orden order by orden) from public.productos_factura where factura_id = v_fa) = array[0, 1, 2, 3],
    'T5f: orden a continuación';
  assert (select estado = 'completado' and factura_id = v_fa and documento_pendiente is null from public.ocr_trabajos where id = v_tp),
    'T5g: trabajo cerrado';
  assert (select resumen_antes->>'operacion' = 'anadir_pagina' and (resumen_despues->>'lineas')::int = 4
            from public.facturas_sustituciones where trabajo_id = v_tp), 'T5h: auditoría';
  assert (select archivo_path = 'a1/pag2.jpg' from public.facturas where id = v_fa), 'T5i: sin original, se apunta el de la página';
  begin
    perform public.ocr_anadir_pagina(v_fa, v_tp, v_user, 2, 2, '{}'::jsonb, '[]'::jsonb, '{}'::jsonb, null);
    assert false, 'T5j: no se puede añadir dos veces';
  exception when raise_exception then
    assert sqlerrm like 'AÑADIDO ABORTADO: ese documento ya no está pendiente%', 'T5j: mensaje: ' || sqlerrm;
  end;
  -- Dos deducidos se suman.
  update public.facturas set total = 100, subtotal = 100, total_origen = 'deducido' where id = v_fb;
  insert into public.productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, pagina, orden)
  values (v_fb, 'A1 X', 1, 'ud', 100, 100, 1, 0);
  insert into public.ocr_trabajos (id, creado_por, num_paginas, origen, nombre_original, estado)
  values (v_t2, v_user, 1, 'imagen', 'a1-b.jpg', 'duplicado');
  j := public.ocr_anadir_pagina(v_fb, v_t2, v_user, 1, 2, '{"subtotal":50,"total":50,"total_origen":"deducido"}'::jsonb,
                                '[{"nombre":"A1 Y","total":50}]'::jsonb, '{}'::jsonb, null);
  assert (j->>'total')::numeric = 150 and j->>'total_origen' = 'deducido', format('T5k: deducidos sumados (%s)', j);
  assert (select subtotal from public.facturas where id = v_fb) = 150, 'T5l: subtotal sumado';

  -- ─── T6. Topes del despacho ──────────────────────────────────────────────
  if exists (select 1 from vault.decrypted_secrets where name = 'ocr_trabajos_secret' and coalesce(decrypted_secret, '') <> '') then
    -- 3 consolidaciones en marcha → la cuarta espera.
    insert into public.ocr_trabajos (id, creado_por, num_paginas, origen, nombre_original, estado, lease_hasta)
    select gen_random_uuid(), v_user, 1, 'imagen', 'a1-consol-' || g || '.jpg', 'consolidando', now() + interval '2 minutes' from generate_series(1, 3) g;
    insert into public.ocr_trabajos (id, creado_por, num_paginas, origen, nombre_original, estado)
    values (gen_random_uuid(), v_user, 1, 'imagen', 'a1-espera.jpg', 'paginas') returning id into v_tc;
    insert into public.ocr_trabajo_paginas (trabajo_id, numero, pieza, pagina_doc, storage_path, mime, bytes, estado)
    values (v_tc, 1, 'pagina', 1, 'pendientes/x/a1/01.jpg', 'image/jpeg', 1000, 'completada');
    n := public.ocr_despachar(v_tc);
    assert n = 0, format('T6a: con 3 consolidaciones no se despacha otra (%s)', n);
    assert (select consolidar_despachado_at is null from public.ocr_trabajos where id = v_tc), 'T6b: no se marca como despachada';
    update public.ocr_trabajos set lease_hasta = now() - interval '1 second' where nombre_original like 'a1-consol-%';
    n := public.ocr_despachar_cola();
    assert n >= 1 and (select consolidar_despachado_at is not null from public.ocr_trabajos where id = v_tc),
      format('T6c: al liberarse hueco, la cola la despacha (%s)', n);
    -- 12 piezas leyéndose → una pieza nueva espera.
    insert into public.ocr_trabajos (id, creado_por, num_paginas, origen, nombre_original, estado)
    select gen_random_uuid(), v_user, 1, 'imagen', 'a1-lee-' || g || '.jpg', 'pagina1' from generate_series(1, 12) g;
    insert into public.ocr_trabajo_paginas (trabajo_id, numero, pieza, pagina_doc, storage_path, mime, bytes, estado, lease_hasta)
    select id, 1, 'pagina', 1, 'pendientes/x/a1/01.jpg', 'image/jpeg', 1000, 'procesando', now() + interval '2 minutes'
      from public.ocr_trabajos where nombre_original like 'a1-lee-%';
    insert into public.ocr_trabajos (id, creado_por, num_paginas, origen, nombre_original)
    values (gen_random_uuid(), v_user, 1, 'imagen', 'a1-nueva.jpg') returning id into v_tc;
    insert into public.ocr_trabajo_paginas (trabajo_id, numero, pieza, pagina_doc, storage_path, mime, bytes)
    values (v_tc, 1, 'pagina', 1, 'pendientes/x/a1/01.jpg', 'image/jpeg', 1000);
    n := public.ocr_despachar(v_tc);
    assert n = 0, format('T6d: con 12 piezas leyéndose no se despacha otra (%s)', n);
    assert (select estado from public.ocr_trabajos where id = v_tc) = 'pagina1', 'T6e: pasa a pagina1 y espera';
    update public.ocr_trabajo_paginas set lease_hasta = now() - interval '1 second'
     where trabajo_id in (select id from public.ocr_trabajos where nombre_original like 'a1-lee-%');
    n := public.ocr_despachar(v_tc);
    assert n = 1, format('T6f: con hueco, se despacha (%s)', n);
  else
    raise notice 'T6: sin el secreto ocr_trabajos_secret en Vault; se omiten los topes';
  end if;

  -- ─── T7. Permisos ────────────────────────────────────────────────────────
  assert not has_function_privilege('anon', 'public.ocr_resumen_factura(bigint)', 'execute'), 'T7a: anon resumen';
  assert has_function_privilege('authenticated', 'public.ocr_resumen_factura(bigint)', 'execute'), 'T7b: authenticated resumen';
  assert not has_function_privilege('authenticated', 'public.ocr_resumen_factura_datos(bigint)', 'execute'), 'T7c: datos solo service_role';
  assert not has_function_privilege('authenticated', 'public.ocr_anadir_pagina(bigint, uuid, uuid, integer, integer, jsonb, jsonb, jsonb, text)', 'execute'),
    'T7d: añadir solo service_role';
  assert not has_function_privilege('authenticated', 'public.ocr_despachar_cola()', 'execute'), 'T7e: cola solo service_role';
  assert has_function_privilege('service_role', 'public.ocr_anadir_pagina(bigint, uuid, uuid, integer, integer, jsonb, jsonb, jsonb, text)', 'execute'),
    'T7f: service_role añade';
end;
$$;

select 'ocr_paginas_duplicados_test: OK' as resultado;

rollback;
