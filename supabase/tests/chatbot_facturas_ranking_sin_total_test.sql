set client_encoding = 'UTF8';
-- ===========================================================================
-- Pruebas de 20261005100000_chatbot_facturas_ranking_sin_total.sql
-- SQL plano con ASSERT dentro de BEGIN … ROLLBACK (solo lee). DESPUÉS de
-- aplicar la migración:
--   npx supabase db query --linked -f supabase/tests/chatbot_facturas_ranking_sin_total_test.sql
-- Si termina sin ERROR, todo ha pasado. NO en el SQL Editor.
-- Datos de referencia: base del 05/10/2026 (19 documentos; sin total: 38, 39
-- y 54; id 52 con alerta fecha_ausente). Si se cargan más documentos, las
-- comprobaciones de conteo exacto (A1, A5) pueden necesitar ajuste; las de
-- coherencia entre RPC y de seguridad no.
-- ===========================================================================

begin;

-- sin_total cambió de forma en 20261005140000 (número -> {n, docs} por tipo,
-- sin lista global): estos ayudantes aceptan las dos para que el test valga
-- antes y después de esa migración.
create function pg_temp.st(x jsonb) returns int language sql immutable as $f$
  select coalesce(case jsonb_typeof(x -> 'sin_total') when 'number' then (x ->> 'sin_total')::int
                                                     when 'object' then (x -> 'sin_total' ->> 'n')::int end, 0)
$f$;
create function pg_temp.docs_st(x jsonb) returns jsonb language sql immutable as $f$
  select coalesce(x -> 'documentos_sin_total' -> 'docs',
                  coalesce(x -> 'facturas' -> 'sin_total' -> 'docs', '[]'::jsonb)
                  || coalesce(x -> 'albaranes' -> 'sin_total' -> 'docs', '[]'::jsonb))
$f$;

do $$
declare
  j   jsonb;
  j2  jsonb;
  n   int;
  ids bigint[];
  x   numeric;
