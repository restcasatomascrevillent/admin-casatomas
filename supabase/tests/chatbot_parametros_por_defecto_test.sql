set client_encoding = 'UTF8';
-- ===========================================================================
-- Pruebas de 20261008100000_chatbot_parametros_por_defecto.sql
-- SQL plano con ASSERT dentro de BEGIN … ROLLBACK: no deja nada escrito.
-- DESPUÉS de aplicar la migración, POR TERMINAL:
--   npx supabase db query --linked -f supabase/tests/chatbot_parametros_por_defecto_test.sql
-- Si termina sin ERROR e imprime «chatbot_parametros_por_defecto_test: OK», todo ha pasado.
--
-- Casos de la prueba del chatbot del 07/10 (datos de producción del 08/10):
--   T1 merluza sin fechas → todo el histórico: 172,7 kg, una_compra.
--   T2 jamón sin fechas → 3 proveedores, todos con el nombre canónico.
--   T3 marisco con tipo null → facturas + albaranes ≈ 1.353,85 €.
--   T4 mayonesa último trimestre de 2025 → 18 ud.
--   T5 centollo 2026 → vacío + ultimo_dato 5,7 kg de Angelmar (canónico).
--   T6 variación de la merluza → sin_comparar con una_compra.
--   T7 conteos sin avisos de importe; criterio sin «sin IVA conocido» si
--      todos los deducidos tienen IVA; nombres canónicos en ranking,
--      estadísticas, consulta_flexible y cruce por proveedor.
--   P  permisos: anon nada, authenticated sí.
-- ===========================================================================

begin;

do $$
declare
  j   jsonb;
  u   jsonb;
  n   int;
  v_canon text[] := array(select nombre from public.proveedores);
