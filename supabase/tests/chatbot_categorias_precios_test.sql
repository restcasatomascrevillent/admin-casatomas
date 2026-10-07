set client_encoding = 'UTF8';
-- ===========================================================================
-- Pruebas de 20261007170000_chatbot_categorias_precios.sql
-- SQL plano con ASSERT dentro de BEGIN … ROLLBACK: no deja nada escrito.
-- DESPUÉS de aplicar la migración, POR TERMINAL:
--   npx supabase db query --linked -f supabase/tests/chatbot_categorias_precios_test.sql
-- Si termina sin ERROR e imprime «chatbot_categorias_precios_test: OK», todo ha pasado.
--
-- Cubre:
--   T1 gasto por categoría: vinos, marisco, «vino»/«cava»/«VINOS»/clave,
--      sinónimos (licores, ginebra, carne, pescado, jamón, limpieza,
--      refrescos, «pescado y marisco»), sin categoría (el reparto cuadra con
--      el total), cruce por mes y por proveedor (cuadran), errores de
--      argumentos y categoría desconocida (con la lista), albarán ya
--      facturado que no se cuenta dos veces.
--   T2 subida de precio simulada con líneas insertadas aquí: sin referencia
--      no avisa; mismo precio no avisa; +12 % avisa UNA vez (texto con
--      «11,50 → 12,90 €/kg»); sustitución con el mismo precio NO repite;
--      con otro precio amplía el aviso sin leer (no crea otro); otro
--      proveedor avisa marcando «antes …» y la RPC marca cambio_proveedor;
--      una factura vieja no avisa; el albarán ya facturado no avisa; la
--      línea que se clasifica después (UPDATE de producto_id NULL → valor)
--      sí avisa; avisos desactivados en la configuración → nada;
--      variacion_precios_agente con producto, subidas, bajadas y umbral.
--   T3 permisos: anon nada; authenticated ejecuta las RPC pero no el aviso;
--      usuario SIN la sección no ve nada; con VISTA lee y no cambia el
--      umbral; con EDICIÓN lo cambia.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- Datos de prueba (como postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000c601', 'test-precios-vista@rls.local'),
  ('00000000-0000-0000-0000-00000000c602', 'test-precios-edicion@rls.local'),
  ('00000000-0000-0000-0000-00000000c603', 'test-precios-sin-seccion@rls.local');
insert into public.user_permissions (user_id, section_key, can_view, can_edit) values
  ('00000000-0000-0000-0000-00000000c601', 'facturas', true, false),
  ('00000000-0000-0000-0000-00000000c602', 'facturas', true, true);

-- Producto de prueba (Pescado) con su alias: las líneas se asignan solas.
insert into public.productos_catalogo (nombre, categoria_id, unidad_habitual, origen)
select 'TEST Merluza prueba', id, 'kg', 'manual' from public.categorias_producto where clave = 'pescado_marisco.pescado';
insert into public.productos_alias (texto_normalizado, producto_id, origen)
select public.normalizar_nombre_producto('TEST Merluza prueba'), id, 'manual'
  from public.productos_catalogo where nombre = 'TEST Merluza prueba';

-- ---------------------------------------------------------------------------
-- T1 gasto por categoría (como postgres)
-- ---------------------------------------------------------------------------
do $t1$
declare
  j      jsonb;
  k      jsonb;
  v_suma numeric;
  v_nata bigint;
  v_fac  bigint;
  v_alb  bigint;
begin
  -- Resolución de categorías: clave, nombre, sinónimos y raíces.
  assert public.categoria_agente('vinos')         = (select id from public.categorias_producto where clave = 'bebidas.vinos'), 'T1a vinos';
  assert public.categoria_agente('Vino')          = (select id from public.categorias_producto where clave = 'bebidas.vinos'), 'T1b vino';
  assert public.categoria_agente('VINOS')         = (select id from public.categorias_producto where clave = 'bebidas.vinos'), 'T1c VINOS';
  assert public.categoria_agente('cava')          = (select id from public.categorias_producto where clave = 'bebidas.vinos'), 'T1d cava';
  assert public.categoria_agente('bebidas.vinos') = (select id from public.categorias_producto where clave = 'bebidas.vinos'), 'T1e clave';
  assert public.categoria_agente('marisco')       = (select id from public.categorias_producto where clave = 'pescado_marisco.marisco'), 'T1f marisco';
  assert public.categoria_agente('mariscos')      = (select id from public.categorias_producto where clave = 'pescado_marisco.marisco'), 'T1g mariscos';
  assert public.categoria_agente('pescado')       = (select id from public.categorias_producto where clave = 'pescado_marisco.pescado'), 'T1h pescado';
  assert public.categoria_agente('marisco y pescado') = (select id from public.categorias_producto where clave = 'pescado_marisco'), 'T1i pescado y marisco';
  assert public.categoria_agente('licores')       = (select id from public.categorias_producto where clave = 'bebidas.licores'), 'T1j licores';
  assert public.categoria_agente('ginebra')       = (select id from public.categorias_producto where clave = 'bebidas.licores'), 'T1k ginebra';
  assert public.categoria_agente('carnes')        = (select id from public.categorias_producto where clave = 'carnes.carne'), 'T1l carnes';
  assert public.categoria_agente('jamón')         = (select id from public.categorias_producto where clave = 'carnes.embutidos'), 'T1m jamón';
  assert public.categoria_agente('limpieza')      = (select id from public.categorias_producto where clave = 'limpieza'), 'T1n limpieza';
  assert public.categoria_agente('refrescos')     = (select id from public.categorias_producto where clave = 'bebidas.refrescos'), 'T1o refrescos';
  assert public.categoria_agente('bebidas')       = (select id from public.categorias_producto where clave = 'bebidas'), 'T1p bebidas';
  assert public.categoria_agente('gasto en vinos') = (select id from public.categorias_producto where clave = 'bebidas.vinos'), 'T1q gasto en vinos';
  assert public.categoria_agente('zapatos') is null, 'T1r zapatos';

  -- Vinos: categoría, madre, total, top ≤ 8, base sin IVA.
  j := public.gasto_categorias_agente('vinos', '2025-01-01', '2026-12-31');
  assert j ->> 'categoria' = 'Vinos' and j ->> 'madre' = 'Bebidas', format('T1s: %s', j);
  assert (j #>> '{total,importe}')::numeric > 12000, format('T1t: vinos > 12.000 (Insula Roma): %s', j);
  assert jsonb_array_length(j -> 'top_productos') between 1 and 8, format('T1u: %s', j);
  assert j ->> 'nota' ilike '%SIN IVA%', 'T1v: falta la nota de IVA';
  -- «vino» y «vinos» dan lo mismo.
  assert public.gasto_categorias_agente('vino', '2025-01-01', '2026-12-31')::jsonb -> 'total' = j -> 'total', 'T1w: vino ≠ vinos';
  -- Marisco: total = suma de sus productos (≤ 8 aquí).
  k := public.gasto_categorias_agente('marisco');
  select sum((p ->> 'importe')::numeric) into v_suma from jsonb_array_elements(k -> 'top_productos') p;
  assert k ->> 'categoria' = 'Marisco' and (k #>> '{total,importe}')::numeric > 0, format('T1x: %s', k);
  assert k ? 'productos_total' or v_suma = (k #>> '{total,importe}')::numeric, format('T1y: los productos no suman el total: %s', k);

  -- Sin categoría: madres + sin categoría + sin clasificar = total.
  j := public.gasto_categorias_agente();
  select coalesce(sum((c ->> 'importe')::numeric), 0) into v_suma from jsonb_array_elements(j -> 'categorias') c;
  v_suma := v_suma + coalesce((j #>> '{sin_categoria,importe}')::numeric, 0) + coalesce((j #>> '{sin_clasificar,importe}')::numeric, 0);
  assert v_suma = (j #>> '{total,importe}')::numeric, format('T1z: el reparto (%s) no cuadra con el total: %s', v_suma, j);
  assert exists (select 1 from jsonb_array_elements(j -> 'categorias') c
                  where c ->> 'categoria' = 'Bebidas' and jsonb_array_length(c -> 'sub') >= 1), format('T1aa: Bebidas sin subcategorías: %s', j);

  -- Cruce por mes (con categoría) y por proveedor (sin categoría): cuadran.
  k := public.gasto_categorias_agente('vinos', null, null, null, 'mes');
  select sum((c ->> 'importe')::numeric) into v_suma from jsonb_array_elements(k -> 'cruce') c;
  assert v_suma = (k #>> '{total,importe}')::numeric and (k -> 'cruce' -> 0) ? 'mes', format('T1ab: cruce por mes: %s', k);
  k := public.gasto_categorias_agente(null, null, null, null, 'proveedor');
  assert (k -> 'cruce' -> 0) ? 'proveedor' and (k -> 'cruce' -> 0) ? 'categoria', format('T1ac: cruce por proveedor: %s', k);
  if not (k ? 'cruce_truncado') then
    select sum((c ->> 'importe')::numeric) into v_suma from jsonb_array_elements(k -> 'cruce') c;
    assert v_suma = (k #>> '{total,importe}')::numeric, format('T1ad: cruce por proveedor no cuadra: %s', k);
  end if;

  -- Errores legibles.
  assert public.gasto_categorias_agente('vinos', '2026-02-01', '2026-01-01')::jsonb ? 'error', 'T1ae rango';
  assert public.gasto_categorias_agente('vinos', null, null, 'pedido')::jsonb ? 'error', 'T1af tipo';
  assert public.gasto_categorias_agente('vinos', null, null, null, 'semana')::jsonb ? 'error', 'T1ag agrupar';
  k := public.gasto_categorias_agente('zapatos');
  assert k ? 'error' and jsonb_array_length(k -> 'categorias') >= 11, format('T1ah: %s', k);

  -- Albarán ya facturado (mismo proveedor, producto, unidad y cantidad): no cuenta dos veces.
  select a.producto_id into v_nata from public.productos_alias a
   where a.texto_normalizado = public.normalizar_nombre_producto('NATOP (20% nata animal de 35mg) 2 L -Debic-');
  assert v_nata is not null, 'T1ai: falta el alias de la nata (carga inicial de 20261007160000)';
  insert into public.facturas (tipo, proveedor, numero_documento, fecha, total)
  values ('factura', 'TEST DEDUPE SL', 'TEST-CAT-F1', date '2098-03-10', 120.23) returning id into v_fac;
  insert into public.facturas (tipo, proveedor, numero_documento, fecha)
  values ('albaran', 'TEST DEDUPE SL', 'TEST-CAT-A1', date '2098-03-05') returning id into v_alb;
  insert into public.productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total)
  values (v_fac, 'NATOP (20% nata animal de 35mg) 2 L -Debic-', 24, 'kg', 4.14, 99.36),
         (v_alb, 'NATOP (20% nata animal de 35mg) 2 L -Debic-', 24, 'kg', 4.14, 99.36);
  k := public.gasto_categorias_agente('lacteos', '2098-01-01', '2098-12-31');
  assert (k #>> '{total,importe}')::numeric = 99.36 and (k #>> '{total,lineas}')::int = 1
     and (k #>> '{avisos,albaranes_ya_facturados}')::int = 1, format('T1aj: albarán ya facturado: %s', k);
  -- Solo albaranes: ese sí (lo pide el usuario).
  k := public.gasto_categorias_agente('lacteos', '2098-01-01', '2098-12-31', 'albaranes');
  assert (k #>> '{total,importe}')::numeric = 99.36 and (k ->> 'incluye_albaranes')::boolean, format('T1ak: %s', k);
  -- Periodo sin compras de la categoría: sin_datos y la última compra.
  k := public.gasto_categorias_agente('vinos', '2030-01-01', '2030-12-31');
  assert (k ->> 'sin_datos')::boolean and k ? 'ultima_compra', format('T1al: %s', k);
end
$t1$;

-- ---------------------------------------------------------------------------
-- T2 subida de precio y aviso automático (como postgres)
-- ---------------------------------------------------------------------------
create temp table t2_base on commit drop as
  select (select count(*) from public.notificaciones_dashboard where tipo = 'subida_precio') as n0;

do $t2$
declare
  v_prod  bigint;
  v_a     bigint;
  v_b     bigint;
  v_c     bigint;
  v_d     bigint;
  v_e     bigint;
  v_f     bigint;
  v_g     bigint;
  v_h     bigint;
  v_n0    bigint := (select n0 from t2_base);
  v_lin   bigint;
  n       record;
  j       jsonb;
  fila    jsonb;
  c_merl  constant text := 'TEST Merluza prueba';
begin
  select id into v_prod from public.productos_catalogo where nombre = c_merl;
  assert (select umbral_subida_precio_pct from public.configuracion_facturas) = 10, 'T2a: el umbral por defecto no es 10';

  -- A y B: primeras compras (sin referencia / mismo precio) → nada.
  insert into public.facturas (tipo, proveedor, numero_documento, fecha, total)
  values ('factura', 'TEST FLOPE SL', 'TEST-PREC-A', current_date - 30, 139.15) returning id into v_a;
  insert into public.productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total)
  values (v_a, c_merl, 10, 'kg', 11.50, 115.00);
  insert into public.facturas (tipo, proveedor, numero_documento, fecha, total)
  values ('factura', 'TEST FLOPE SL', 'TEST-PREC-B', current_date - 20, 139.15) returning id into v_b;
  insert into public.productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total)
  values (v_b, c_merl, 10, 'kg', 11.50, 115.00);
  assert (select count(*) from public.productos_factura where factura_id in (v_a, v_b) and producto_id = v_prod) = 2,
    'T2b: el alias no asignó el producto';
  assert (select count(*) from public.notificaciones_dashboard where tipo = 'subida_precio') = v_n0,
    'T2c: avisó sin subida';

  -- C: +12,2 % (11,50 → 12,90) → UN aviso.
  insert into public.facturas (tipo, proveedor, numero_documento, fecha, total)
  values ('factura', 'TEST FLOPE SL', 'TEST-PREC-C', current_date - 1, 78.05) returning id into v_c;
  insert into public.productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total)
  values (v_c, c_merl, 5, 'kg', 12.90, 64.50);
  assert (select count(*) from public.notificaciones_dashboard where tipo = 'subida_precio') = v_n0 + 1,
    'T2d: la subida del 12 % no avisó una vez';
  select * into n from public.notificaciones_dashboard where tipo = 'subida_precio' order by created_at desc, id limit 1;
  assert n.titulo = 'Subida de precio: TEST Merluza prueba +12,2 %', format('T2e: título «%s»', n.titulo);
  assert n.mensaje like 'TEST Merluza prueba +12,2 % (11,50 → 12,90 €/kg, TEST FLOPE SL) · Factura TEST-PREC-C del %. Precios sin IVA.',
    format('T2f: mensaje «%s»', n.mensaje);
  assert n.referencia_tipo = 'facturas_productos' and n.prioridad = 'normal' and not n.leida and n.origen is null,
    format('T2g: %s', to_jsonb(n));

  -- La RPC dice lo mismo.
  j := public.variacion_precios_agente(p_producto => 'merluza prueba');
  fila := j -> 'productos' -> 0;
  assert (fila ->> 'variacion_pct')::numeric = 12.2 and (fila ->> 'ref_precio')::numeric = 11.5
     and (fila ->> 'ref_compras')::int = 2 and not (fila ? 'cambio_proveedor') and not (fila ? 'pocas_compras'),
    format('T2h: %s', j);
  j := public.variacion_precios_agente(current_date - 7, current_date, 10, 'pescado');
  assert exists (select 1 from jsonb_array_elements(j -> 'productos') p where p ->> 'producto' = c_merl), format('T2i: %s', j);
  j := public.variacion_precios_agente(current_date - 7, current_date, 15, 'pescado');
  assert not exists (select 1 from jsonb_array_elements(j -> 'productos') p where p ->> 'producto' = c_merl),
    format('T2j: con umbral 15 no debería salir: %s', j);
  j := public.variacion_precios_agente(current_date - 7, current_date, 10, 'pescado', null, 10, 'bajadas');
  assert not exists (select 1 from jsonb_array_elements(j -> 'productos') p where p ->> 'producto' = c_merl), format('T2k: %s', j);

  -- Sustitución / reproceso con el MISMO precio: no repite el aviso.
  delete from public.productos_factura where factura_id = v_c;
  insert into public.productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total)
  values (v_c, c_merl, 5, 'kg', 12.90, 64.50);
  assert (select count(*) from public.notificaciones_dashboard where tipo = 'subida_precio') = v_n0 + 1,
    'T2l: la sustitución con el mismo precio repitió el aviso';
  -- Con OTRO precio: amplía el aviso sin leer (no crea otro).
  delete from public.productos_factura where factura_id = v_c;
  insert into public.productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total)
  values (v_c, c_merl, 5, 'kg', 13.50, 67.50);
  assert (select count(*) from public.notificaciones_dashboard where tipo = 'subida_precio') = v_n0 + 1,
    'T2m: la corrección de precio creó otro aviso';
  assert (select mensaje from public.notificaciones_dashboard where id = n.id) like '%11,50 → 13,50 €/kg%',
    'T2n: el aviso no se actualizó con el precio nuevo';
  update public.notificaciones_dashboard set leida = true where id = n.id;

  -- D: otro proveedor → aviso con «antes …»; la RPC marca cambio_proveedor.
  insert into public.facturas (tipo, proveedor, numero_documento, fecha, total)
  values ('factura', 'TEST OTRO PESCADO SL', 'TEST-PREC-D', current_date, 87.73) returning id into v_d;
  insert into public.productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total)
  values (v_d, c_merl, 5, 'kg', 14.50, 72.50);
  assert (select count(*) from public.notificaciones_dashboard where tipo = 'subida_precio') = v_n0 + 2,
    'T2o: el cambio de proveedor más caro no avisó';
  assert (select mensaje from public.notificaciones_dashboard where tipo = 'subida_precio' and not leida
           order by created_at desc limit 1) like '%TEST OTRO PESCADO SL; antes TEST FLOPE SL)%', 'T2p: falta «antes …»';
  j := public.variacion_precios_agente(p_producto => 'TEST merluza');
  fila := j -> 'productos' -> 0;
  assert (fila ->> 'cambio_proveedor')::boolean and fila ->> 'ref_proveedor' = 'TEST FLOPE SL'
     and fila ->> 'proveedor' = 'TEST OTRO PESCADO SL' and (j #>> '{avisos,cambio_proveedor}')::int = 1, format('T2q: %s', j);

  -- E: una factura VIEJA más cara no avisa (no es la última compra).
  insert into public.facturas (tipo, proveedor, numero_documento, fecha, total)
  values ('factura', 'TEST FLOPE SL', 'TEST-PREC-E', current_date - 60, 121) returning id into v_e;
  insert into public.productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total)
  values (v_e, c_merl, 5, 'kg', 20, 100);
  assert (select count(*) from public.notificaciones_dashboard where tipo = 'subida_precio') = v_n0 + 2,
    'T2r: una factura vieja avisó';

  -- F: albarán del mismo pedido que D (ya facturado) → no avisa.
  insert into public.facturas (tipo, proveedor, numero_documento, fecha)
  values ('albaran', 'TEST OTRO PESCADO SL', 'TEST-PREC-F', current_date) returning id into v_f;
  insert into public.productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total)
  values (v_f, c_merl, 5, 'kg', 14.50, 72.50);
  assert (select count(*) from public.notificaciones_dashboard where tipo = 'subida_precio') = v_n0 + 2,
    'T2s: el albarán ya facturado avisó';

  -- G: línea sin producto (texto desconocido) que se clasifica DESPUÉS → avisa.
  insert into public.facturas (tipo, proveedor, numero_documento, fecha, total)
  values ('factura', 'TEST FLOPE SL', 'TEST-PREC-G', current_date, 145.2) returning id into v_g;
  insert into public.productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total)
  values (v_g, 'TEST pescadilla rara xyz', 4, 'kg', 30, 120) returning id into v_lin;
  assert (select producto_id from public.productos_factura where id = v_lin) is null, 'T2t: la línea desconocida tiene producto';
  assert (select count(*) from public.notificaciones_dashboard where tipo = 'subida_precio') = v_n0 + 2, 'T2u';
  update public.productos_factura set producto_id = v_prod where id = v_lin;
  assert (select count(*) from public.notificaciones_dashboard where tipo = 'subida_precio') = v_n0 + 3,
    'T2v: la línea clasificada después no avisó';
  -- Cambiar de un producto a otro (no NULL → valor) no vuelve a avisar.
  update public.productos_factura set producto_id = v_prod where id = v_lin;
  assert (select count(*) from public.notificaciones_dashboard where tipo = 'subida_precio') = v_n0 + 3, 'T2w';
  assert (select count(*) from public.avisos_subida_precio where producto_id = v_prod) = 3,
    'T2x: avisos_subida_precio no tiene C, D y G';

  -- Avisos desactivados → nada.
  update public.configuracion_facturas set avisos_subida_precio = false;
  insert into public.facturas (tipo, proveedor, numero_documento, fecha, total)
  values ('factura', 'TEST FLOPE SL', 'TEST-PREC-H', current_date, 300) returning id into v_h;
  insert into public.productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total)
  values (v_h, c_merl, 5, 'kg', 50, 250);
  assert (select count(*) from public.notificaciones_dashboard where tipo = 'subida_precio') = v_n0 + 3,
    'T2y: con los avisos desactivados avisó';
  update public.configuracion_facturas set avisos_subida_precio = true;

  -- Argumentos.
  assert public.variacion_precios_agente(p_sentido => 'arriba')::jsonb ? 'error', 'T2z sentido';
  assert public.variacion_precios_agente(p_umbral_pct => -1)::jsonb ? 'error', 'T2aa umbral';
  assert public.variacion_precios_agente(p_categoria => 'zapatos')::jsonb ? 'error', 'T2ab categoría';
  assert (public.variacion_precios_agente(p_producto => 'zzqxw inexistente')::jsonb ->> 'sin_datos')::boolean, 'T2ac producto';
  j := public.variacion_precios_agente(p_limite => 1, p_umbral_pct => 0, p_sentido => 'ambas');
  assert jsonb_array_length(j -> 'productos') = 1 and ((j ->> 'truncado')::boolean or (j ->> 'total_productos')::int = 1),
    format('T2ad: %s', j);
end
$t2$;

-- ---------------------------------------------------------------------------
-- T3 permisos
-- ---------------------------------------------------------------------------
do $t3a$
begin
  assert not has_function_privilege('anon', 'public.gasto_categorias_agente(text,date,date,text,text)', 'execute'), 'T3a';
  assert not has_function_privilege('anon', 'public.variacion_precios_agente(date,date,numeric,text,text,integer,text)', 'execute'), 'T3b';
  assert not has_function_privilege('anon', 'public.categoria_agente(text)', 'execute'), 'T3c';
  assert has_function_privilege('authenticated', 'public.gasto_categorias_agente(text,date,date,text,text)', 'execute'), 'T3d';
  assert has_function_privilege('service_role', 'public.variacion_precios_agente(date,date,numeric,text,text,integer,text)', 'execute'), 'T3e';
  assert not has_function_privilege('authenticated', 'public.productos_avisar_subidas(bigint[])', 'execute'), 'T3f';
  assert not has_table_privilege('anon', 'public.configuracion_facturas', 'select'), 'T3g';
  assert not has_table_privilege('anon', 'public.avisos_subida_precio', 'select'), 'T3h';
  assert not has_table_privilege('authenticated', 'public.avisos_subida_precio', 'insert'), 'T3i';
  assert not has_table_privilege('authenticated', 'public.configuracion_facturas', 'insert'), 'T3j';
end
$t3a$;

-- Usuario SIN la sección facturas.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000c603';
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000c603","role":"authenticated"}';
do $t3b$
declare
  j jsonb;
begin
  j := public.gasto_categorias_agente();
  assert (j ->> 'sin_datos')::boolean and not (j ? 'categorias'), format('T3k: sin la sección ve gasto: %s', j);
  assert (public.variacion_precios_agente(p_umbral_pct => 0, p_sentido => 'ambas')::jsonb ->> 'sin_datos')::boolean, 'T3l';
  assert (select count(*) from public.configuracion_facturas) = 0, 'T3m: sin la sección ve la configuración';
end
$t3b$;
reset role;

-- Usuario con VISTA: lee lo mismo que postgres; no cambia el umbral.
select set_config('test_precios.vinos', (public.gasto_categorias_agente('vinos', '2025-01-01', '2026-12-31')::jsonb -> 'total')::text, true);
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000c601';
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000c601","role":"authenticated"}';
do $t3c$
begin
  assert public.gasto_categorias_agente('vinos', '2025-01-01', '2026-12-31')::jsonb -> 'total'
         = current_setting('test_precios.vinos')::jsonb,
    'T3n: con vista no lee el gasto en vinos';
  assert (select umbral_subida_precio_pct from public.configuracion_facturas) = 10, 'T3o: con vista no lee el umbral';
  update public.configuracion_facturas set umbral_subida_precio_pct = 5;
  assert not found, 'T3p: con solo vista cambió el umbral';
end
$t3c$;
reset role;

-- Usuario con EDICIÓN: cambia el umbral (y queda quién y cuándo).
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000c602';
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000c602","role":"authenticated"}';
do $t3d$
begin
  update public.configuracion_facturas set umbral_subida_precio_pct = 15;
  assert found, 'T3q: con edición no pudo cambiar el umbral';
  assert (select updated_by from public.configuracion_facturas) = '00000000-0000-0000-0000-00000000c602'::uuid, 'T3r: updated_by';
  begin
    update public.configuracion_facturas set umbral_subida_precio_pct = 0;
    raise exception 'T3s: aceptó un umbral 0';
  exception when check_violation then null;
  end;
end
$t3d$;
reset role;

select 'chatbot_categorias_precios_test: OK' as resultado;

rollback;
