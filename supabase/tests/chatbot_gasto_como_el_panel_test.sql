set client_encoding = 'UTF8';
-- Test de 20261106140000_chatbot_gasto_como_el_panel. BEGIN … ROLLBACK: no deja nada escrito.
-- Acaba en «chatbot_gasto_como_el_panel_test: OK».
--   supabase db query --linked -f supabase/tests/chatbot_gasto_como_el_panel_test.sql
--
--   P1 permisos y marca 20261106140000 en las ocho funciones (SECURITY INVOKER,
--      search_path, EXECUTE solo authenticated y service_role).
--   P2 datos de prueba en 2033: factura 100 + albarán ya facturado 50 + albarán
--      sin factura 30 → gasto 130 en resumen_periodo, estadisticas_globales
--      (meses), filtrar_documentos y consulta_flexible; el ya facturado sale aparte.
--   P3 filtrar_documentos: «sin factura» y «facturados» son filtros; «pagado» da
--      error; su COMMENT ya no dice que no hay relación albarán-factura.
--   P4 importes de línea: una línea sin importe no suma (gasto_categorias,
--      compras_producto, ficha_proveedor).
--   P5 datos reales: el chatbot da el gasto del panel al céntimo (octubre 2026,
--      2026 entero, todo y cada mes) y su regla de albarán facturado coincide hoy
--      con facturado_en_id.
--   P6 rapidez: resumen_periodo(2026) y estadisticas_globales < 1 s.
begin;

do $$
declare
  f      text;
  v_prov bigint;
  v_f1   bigint;
  v_a1   bigint;
  v_a2   bigint;
  j      jsonb;
  x      jsonb;
  v_n    numeric;
  t0     timestamptz;
  ms     numeric;