begin
  -- T1
  j := compras_producto_agente('merluza');
  assert j ->> 'periodo' = 'todo el historico', format('T1 periodo: %s', j ->> 'periodo');
  select x into u from jsonb_array_elements(j -> 'por_unidad') x where x ->> 'unidad' = 'kg';
  assert (u ->> 'cantidad')::numeric = 172.7, format('T1 kg de merluza: %s', u);
  assert (j ->> 'una_compra')::boolean, 'T1 una_compra';

  -- T2
  j := compras_producto_agente('jamon');
  assert (j #>> '{total,proveedores}')::int = 3, format('T2 proveedores: %s', j -> 'total');
  select count(*) into n from jsonb_array_elements(j -> 'por_proveedor') x
   where not (x ->> 'proveedor' = any(v_canon));
  assert n = 0, format('T2 %s filas sin nombre canónico: %s', n, j -> 'por_proveedor');
  assert j -> 'una_compra' is null, 'T2 una_compra con varias compras';

  -- T3
  j := gasto_categorias_agente('marisco');
  assert j ->> 'tipo' is null and j ->> 'periodo' = 'todo el historico', format('T3 marco: %s', j);
  assert (j #>> '{total,importe}')::numeric between 1353 and 1354, format('T3 marisco: %s', j -> 'total');
  assert (j ->> 'incluye_albaranes')::boolean, 'T3 incluye_albaranes';

  -- T4
  j := compras_producto_agente('mayonesa', '2025-10-01', '2025-12-31');
  select x into u from jsonb_array_elements(j -> 'por_unidad') x where x ->> 'unidad' = 'ud';
  assert (u ->> 'cantidad')::numeric = 18, format('T4 mayonesa: %s', j -> 'por_unidad');
  assert j -> 'ultimo_dato' is null, 'T4 ultimo_dato con datos en el periodo';

  -- T5
  j := compras_producto_agente('centollo', '2026-01-01', '2026-12-31');
  assert (j ->> 'sin_datos')::boolean, format('T5 sin_datos: %s', j);
  assert (j #>> '{ultimo_dato,cantidad}')::numeric = 5.7 and j #>> '{ultimo_dato,unidad}' = 'kg'
     and j #>> '{ultimo_dato,fecha}' = '2025-12-29', format('T5 ultimo_dato: %s', j -> 'ultimo_dato');
  assert j #>> '{ultimo_dato,proveedor}' = any(v_canon)
     and j #>> '{ultimo_dato,proveedor}' ilike '%angel%', format('T5 proveedor: %s', j -> 'ultimo_dato');
  -- Con tipo que lo excluye también da la última compra (albarán).
  j := compras_producto_agente('centollo', null, null, 'factura');
  assert j #>> '{ultimo_dato,tipo}' = 'albaran', format('T5 tipo factura: %s', j);

  -- T6
  j := variacion_precios_agente(p_producto => 'merluza');
  assert j ->> 'periodo' = 'todo el historico', 'T6 periodo';
  assert jsonb_array_length(j -> 'sin_comparar') >= 1
     and (j #>> '{sin_comparar,0,una_compra}')::boolean
     and (j #>> '{sin_comparar,0,precio}')::numeric = 11.5, format('T6 sin_comparar: %s', j);
  j := variacion_precios_agente();
  assert j -> 'sin_comparar' is null, 'T6 sin producto no lleva sin_comparar';

  -- T7 conteos sin avisos de importe
  j := consulta_flexible_agente('{"fuente":"documentos","metricas":["count_documentos"],"agrupar":["tipo"]}');
  assert not (j ? 'documentos_sin_total' or j ? 'documentos_deducidos' or j ? 'documentos_sin_iva'),
         format('T7 conteo con avisos: %s', j);
  j := filtrar_documentos_agente('sin_total');
  assert j #> '{sumas,facturas,total}' is null and not (j ? 'documentos_sin_total'), format('T7 filtro de estado: %s', j);
  -- «sin IVA conocido» solo si algún deducido no tiene IVA.
  j := consulta_flexible_agente('{"fuente":"documentos","metricas":["avg_total"],"filtros":{"tipo":"factura"}}');
  assert (j ->> 'criterio' like '%sin IVA conocido%')
         = exists (select 1 from facturas where tipo = 'factura' and total_origen = 'deducido' and total is not null and iva is null),
         format('T7 criterio IVA: %s', j ->> 'criterio');
  -- Nombres canónicos.
  select count(*) into n from jsonb_array_elements(ranking_agente('gasto_proveedor', p_limite => 50)::jsonb -> 'filas') x
   where x ->> 'proveedor' <> all(v_canon);
  assert n = 0, format('T7 ranking: %s sin nombre canónico', n);
  select count(*) into n from jsonb_array_elements(estadisticas_globales_agente()::jsonb -> 'top_proveedores') x
   where x ->> 'proveedor' <> all(v_canon);
  assert n = 0, format('T7 estadisticas: %s sin nombre canónico', n);
  select count(*) into n from jsonb_array_elements(
           consulta_flexible_agente('{"fuente":"documentos","metricas":["sum_total"],"agrupar":["proveedor"],"limite":50}')::jsonb -> 'filas') x
   where x ->> 'proveedor' <> all(v_canon);
  assert n = 0, format('T7 consulta_flexible: %s sin nombre canónico', n);
  select count(*) into n from jsonb_array_elements(gasto_categorias_agente('embutidos', p_agrupar => 'proveedor')::jsonb -> 'cruce') x
   where x ->> 'proveedor' <> all(v_canon);
  assert n = 0, format('T7 cruce por proveedor: %s sin nombre canónico', n);

  -- P
  select count(*) into n
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('compras_producto_agente', 'gasto_categorias_agente', 'variacion_precios_agente',
                       'ranking_agente', 'estadisticas_globales_agente', 'consulta_flexible_agente')
     and not has_function_privilege('anon', p.oid, 'execute')
     and has_function_privilege('authenticated', p.oid, 'execute')
     and p.proconfig @> array['search_path=public']
     and not p.prosecdef;
  assert n = 6, format('P: %s de 6 funciones con permisos/search_path correctos', n);
end;
$$;

select 'chatbot_parametros_por_defecto_test: OK' as resultado;

rollback;