begin
  -- A1. documentos_sin_total incluye hoy las facturas 54 (Luga) y 39 (Garre).
  j := estadisticas_globales_agente()::jsonb;
  select array_agg((d ->> 'id')::bigint) into ids from jsonb_array_elements(pg_temp.docs_st(j)) d;
  assert 54 = any(ids) and 39 = any(ids), format('A1: documentos_sin_total = %s', ids);
  assert pg_temp.st(j -> 'facturas') + pg_temp.st(j -> 'albaranes') = cardinality(ids), 'A1: n no coincide con la lista';
  assert pg_temp.st(j -> 'facturas') >= 2, 'A1: facturas.sin_total < 2';

  -- A2. Conteos alineados: para CADA mes, estadisticas.meses y
  --     resumen_periodo dan el mismo número de facturas, gasto y sin_total.
  for j2 in select m from jsonb_array_elements(j -> 'meses') m loop
    declare
      d1 date := to_date(j2 ->> 'mes', 'YYYY-MM');
      r  jsonb := resumen_periodo_agente(d1, (d1 + interval '1 month - 1 day')::date)::jsonb;
    begin
      assert (r -> 'facturas' ->> 'n')::int = (j2 ->> 'facturas')::int,
        format('A2: %s facturas resumen=%s estadisticas=%s', j2 ->> 'mes', r -> 'facturas' ->> 'n', j2 ->> 'facturas');
      assert (r -> 'facturas' ->> 'gasto')::numeric = (j2 ->> 'gasto')::numeric,
        format('A2: %s gasto resumen=%s estadisticas=%s', j2 ->> 'mes', r -> 'facturas' ->> 'gasto', j2 ->> 'gasto');
      assert pg_temp.st(r -> 'facturas') = coalesce((j2 ->> 'sin_total')::int, 0),
        format('A2: %s sin_total distinto', j2 ->> 'mes');
    end;
  end loop;
  -- …y la suma de meses = total global (no hay meses perdidos).
  select sum((m ->> 'facturas')::int) into n from jsonb_array_elements(j -> 'meses') m;
  assert n = (j -> 'facturas' ->> 'n')::int, format('A2: suma de meses %s <> %s facturas', n, j -> 'facturas' ->> 'n');
  -- …y gasto_proveedor del ranking suma lo mismo que estadisticas.
  select sum((f ->> 'importe')::numeric) into x
    from jsonb_array_elements(ranking_agente('gasto_proveedor', 'factura', 50)::jsonb -> 'filas') f;
  assert x = (j -> 'facturas' ->> 'gasto')::numeric, 'A2: ranking gasto_proveedor no suma el gasto global';

  -- A3. Enero de 2026 marca cifra parcial: Luga (54) sin total.
  j := resumen_periodo_agente('2026-01-01', '2026-01-31')::jsonb;
  assert pg_temp.st(j -> 'facturas') = 1, format('A3: enero sin_total = %s', j -> 'facturas' -> 'sin_total');
  assert exists (select 1 from jsonb_array_elements(pg_temp.docs_st(j)) d where (d ->> 'id')::int = 54
                    and d ->> 'numero' = 'ML/101511'), 'A3: enero no cita ML/101511';
  assert exists (select 1 from jsonb_array_elements(j -> 'proveedores') p
                  where p ->> 'proveedor' ilike 'luga%' and (p ->> 'sin_total')::int = 1), 'A3: Luga sin marca sin_total';

  -- A4. Ranking por precio unitario: devuelve el criterio y excluye servicios.
  j := ranking_agente('precio_unitario', null, 10)::jsonb;
  assert j ->> 'criterio' ilike '%precio unitario%sin iva%', format('A4: criterio = %s', j ->> 'criterio');
  assert not exists (select 1 from jsonb_array_elements(j -> 'filas') f
                      where es_linea_servicio_agente(lower(f ->> 'producto'))), 'A4: hay servicios en el ranking';
  assert (j -> 'filas' -> 0 ->> 'producto') ilike 'jam%n bellota%', format('A4: primero = %s', j -> 'filas' -> 0 ->> 'producto');
  assert (j -> 'filas' -> 0 ->> 'precio_unitario')::numeric = 519.40, 'A4: precio del primero <> 519,40';
  assert exists (select 1 from jsonb_array_elements(j -> 'servicios_excluidos' -> 'mayores') s
                  where s ->> 'producto' = 'TRABAJOS'), 'A4: no avisa de TRABAJOS excluido';
  -- Con servicios, TRABAJOS (598) pasa a ser el primero.
  j := ranking_agente('precio_unitario', null, 3, null, null, 'desc', true)::jsonb;
  assert j -> 'filas' -> 0 ->> 'producto' = 'TRABAJOS', 'A4: incluir_servicios no incluye TRABAJOS';
  -- Cantidad: no mezcla unidades; el primero es la merluza en kg.
  j := ranking_agente('cantidad', null, 3)::jsonb;
  assert j -> 'filas' -> 0 ->> 'unidad' = 'kg' and (j -> 'filas' -> 0 ->> 'producto') ilike 'merluza%',
    format('A4: cantidad primero = %s', j -> 'filas' -> 0);
  -- Criterio inválido -> error con la lista de permitidos.
  j := ranking_agente('lo_que_sea')::jsonb;
  assert j ? 'error' and j ? 'permitidos', 'A4: criterio invalido sin error';

  -- A5. Alertas con código y mensaje; fecha dudosa en el id 52.
  j := filtrar_documentos_agente('fecha_dudosa')::jsonb;
  assert (j ->> 'total_filas')::int >= 1 and exists (
           select 1 from jsonb_array_elements(j -> 'filas') f
            where (f ->> 'id')::int = 52 and (f ->> 'fecha_dudosa')::boolean
              and f -> 'alertas' -> 0 ->> 'codigo' = 'fecha_ausente'
              and length(f -> 'alertas' -> 0 ->> 'mensaje') > 10), 'A5: id 52 sin fecha_dudosa/alerta';
  j := estadisticas_globales_agente()::jsonb;
  assert exists (select 1 from jsonb_array_elements(j -> 'con_alertas') a where (a ->> 'id')::int = 52), 'A5: con_alertas sin el 52';

  -- A6. filtrar_documentos: sumas de TODO lo filtrado (Osborne = 6.089,71).
  j := filtrar_documentos_agente('todos', 'Osborne')::jsonb;
  assert (j -> 'sumas' -> 'facturas' ->> 'total')::numeric = 6089.71, format('A6: Osborne = %s', j -> 'sumas');
  j := filtrar_documentos_agente('sin_total', null, null, null, null, 'fecha_desc', 1)::jsonb;
  assert (j ->> 'truncado')::boolean and (j ->> 'total_filas')::int >= 3, 'A6: truncado/total_filas';
  j := filtrar_documentos_agente('pendientes_de_pago')::jsonb;
  assert j ? 'error', 'A6: filtro invalido sin error';

  -- A7. detalle_documento: número exacto, inexistente.
  j := detalle_documento_agente(null, 'ML/101511')::jsonb;
  assert (j ->> 'encontrado')::boolean and (j -> 'documento' ->> 'sin_total')::boolean
         and (j ->> 'suma_lineas')::numeric = 295.11, format('A7: Luga = %s', j ->> 'suma_lineas');
  j := detalle_documento_agente(null, '99999')::jsonb;
  assert not (j ->> 'encontrado')::boolean, 'A7: 99999 encontrado';

  -- A8. Búsqueda por texto (sin embeddings).
  j := buscar_productos_texto_agente('Johnnie Walker Black')::jsonb;
  assert jsonb_array_length(j) >= 1 and (j -> 0 ->> 'producto') ilike 'johnnie walker black%', 'A8: Johnnie Walker Black';
  j := buscar_productos_texto_agente('portes')::jsonb;
  assert jsonb_array_length(j) >= 2 and (j -> 0 ->> 'servicio')::boolean, 'A8: portes como servicio';

  -- A9. consulta_flexible: combinaciones permitidas.
  --  a) Gasto por proveedor y mes de 2025 (facturas): cuadra con resumen y avisa de Garre.
  j := consulta_flexible_agente('{"metricas": ["sum_total", "count_documentos"], "agrupar": ["proveedor", "mes"],
                                  "filtros": {"desde": "2025-01-01", "hasta": "2025-12-31", "tipo": "factura"}, "limite": 50}')::jsonb;
  assert j ->> 'error' is null, format('A9a: %s', j ->> 'error');
  select sum((f ->> 'count_documentos')::int) into n from jsonb_array_elements(j -> 'filas') f;
  assert n = (resumen_periodo_agente('2025-01-01', '2025-12-31')::jsonb -> 'facturas' ->> 'n')::int, 'A9a: conteo 2025';
  assert exists (select 1 from jsonb_array_elements(j -> 'documentos_sin_total' -> 'docs') d where (d ->> 'id')::int = 39), 'A9a: sin Garre';
  --  b) Producto con más cantidad excluyendo servicios.
  j := consulta_flexible_agente('{"fuente": "lineas", "metricas": ["sum_cantidad"], "agrupar": ["producto", "unidad"],
                                  "filtros": {"excluir_servicios": true}, "limite": 1}')::jsonb;
  assert (j -> 'filas' -> 0 ->> 'producto') ilike 'merluza%' and (j ->> 'truncado')::boolean, format('A9b: %s', j -> 'filas');
  assert j ->> 'criterio' ilike '%sin iva%', 'A9b: criterio sin nota de IVA';
  --  c) Media de total por tipo.
  j := consulta_flexible_agente('{"metricas": ["avg_total"], "agrupar": ["tipo"]}')::jsonb;
  assert (j ->> 'total_filas')::int = 2 and (j -> 'documentos_sin_total' ->> 'n')::int >= 3, format('A9c: %s', j);
  --  d) Filtro por proveedor (ilike normalizado): "joselito" encuentra factura y albarán.
  j := consulta_flexible_agente('{"metricas": ["count_documentos"], "filtros": {"proveedor": "joselito"}}')::jsonb;
  assert (j -> 'filas' -> 0 ->> 'count_documentos')::int = 2, format('A9d: %s', j -> 'filas');
  --  e) Valores no permitidos -> error claro con la lista de permitidos.
  j := consulta_flexible_agente('{"metricas": ["sum_precio"]}')::jsonb;
  assert j ? 'error' and j ? 'permitidos', 'A9e: metrica';
  j := consulta_flexible_agente('{"fuente": "documentos", "agrupar": ["producto"]}')::jsonb;
  assert j ? 'error', 'A9e: producto con documentos';
  j := consulta_flexible_agente('{"filtros": {"desde": "2026-02-30"}}')::jsonb;
  assert j ? 'error', 'A9e: fecha imposible';
  j := consulta_flexible_agente('{"sql": "select 1"}')::jsonb;
  assert j ? 'error', 'A9e: clave desconocida';
  j := consulta_flexible_agente('{"limite": 100000}')::jsonb;
  assert (j ->> 'error') is null, 'A9e: limite se acota, no falla';

  -- A10. Inyección: rechazada o neutralizada, y facturas intacta.
  j := consulta_flexible_agente('{"agrupar": ["proveedor; drop table facturas"]}')::jsonb;
  assert j ? 'error', 'A10: agrupar inyectado aceptado';
  j := consulta_flexible_agente('{"metricas": ["count_documentos); drop table facturas; --"]}')::jsonb;
  assert j ? 'error', 'A10: metrica inyectada aceptada';
  j := consulta_flexible_agente('{"orden_por": "count_documentos desc; select 1"}')::jsonb;
  assert j ? 'error', 'A10: orden_por inyectado aceptado';
  j := consulta_flexible_agente($j${"filtros": {"proveedor": "x'); drop table facturas; --"}}$j$)::jsonb;
  assert j ->> 'error' is null and (j -> 'filas' -> 0 ->> 'count_documentos')::int = 0, 'A10: valor inyectado no neutralizado';
  assert to_regclass('public.facturas') is not null and (select count(*) from facturas) > 0, 'A10: facturas tocada';

  -- A11. Permisos: ni PUBLIC ni anon; sí authenticated y service_role.
  select count(*) into n
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public'
     and p.proname in ('es_linea_servicio_agente', 'alertas_resumen_agente', 'fecha_dudosa_agente', 'documento_compacto_agente',
                       'docs_sin_total_agente', 'buscar_productos_texto_agente', 'ranking_agente', 'filtrar_documentos_agente',
                       'detalle_documento_agente', 'consulta_flexible_agente')
     and not has_function_privilege('anon', p.oid, 'execute')
     and has_function_privilege('authenticated', p.oid, 'execute')
     and has_function_privilege('service_role', p.oid, 'execute')
     and not p.prosecdef
     and p.proconfig @> array['search_path=public'];
  assert n = 10, format('A11: %s de 10 funciones con permisos/search_path correctos', n);
end;
$$;

select 'chatbot_facturas_ranking_sin_total: todas las comprobaciones han pasado' as resultado;

rollback;