begin
  -- P1 ─────────────────────────────────────────────────────────────────────
  foreach f in array array['public.resumen_periodo_agente(date,date)',
                           'public.estadisticas_globales_agente()',
                           'public.filtrar_documentos_agente(text,text,text,date,date,text,integer)',
                           'public.consulta_flexible_agente(jsonb)',
                           'public.ficha_proveedor_agente(text)',
                           'public.compras_producto_agente(text,date,date,text,integer,text,text,vector,text)',
                           'public.gasto_categorias_agente(text,date,date,text,text)',
                           'public.variacion_precios_agente(date,date,numeric,text,text,integer,text)'] loop
    if has_function_privilege('anon', f, 'execute')
       or not has_function_privilege('authenticated', f, 'execute') or not has_function_privilege('service_role', f, 'execute') then
      raise exception 'FALLO P1: permisos de %', f;
    end if;
    if (select prosecdef or proconfig is null or not ('search_path=public' = any(proconfig)) from pg_proc where oid = f::regprocedure) then
      raise exception 'FALLO P1: % no es SECURITY INVOKER con search_path=public', f;
    end if;
    if position('20261106140000' in pg_get_functiondef(f::regprocedure)) = 0 then
      raise exception 'FALLO P1: % no es la de 20261106140000', f;
    end if;
  end loop;

  -- P2 ─────────────────────────────────────────────────────────────────────
  if exists (select 1 from facturas where fecha between '2033-01-01' and '2033-12-31') then
    raise exception 'FALLO datos: ya hay documentos en 2033; el test necesita ese año vacío';
  end if;
  insert into proveedores (nombre, cif) values ('PRUEBA CHATBOT PANEL SL', 'B00000171') returning id into v_prov;
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
  values ('factura', 'PRUEBA CHATBOT PANEL SL', 'B00000171', v_prov, 'CHP-1', '2033-01-20', 100, 'casa_tomas') returning id into v_f1;
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
  values ('albaran', 'PRUEBA CHATBOT PANEL SL', 'B00000171', v_prov, 'CHP-ALB-1', '2033-01-10', 50, 'casa_tomas') returning id into v_a1;
  update facturas set facturado_en_id = v_f1, facturado_origen = 'manual' where id = v_a1;
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
  values ('albaran', 'PRUEBA CHATBOT PANEL SL', 'B00000171', v_prov, 'CHP-ALB-2', '2033-02-10', 30, 'casa_tomas') returning id into v_a2;
  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total)
  values (v_f1, 'ATUN PRUEBA CHATBOT PANEL', 10, 'kg', 8, 80),
         (v_f1, 'ATUN PRUEBA CHATBOT PANEL', 1, 'kg', 7, null),   -- sin importe leído
         (v_a1, 'ATUN PRUEBA CHATBOT PANEL', 5, 'kg', 8, 40),     -- ya facturado
         (v_a2, 'ATUN PRUEBA CHATBOT PANEL', 3, 'kg', 8, 24);

  j := resumen_periodo_agente('2033-01-01', '2033-02-28')::jsonb;
  if (j -> 'gasto_total' ->> 'importe')::numeric <> 130 or (j -> 'gasto_total' ->> 'en_facturas')::numeric <> 100
     or (j -> 'gasto_total' ->> 'en_albaranes_sin_factura')::numeric <> 30 then
    raise exception 'FALLO P2: resumen gasto_total %', j -> 'gasto_total';
  end if;
  if (j -> 'facturas' ->> 'gasto')::numeric <> 100 or (j -> 'albaranes' ->> 'n')::int <> 1 or (j -> 'albaranes' ->> 'valor')::numeric <> 30
     or (j -> 'albaranes' -> 'ya_facturados' ->> 'n')::int <> 1 then
    raise exception 'FALLO P2: resumen facturas % / albaranes %', j -> 'facturas' -> 'gasto', j -> 'albaranes';
  end if;
  select m into x from jsonb_array_elements(j -> 'meses') m where m ->> 'mes' = '2033-01';
  if (x ->> 'gasto')::numeric <> 100 or x ? 'albaranes' then
    raise exception 'FALLO P2: enero 2033 en resumen.meses % (el albarán facturado no suma ni cuenta)', x;
  end if;
  select (p ->> 'gasto')::numeric into v_n from jsonb_array_elements(j -> 'proveedores') p where p ->> 'proveedor' = 'PRUEBA CHATBOT PANEL SL';
  if v_n <> 130 then
    raise exception 'FALLO P2: proveedor en resumen % (esperado 130)', v_n;
  end if;
  -- Va por tipo (factura 80, albarán sin factura 24).
  select sum((p ->> 'importe')::numeric) into v_n from jsonb_array_elements(j -> 'productos') p where p ->> 'producto' = 'ATUN PRUEBA CHATBOT PANEL';
  if v_n is distinct from 104 then
    raise exception 'FALLO P2: producto en resumen % (esperado 80 + 24: ni el albarán facturado ni la línea sin importe)', v_n;
  end if;
  j := estadisticas_globales_agente()::jsonb;
  select m into x from jsonb_array_elements(j -> 'meses') m where m ->> 'mes' = '2033-02';
  if (x ->> 'gasto')::numeric <> 30 or (x ->> 'en_albaranes_sin_factura')::numeric <> 30 or (x ->> 'en_facturas')::numeric <> 0 then
    raise exception 'FALLO P2: febrero 2033 en estadisticas.meses %', x;
  end if;
  j := filtrar_documentos_agente('todos', 'PRUEBA CHATBOT PANEL')::jsonb;
  if (j -> 'sumas' ->> 'gasto_total')::numeric <> 130 or (j -> 'sumas' -> 'albaranes' ->> 'ya_facturados')::int <> 1
     or (j -> 'sumas' -> 'albaranes' ->> 'valor_sin_factura')::numeric <> 30 then
    raise exception 'FALLO P2: filtrar_documentos sumas %', j -> 'sumas';
  end if;
  j := consulta_flexible_agente('{"fuente":"documentos","metricas":["sum_total","count_documentos"],"filtros":{"desde":"2033-01-01","hasta":"2033-12-31"}}')::jsonb;
  if (j -> 'filas' -> 0 ->> 'sum_total')::numeric <> 130 or (j -> 'filas' -> 0 ->> 'count_documentos')::int <> 2
     or j ->> 'criterio' not like '%sin albaranes ya facturados%' then
    raise exception 'FALLO P2: consulta_flexible %', j;
  end if;

  -- P3 ─────────────────────────────────────────────────────────────────────
  j := filtrar_documentos_agente('albaranes sin factura', null, null, '2033-01-01', '2033-12-31')::jsonb;
  if (j ->> 'total_filas')::int <> 1 or (j -> 'filas' -> 0 ->> 'id')::bigint <> v_a2 or j ? 'error' then
    raise exception 'FALLO P3: filtro sin factura %', j;
  end if;
  j := filtrar_documentos_agente('ya facturados', null, null, '2033-01-01', '2033-12-31')::jsonb;
  if (j ->> 'total_filas')::int <> 1 or (j -> 'filas' -> 0 ->> 'id')::bigint <> v_a1 then
    raise exception 'FALLO P3: filtro facturados %', j;
  end if;
  j := filtrar_documentos_agente('pagados')::jsonb;
  if j ->> 'error' not ilike '%estado de pago%' or j ->> 'error' ilike '%no hay ninguna relacion%' then
    raise exception 'FALLO P3: «pagados» %', j;
  end if;
  if obj_description('public.filtrar_documentos_agente(text,text,text,date,date,text,integer)'::regprocedure, 'pg_proc')
     ilike '%no hay relaci%' then
    raise exception 'FALLO P3: el COMMENT de filtrar_documentos_agente sigue diciendo que no hay relación';
  end if;

  -- P4 ─────────────────────────────────────────────────────────────────────
  j := gasto_categorias_agente(null, '2033-01-01', '2033-12-31')::jsonb;
  if (j -> 'total' ->> 'importe')::numeric <> 104 then
    raise exception 'FALLO P4: gasto_categorias % (esperado 104: la línea sin importe no suma)', j -> 'total';
  end if;
  j := compras_producto_agente('atun prueba chatbot panel', '2033-01-01', '2033-12-31')::jsonb;
  if (j -> 'total' ->> 'importe')::numeric <> 104 then
    raise exception 'FALLO P4: compras_producto % (esperado 104)', j -> 'total';
  end if;

  -- P5 datos reales ────────────────────────────────────────────────────────
  if exists (select albaran_id from albaranes_facturados_agente()
             except select id from facturas where tipo = 'albaran' and facturado_en_id is not null)
     or exists (select id from facturas where tipo = 'albaran' and facturado_en_id is not null
                except select albaran_id from albaranes_facturados_agente()) then
    raise exception 'FALLO P5: la regla del chatbot (albaranes_facturados_agente) ya no coincide con facturado_en_id: el chatbot y el panel pueden descuadrar (¿falta vincular algún albarán citado?)';
  end if;
  j := resumen_periodo_agente('2026-10-01', '2026-10-31')::jsonb;
  if (j -> 'gasto_total' ->> 'importe')::numeric <> (tablero_compras('2026-10-01', '2026-10-31')::jsonb -> 'indicadores' ->> 'gasto')::numeric then
    raise exception 'FALLO P5: octubre 2026 chatbot % ≠ panel %', j -> 'gasto_total' ->> 'importe',
      tablero_compras('2026-10-01', '2026-10-31')::jsonb -> 'indicadores' ->> 'gasto';
  end if;
  j := resumen_periodo_agente('2026-01-01', '2026-12-31')::jsonb;
  if (j -> 'gasto_total' ->> 'importe')::numeric <> (tablero_compras('2026-01-01', '2026-12-31')::jsonb -> 'indicadores' ->> 'gasto')::numeric then
    raise exception 'FALLO P5: 2026 chatbot % ≠ panel', j -> 'gasto_total' ->> 'importe';
  end if;
  j := estadisticas_globales_agente()::jsonb;
  if (j -> 'gasto_total' ->> 'importe')::numeric <> (tablero_compras(null, null)::jsonb -> 'indicadores' ->> 'gasto')::numeric then
    raise exception 'FALLO P5: todo chatbot % ≠ panel', j -> 'gasto_total' ->> 'importe';
  end if;
  for x in select m from jsonb_array_elements(j -> 'meses') m loop
    select coalesce(sum(total), 0) into v_n from facturas
     where to_char(fecha, 'YYYY-MM') = x ->> 'mes' and not (tipo = 'albaran' and facturado_en_id is not null);
    if (x ->> 'gasto')::numeric <> round(v_n, 2) then
      raise exception 'FALLO P5: mes % chatbot % ≠ panel %', x ->> 'mes', x ->> 'gasto', round(v_n, 2);
    end if;
  end loop;

  -- P6 ─────────────────────────────────────────────────────────────────────
  t0 := clock_timestamp();
  j := resumen_periodo_agente('2026-01-01', '2026-12-31')::jsonb;
  ms := extract(epoch from clock_timestamp() - t0) * 1000;
  if ms > 1000 then
    raise exception 'FALLO P6: resumen_periodo_agente(2026) tarda % ms', round(ms);
  end if;
  t0 := clock_timestamp();
  j := estadisticas_globales_agente()::jsonb;
  ms := extract(epoch from clock_timestamp() - t0) * 1000;
  if ms > 1000 then
    raise exception 'FALLO P6: estadisticas_globales_agente tarda % ms', round(ms);
  end if;
end;
$$;

rollback;

select 'chatbot_gasto_como_el_panel_test: OK' as resultado;
