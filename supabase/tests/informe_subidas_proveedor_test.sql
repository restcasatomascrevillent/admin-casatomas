set client_encoding = 'UTF8';
-- Test de 20261207110000_informe_subidas_proveedor. BEGIN … ROLLBACK: no deja nada escrito.
-- Acaba en «informe_subidas_proveedor_test: OK».
--   supabase db query --linked -f supabase/tests/informe_subidas_proveedor_test.sql
--
-- Datos entre 09/2034 y 11/2035 («hoy» = 01/12/2035), proveedores A, B y C:
--   SALMON (kg, A)   15 compras mensuales de 10 kg: 10 € hasta mayo, 11 € de junio a agosto y 12 €
--                    desde septiembre; con un abono, una línea regalada y una factura de abono
--                    → +20 % frente a hace 12 meses, 120 kg en 12 meses, +240 €/año, confianza ALTA.
--   HUEVO (docena, A) 1,90 → 2,30 € con una compra suelta por «ud» → +21,1 %, +120 €/año, MEDIA
--                    (pocas compras y varias unidades); la compra por «ud» no se mezcla.
--   PAN CAJA 20 UD (ud, A) 1,40 → 29,40 € → +2.000 %: BAJA («Revisar»), no suma.
--   SOLO (kg, A)     una sola compra → no se puede comparar.
--   CAJON (kg, A y B) 6 nombres de línea y precios de 10 a 30 € → cajón genérico: fuera de los dos bloques.
--   ARROZ (kg)       A a 2,00 € (200 kg) y B a 1,60 € → ahorro 80 €/año, ALTA.
--   GAMBA (kg, pescado) A a 50 € (30 kg) y B a 40 € → ahorro 300 €/año, MEDIA (producto fresco).
--   VINO (botella)   A a 20 € y C a 5 € con una sola compra → BAJA, no suma.
begin;

do $$
declare
  v_hoy  constant date := '2035-12-01';
  v_a    bigint;
  v_b    bigint;
  v_c    bigint;
  v_f    bigint;
  v_desp bigint;
  v_pesc bigint;
  v_pc   jsonb := '{}'::jsonb;
  v_id   bigint;
  rec    record;
  j      jsonb;
  f      jsonb;
  i      int;
  v_d    date;
