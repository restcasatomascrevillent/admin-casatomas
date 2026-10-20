set client_encoding = 'UTF8';
-- ===========================================================================
-- Pruebas de 20261008120000_chatbot_ronda8_cocinero.sql
-- SQL plano con ASSERT dentro de BEGIN … ROLLBACK: no deja nada escrito.
-- DESPUÉS de aplicar la migración, POR TERMINAL:
--   npx supabase db query --linked -f supabase/tests/chatbot_ronda8_cocinero_test.sql
-- Si termina sin ERROR e imprime «chatbot_ronda8_cocinero_test: OK», todo ha pasado.
--
-- Casos (datos de producción del 08/10/2026):
--   T1 marisco con tipo null = facturas + albaranes 1.353,85 € (solo
--      facturas: 39,80 €); vinos 13.292 € = 12.513,50 en facturas + 778,50
--      en albaranes sin factura.
--   T2 buscador único: centollo → Centolla 5,7 kg; gambas → Gambón
--      (aproximada); «helado de frambuesa» → la línea «Frambuesa»; surimi →
--      «CG. PUNTAS Y RECORTE KRISSIA»; salmonete → solo subproductos;
--      «espinas de salmonete» sí las da.
--   T3 historial_precios con el mismo buscador y filas idénticas agrupadas.
--   T4 compras_producto: ultima, ultimo_precio, precio_min y precio_max
--      siempre; p_unidad; sin líneas a 0 €.
--   T5 ranking con p_unidad y p_categoria.
--   T6 ficha_proveedor por nombre, alias y nombre comercial.
--   T7 consulta_flexible agrupar iva_pct.
--   T8 serie_precios_agente: contrato con la UI.
--   T9 vínculo albarán → factura (triggers) y que no se cuente dos veces.
--   T10 chat_facturas_mensajes expone adjuntos.
--   P  permisos.
-- ===========================================================================

begin;

do $$
declare
  j    jsonb;
  x    jsonb;
  n    int;
  v_alb bigint;
  v_lin bigint;
  v_nom text;
