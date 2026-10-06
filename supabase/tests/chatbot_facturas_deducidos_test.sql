set client_encoding = 'UTF8';
-- ===========================================================================
-- Pruebas de 20261006100000_chatbot_facturas_deducidos.sql
-- SQL plano con ASSERT dentro de BEGIN … ROLLBACK. DESPUÉS de aplicar la
-- migración, POR TERMINAL (no en el SQL Editor):
--   npx supabase db query --linked -f supabase/tests/chatbot_facturas_deducidos_test.sql
-- Si termina sin ERROR e imprime «… todas las comprobaciones han pasado», todo
-- ha pasado. Inserta documentos SIMULADOS en enero de 2031 (un mes sin datos
-- reales) que el ROLLBACK final deshace:
--   T-DED-IVA    factura deducida CON IVA conocido   (base 100, IVA 21, total 121)
--   T-DED-SINIVA factura deducida SIN IVA            (total 200 = base, iva NULL)
--   T-SINTOTAL   factura sin total                   (Garre simulada)
--   T-LEIDA      factura con total leído             (60,50)
--   T-ALB-DED    albarán deducido sin IVA            (80)
-- Lo que depende de datos reales (Luga 54, Garre 39) se comprueba contra la
-- propia tabla, así que vale antes y después de 20261006110000.
-- Fallos de la tercera batería anotados (q01…q22, n1).
-- ===========================================================================

begin;

insert into facturas (tipo, proveedor, numero_documento, fecha, subtotal, iva, total, total_origen, verificada)
values ('factura', 'Prueba Deducidos SL', 'T-DED-IVA',    '2031-01-10', 100,  21,   121,  'deducido', false),
       ('factura', 'Prueba Deducidos SL', 'T-DED-SINIVA', '2031-01-12', null, null, 200,  'deducido', false),
       ('factura', 'Salazones Prueba',    'T-SINTOTAL',   '2031-01-15', null, null, null, null,       false),
       ('factura', 'Leida Prueba SL',     'T-LEIDA',      '2031-01-20', 50,   10.5, 60.5, 'leido',    true),
       ('albaran', 'Prueba Deducidos SL', 'T-ALB-DED',    '2031-01-21', null, null, 80,   'deducido', false);

do $$
declare
  j    jsonb;
  f    jsonb;
  x    jsonb;
  n    int;
  i_ai bigint := (select id from facturas where numero_documento = 'T-DED-IVA');
  i_as bigint := (select id from facturas where numero_documento = 'T-DED-SINIVA');
  i_st bigint := (select id from facturas where numero_documento = 'T-SINTOTAL');
  i_le bigint := (select id from facturas where numero_documento = 'T-LEIDA');
  i_al bigint := (select id from facturas where numero_documento = 'T-ALB-DED');