begin
  if exists (select 1 from facturas where fecha between '2033-08-01' and '2035-12-31') then
    raise exception 'FALLO datos: ya hay documentos entre 08/2033 y 2035; el test necesita esos años vacíos';
  end if;
  select id into v_desp from categorias_producto where padre_id is null and nombre = 'Despensa';
  select id into v_pesc from categorias_producto where padre_id is null and nombre = 'Pescado y marisco';
  if v_desp is null or v_pesc is null then
    raise exception 'FALLO datos: faltan las familias Despensa o Pescado y marisco';
  end if;

  insert into proveedores (nombre, cif) values ('PRUEBA ISP A', 'B00000961') returning id into v_a;
  insert into proveedores (nombre, cif) values ('PRUEBA ISP B', 'B00000962') returning id into v_b;
  insert into proveedores (nombre, cif) values ('PRUEBA ISP C', 'B00000963') returning id into v_c;

  for rec in
    select * from (values
      ('SALMON', v_desp), ('HUEVO', v_desp), ('PAN CAJA 20 UD', v_desp), ('SOLO', v_desp),
      ('CAJON', v_desp), ('ARROZ', v_desp), ('GAMBA', v_pesc), ('VINO', v_desp)) x(n, cat)
  loop
    insert into productos_catalogo (nombre, origen, categoria_id) values ('Zzisp ' || rec.n, 'manual', rec.cat) returning id into v_id;
    v_pc := v_pc || jsonb_build_object(rec.n, v_id);
  end loop;

  -- SALMON: 15 compras mensuales (15/09/2034 … 15/11/2035).
  for i in 0..14 loop
    v_d := ('2034-09-15'::date + make_interval(months => i))::date;
    insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
    values ('factura', 'PRUEBA ISP A', 'B00000961', v_a, 'ISP-S' || i, v_d, 100, 'casa_tomas') returning id into v_f;
    insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, producto_id)
    values (v_f, 'ZZISP SALMON', 10, 'kg',
            case when v_d < '2035-06-01' then 10 when v_d < '2035-09-01' then 11 else 12 end,
            10 * case when v_d < '2035-06-01' then 10 when v_d < '2035-09-01' then 11 else 12 end,
            (v_pc ->> 'SALMON')::bigint);
    if i = 14 then
      -- En la última factura: un abono (total negativo) y una línea regalada (100 % de descuento).
      insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, producto_id)
      values (v_f, 'ZZISP SALMON', -3, 'kg', 12, -36, (v_pc ->> 'SALMON')::bigint);
      insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, producto_id, descuento_pct)
      values (v_f, 'ZZISP SALMON', 5, 'kg', 12, 0, (v_pc ->> 'SALMON')::bigint, 100);
    end if;
  end loop;
  -- Una factura de abono posterior, a 1 €: no puede ser «la última compra».
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
  values ('factura', 'PRUEBA ISP A', 'B00000961', v_a, 'ISP-ABONO', '2035-11-20', -20, 'casa_tomas') returning id into v_f;
  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, producto_id)
  values (v_f, 'ZZISP SALMON', 20, 'kg', 1, 20, (v_pc ->> 'SALMON')::bigint);

  for rec in
    select * from (values
      ('HUEVO', v_a, '2034-11-05'::date, 'ZZISP HUEVO', 'docena', 100::numeric, 1.90::numeric),
      ('HUEVO', v_a, '2035-03-05', 'ZZISP HUEVO', 'docena', 100, 1.90),
      ('HUEVO', v_a, '2035-06-05', 'ZZISP HUEVO', 'ud', 30, 0.20),
      ('HUEVO', v_a, '2035-07-05', 'ZZISP HUEVO', 'docena', 100, 2.10),
      ('HUEVO', v_a, '2035-11-05', 'ZZISP HUEVO', 'docena', 100, 2.30),
      ('PAN CAJA 20 UD', v_a, '2034-11-10', 'ZZISP PAN CAJA 20 UD', 'ud', 10, 1.40),
      ('PAN CAJA 20 UD', v_a, '2035-11-10', 'ZZISP PAN CAJA 20 UD', 'ud', 10, 29.40),
      ('SOLO', v_a, '2035-11-01', 'ZZISP SOLO', 'kg', 5, 7),
      ('CAJON', v_a, '2035-06-10', 'ZZISP CAJON UNO', 'kg', 10, 10),
      ('CAJON', v_a, '2035-07-10', 'ZZISP CAJON DOS', 'kg', 10, 12),
      ('CAJON', v_a, '2035-11-10', 'ZZISP CAJON TRES', 'kg', 10, 30),
      ('CAJON', v_b, '2035-09-10', 'ZZISP CAJON CUATRO', 'kg', 10, 20),
      ('CAJON', v_b, '2035-10-10', 'ZZISP CAJON CINCO', 'kg', 10, 25),
      ('CAJON', v_b, '2035-11-11', 'ZZISP CAJON SEIS', 'kg', 10, 14),
      ('ARROZ', v_a, '2035-08-10', 'ZZISP ARROZ', 'kg', 50, 2.00),
      ('ARROZ', v_a, '2035-09-10', 'ZZISP ARROZ', 'kg', 50, 2.00),
      ('ARROZ', v_a, '2035-10-10', 'ZZISP ARROZ', 'kg', 50, 2.00),
      ('ARROZ', v_a, '2035-11-10', 'ZZISP ARROZ', 'kg', 50, 2.00),
      ('ARROZ', v_b, '2035-08-12', 'ZZISP ARROZ', 'kg', 10, 1.60),
      ('ARROZ', v_b, '2035-09-12', 'ZZISP ARROZ', 'kg', 10, 1.60),
      ('ARROZ', v_b, '2035-10-12', 'ZZISP ARROZ', 'kg', 10, 1.60),
      ('ARROZ', v_b, '2035-11-12', 'ZZISP ARROZ', 'kg', 10, 1.60),
      ('GAMBA', v_a, '2035-09-05', 'ZZISP GAMBA', 'kg', 10, 50),
      ('GAMBA', v_a, '2035-10-05', 'ZZISP GAMBA', 'kg', 10, 50),
      ('GAMBA', v_a, '2035-11-05', 'ZZISP GAMBA', 'kg', 10, 50),
      ('GAMBA', v_b, '2035-09-06', 'ZZISP GAMBA', 'kg', 5, 40),
      ('GAMBA', v_b, '2035-10-06', 'ZZISP GAMBA', 'kg', 5, 40),
      ('GAMBA', v_b, '2035-11-06', 'ZZISP GAMBA', 'kg', 5, 40),
      ('VINO', v_a, '2035-09-07', 'ZZISP VINO', 'botella', 12, 20),
      ('VINO', v_a, '2035-10-07', 'ZZISP VINO', 'botella', 12, 20),
      ('VINO', v_a, '2035-11-07', 'ZZISP VINO', 'botella', 12, 20),
      ('VINO', v_c, '2035-10-08', 'ZZISP VINO', 'botella', 6, 5)
    ) x(prod, prov, fecha, nombre, unidad, cantidad, precio)
  loop
    insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
    values ('factura', 'PRUEBA ISP', 'B00000961', rec.prov, 'ISP-' || rec.prod || '-' || rec.fecha, rec.fecha, rec.cantidad * rec.precio, 'casa_tomas')
    returning id into v_f;
    insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, producto_id)
    values (v_f, rec.nombre, rec.cantidad, rec.unidad, rec.precio, rec.cantidad * rec.precio, (v_pc ->> rec.prod)::bigint);
  end loop;

  -- ── Permisos ──
  if has_function_privilege('anon', 'public.informe_subidas_precio(integer,bigint,bigint,text,date,integer,integer,boolean)', 'execute')
     or has_function_privilege('anon', 'public.informe_proveedor_mas_barato(bigint,bigint,text,date,integer,integer,boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.informe_precios_compras(date,text)', 'execute') then
    raise exception 'FALLO permisos: anon no puede ejecutar los informes ni authenticated la base';
  end if;
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  begin
    perform public.informe_subidas_precio(12, null, null, null, v_hoy);
    raise exception 'FALLO permisos: un usuario sin Facturas ha podido ver el informe';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  begin
    perform public.informe_subidas_precio(5, null, null, null, v_hoy);
    raise exception 'FALLO: meses = 5 debería fallar';
  exception when invalid_parameter_value then null;
  end;

  -- ══ Bloque 1 · Subidas frente a hace 12 meses ══
  j := public.informe_subidas_precio(12, null, null, null, v_hoy, 200, 0);
  if (j ->> 'total_filas')::int <> 3 then
    raise exception 'FALLO subidas: se esperaban 3 filas (salmón, huevo, pan): %', (select jsonb_agg(x ->> 'producto') from jsonb_array_elements(j -> 'filas') x);
  end if;
  -- Orden: lo fiable por impacto y «Revisar» al final, aunque su impacto sea el mayor.
  if (select array_agg(x ->> 'producto' order by o) from jsonb_array_elements(j -> 'filas') with ordinality t(x, o))
       is distinct from array['Zzisp SALMON', 'Zzisp HUEVO', 'Zzisp PAN CAJA 20 UD'] then
    raise exception 'FALLO subidas: orden %', (select jsonb_agg(x ->> 'producto') from jsonb_array_elements(j -> 'filas') x);
  end if;

  f := j -> 'filas' -> 0;   -- SALMON
  if (f ->> 'precio')::numeric <> 12 or (f ->> 'precio_ref')::numeric <> 10 or (f ->> 'variacion_pct')::numeric <> 20
     or (f ->> 'cantidad_12m')::numeric <> 120 or (f ->> 'impacto_anual')::numeric <> 240
     or f ->> 'confianza' <> 'alta' or f ->> 'unidad' <> 'kg' or f ->> 'fecha' <> '2035-11-15' or f ->> 'fecha_ref' <> '2034-11-15' then
    raise exception 'FALLO salmón (abonos y regalos no cuentan; 12 frente a 10, 120 kg, +240 €, alta): %', f;
  end if;
  if (f -> 'hace_3' ->> 'precio')::numeric <> 11 or (f -> 'hace_6' ->> 'precio')::numeric <> 10 or (f -> 'hace_12' ->> 'precio')::numeric <> 10 then
    raise exception 'FALLO salmón: precios de hace 3, 6 y 12 meses: %', f;
  end if;
  if (f -> 'doc' ->> 'numero') <> 'ISP-S14' or (f -> 'doc_ref' ->> 'numero') <> 'ISP-S2' then
    raise exception 'FALLO salmón: facturas enlazadas %, %', f -> 'doc', f -> 'doc_ref';
  end if;

  f := j -> 'filas' -> 1;   -- HUEVO
  if f ->> 'unidad' <> 'docena' or (f ->> 'precio')::numeric <> 2.30 or (f ->> 'precio_ref')::numeric <> 1.90
     or (f ->> 'cantidad_12m')::numeric <> 300 or (f ->> 'impacto_anual')::numeric <> 120
     or f ->> 'confianza' <> 'media' or f ->> 'motivo' not like '%varias unidades%' or f ->> 'motivo' not like '%Pocas compras: 3%' then
    raise exception 'FALLO huevo (docena sin mezclar con ud; media): %', f;
  end if;

  f := j -> 'filas' -> 2;   -- PAN
  if f ->> 'confianza' <> 'baja' or f ->> 'motivo' not like '%más del 60 %%' or f ->> 'motivo' not like '%caja o pack%' then
    raise exception 'FALLO pan (pack guardado como unidad y +2000 %%: baja): %', f;
  end if;

  if (j -> 'totales' ->> 'impacto_fiable')::numeric <> 360 or (j -> 'totales' ->> 'n_fiable')::int <> 2
     or (j -> 'totales' -> 'por_confianza' -> 'alta' ->> 'impacto')::numeric <> 240
     or (j -> 'totales' -> 'por_confianza' -> 'media' ->> 'impacto')::numeric <> 120
     or (j -> 'totales' -> 'por_confianza' -> 'baja' ->> 'n')::int <> 1
     or (j -> 'totales' -> 'por_confianza' -> 'baja' ->> 'impacto')::numeric <> 280 then
    raise exception 'FALLO totales de subidas (solo alta + media = 360): %', j -> 'totales';
  end if;
  if (j -> 'totales' ->> 'sin_referencia')::int <> 7 then
    raise exception 'FALLO sin_referencia (solo, arroz ×2, gamba ×2, vino ×2 = 7): %', j -> 'totales';
  end if;
  if (j -> 'excluidos' ->> 'n_genericos')::int <> 1 or (j -> 'excluidos' -> 'genericos' -> 0 ->> 'producto') <> 'Zzisp CAJON' then
    raise exception 'FALLO genéricos en subidas: %', j -> 'excluidos';
  end if;
  if jsonb_array_length(j -> 'proveedores') <> 1 or jsonb_array_length(j -> 'familias') <> 1 then
    raise exception 'FALLO opciones de filtro: % %', j -> 'proveedores', j -> 'familias';
  end if;

  -- Frente a hace 3 meses: salmón 12 frente a 11 (+120 €) y huevo 2,30 frente a 2,10 (+60 €).
  j := public.informe_subidas_precio(3, null, null, null, v_hoy, 200, 0);
  if (j -> 'totales' ->> 'impacto_fiable')::numeric <> 180 or (j ->> 'total_filas')::int <> 2 then
    raise exception 'FALLO subidas a 3 meses (180 €, 2 filas): % %', j -> 'totales', j ->> 'total_filas';
  end if;

  -- Paginación: la segunda fila sola, con el total intacto.
  j := public.informe_subidas_precio(12, null, null, null, v_hoy, 1, 1);
  if jsonb_array_length(j -> 'filas') <> 1 or (j -> 'filas' -> 0 ->> 'producto') <> 'Zzisp HUEVO'
     or (j ->> 'total_filas')::int <> 3 or (j -> 'totales' ->> 'impacto_fiable')::numeric <> 360 then
    raise exception 'FALLO paginación de subidas: %', j;
  end if;

  -- Filtros: otro proveedor no tiene subidas; la familia de pescado, tampoco.
  j := public.informe_subidas_precio(12, v_b, null, null, v_hoy, 200, 0);
  if (j ->> 'total_filas')::int <> 0 then raise exception 'FALLO filtro de proveedor en subidas: %', j -> 'filas'; end if;
  j := public.informe_subidas_precio(12, null, v_pesc, null, v_hoy, 200, 0);
  if (j ->> 'total_filas')::int <> 0 then raise exception 'FALLO filtro de familia en subidas: %', j -> 'filas'; end if;
  j := public.informe_subidas_precio(12, null, null, 'touza', v_hoy, 200, 0);
  if (j ->> 'total_filas')::int <> 0 then raise exception 'FALLO filtro de local en subidas: %', j -> 'filas'; end if;

  -- ══ Bloque 2 · Proveedor más barato ══
  j := public.informe_proveedor_mas_barato(null, null, null, v_hoy, 200, 0);
  if (select array_agg(x ->> 'producto' order by o) from jsonb_array_elements(j -> 'filas') with ordinality t(x, o))
       is distinct from array['Zzisp GAMBA', 'Zzisp ARROZ', 'Zzisp VINO'] then
    raise exception 'FALLO barato: filas y orden (gamba 300, arroz 80, vino a revisar; sin el cajón): %',
      (select jsonb_agg(x ->> 'producto') from jsonb_array_elements(j -> 'filas') x);
  end if;
  f := j -> 'filas' -> 0;   -- GAMBA
  if (f ->> 'precio')::numeric <> 50 or (f ->> 'precio_barato')::numeric <> 40 or (f ->> 'cantidad_12m')::numeric <> 30
     or (f ->> 'ahorro_anual')::numeric <> 300 or f ->> 'confianza' <> 'media' or f ->> 'motivo' not like 'Pescado, marisco%'
     or f ->> 'proveedor' <> 'PRUEBA ISP A' or f ->> 'proveedor_barato' <> 'PRUEBA ISP B' or (f -> 'doc_barato' ->> 'fecha') <> '2035-11-06' then
    raise exception 'FALLO gamba: %', f;
  end if;
  f := j -> 'filas' -> 1;   -- ARROZ
  if (f ->> 'ahorro_anual')::numeric <> 80 or (f ->> 'diferencia_pct')::numeric <> 20 or f ->> 'confianza' <> 'alta' or f ->> 'unidad' <> 'kg' then
    raise exception 'FALLO arroz (2,00 frente a 1,60 por 200 kg = 80 €, alta): %', f;
  end if;
  f := j -> 'filas' -> 2;   -- VINO
  if f ->> 'confianza' <> 'baja' or f ->> 'motivo' not like '%más barato%' or f ->> 'motivo' not like '%Una sola compra%' or f ->> 'unidad' <> 'botella' then
    raise exception 'FALLO vino (75 %% más barato y una sola compra: baja): %', f;
  end if;
  if (j -> 'totales' ->> 'ahorro_fiable')::numeric <> 380 or (j -> 'totales' ->> 'n_fiable')::int <> 2
     or (j -> 'totales' -> 'por_confianza' -> 'alta' ->> 'ahorro')::numeric <> 80
     or (j -> 'totales' -> 'por_confianza' -> 'media' ->> 'ahorro')::numeric <> 300
     or (j -> 'totales' -> 'por_confianza' -> 'baja' ->> 'n')::int <> 1
     or (j -> 'totales' ->> 'productos_varios_proveedores')::int <> 3 then
    raise exception 'FALLO totales de ahorro (solo alta + media = 380): %', j -> 'totales';
  end if;
  if (j -> 'excluidos' -> 'genericos' -> 0 ->> 'producto') <> 'Zzisp CAJON' or (j -> 'excluidos' -> 'genericos' -> 0 ->> 'motivo') not like 'Agrupa 6 líneas%' then
    raise exception 'FALLO genéricos en barato: %', j -> 'excluidos';
  end if;

  j := public.informe_proveedor_mas_barato(null, v_pesc, null, v_hoy, 200, 0);
  if (j ->> 'total_filas')::int <> 1 or (j -> 'totales' ->> 'ahorro_fiable')::numeric <> 300 then
    raise exception 'FALLO filtro de familia en barato: %', j -> 'totales';
  end if;
  j := public.informe_proveedor_mas_barato(v_c, null, null, v_hoy, 200, 0);
  if (j ->> 'total_filas')::int <> 1 or (j -> 'filas' -> 0 ->> 'producto') <> 'Zzisp VINO' then
    raise exception 'FALLO filtro de proveedor en barato (vale el caro o el barato): %', j -> 'filas';
  end if;
  j := public.informe_proveedor_mas_barato(null, null, null, v_hoy, 1, 1);
  if jsonb_array_length(j -> 'filas') <> 1 or (j -> 'filas' -> 0 ->> 'producto') <> 'Zzisp ARROZ' or (j ->> 'total_filas')::int <> 3 then
    raise exception 'FALLO paginación de barato: %', j -> 'filas';
  end if;

  -- ══ Versión corta para el chat: mismas cifras, sin documentos ni opciones de filtro ══
  j := public.informe_subidas_precio(12, null, null, null, v_hoy, 2, 0, true);
  if (j -> 'totales' ->> 'impacto_fiable')::numeric <> 360 or jsonb_array_length(j -> 'filas') <> 2 or (j ->> 'truncado')::boolean is not true
     or j ? 'proveedores' or (j -> 'filas' -> 0) ? 'doc' or (j -> 'filas' -> 0 ->> 'factura') <> 'ISP-S14' or (j -> 'filas' -> 0 ->> 'factura_ref') <> 'ISP-S2'
     or j ->> 'como_leer' not like '%impacto_fiable%' or (j -> 'excluidos' -> 'genericos' ->> 0) <> 'Zzisp CAJON' then
    raise exception 'FALLO compacto de subidas: %', j;
  end if;
  j := public.informe_proveedor_mas_barato(null, null, null, v_hoy, 10, 0, true);
  if (j -> 'totales' ->> 'ahorro_fiable')::numeric <> 380 or (j ->> 'truncado')::boolean is not false
     or (j -> 'filas' -> 0) ? 'doc_barato' or (j -> 'filas' -> 0 ->> 'factura_barato') is null then
    raise exception 'FALLO compacto de barato: %', j;
  end if;
end;
$$;

rollback;

select 'informe_subidas_proveedor_test: OK' as resultado;
