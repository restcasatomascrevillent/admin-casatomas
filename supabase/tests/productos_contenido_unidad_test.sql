set client_encoding = 'UTF8';
-- ===========================================================================
-- Pruebas de 20261008140000_productos_contenido_unidad.sql
-- SQL plano con ASSERT dentro de BEGIN … ROLLBACK: no deja nada escrito.
-- DESPUÉS de aplicar la migración, POR TERMINAL:
--   npx supabase db query --linked -f supabase/tests/productos_contenido_unidad_test.sql
-- Si termina sin ERROR e imprime «productos_contenido_unidad_test: OK», todo ha pasado.
--
-- Casos:
--   T1 extraer_contenido: caja 10 kg, C/2K, cubo 5 L, 5KG, 2 L, 750 ml, 500 g,
--      24x33cl, 45U, C/45U, 70 CL.; ambiguos (rangos, cifras distintas, 1.000 g)
--      y textos sin contenido = nada.
--   T2 trigger: rellena al insertar, no pisa 'manual', recalcula al borrar lo manual.
--   T3 compras_producto: precio_comparable en €/kg con «convertido_desde»; sin él
--      si alguna línea no se puede convertir; contenido del catálogo si la línea
--      no trae el suyo.
--   T4 historial, serie, variación y ranking (p_unidad kg) con la conversión;
--      lineas_precio_agente sin p_base = lo de siempre.
--   T5 RPC productos_contenido_guardar (la usa la ficha de producto): permiso, validación y borrado.
--   P  permisos y marca de las funciones.
-- ===========================================================================

begin;

do $$
declare
  j     jsonb;
  v_fa  bigint;
  v_fb  bigint;
  v_fc  bigint;
  v_la  bigint;
  v_lb  bigint;
  v_lc  bigint;
  v_ld  bigint;
  v_cat bigint;
  v_c   numeric;
  v_u   text;
  v_o   text;
  n     int;