begin
  -- -------------------------------------------------------------------------
  -- F1 (q20, q01, q02, q03, q16). Totales deducidos: marcados en cada fila y
  --     en bloques compactos del tipo consultado, con iva_conocido.
  -- -------------------------------------------------------------------------
  -- Filas de documento (documento_compacto_agente).
  j := filtrar_documentos_agente('todos', 'T-DED', 'factura')::jsonb;
  select x2 into f from jsonb_array_elements(j -> 'filas') x2 where (x2 ->> 'id')::bigint = i_ai;
  assert f ->> 'total_origen' = 'deducido' and (f ->> 'iva_conocido')::boolean, format('F1 fila con IVA: %s', f);
  select x2 into f from jsonb_array_elements(j -> 'filas') x2 where (x2 ->> 'id')::bigint = i_as;
  assert f ->> 'total_origen' = 'deducido' and not (f ->> 'iva_conocido')::boolean, format('F1 fila sin IVA: %s', f);
  assert (j -> 'sumas' -> 'facturas' ->> 'deducidos')::int = 2 and (j -> 'sumas' -> 'facturas' ->> 'total')::numeric = 321,
    format('F1 sumas: %s', j -> 'sumas');
  j := filtrar_documentos_agente('todos', 'T-LEIDA')::jsonb;
  assert not (j -> 'filas' -> 0) ? 'total_origen' and not (j -> 'filas' -> 0) ? 'iva_conocido', format('F1 leida: %s', j -> 'filas');

  -- detalle_documento (q20): nota según el origen del total.
  j := detalle_documento_agente(i_as)::jsonb;
  assert j -> 'documento' ->> 'total_origen' = 'deducido' and not (j -> 'documento' ->> 'iva_conocido')::boolean, format('F1 detalle: %s', j -> 'documento');
  assert j ->> 'nota' ilike '%base SIN IVA%' and j ->> 'nota' ilike '%real sera mayor%' and j ->> 'nota' not ilike '%con IVA%'
     and j ->> 'nota' ilike '%Nunca digas IVA incluido%', format('F1 nota sin IVA: %s', j ->> 'nota');
  j := detalle_documento_agente(i_ai)::jsonb;
  assert j ->> 'nota' ilike 'Total deducido%' and j ->> 'nota' ilike '%mas su IVA%', format('F1 nota con IVA: %s', j ->> 'nota');
  j := detalle_documento_agente(i_le)::jsonb;
  assert j ->> 'nota' = 'precio, importe y suma_lineas son de linea, SIN IVA; total del documento con IVA', format('F1 nota leida: %s', j ->> 'nota');

  -- resumen_periodo (q16/q15): avisos de importe en si_das_importes, por tipo.
  j := resumen_periodo_agente('2031-01-01', '2031-01-31')::jsonb;
  f := j -> 'facturas';
  assert (f ->> 'n')::int = 4 and (f ->> 'gasto')::numeric = 381.5, format('F1 resumen facturas: %s', f);
  assert not f ? 'sin_total' and not f ? 'deducidos', format('F1 avisos sueltos junto al conteo: %s', f);
  assert (f -> 'si_das_importes' -> 'deducidos' ->> 'n')::int = 2, format('F1 deducidos: %s', f);
  assert exists (select 1 from jsonb_array_elements(f -> 'si_das_importes' -> 'deducidos' -> 'docs') d
                  where (d ->> 'id')::bigint = i_ai and (d ->> 'iva_conocido')::boolean)
     and exists (select 1 from jsonb_array_elements(f -> 'si_das_importes' -> 'deducidos' -> 'docs') d
                  where (d ->> 'id')::bigint = i_as and not (d ->> 'iva_conocido')::boolean and d ->> 'numero' = 'T-DED-SINIVA'),
    format('F1 docs deducidos: %s', f -> 'si_das_importes' -> 'deducidos');
  assert (f -> 'si_das_importes' -> 'sin_total' ->> 'n')::int = 1, format('F1 sin_total: %s', f);
  assert (j -> 'albaranes' -> 'si_das_importes' -> 'deducidos' ->> 'n')::int = 1
     and not (j -> 'albaranes' -> 'si_das_importes') ? 'sin_iva'
     and not exists (select 1 from jsonb_array_elements(f -> 'si_das_importes' -> 'deducidos' -> 'docs') d where (d ->> 'id')::bigint = i_al),
    format('F1 albaranes por su lado: %s', j -> 'albaranes');
  select x2 into x from jsonb_array_elements(j -> 'proveedores') x2 where x2 ->> 'proveedor' = 'Prueba Deducidos SL';
  assert (x ->> 'deducidos')::int = 2, format('F1 proveedor: %s', x);
  -- Un mes sin deducidos: no aparece la clave.
  j := resumen_periodo_agente('2031-02-01', '2031-02-28')::jsonb;
  assert not coalesce(j -> 'facturas', '{}'::jsonb) ? 'si_das_importes', format('F1 mes vacio: %s', j -> 'facturas');

  -- estadisticas_globales (q01, q02): todos los deducidos de la tabla, con su iva_conocido.
  j := estadisticas_globales_agente()::jsonb;
  select count(*) into n from facturas where tipo = 'factura' and total_origen = 'deducido' and total is not null;
  assert (j -> 'facturas' -> 'si_das_importes' -> 'deducidos' ->> 'n')::int = n, format('F1 estadisticas n: %s', j -> 'facturas');
  assert not exists (select 1 from jsonb_array_elements(j -> 'facturas' -> 'si_das_importes' -> 'deducidos' -> 'docs') d
                       join facturas fa on fa.id = (d ->> 'id')::bigint
                      where (d ->> 'iva_conocido')::boolean is distinct from (fa.iva is not null)),
    'F1 estadisticas: iva_conocido no casa con facturas.iva';
  -- La Luga real (54), si sigue deducida, sale con su iva_conocido.
  if exists (select 1 from facturas where id = 54 and total_origen = 'deducido') then
    assert exists (select 1 from jsonb_array_elements(j -> 'facturas' -> 'si_das_importes' -> 'deducidos' -> 'docs') d
                    where (d ->> 'id')::int = 54
                      and (d ->> 'iva_conocido')::boolean = (select iva is not null from facturas where id = 54)),
      'F1: Luga 54 no sale como deducida';
  end if;
  select x2 into x from jsonb_array_elements(j -> 'meses') x2 where x2 ->> 'mes' = '2031-01';
  assert (x ->> 'deducidos')::int = 2 and (x ->> 'sin_total')::int = 1, format('F1 meses: %s', x);

  -- ranking (q03): por fila y en bloque, y criterio que no promete IVA.
  j := ranking_agente('gasto_proveedor', 'factura', 10, '2031-01-01', '2031-01-31')::jsonb;
  select x2 into x from jsonb_array_elements(j -> 'filas') x2 where x2 ->> 'proveedor' = 'Prueba Deducidos SL';
  assert (x ->> 'deducidos')::int = 2 and (x ->> 'importe')::numeric = 321, format('F1 ranking fila: %s', x);
  assert (j -> 'documentos_deducidos' ->> 'n')::int = 2 and (j -> 'documentos_sin_total' ->> 'n')::int = 1, format('F1 ranking: %s', j);
  assert j ->> 'criterio' ilike '%iva_conocido=false%', format('F1 criterio: %s', j ->> 'criterio');
  j := ranking_agente('importe_documento', 'factura', 10, '2031-01-01', '2031-01-31')::jsonb;
  assert (j -> 'documentos_deducidos' ->> 'n')::int = 2
     and exists (select 1 from jsonb_array_elements(j -> 'filas') x2 where x2 ->> 'total_origen' = 'deducido'), format('F1 importe_documento: %s', j);
  -- Rankings de líneas: sin bloques de documento.
  j := ranking_agente('precio_unitario', null, 3)::jsonb;
  assert not j ? 'documentos_deducidos', 'F1 ranking de lineas con deducidos';

  -- -------------------------------------------------------------------------
  -- F2 (n1). Proveedor x mes: la fila sin total y la deducida lo dicen, y
  --     los bloques están en el nivel superior.
  -- -------------------------------------------------------------------------
  j := consulta_flexible_agente('{"metricas": ["sum_total"], "agrupar": ["proveedor", "mes"],
                                  "filtros": {"tipo": "factura", "desde": "2031-01-01", "hasta": "2031-01-31"}, "limite": 50}')::jsonb;
  assert j ->> 'error' is null and (j ->> 'total_filas')::int = 3, format('F2: %s', j);
  select x2 into x from jsonb_array_elements(j -> 'filas') x2 where x2 ->> 'proveedor' = 'Salazones Prueba';
  assert (x ->> 'sin_total')::int = 1 and jsonb_typeof(x -> 'sum_total') = 'null', format('F2 fila sin total: %s', x);
  select x2 into x from jsonb_array_elements(j -> 'filas') x2 where x2 ->> 'proveedor' = 'Prueba Deducidos SL';
  assert (x ->> 'deducidos')::int = 2 and (x ->> 'sum_total')::numeric = 321 and not x ? 'sin_total', format('F2 fila deducida: %s', x);
  select x2 into x from jsonb_array_elements(j -> 'filas') x2 where x2 ->> 'proveedor' = 'Leida Prueba SL';
  assert not x ? 'sin_total' and not x ? 'deducidos', format('F2 fila limpia: %s', x);
  assert (j -> 'documentos_sin_total' ->> 'n')::int = 1 and j -> 'documentos_sin_total' -> 'docs' -> 0 ->> 'numero' = 'T-SINTOTAL',
    format('F2 sin_total: %s', j -> 'documentos_sin_total');
  assert (j -> 'documentos_deducidos' ->> 'n')::int = 2
     and exists (select 1 from jsonb_array_elements(j -> 'documentos_deducidos' -> 'docs') d
                  where (d ->> 'id')::bigint = i_as and not (d ->> 'iva_conocido')::boolean),
    format('F2 deducidos: %s', j -> 'documentos_deducidos');
  assert j ->> 'criterio' ilike '%salvo documentos_deducidos%', format('F2 criterio: %s', j ->> 'criterio');
  -- Media: sigue con n_con_total y suma los avisos.
  j := consulta_flexible_agente('{"metricas": ["avg_total"], "agrupar": ["tipo"], "filtros": {"desde": "2031-01-01", "hasta": "2031-01-31"}}')::jsonb;
  select x2 into x from jsonb_array_elements(j -> 'filas') x2 where x2 ->> 'tipo' = 'factura';
  assert (x ->> 'n_con_total')::int = 3 and (x ->> 'avg_total')::numeric = 127.17 and (x ->> 'deducidos')::int = 2 and (x ->> 'sin_total')::int = 1,
    format('F2 media: %s', x);

  -- -------------------------------------------------------------------------
  -- F3 (q04, q12, q13). Conteos: solo números, sin importes ni avisos.
  -- -------------------------------------------------------------------------
  j := consulta_flexible_agente('{"metricas": ["count_documentos", "count_con_total"], "agrupar": ["tipo"]}')::jsonb;
  assert not (j ? 'documentos_sin_total' or j ? 'documentos_deducidos' or j ? 'documentos_sin_iva'), format('F3 flexible: %s', j);
  assert not exists (select 1 from jsonb_array_elements(j -> 'filas') x2 where x2 ? 'sin_total' or x2 ? 'deducidos'), format('F3 filas: %s', j -> 'filas');
  j := filtrar_documentos_agente('sin_verificar', null, 'factura', '2031-01-01', '2031-01-31')::jsonb;
  assert (j ->> 'total_filas')::int = 3 and j -> 'sumas' = '{"facturas": {"n": 3}}'::jsonb, format('F3 sin_verificar: %s', j -> 'sumas');
  assert j ->> 'criterio' ilike '%solo conteo%', format('F3 criterio: %s', j ->> 'criterio');
  j := filtrar_documentos_agente('sin_verificar', null, 'factura', '2031-01-01', '2031-01-31', 'fecha_desc', 1)::jsonb;
  assert (j ->> 'truncado')::boolean and not (j ? 'documentos_sin_total' or j ? 'documentos_deducidos'), format('F3 truncado: %s', j);
  j := filtrar_documentos_agente('con_alertas')::jsonb;
  assert not exists (select 1 from jsonb_each(j -> 'sumas') s where s.value ? 'total' or s.value ? 'valor' or s.value ? 'sin_total'),
    format('F3 con_alertas: %s', j -> 'sumas');
  j := filtrar_documentos_agente('sin_total', null, null, '2031-01-01', '2031-01-31')::jsonb;
  assert j ->> 'nota' ilike '%NO significa sin factura%' and j -> 'sumas' = '{"facturas": {"n": 1}}'::jsonb, format('F3 sin_total: %s', j);
  -- «todos» sigue sumando y, con filas fuera de la vista, cita los bloques.
  j := filtrar_documentos_agente('todos', null, 'factura', '2031-01-01', '2031-01-31', 'fecha_desc', 1)::jsonb;
  assert (j -> 'sumas' -> 'facturas' ->> 'total')::numeric = 381.5 and (j -> 'documentos_deducidos' ->> 'n')::int = 2
     and (j -> 'documentos_sin_total' ->> 'n')::int = 1 and j ->> 'criterio' not ilike '%solo conteo%', format('F3 todos: %s', j);
  j := filtrar_documentos_agente('todos', null, 'factura', '2031-01-01', '2031-01-31', 'fecha_desc', 10)::jsonb;
  assert not (j ? 'documentos_deducidos' or j ? 'documentos_sin_total'), format('F3 todos a la vista: %s', j);

  -- -------------------------------------------------------------------------
  -- F4 (q22). IVA: además de los sin total, los que tienen total pero no IVA.
  -- -------------------------------------------------------------------------
  j := consulta_flexible_agente('{"metricas": ["sum_iva"], "filtros": {"tipo": "factura", "desde": "2031-01-01", "hasta": "2031-01-31"}}')::jsonb;
  assert (j -> 'filas' -> 0 ->> 'sum_iva')::numeric = 31.5, format('F4 suma: %s', j -> 'filas');
  assert (j -> 'documentos_sin_iva' ->> 'n')::int = 1 and (j -> 'documentos_sin_iva' -> 'docs' -> 0 ->> 'id')::bigint = i_as,
    format('F4 sin_iva: %s', j -> 'documentos_sin_iva');
  assert (j -> 'documentos_sin_total' ->> 'n')::int = 1, format('F4 sin_total: %s', j);
  j := consulta_flexible_agente('{"metricas": ["sum_total"], "filtros": {"tipo": "factura", "desde": "2031-01-01", "hasta": "2031-01-31"}}')::jsonb;
  assert not j ? 'documentos_sin_iva', 'F4: sin_iva sin pedir IVA';
  j := resumen_periodo_agente('2031-01-01', '2031-01-31')::jsonb;
  assert (j -> 'facturas' ->> 'iva')::numeric = 31.5
     and (j -> 'facturas' -> 'si_das_importes' -> 'sin_iva' ->> 'n')::int = 1
     and (j -> 'facturas' -> 'si_das_importes' -> 'sin_iva' -> 'docs' -> 0 ->> 'numero') = 'T-DED-SINIVA',
    format('F4 resumen: %s', j -> 'facturas');
  j := estadisticas_globales_agente()::jsonb;
  select count(*) into n from facturas where tipo = 'factura' and iva is null and total is not null;
  assert coalesce((j -> 'facturas' -> 'si_das_importes' -> 'sin_iva' ->> 'n')::int, 0) = n, format('F4 estadisticas: %s', j -> 'facturas');

  -- -------------------------------------------------------------------------
  -- F5 (q21). Sin total: no consta si las líneas llevan IVA.
  -- -------------------------------------------------------------------------
  j := detalle_documento_agente(i_st)::jsonb;
  assert (j -> 'documento' ->> 'sin_total')::boolean and j ->> 'nota' ilike '%no consta si las lineas llevan IVA%'
     and j ->> 'nota' not ilike '%son de linea, SIN IVA%', format('F5: %s', j ->> 'nota');
  if exists (select 1 from facturas where id = 39 and total is null) then
    assert detalle_documento_agente(39)::jsonb ->> 'nota' ilike '%no consta%', 'F5: Garre 39';
  end if;

  -- -------------------------------------------------------------------------
  -- F6. Lo de antes sigue: «sin factura», seguridad de la flexible, ayudantes.
  -- -------------------------------------------------------------------------
  assert filtrar_documentos_agente('albaranes_sin_factura')::jsonb ->> 'error' ilike '%no hay ninguna relacion%', 'F6 sin factura';
  assert consulta_flexible_agente('{"agrupar": ["proveedor; drop table facturas"]}')::jsonb ? 'error', 'F6 inyeccion';
  assert consulta_flexible_agente('{"metricas": ["sum_total; select 1"]}')::jsonb ? 'error', 'F6 metrica inyectada';
  assert docs_deducidos_agente('factura', '2031-02-01', '2031-02-28') is null
     and docs_sin_iva_agente('factura', '2031-02-01', '2031-02-28') is null, 'F6 ayudantes vacios';
  assert (docs_deducidos_agente(null, '2031-01-01', '2031-01-31') ->> 'n')::int = 3
     and docs_deducidos_agente(null, '2031-01-01', '2031-01-31') -> 'docs' -> 0 ? 'tipo'
     and not docs_deducidos_agente('factura', '2031-01-01', '2031-01-31') -> 'docs' -> 0 ? 'tipo', 'F6 tipo solo si se mezclan';

  -- -------------------------------------------------------------------------
  -- F7. Permisos y configuración de las 9 funciones tocadas o nuevas.
  -- -------------------------------------------------------------------------
  select count(*) into n
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public'
     and p.proname in ('docs_deducidos_agente', 'docs_sin_iva_agente', 'documento_compacto_agente',
                       'estadisticas_globales_agente', 'resumen_periodo_agente', 'filtrar_documentos_agente',
                       'ranking_agente', 'consulta_flexible_agente', 'detalle_documento_agente')
     and not has_function_privilege('anon', p.oid, 'execute')
     and has_function_privilege('authenticated', p.oid, 'execute')
     and has_function_privilege('service_role', p.oid, 'execute')
     and not p.prosecdef
     and p.proconfig @> array['search_path=public'];
  assert n = 9, format('F7: %s de 9 funciones con permisos/search_path correctos', n);
end;
$$;

select 'chatbot_facturas_deducidos: todas las comprobaciones han pasado' as resultado;

rollback;