begin
  -- T1
  j := gasto_categorias_agente('marisco');
  assert (j #>> '{total,importe}')::numeric = 1353.85, format('T1 marisco: %s', j -> 'total');
  assert (j #>> '{total,en_facturas}')::numeric = 39.8
     and (j #>> '{total,en_albaranes_sin_factura}')::numeric = 1314.05, format('T1 reparto marisco: %s', j -> 'total');
  j := gasto_categorias_agente('marisco', null, null, 'factura');
  assert (j #>> '{total,importe}')::numeric = 39.8, format('T1 marisco facturas: %s', j -> 'total');
  j := gasto_categorias_agente('vinos');
  assert (j #>> '{total,importe}')::numeric = 13292 and (j #>> '{total,en_facturas}')::numeric = 12513.5
     and (j #>> '{total,en_albaranes_sin_factura}')::numeric = 778.5, format('T1 vinos: %s', j -> 'total');
  assert not (j ? 'incluye_albaranes'), 'T1 incluye_albaranes ya no se manda';

  -- T2
  j := compras_producto_agente('centollo');
  assert j #>> '{productos_coincidentes,0,nombre}' ilike 'centolla%'
     and (j #>> '{por_unidad,0,cantidad}')::numeric = 5.7, format('T2 centollo: %s', j);
  j := compras_producto_agente('gambas');
  assert j #>> '{productos_coincidentes,0,nombre}' ilike 'gambon%' and j ->> 'coincidencia' = 'aproximada',
         format('T2 gambas: %s', j);
  j := compras_producto_agente('helado de frambuesa');
  assert j #>> '{productos_coincidentes,0,nombre}' = 'Frambuesa' and j ->> 'coincidencia' = 'exacta'
     and (j #>> '{por_unidad,0,cantidad}')::numeric = 5, format('T2 helado de frambuesa: %s', j);
  j := compras_producto_agente('surimi');
  assert j #>> '{productos_coincidentes,0,nombre}' ilike '%krissia%'
     and (j #>> '{por_unidad,0,cantidad}')::numeric = 30, format('T2 surimi: %s', j);
  j := compras_producto_agente('salmonete');
  assert j ->> 'coincidencia' = 'solo_subproductos' and (j ->> 'sin_datos')::boolean
     and j #>> '{subproductos,0}' ilike 'espinas%', format('T2 salmonete: %s', j);
  j := compras_producto_agente('espinas de salmonete');
  assert (j #>> '{total,lineas}')::int = 5, format('T2 espinas pedidas: %s', j);

  -- T3
  j := historial_precios_agente('gambas');
  assert (j ->> 'compras_encontradas')::int = 1 and j ->> 'coincidencia' = 'aproximada', format('T3 gambas: %s', j);
  j := historial_precios_agente('salmonete');
  assert (j ->> 'compras_encontradas')::int = 0 and j #>> '{subproductos,0}' ilike 'espinas%', format('T3 salmonete: %s', j);
  j := historial_precios_agente('espinas de salmonete');
  assert jsonb_array_length(j -> 'compras') = 1 and (j #>> '{compras,0,veces}')::int = 5
     and (j #>> '{compras,0,cantidad}')::numeric = 10, format('T3 filas idénticas agrupadas: %s', j);
  j := historial_precios_agente('jamon');
  assert (j ->> 'comparativa_entre_proveedores')::boolean and j -> 'variacion' = 'null'::jsonb
     and j #>> '{por_proveedor,0,unidad}' is not null, format('T3 jamón: %s', j - 'compras');

  -- T4
  j := compras_producto_agente('jamon');
  for x in select * from jsonb_array_elements(j -> 'por_proveedor') loop
    assert x ? 'ultima' and x ? 'ultimo_precio' and x ? 'precio_min' and x ? 'precio_max'
       and (x ->> 'precio_min')::numeric > 0, format('T4 por_proveedor: %s', x);
  end loop;
  j := compras_producto_agente('jamon', p_unidad => 'kilos');
  assert j ->> 'unidad' = 'kg' and not exists (select 1 from jsonb_array_elements(j -> 'por_proveedor') y
                                              where y ->> 'unidad' <> 'kg'), format('T4 p_unidad: %s', j);
  select count(*) into n
    from productos_factura pf join facturas f on f.id = pf.factura_id
   where coalesce(pf.total, round(pf.cantidad * pf.precio_unitario, 2)) = 0;
  if n > 0 then
    select pf.nombre into v_nom from productos_factura pf
     where coalesce(pf.total, round(pf.cantidad * pf.precio_unitario, 2)) = 0 limit 1;
    j := compras_producto_agente(v_nom);
    assert not exists (select 1 from jsonb_array_elements(j -> 'por_unidad') y where (y ->> 'importe')::numeric = 0),
           format('T4 linea a 0 €: %s', j);
  end if;

  -- T5
  j := ranking_agente('precio_unitario', p_unidad => 'kg', p_limite => 50);
  assert not exists (select 1 from jsonb_array_elements(j -> 'filas') y where y ->> 'unidad' <> 'kg')
     and j ->> 'criterio' like '%solo unidad kg%', format('T5 unidad: %s', j ->> 'criterio');
  j := ranking_agente('cantidad', p_categoria => 'vinos');
  assert j ->> 'criterio' like '%categoria Vinos%' and (j ->> 'total_filas')::int > 0, format('T5 categoria: %s', j);
  assert ranking_agente('cantidad', p_categoria => 'zzz')::jsonb ? 'error', 'T5 categoria inexistente';

  -- T6
  j := ficha_proveedor_agente('luga');
  assert j ->> 'proveedor' = 'Luga Sabores S.L.' and jsonb_array_length(j -> 'top_productos') between 1 and 8
     and j #> '{top_productos,0}' ?& array['producto', 'unidad', 'ultimo_precio', 'ultima_fecha']
     and j ? 'gasto' and j ? 'primera' and j ? 'ultima' and j ? 'docs', format('T6 luga: %s', j);
  assert ficha_proveedor_agente('angelmar')::jsonb ->> 'proveedor' ilike 'herederos%', 'T6 alias';
  assert ficha_proveedor_agente('Joselito')::jsonb ->> 'proveedor' ilike 'carnicas joselito%'
      or ficha_proveedor_agente('Joselito')::jsonb ->> 'proveedor' ilike 'cárnicas joselito%', 'T6 nombre comercial';
  assert (ficha_proveedor_agente('mercadona')::jsonb ->> 'sin_datos')::boolean, 'T6 sin datos';

  -- T7
  j := consulta_flexible_agente('{"fuente":"documentos","metricas":["sum_total"],"agrupar":["iva_pct"]}');
  assert not j ? 'error' and exists (select 1 from jsonb_array_elements(j -> 'filas') y where (y ->> 'iva_pct')::numeric = 21)
     and exists (select 1 from jsonb_array_elements(j -> 'filas') y where (y ->> 'iva_pct')::numeric = 10 and y ? 'cuota_iva'),
         format('T7 iva_pct: %s', j);
  assert abs((select sum((y ->> 'base')::numeric) from jsonb_array_elements(j -> 'filas') y)
             - (select sum(total) from productos_factura)) < 0.05, 'T7 la base suma todas las lineas';

  -- T8
  j := serie_precios_agente('jamon');
  assert j ?& array['producto', 'unidad', 'proveedores', 'puntos', 'n', 'min', 'max', 'ultimo', 'variacion_pct'],
         format('T8 claves: %s', j);
  assert jsonb_array_length(j -> 'puntos') = (j ->> 'n')::int and (j ->> 'n')::int <= 60, 'T8 n';
  assert not exists (select 1 from jsonb_array_elements(j -> 'puntos') pt
                      where jsonb_array_length(pt) <> 3 or (pt ->> 0) !~ '^\d{4}-\d{2}-\d{2}$'
                         or (pt ->> 2)::int not between 0 and jsonb_array_length(j -> 'proveedores') - 1),
         format('T8 puntos: %s', j -> 'puntos');
  assert j -> 'variacion_pct' = 'null'::jsonb, 'T8 sin variacion entre proveedores';
  j := serie_precios_agente('caviar');
  assert j = jsonb_build_object('sin_datos', true, 'buscado', 'caviar'), format('T8 sin datos: %s', j);

  -- T9 vínculo albarán → factura (Luga ML/101511 trae «V/ 775.630»)
  insert into facturas (tipo, proveedor, numero_documento, fecha, total, proveedor_id)
  values ('albaran', 'LUGA SABORES S.L.', '775630', '2025-12-20', 100, 224) returning id into v_alb;
  assert (select facturado_en_id from facturas where id = v_alb) = 54, 'T9 vínculo al dar de alta el albarán';
  assert (ficha_proveedor_agente('luga')::jsonb ->> 'docs')::int = 1, 'T9 el albarán facturado no cuenta en la ficha';
  assert not exists (select 1 from jsonb_array_elements(ranking_agente('importe_documento', p_limite => 50)::jsonb -> 'filas') y
                      where (y ->> 'id')::bigint = v_alb), 'T9 ni en el ranking de documentos';
  update facturas set numero_documento = '999999' where id = v_alb;
  assert (select facturado_en_id from facturas where id = v_alb) is null, 'T9 se desvincula al cambiar el número';
  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, albaran_ref)
  values (54, 'PRUEBA RONDA 8', 1, 'ud', 1, 1, 'V/ 999.999') returning id into v_lin;
  assert (select facturado_en_id from facturas where id = v_alb) = 54, 'T9 vínculo al llegar la línea de la factura';
  delete from productos_factura where id = v_lin;
  assert (select facturado_en_id from facturas where id = v_alb) is null, 'T9 se desvincula al borrar la línea';

  -- T10
  assert exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'chat_facturas_mensajes' and column_name = 'adjuntos'),
         'T10 adjuntos en la vista';

  -- P
  select count(*) into n
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('compras_producto_agente', 'historial_precios_agente', 'variacion_precios_agente', 'ranking_agente',
                       'gasto_categorias_agente', 'consulta_flexible_agente', 'ficha_proveedor_agente', 'serie_precios_agente',
                       'lineas_producto_agente', 'lineas_precio_agente')
     and not has_function_privilege('anon', p.oid, 'execute')
     and has_function_privilege('authenticated', p.oid, 'execute')
     and p.proconfig @> array['search_path=public']
     and not p.prosecdef;
  assert n = 10, format('P: %s de 10 funciones con permisos/search_path correctos', n);
  select count(*) into n
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('vincular_albaranes_proveedor', 'trg_facturas_vincular_albaranes', 'trg_productos_factura_vincular_albaranes')
     and p.prosecdef
     and not has_function_privilege('authenticated', p.oid, 'execute')
     and not has_function_privilege('anon', p.oid, 'execute');
  assert n = 3, format('P: %s de 3 funciones de vínculo cerradas', n);
end;
$$;

select 'chatbot_ronda8_cocinero_test: OK' as resultado;

rollback;