begin
  -- ── T1 ──
  assert (select cantidad from extraer_contenido('caja 10 kg')) = 10 and (select unidad from extraer_contenido('caja 10 kg')) = 'kg', 'T1 caja 10 kg';
  assert (select cantidad from extraer_contenido('C/2K')) = 2 and (select unidad from extraer_contenido('C/2K')) = 'kg', 'T1 C/2K';
  assert (select cantidad from extraer_contenido('MAYONESA ORIGINAL (CUBO 5L) -Hellmanns-')) = 5
     and (select unidad from extraer_contenido('cubo 5 L')) = 'l', 'T1 cubo 5 L';
  assert (select cantidad from extraer_contenido('5KG')) = 5 and (select unidad from extraer_contenido('5KG')) = 'kg', 'T1 5KG';
  assert (select cantidad from extraer_contenido('2 L')) = 2 and (select unidad from extraer_contenido('2 L')) = 'l', 'T1 2 L';
  assert (select cantidad from extraer_contenido('750 ml')) = 0.75 and (select unidad from extraer_contenido('750 ml')) = 'l', 'T1 750 ml';
  assert (select cantidad from extraer_contenido('500 g')) = 0.5 and (select unidad from extraer_contenido('500 g')) = 'kg', 'T1 500 g';
  assert (select cantidad from extraer_contenido('24x33cl')) = 7.92 and (select unidad from extraer_contenido('24x33cl')) = 'l', 'T1 24x33cl';
  assert (select cantidad from extraer_contenido('45U')) = 45 and (select unidad from extraer_contenido('45U')) = 'ud', 'T1 45U';
  assert (select cantidad from extraer_contenido('CRUJIENTE (C/45U) Didess')) = 45
     and (select unidad from extraer_contenido('CRUJIENTE (C/45U) Didess')) = 'ud', 'T1 C/45U';
  assert (select cantidad from extraer_contenido('BEEFEATER 70 CL.')) = 0.7, 'T1 70 CL.';
  assert (select cantidad from extraer_contenido('GAMBON ZARADO XXL (C/2K- 45U aprox) -Gegarri-')) = 2, 'T1 el marcador C/ gana a 45U';
  assert (select cantidad from extraer_contenido('PICOS (C/ 25 U) (Individual 20g)')) = 25, 'T1 C/ 25 U gana a 20g';
  assert not exists (select 1 from extraer_contenido('Jamón Bellota 100% Ibérico 5,0-10 kg N24')), 'T1 rango 5-10 kg = nada';
  assert not exists (select 1 from extraer_contenido('Buey de mar gallego hembra 1-1.5 kg')), 'T1 rango 1-1.5 kg = nada';
  assert not exists (select 1 from extraer_contenido('1.000 g')), 'T1 1.000 g = nada';
  assert not exists (select 1 from extraer_contenido('ENVASE 2 kg Y 3 L')), 'T1 cifras distintas = nada';
  assert not exists (select 1 from extraer_contenido('INTE/DIF 6KA 30MA 1P+N 10A OPW1N10C030A')), 'T1 6KA no es 6 kg';
  assert not exists (select 1 from extraer_contenido('FUENTE OVAL STOLT Ø 26,5x13 CM (12) VITROPORCELANA')), 'T1 medidas en cm = nada';
  assert not exists (select 1 from extraer_contenido('NATOP 35mg')), 'T1 35mg no es 35 g';
  assert not exists (select 1 from extraer_contenido(null)) and not exists (select 1 from extraer_contenido('')), 'T1 vacío';

  -- ── Datos de prueba: caja de 10 kg (A), kilo (B) y una línea sin contenido (C) ──
  insert into productos_catalogo (nombre) values ('ZZPRUEBAX aceite') returning id into v_cat;
  insert into facturas (tipo, proveedor, numero_documento, fecha, total)
  values ('factura', 'ZZPRUEBA PROVEEDOR A', 'ZZ-A-1', '2026-01-10', 100) returning id into v_fa;
  insert into facturas (tipo, proveedor, numero_documento, fecha, total)
  values ('factura', 'ZZPRUEBA PROVEEDOR B', 'ZZ-B-1', '2026-01-12', 24) returning id into v_fb;
  insert into facturas (tipo, proveedor, numero_documento, fecha, total)
  values ('factura', 'ZZPRUEBA PROVEEDOR C', 'ZZ-C-1', '2026-01-14', 10) returning id into v_fc;
  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total)
  values (v_fa, 'ZZPRUEBAX ACEITE (CAJA 10 KG)', 2, 'caja', 50, 100) returning id into v_la;
  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total)
  values (v_fb, 'ZZPRUEBAX ACEITE', 4, 'kg', 6, 24) returning id into v_lb;
  update productos_factura set producto_id = v_cat where id in (v_la, v_lb);

  -- ── T2 trigger ──
  select contenido_cantidad, contenido_unidad, contenido_origen into v_c, v_u, v_o from productos_factura where id = v_la;
  assert v_c = 10 and v_u = 'kg' and v_o = 'texto', format('T2 alta: %s %s %s', v_c, v_u, v_o);
  select contenido_cantidad, contenido_unidad, contenido_origen into v_c, v_u, v_o from productos_factura where id = v_lb;
  assert v_c is null and v_u is null and v_o is null, 'T2 sin contenido: todo null';
  update productos_factura set contenido_cantidad = 12, contenido_unidad = 'kg' where id = v_la;
  select contenido_cantidad, contenido_origen into v_c, v_o from productos_factura where id = v_la;
  assert v_c = 12 and v_o = 'manual', format('T2 lo escrito a mano pasa a manual: %s %s', v_c, v_o);
  update productos_factura set nombre = 'ZZPRUEBAX ACEITE (CAJA 10 KG) bis' where id = v_la;
  select contenido_cantidad, contenido_origen into v_c, v_o from productos_factura where id = v_la;
  assert v_c = 12 and v_o = 'manual', 'T2 manual no se pisa al cambiar el nombre';
  update productos_factura set contenido_cantidad = null, contenido_unidad = null, contenido_origen = null where id = v_la;
  select contenido_cantidad, contenido_origen into v_c, v_o from productos_factura where id = v_la;
  assert v_c = 10 and v_o = 'texto', 'T2 al borrar lo manual se vuelve a leer el texto';
  begin
    update productos_factura set contenido_cantidad = 5, contenido_unidad = null where id = v_la;   -- sin unidad
    assert false, 'T2 contenido sin unidad debe fallar';
  exception when check_violation then
    null;
  end;
  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, contenido_cantidad, contenido_unidad)
  values (v_fc, 'ZZPRUEBAX ACEITE a granel', 1, 'ud', 10, 10, 8, 'kg') returning id into v_lc;
  select contenido_origen into v_o from productos_factura where id = v_lc;
  assert v_o = 'manual', 'T2 alta con contenido explícito = manual';
  update productos_factura set contenido_cantidad = null, contenido_unidad = null, contenido_origen = null where id = v_lc;
  select contenido_cantidad into v_c from productos_factura where id = v_lc;
  assert v_c is null, 'T2 sin texto ni manual: null';

  -- ── T3 compras_producto: precio comparable ──
  j := compras_producto_agente('zzpruebax aceite');
  assert not (j ? 'precio_comparable'), format('T3 C sin contenido: no hay precio comparable: %s', j -> 'precio_comparable');
  assert jsonb_array_length(j -> 'por_proveedor') = 3, 'T3 sigue el desglose de siempre (proveedor y unidad)';
  -- Contenido por defecto del catálogo: la línea C no trae el suyo.
  update productos_factura set producto_id = v_cat where id = v_lc;
  update productos_catalogo set contenido_cantidad = 8, contenido_unidad = 'kg' where id = v_cat;
  j := compras_producto_agente('zzpruebax aceite');
  assert j #>> '{precio_comparable,unidad_base}' = 'kg', format('T3 comparable en kg: %s', j -> 'precio_comparable');
  assert jsonb_array_length(j #> '{precio_comparable,por_proveedor}') = 3, 'T3 tres proveedores';
  assert j #>> '{precio_comparable,por_proveedor,0,proveedor}' ilike '%proveedor c%'
     and (j #>> '{precio_comparable,por_proveedor,0,precio_medio}')::numeric = 1.25
     and j #>> '{precio_comparable,por_proveedor,0,convertido_desde}' = 'envase de 8 kg',
     format('T3 C 10 € / 8 kg = 1,25 €/kg del catálogo: %s', j #> '{precio_comparable,por_proveedor,0}');
  assert j #>> '{precio_comparable,por_proveedor,1,proveedor}' ilike '%proveedor a%'
     and (j #>> '{precio_comparable,por_proveedor,1,precio_medio}')::numeric = 5
     and j #>> '{precio_comparable,por_proveedor,1,convertido_desde}' = 'caja de 10 kg',
     format('T3 A 50 € / 10 kg = 5 €/kg: %s', j #> '{precio_comparable,por_proveedor,1}');
  assert j #>> '{precio_comparable,por_proveedor,2,proveedor}' ilike '%proveedor b%'
     and (j #>> '{precio_comparable,por_proveedor,2,precio_medio}')::numeric = 6
     and not (j #> '{precio_comparable,por_proveedor,2}' ? 'convertido_desde'),
     format('T3 B ya está en kg: %s', j #> '{precio_comparable,por_proveedor,2}');
  -- Lo de la línea gana al catálogo.
  update productos_factura set contenido_cantidad = 4, contenido_unidad = 'kg' where id = v_lc;
  j := compras_producto_agente('zzpruebax aceite');
  assert (j #>> '{precio_comparable,por_proveedor,0,precio_medio}')::numeric = 2.5, 'T3 la línea gana al catálogo (10/4 = 2,5)';
  update productos_factura set contenido_cantidad = null, contenido_unidad = null, contenido_origen = null where id = v_lc;
  -- p_unidad = caja: solo la caja, que sigue siendo convertible.
  j := compras_producto_agente('zzpruebax aceite', p_unidad => 'caja');
  assert j #>> '{precio_comparable,por_proveedor,0,convertido_desde}' = 'caja de 10 kg', 'T3 solo cajas';
  -- Otra unidad base (litros) en el mismo producto: ya no es comparable.
  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, producto_id, contenido_cantidad, contenido_unidad)
  values (v_fc, 'ZZPRUEBAX ACEITE botella', 1, 'ud', 4, 4, v_cat, 1, 'l') returning id into v_ld;
  j := compras_producto_agente('zzpruebax aceite');
  assert not (j ? 'precio_comparable'), 'T3 kg y l mezclados: no hay precio comparable';
  delete from productos_factura where id = v_ld;

  -- ── T4 historial, serie, variación y ranking ──
  j := historial_precios_agente('zzpruebax aceite');
  assert j ->> 'convertido_a' = 'kg', format('T4 historial convertido a kg: %s', j -> 'convertido_a');
  assert not coalesce((j ->> 'unidades_mezcladas')::boolean, false), 'T4 historial: ya una sola unidad';
  assert exists (select 1 from jsonb_array_elements(j -> 'compras') c
                  where c ->> 'unidad' = 'kg' and (c ->> 'precio_unitario')::numeric = 5 and c ->> 'convertido_desde' = 'caja de 10 kg'),
         format('T4 historial: la caja a 5 €/kg: %s', j -> 'compras');
  j := serie_precios_agente('zzpruebax aceite');
  assert j ->> 'unidad' = 'kg' and j ->> 'convertido_desde' like '%caja de 10 kg%'
     and j ? 'puntos' and j ? 'proveedores' and j ? 'variacion_pct', format('T4 serie: %s', j);
  assert (select count(*) from jsonb_array_elements(j -> 'puntos')) = 3, 'T4 serie: tres puntos (A, B y C con el contenido del catálogo)';
  j := serie_precios_agente('zzpruebax aceite', null, null, 'caja');
  assert j ->> 'unidad' = 'caja' and not (j ? 'convertido_desde'), format('T4 serie con p_unidad caja = sin convertir: %s', j);
  -- lineas_precio_agente: sin p_base lo de siempre; con p_base, en kg.
  assert (select count(*) from lineas_precio_agente(v_cat) where unidad = 'caja') = 1
     and (select bool_or(convertida) from lineas_precio_agente(v_cat)) is not true, 'T4 sin p_base no cambia nada';
  assert (select count(*) from lineas_precio_agente(v_cat, null, true) where unidad = 'kg') = 3
     and (select precio from lineas_precio_agente(v_cat, null, true) where factura_id = v_fa) = 5
     and (select convertido_desde from lineas_precio_agente(v_cat, null, true) where factura_id = v_fa) = 'caja de 10 kg', 'T4 con p_base en kg';
  -- Variación: el producto en kg (A 5 → B 6 = +20 %).
  insert into facturas (tipo, proveedor, numero_documento, fecha, total)
  values ('factura', 'ZZPRUEBA PROVEEDOR B', 'ZZ-B-2', '2026-01-20', 28) returning id into v_fb;
  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, producto_id)
  values (v_fb, 'ZZPRUEBAX ACEITE', 4, 'kg', 7, 28, v_cat);
  j := variacion_precios_agente(null, null, 10, null, 'zzpruebax aceite');
  assert j #>> '{productos,0,unidad}' = 'kg' and (j #>> '{productos,0,precio}')::numeric = 7
     and j #>> '{productos,0,convertido_desde}' like '%caja de 10 kg%', format('T4 variación en kg: %s', j -> 'productos');
  -- Ranking de precio unitario por kilo: la caja entra convertida; sin p_unidad no se toca.
  j := ranking_agente('precio_unitario', null, 50, null, null, 'desc', false, 'kg', null);
  if (j ->> 'total_filas')::int <= 50 then
    assert exists (select 1 from jsonb_array_elements(j -> 'filas') f
                    where f ->> 'producto' ilike 'ZZPRUEBAX ACEITE (CAJA%' and (f ->> 'precio_unitario')::numeric = 5
                      and f ->> 'unidad' = 'kg' and f ->> 'convertido_desde' = 'caja de 10 kg'),
           format('T4 ranking kg: la caja a 5 €/kg: %s', j -> 'criterio');
  end if;
  j := ranking_agente('precio_unitario', null, 50, null, null, 'desc', false, null, null);
  assert not exists (select 1 from jsonb_array_elements(j -> 'filas') f where f ? 'convertido_desde'), 'T4 ranking sin p_unidad: sin conversión';

  -- ── T5 RPC de la ficha de producto (contenido por defecto del catálogo) ──
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  begin
    perform productos_contenido_guardar(v_cat, 5, 'kg');
    assert false, 'T5 sin permiso de edición debe fallar';
  exception when insufficient_privilege then
    null;
  end;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  -- La auditoría exige un responsable: cualquier usuario existente hace de actor.
  perform set_config('request.headers', jsonb_build_object('x-audit-actor-id', (select id from auth.users order by created_at limit 1))::text, true);
  j := productos_contenido_guardar(v_cat, 7.5, 'KG');
  assert (j ->> 'contenido_cantidad')::numeric = 7.5 and j ->> 'contenido_unidad' = 'kg', format('T5 guardar: %s', j);
  assert (select contenido_cantidad from productos_catalogo where id = v_cat) = 7.5, 'T5 queda en el catálogo';
  begin
    perform productos_contenido_guardar(v_cat, 5, 'cajas');
    assert false, 'T5 unidad no válida debe fallar';
  exception when invalid_parameter_value then
    null;
  end;
  begin
    perform productos_contenido_guardar(v_cat, 0, 'kg');
    assert false, 'T5 contenido 0 debe fallar';
  exception when invalid_parameter_value then
    null;
  end;
  j := productos_contenido_guardar(v_cat, null, null);
  assert j -> 'contenido_cantidad' = 'null'::jsonb and j -> 'contenido_unidad' = 'null'::jsonb, 'T5 quitar el contenido';
  begin
    perform productos_contenido_guardar(-1, 5, 'kg');
    assert false, 'T5 producto inexistente debe fallar';
  exception when no_data_found then
    null;
  end;

  -- ── P permisos ──
  select count(*) into n
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('extraer_contenido', 'base_linea_agente', 'contenido_texto_agente', 'lineas_precio_agente',
                       'precio_referencia_agente', 'compras_producto_agente', 'historial_precios_agente',
                       'variacion_precios_agente', 'ranking_agente', 'serie_precios_agente')
     and not has_function_privilege('anon', p.oid, 'execute')
     and has_function_privilege('authenticated', p.oid, 'execute')
     and p.proconfig @> array['search_path=public']
     and not p.prosecdef;
  assert n = 10, format('P: %s de 10 funciones con permisos/search_path correctos', n);
  assert not has_function_privilege('authenticated', 'public.trg_productos_factura_rellenar_contenido()'::regprocedure, 'execute')
     and not has_function_privilege('anon', 'public.trg_productos_factura_rellenar_contenido()'::regprocedure, 'execute'),
     'P: la función del trigger está cerrada';
  assert (select count(*) from pg_trigger where tgrelid = 'public.productos_factura'::regclass
             and tgname = 'trg_productos_factura_rellenar_contenido' and not tgisinternal) = 1, 'P: trigger creado';
end;
$$;

select 'productos_contenido_unidad_test: OK' as resultado;

rollback;
