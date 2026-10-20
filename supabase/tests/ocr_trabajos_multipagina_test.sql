set client_encoding = 'UTF8';
-- ===========================================================================
-- Pruebas de 20261005120000_ocr_trabajos_multipagina.sql
-- SQL plano con ASSERT dentro de BEGIN … ROLLBACK: no deja nada escrito, y
-- las peticiones de pg_net que se encolen aquí se descartan con el ROLLBACK
-- (net.http_post solo envía tras COMMIT). DESPUÉS de aplicar la migración:
--   npx supabase db query --linked -f supabase/tests/ocr_trabajos_multipagina_test.sql
-- Si termina sin ERROR e imprime «ocr_trabajos_multipagina_test: OK», todo ha pasado.
--
-- Cubre: relleno de orden sin huecos; despacho mudo sin secreto; máquina de
-- estados (reclamar una sola vez, p1 → paginas, consolidación una sola vez,
-- relectura una sola ronda, 3 fallos → fallida, lease caducado → rescate);
-- RLS (authenticated sin permiso no ve nada; anon no ejecuta RPC);
-- duplicado por número normalizado; SUSTITUCIÓN EN SITIO sobre una COPIA de
-- la factura 54 (Luga): mismo id, líneas e historial rehechos, copia de
-- auditoría, guardas de concurrencia y todo-o-nada.
-- ===========================================================================

begin;

do $$
declare
  v_user   uuid;
  v_trab   uuid := '00000000-0000-4000-8000-0000000000a1';
  v_dup    uuid := '00000000-0000-4000-8000-0000000000a2';
  p1 bigint; p2 bigint; p3 bigint;
  n integer;
  r record;
  j jsonb;
  v_copia bigint;
  v_hist_antes integer;
  v_lin_antes integer;
  v_updated timestamp;
