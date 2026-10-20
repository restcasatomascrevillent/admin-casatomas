set client_encoding = 'UTF8';
-- ===========================================================================
-- Pruebas de 20261005140000_chatbot_facturas_ajustes.sql
-- SQL plano con ASSERT dentro de BEGIN … ROLLBACK (solo lee). DESPUÉS de
-- aplicar la migración:
--   npx supabase db query --linked -f supabase/tests/chatbot_facturas_ajustes_test.sql
-- Si termina sin ERROR, todo ha pasado. NO en el SQL Editor.
-- Datos de referencia: base del 05/10/2026 (19 documentos; sin total: albarán
-- 38 y facturas 39 y 54; id 52 con fecha_ausente; portes de ANGELMAR 57 € y
-- ENCHENTA 25,45 €). Las preguntas fallidas de la segunda batería van
-- anotadas (q19, n3, q11, q16, q09, n5).
-- ===========================================================================

begin;

do $$
declare
  j  jsonb;
  f  jsonb;
  n  int;
begin
  -- B1 (q19). «Sin factura» no existe: error claro, no sin_total.
  j := filtrar_documentos_agente('albaranes_sin_factura')::jsonb;
  assert j ->> 'error' ilike '%no hay ninguna relacion%' and j ->> 'error' ilike '%sin_total NO significa sin factura%',
    format('B1: %s', j);
  j := filtrar_documentos_agente('sin_facturar')::jsonb;
  assert j ? 'error', 'B1: sin_facturar aceptado';
  j := filtrar_documentos_agente('pagadas')::jsonb;
  assert j ? 'error', 'B1: pagadas aceptado';
  j := filtrar_documentos_agente('sin_total')::jsonb;
  assert j ->> 'nota' ilike '%NO significa sin factura%', 'B1: sin_total sin nota';
  j := filtrar_documentos_agente('todos')::jsonb;
  assert not j ? 'nota', 'B1: nota fuera de sin_total';

  -- B2 (n3). Ticket medio: 3.155,52 € sobre 10 facturas con total y
  --          1.068,90 € sobre 6 albaranes con total.
  j := consulta_flexible_agente('{"metricas": ["avg_total", "count_documentos", "count_con_total"], "agrupar": ["tipo"]}')::jsonb;
  assert j ->> 'error' is null, format('B2: %s', j ->> 'error');
  select x into f from jsonb_array_elements(j -> 'filas') x where x ->> 'tipo' = 'factura';
  assert (f ->> 'avg_total')::numeric = 3155.52 and (f ->> 'n_con_total')::int = 10
     and (f ->> 'count_con_total')::int = 10 and (f ->> 'count_documentos')::int = 12, format('B2 facturas: %s', f);
  select x into f from jsonb_array_elements(j -> 'filas') x where x ->> 'tipo' = 'albaran';
  assert (f ->> 'avg_total')::numeric = 1068.90 and (f ->> 'n_con_total')::int = 6, format('B2 albaranes: %s', f);
  assert j ->> 'criterio' ilike '%n_con_%', 'B2: criterio sin n_con';
  -- count_con_total no existe con fuente lineas.
  j := consulta_flexible_agente('{"fuente": "lineas", "metricas": ["count_con_total"]}')::jsonb;
  assert j ? 'error', 'B2: count_con_total con lineas';
  -- Media de líneas también trae n_con_.
  j := consulta_flexible_agente('{"fuente": "lineas", "metricas": ["avg_precio_unitario"]}')::jsonb;
  assert (j -> 'filas' -> 0 ->> 'n_con_precio_unitario')::int > 0, format('B2 lineas: %s', j -> 'filas');

  -- B3 (n1). Cruce proveedor x mes: filas por pareja y sin_total de facturas.
  j := consulta_flexible_agente('{"metricas": ["sum_total"], "agrupar": ["proveedor", "mes"],
                                  "filtros": {"tipo": "factura", "desde": "2025-01-01", "hasta": "2025-12-31"}, "limite": 50}')::jsonb;
  assert (j ->> 'total_filas')::int = 5 and (j -> 'documentos_sin_total' ->> 'n')::int = 1
     and j -> 'documentos_sin_total' -> 'docs' -> 0 ->> 'numero' = 'F/25011959', format('B3: %s', j);

  -- B4 (q11). Portes: dos proveedores => comparativa, variacion null.
  j := historial_precios_agente('portes', 20)::jsonb;
  assert (j ->> 'comparativa_entre_proveedores')::boolean, format('B4: %s', j);
  assert j ? 'variacion' and jsonb_typeof(j -> 'variacion') = 'null', 'B4: variacion no es null';
  assert jsonb_array_length(j -> 'proveedores') = 2, 'B4: proveedores';
  assert j ->> 'nota_variacion' ilike '%COMPARATIVA%', 'B4: nota';
  assert not exists (select 1 from jsonb_array_elements(j -> 'por_proveedor') p where p ? 'variacion_pct'),
    'B4: variacion_pct de un proveedor con una sola fecha';
  -- Un producto de un solo proveedor y una sola fecha: sin comparativa.
  j := historial_precios_agente('merluza', 20)::jsonb;
  assert not j ? 'comparativa_entre_proveedores' and jsonb_typeof(j -> 'variacion') = 'null', format('B4 merluza: %s', j);
  j := historial_precios_agente('producto que no existe', 20)::jsonb;
  assert (j ->> 'compras_encontradas')::int = 0, 'B4: vacio';

  -- B5 (q16/q01/q22). sin_total por tipo y consistente entre herramientas.
  j := resumen_periodo_agente('2025-12-01', '2025-12-31')::jsonb;
  assert not j ? 'documentos_sin_total', 'B5: sigue la lista global mezclada';
  assert (j -> 'facturas' -> 'sin_total' ->> 'n')::int = 1
     and j -> 'facturas' -> 'sin_total' -> 'docs' -> 0 ->> 'numero' = 'F/25011959', format('B5 dic facturas: %s', j -> 'facturas');
  assert (j -> 'albaranes' -> 'sin_total' ->> 'n')::int = 1
     and j -> 'albaranes' -> 'sin_total' -> 'docs' -> 0 ->> 'numero' = '2509134', format('B5 dic albaranes: %s', j -> 'albaranes');
  select (m ->> 'sin_total')::int into n
    from jsonb_array_elements(estadisticas_globales_agente()::jsonb -> 'meses') m where m ->> 'mes' = '2025-12';
  assert n = 1, format('B5: meses dic sin_total = %s', n);
  j := estadisticas_globales_agente()::jsonb;
  assert not j ? 'documentos_sin_total', 'B5: estadisticas con lista global';
  assert (j -> 'facturas' -> 'sin_total' ->> 'n')::int = 2
     and not exists (select 1 from jsonb_array_elements(j -> 'facturas' -> 'sin_total' -> 'docs') d where d ->> 'tipo' = 'albaran'),
    'B5: facturas.sin_total incluye albaranes';
  assert (j -> 'albaranes' -> 'sin_total' ->> 'n')::int = 1, 'B5: albaranes.sin_total';
  -- Enero: sin albaranes sin total => no aparece la clave.
  j := resumen_periodo_agente('2026-01-01', '2026-01-31')::jsonb;
  assert not (j -> 'albaranes') ? 'sin_total' and (j -> 'facturas' -> 'sin_total' ->> 'n')::int = 1, 'B5: enero';
  -- Conteo puro en la flexible: sin documentos_sin_total.
  j := consulta_flexible_agente('{"metricas": ["count_documentos"], "agrupar": ["tipo"]}')::jsonb;
  assert not j ? 'documentos_sin_total', 'B5: conteo con aviso de parcial';
  -- El ranking por proveedor de facturas solo cita facturas.
  j := ranking_agente('gasto_proveedor', 'factura', 5)::jsonb;
  assert not exists (select 1 from jsonb_array_elements(j -> 'documentos_sin_total' -> 'docs') d where d ->> 'tipo' = 'albaran'),
    'B5: ranking facturas cita albaranes';

  -- B6 (q09). Cantidad: criterio redactado y primero de cada unidad.
  j := ranking_agente('cantidad', null, 5)::jsonb;
  assert j ->> 'criterio' ilike '%kg con kg%', format('B6: %s', j ->> 'criterio');
  assert exists (select 1 from jsonb_array_elements(j -> 'primero_por_unidad') u
                  where u ->> 'unidad' = 'kg' and u ->> 'producto' ilike 'merluza%'), 'B6: kg';
  assert exists (select 1 from jsonb_array_elements(j -> 'primero_por_unidad') u where u ->> 'unidad' = 'ud'), 'B6: ud';
  j := ranking_agente('veces', null, 5)::jsonb;
  assert not j ? 'primero_por_unidad', 'B6: veces con primero_por_unidad';

  -- B7 (n5). Agrupar por día de la semana avisa de la fecha dudosa (id 52).
  j := consulta_flexible_agente('{"metricas": ["count_documentos"], "agrupar": ["dia_semana"], "filtros": {"tipo": "factura"}}')::jsonb;
  assert (j -> 'fechas_dudosas' ->> 'n')::int = 1 and (j -> 'fechas_dudosas' -> 'docs' -> 0 ->> 'id')::int = 52, format('B7: %s', j);
  j := consulta_flexible_agente('{"fuente": "lineas", "metricas": ["count_lineas"], "agrupar": ["mes"]}')::jsonb;
  assert (j -> 'fechas_dudosas' ->> 'n')::int = 1, 'B7: lineas por mes';
  j := consulta_flexible_agente('{"metricas": ["count_documentos"], "agrupar": ["proveedor"]}')::jsonb;
  assert not j ? 'fechas_dudosas', 'B7: fechas_dudosas sin agrupar por fecha';

  -- B8. Seguridad de la flexible intacta.
  j := consulta_flexible_agente('{"agrupar": ["proveedor; drop table facturas"]}')::jsonb;
  assert j ? 'error', 'B8: inyeccion';
  j := consulta_flexible_agente('{"metricas": ["count_con_total; select 1"]}')::jsonb;
  assert j ? 'error', 'B8: metrica inyectada';

  -- B9. Permisos y configuración.
  select count(*) into n
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public'
     and p.proname in ('estadisticas_globales_agente', 'resumen_periodo_agente', 'filtrar_documentos_agente',
                       'ranking_agente', 'consulta_flexible_agente', 'historial_precios_agente')
     and not has_function_privilege('anon', p.oid, 'execute')
     and has_function_privilege('authenticated', p.oid, 'execute')
     and has_function_privilege('service_role', p.oid, 'execute')
     and not p.prosecdef
     and p.proconfig @> array['search_path=public'];
  assert n = 6, format('B9: %s de 6 funciones con permisos/search_path correctos', n);
end;
$$;

select 'chatbot_facturas_ajustes: todas las comprobaciones han pasado' as resultado;

rollback;