begin
  select id into v_user from auth.users order by created_at limit 1;
  assert v_user is not null, 'T0: no hay ningún usuario en auth.users';

  -- T1. Relleno de orden: 0..n-1 por factura, sin huecos.
  select count(*) into n from (
    select factura_id from public.productos_factura group by factura_id
    having min(orden) <> 0 or max(orden) <> count(*) - 1 or count(distinct orden) <> count(*)) s;
  assert n = 0, format('T1: %s facturas con huecos en orden', n);
  select count(*) into n from public.productos_factura where pagina is null or orden is null;
  assert n = 0, format('T1: %s líneas sin pagina/orden', n);

  -- T2. Sin secreto en Vault, ocr_despachar es mudo.
  delete from vault.secrets where name = 'ocr_trabajos_secret';
  insert into public.ocr_trabajos (id, creado_por, num_paginas, origen, nombre_original)
  values (v_trab, v_user, 3, 'imagen', 'test-luga.jpg');
  insert into public.ocr_trabajo_paginas (trabajo_id, numero, pieza, pagina_doc, franja, storage_path, mime, bytes)
  values (v_trab, 1, 'franja', 1, 1, 'pendientes/x/a1/01.jpg', 'image/jpeg', 1000),
         (v_trab, 2, 'franja', 1, 2, 'pendientes/x/a1/02.jpg', 'image/jpeg', 1000),
         (v_trab, 3, 'franja', 1, 3, 'pendientes/x/a1/03.jpg', 'image/jpeg', 1000);
  select id into p1 from public.ocr_trabajo_paginas where trabajo_id = v_trab and numero = 1;
  select id into p2 from public.ocr_trabajo_paginas where trabajo_id = v_trab and numero = 2;
  select id into p3 from public.ocr_trabajo_paginas where trabajo_id = v_trab and numero = 3;
  assert public.ocr_despachar(v_trab) = 0, 'T2: sin secreto ocr_despachar debería devolver 0';
  assert (select estado from public.ocr_trabajos where id = v_trab) = 'pendiente', 'T2: sin secreto no cambia el estado';

  -- T3. Con secreto (falso, se deshace con el ROLLBACK): p1 primero, una sola vez.
  perform vault.create_secret('secreto-de-prueba', 'ocr_trabajos_secret');
  assert public.ocr_despachar(v_trab) = 1, 'T3: debería encolar solo la pieza 1';
  assert (select estado from public.ocr_trabajos where id = v_trab) = 'pagina1', 'T3: pendiente → pagina1';
  assert public.ocr_despachar(v_trab) = 0, 'T3: p1 ya despachada hace < 30 s: no se repite';

  -- T4. Reclamar: p2 no mientras p1 no termina; p1 una sola vez.
  select count(*) into n from public.ocr_reclamar_pagina(p2);
  assert n = 0, 'T4: p2 no se puede reclamar en pagina1';
  select count(*) into n from public.ocr_reclamar_pagina(p1);
  assert n = 1, 'T4: p1 se reclama';
  select count(*) into n from public.ocr_reclamar_pagina(p1);
  assert n = 0, 'T4: p1 no se reclama dos veces';

  -- T5. Cerrar p1 → paginas + contexto + despacha p2 y p3.
  assert public.ocr_cerrar_pagina(p1, '{"lineas":[]}', '{"filas_tabla":0}', null, '[]', 0, 0, 0, 1000, 10, 10, 0.001,
                                  '{"formato_numerico":"en"}', 'gpt-5.4-mini'), 'T5: cerrar p1';
  select * into r from public.ocr_trabajos where id = v_trab;
  assert r.estado = 'paginas' and r.contexto_p1->>'formato_numerico' = 'en' and r.coste_usd > 0, 'T5: p1 → paginas con contexto';
  select count(*) into n from public.ocr_trabajo_paginas where trabajo_id = v_trab and despachada_at is not null and numero > 1;
  assert n = 2, format('T5: deberían haberse despachado p2 y p3 (%s)', n);
  assert not public.ocr_cerrar_pagina(p1, '{}', null, null, null, 0, 0, 0, 0, 0, 0, 0, null, null), 'T5: p1 no se cierra dos veces';

  -- T6. Consolidación: no antes de cerrar todas; luego una sola vez.
  select count(*) into n from public.ocr_reclamar_consolidacion(v_trab);
  assert n = 0, 'T6: no se consolida con piezas pendientes';
  perform public.ocr_reclamar_pagina(p2);
  perform public.ocr_reclamar_pagina(p3);
  perform public.ocr_cerrar_pagina(p2, '{"lineas":[]}', null, null, null, 0, 0, 0, 1, 1, 1, 0, null, null);
  perform public.ocr_cerrar_pagina(p3, '{"lineas":[]}', null, null, null, 0, 0, 0, 1, 1, 1, 0, null, null);
  select count(*) into n from public.ocr_reclamar_consolidacion(v_trab);
  assert n = 1, 'T6: la consolidación se reclama';
  select count(*) into n from public.ocr_reclamar_consolidacion(v_trab);
  assert n = 0, 'T6: la consolidación no se reclama dos veces';

  -- T7. Relectura diferida: una ronda; la segunda no hace nada.
  assert public.ocr_pedir_relectura(v_trab, jsonb_build_array(jsonb_build_object('pagina_id', p2, 'motivo', '[{"codigo":"x"}]'))) = 1,
    'T7: la relectura de p2 se acepta';
  select * into r from public.ocr_trabajos where id = v_trab;
  assert r.estado = 'paginas' and r.ronda_relectura = 1, 'T7: trabajo vuelve a paginas con ronda 1';
  assert (select estado from public.ocr_trabajo_paginas where id = p2) = 'pendiente', 'T7: p2 vuelve a pendiente';
  perform public.ocr_reclamar_pagina(p2);
  perform public.ocr_cerrar_pagina(p2, '{"lineas":[]}', null, null, null, 0, 0, 1, 1, 1, 1, 0, null, null);
  perform public.ocr_reclamar_consolidacion(v_trab);
  assert public.ocr_pedir_relectura(v_trab, jsonb_build_array(jsonb_build_object('pagina_id', p3, 'motivo', '[]'))) = 0,
    'T7: segunda ronda de relectura rechazada';

  -- T8. 3 fallos técnicos → fallida.
  update public.ocr_trabajo_paginas set estado = 'procesando', intentos = 3 where id = p3;
  assert public.ocr_fallo_pagina(p3, 'prueba') = 'fallida', 'T8: al tercer intento la pieza queda fallida';
  update public.ocr_trabajo_paginas set estado = 'procesando', intentos = 1 where id = p3;
  assert public.ocr_fallo_pagina(p3, 'prueba') = 'pendiente', 'T8: con intentos < 3 vuelve a pendiente';

  -- T9. Lease caducado → el cron lo rescata.
  update public.ocr_trabajos set estado = 'paginas' where id = v_trab;
  update public.ocr_trabajo_paginas set estado = 'procesando', intentos = 1, lease_hasta = now() - interval '1 minute'
   where id = p3;
  perform public.reanudar_trabajos_ocr();
  assert (select estado from public.ocr_trabajo_paginas where id = p3) = 'pendiente', 'T9: lease caducado → pendiente';

  -- T10. Terminar: estado terminal, no se reabre.
  assert public.ocr_terminar_trabajo(v_trab, 'fallido', '{"success":false}', null, 'prueba'), 'T10: terminar';
  assert not public.ocr_terminar_trabajo(v_trab, 'completado', null, null, null), 'T10: un trabajo terminado no cambia';

  -- T11. RLS: authenticated sin permiso de facturas no ve nada.
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.ocr_trabajos;
  assert n = 0, format('T11: un usuario sin permiso ve %s trabajos', n);
  select count(*) into n from public.facturas_sustituciones;
  assert n = 0, 'T11: un usuario sin permiso ve sustituciones';
  reset role;

  -- T12. Privilegios: nadie salvo service_role ejecuta las RPC.
  assert not has_function_privilege('anon', 'public.ocr_reclamar_pagina(bigint, integer)', 'execute'), 'T12: anon reclamar';
  assert not has_function_privilege('authenticated', 'public.ocr_despachar(uuid)', 'execute'), 'T12: authenticated despachar';
  assert not has_function_privilege('authenticated', 'public.ocr_sustituir_factura(bigint, uuid, uuid, jsonb, jsonb, jsonb, text)', 'execute'),
    'T12: authenticated sustituir';
  assert not has_table_privilege('authenticated', 'public.ocr_trabajos', 'insert'), 'T12: authenticated insert en ocr_trabajos';
  assert not has_table_privilege('anon', 'public.ocr_trabajos', 'select'), 'T12: anon select en ocr_trabajos';

  -- T13. Duplicados: Luga por número; Garre con el número escrito con espacios.
  j := public.ocr_factura_existente('ML/101511', 'LUGA SABORES S.L.', null, '2025-12-31', 0);
  assert (j->>'id')::bigint = 54, format('T13: Luga debería ser la 54 (%s)', j);
  j := public.ocr_factura_existente('F / 25011959', 'SALAZONES GARRE', 'B-73028474', '2025-12-24', 0);
  assert (j->>'id')::bigint = 39, format('T13: Garre con espacios debería ser la 39 (%s)', j);
  assert public.ocr_factura_existente('NO-EXISTE-999', 'NADIE', null, '2025-01-01', 1) is null, 'T13: inexistente → null';

  -- T14. SUSTITUCIÓN EN SITIO sobre una COPIA de la factura 54.
  insert into public.facturas (tipo, proveedor, cif, numero_documento, fecha, subtotal, iva, total, total_origen,
                               observaciones, resumen, embedding, verificada, archivo_path, alertas_validacion)
  select tipo, proveedor, cif, 'TEST-COPIA-' || numero_documento, fecha, subtotal, iva, total, total_origen,
         observaciones, resumen, embedding, verificada, archivo_path, alertas_validacion
    from public.facturas where id = 54
  returning id into v_copia;
  insert into public.productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, embedding, pagina, orden)
  select v_copia, nombre, cantidad, unidad, precio_unitario, total, embedding, pagina, orden
    from public.productos_factura where factura_id = 54 order by orden;
  select count(*) into v_lin_antes from public.productos_factura where factura_id = v_copia;
  select count(*) into v_hist_antes from public.historial_precios where factura_id = v_copia;
  assert v_lin_antes = 8 and v_hist_antes = 8, format('T14: copia con %s líneas / %s historial', v_lin_antes, v_hist_antes);
  select updated_at into v_updated from public.facturas where id = v_copia;

  insert into public.ocr_trabajos (id, creado_por, num_paginas, origen, nombre_original, estado)
  values (v_dup, v_user, 1, 'sincrono', 'ML101511.pdf', 'duplicado');

  -- T14a. Guarda de concurrencia: si el nº de líneas no es el que vio el usuario, aborta y no toca nada.
  begin
    perform public.ocr_sustituir_factura(v_copia, v_dup, v_user,
      jsonb_build_object('tipo', 'factura', 'numero_documento', 'TEST-COPIA-ML/101511', 'fecha', '2025-12-31'),
      '[]'::jsonb, jsonb_build_object('lineas', 99), null);
    assert false, 'T14a: debería haber abortado por concurrencia';
  exception when raise_exception then
    assert sqlerrm like 'SUSTITUCIÓN ABORTADA%', 'T14a: mensaje inesperado: ' || sqlerrm;
  end;
  assert (select count(*) from public.productos_factura where factura_id = v_copia) = 8, 'T14a: no tocó las líneas';

  -- T14b. Todo o nada: una cabecera que choca con unique_documento deshace también el borrado.
  begin
    perform public.ocr_sustituir_factura(v_copia, v_dup, v_user,
      jsonb_build_object('tipo', 'factura', 'numero_documento', (select numero_documento from public.facturas where id = 54),
                         'proveedor', (select proveedor from public.facturas where id = 54), 'fecha', '2025-12-31'),
      '[{"nombre":"X","cantidad":1,"precio_unitario":1,"total":1}]'::jsonb,
      jsonb_build_object('lineas', 8), null);
    assert false, 'T14b: debería haber chocado con unique_documento';
  exception when unique_violation then
    null;
  end;
  assert (select count(*) from public.productos_factura where factura_id = v_copia) = 8
     and (select count(*) from public.historial_precios where factura_id = v_copia) = 8
     and (select count(*) from public.facturas_sustituciones where factura_id = v_copia) = 0,
    'T14b: el fallo no deshizo todo';

  -- T14c. Sustitución buena: 3 líneas nuevas, proveedor corregido.
  j := public.ocr_sustituir_factura(v_copia, v_dup, v_user,
    jsonb_build_object('tipo', 'factura', 'proveedor', 'LUGA SABORES S.L. (TEST)', 'cif', 'B-54529045',
                       'numero_documento', 'TEST-COPIA-ML/101511', 'fecha', '2025-12-31', 'subtotal', null,
                       'iva', null, 'total', 129.53, 'total_origen', 'deducido', 'resumen', 'prueba', 'paginas', 2),
    '[{"nombre":"PICOS Sin Gluten","cantidad":2,"unidad":"ud","precio_unitario":9.03,"total":18.07,"pagina":1,"orden":0,"albaran_ref":"V/ 774.077"},
      {"nombre":"ESPINAS PESCADO SALMONETE","cantidad":1,"unidad":"ud","precio_unitario":4.2,"total":8.4,"pagina":1,"orden":1,"albaran_ref":"V/ 774.077"},
      {"nombre":"NATOP 2L","cantidad":12,"unidad":"ud","precio_unitario":4.14,"total":99.46,"pagina":2,"orden":2,"albaran_ref":"V/ 781.316"}]'::jsonb,
    jsonb_build_object('lineas', 8, 'updated_at', v_updated), '2025/12/' || v_copia || '-ML101511.pdf');
  assert (j->>'factura_id')::bigint = v_copia and (j->>'lineas')::int = 3 and (j->>'historial_borrado')::int = 8
     and (j->>'historial_creado')::int = 3, format('T14c: resultado inesperado %s', j);
  select * into r from public.facturas where id = v_copia;
  assert r.proveedor = 'LUGA SABORES S.L. (TEST)' and r.total = 129.53 and r.total_origen = 'deducido'
     and r.paginas = 2 and r.ocr_trabajo_id = v_dup and r.drive_url is null
     and r.archivo_path = '2025/12/' || v_copia || '-ML101511.pdf' and r.alertas_validacion is null,
    'T14c: cabecera no sustituida como se esperaba';
  assert (select count(*) from public.productos_factura where factura_id = v_copia) = 3, 'T14c: 3 líneas nuevas';
  assert (select string_agg(albaran_ref, ',' order by orden) from public.productos_factura where factura_id = v_copia)
         = 'V/ 774.077,V/ 774.077,V/ 781.316', 'T14c: orden y albarán de las líneas';
  assert (select count(*) from public.historial_precios where factura_id = v_copia and proveedor = 'LUGA SABORES S.L. (TEST)') = 3,
    'T14c: el historial se rehízo con el proveedor nuevo';
  select * into r from public.facturas_sustituciones where factura_id = v_copia;
  assert jsonb_array_length(r.productos_antes) = 8 and jsonb_array_length(r.historial_antes) = 8
     and r.factura_antes->>'numero_documento' = 'TEST-COPIA-ML/101511' and not (r.factura_antes ? 'embedding')
     and r.sustituida_por = v_user, 'T14c: copia de auditoría incompleta';
  assert (select estado from public.ocr_trabajos where id = v_dup) = 'completado'
     and (select factura_id from public.ocr_trabajos where id = v_dup) = v_copia, 'T14c: trabajo completado';

  -- T14d. Un trabajo ya usado no sustituye dos veces.
  begin
    perform public.ocr_sustituir_factura(v_copia, v_dup, v_user, jsonb_build_object('numero_documento', 'x'), '[]', '{}', null);
    assert false, 'T14d: debería abortar (trabajo ya completado)';
  exception when raise_exception then
    null;
  end;

  -- T15. La factura 54 original no se ha tocado.
  assert (select count(*) from public.productos_factura where factura_id = 54) = 8, 'T15: la 54 sigue con sus 8 líneas';
end;
$$;

select 'ocr_trabajos_multipagina_test: OK' as resultado;

rollback;
