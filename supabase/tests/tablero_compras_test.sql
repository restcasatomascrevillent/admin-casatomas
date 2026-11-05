set client_encoding = 'UTF8';
-- Test de 20261105150000_tablero_compras. BEGIN … ROLLBACK: no deja nada escrito.
-- Acaba en «tablero_compras_test: OK».
--   supabase db query --linked -f supabase/tests/tablero_compras_test.sql
--
--   T1 permisos: anon no ejecuta; authenticated y service_role sí; SECURITY INVOKER.
--   T2 argumentos: local desconocido y rango al revés devuelven «error».
--   T3 datos de prueba en 2031 (periodo vacío): gasto con IVA, sin el albarán ya
--      facturado; local NULL = Casa Tomás; abonos; albaranes sin factura;
--      regalado; meses por local; top proveedores con %; subida de precio
--      (y los portes no salen); gasto fijo; filtro por local.
--   T4 periodo anterior equivalente: mes cerrado, rango suelto, «todo».
--   T5 con los datos reales de 2026: las cifras cuadran con consultas directas.
--   T6 RLS: un usuario sin permiso de Facturas recibe un tablero vacío.
begin;

do $$
declare
  v_a   bigint;
  v_b   bigint;
  v_c   bigint;
  v_f1  bigint;
  v_f2  bigint;
  v_f3  bigint;
  v_f4  bigint;
  v_alb bigint;
  v_doc bigint;
  t     jsonb;
  v_n   numeric;
  v_m   numeric;
  v_x   jsonb;
begin
  -- T1 ─────────────────────────────────────────────────────────────────────
  if has_function_privilege('anon', 'public.tablero_compras(date,date,text)', 'execute') then
    raise exception 'FALLO T1: anon puede ejecutar tablero_compras';
  end if;
  if not has_function_privilege('authenticated', 'public.tablero_compras(date,date,text)', 'execute')
     or not has_function_privilege('service_role', 'public.tablero_compras(date,date,text)', 'execute') then
    raise exception 'FALLO T1: authenticated o service_role no pueden ejecutar tablero_compras';
  end if;
  if (select prosecdef from pg_proc where oid = 'public.tablero_compras(date,date,text)'::regprocedure) then
    raise exception 'FALLO T1: tablero_compras no es SECURITY INVOKER';
  end if;
  if has_function_privilege('anon', 'public.es_linea_no_producto_tablero(text,text)', 'execute') then
    raise exception 'FALLO T1: anon puede ejecutar es_linea_no_producto_tablero';
  end if;
  if position('20261105150000' in pg_get_functiondef('public.tablero_compras(date,date,text)'::regprocedure)) = 0 then
    raise exception 'FALLO T1: tablero_compras no es la de 20261105150000';
  end if;

  -- T2 ─────────────────────────────────────────────────────────────────────
  if tablero_compras('2026-01-01', '2026-12-31', 'otro')::jsonb ->> 'error' is null then
    raise exception 'FALLO T2: un local desconocido no da error';
  end if;
  if tablero_compras('2026-12-31', '2026-01-01')::jsonb ->> 'error' is null then
    raise exception 'FALLO T2: desde > hasta no da error';
  end if;
  if not es_linea_no_producto_tablero('PORTES', 'ud') or not es_linea_no_producto_tablero('ENVASE AMSTEL 1/3 * 24', 'caja')
     or not es_linea_no_producto_tablero('termino potencia', 'kw') or not es_linea_no_producto_tablero('Alquiler local', 'ud')
     or es_linea_no_producto_tablero('TOMATE RAF', 'kg') or es_linea_no_producto_tablero('PAN DE CRISTAL', 'ud') then
    raise exception 'FALLO T2: es_linea_no_producto_tablero clasifica mal';
  end if;

  -- T3 datos ───────────────────────────────────────────────────────────────
  if exists (select 1 from facturas where fecha between '2030-10-01' and '2031-03-31') then
    raise exception 'FALLO datos: ya hay documentos en 2030-10 … 2031-03; el test necesita ese periodo vacío';
  end if;
  insert into proveedores (nombre, cif) values ('PRUEBA TABLERO MAYORISTA SL', 'B00000151') returning id into v_a;
  insert into proveedores (nombre, cif) values ('PRUEBA TABLERO TOUZA SL', 'B00000152') returning id into v_b;
  insert into proveedores (nombre, cif) values ('PRUEBA TABLERO ALQUILERES SL', 'B00000153') returning id into v_c;

  -- Mayorista (Casa Tomás; una con local NULL).
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
  values ('factura', 'PRUEBA TABLERO MAYORISTA SL', 'B00000151', v_a, 'TAB-1', '2031-01-10', 1000, null) returning id into v_f1;
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
  values ('factura', 'PRUEBA TABLERO MAYORISTA SL', 'B00000151', v_a, 'TAB-2', '2031-01-12', 100, 'casa_tomas') returning id into v_f2;
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
  values ('factura', 'PRUEBA TABLERO MAYORISTA SL', 'B00000151', v_a, 'TAB-3', '2031-03-10', 500, 'casa_tomas') returning id into v_f3;
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
  values ('factura', 'PRUEBA TABLERO MAYORISTA SL', 'B00000151', v_a, 'TAB-4', '2031-03-20', 100, 'casa_tomas') returning id into v_f4;
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
  values ('factura', 'PRUEBA TABLERO MAYORISTA SL', 'B00000151', v_a, 'TAB-AB', '2031-02-10', -100, 'casa_tomas');
  -- Albarán ya facturado (no suma) y albarán sin factura (suma).
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
  values ('albaran', 'PRUEBA TABLERO MAYORISTA SL', 'B00000151', v_a, 'TAB-ALB-1', '2031-01-05', 200, 'casa_tomas') returning id into v_alb;
  update facturas set facturado_en_id = v_f1, facturado_origen = 'manual' where id = v_alb;
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
  values ('albaran', 'PRUEBA TABLERO MAYORISTA SL', 'B00000151', v_a, 'TAB-ALB-2', '2031-03-15', 50, 'casa_tomas');
  -- Touza.
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
  values ('factura', 'PRUEBA TABLERO TOUZA SL', 'B00000152', v_b, 'TAB-TZ', '2031-02-20', 300, 'touza');
  -- Alquiler: una factura al mes, siempre 400.
  for i in 1..3 loop
    insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
    values ('factura', 'PRUEBA TABLERO ALQUILERES SL', 'B00000153', v_c, 'TAB-ALQ-' || i, make_date(2031, i, 1), 400, 'casa_tomas')
    returning id into v_doc;
    -- nombre_normalizado es columna generada.
    insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total)
    values (v_doc, 'Alquiler local', 1, 'ud', 330.58, 330.58);
  end loop;

  -- Líneas: producto X a 2 € en enero y a 3 € en marzo (+50 %); portes que también suben.
  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, importe_bruto)
  values (v_f1, 'PRODUCTO PRUEBA TABLERO', 10, 'kg', 2, 20, 25),
         (v_f2, 'PRODUCTO PRUEBA TABLERO', 10, 'kg', 2, 20, null),
         (v_f3, 'PRODUCTO PRUEBA TABLERO', 10, 'kg', 3, 30, null),
         (v_f4, 'PRODUCTO PRUEBA TABLERO', 10, 'kg', 3, 30, null),
         (v_f1, 'PORTES', 1, 'ud', 5, 5, null),
         (v_f2, 'PORTES', 1, 'ud', 5, 5, null),
         (v_f3, 'PORTES', 1, 'ud', 50, 50, null),
         (v_f4, 'PORTES', 1, 'ud', 50, 50, null);

  -- T3 ─────────────────────────────────────────────────────────────────────
  t := tablero_compras('2031-01-01', '2031-03-31')::jsonb;
  if (t -> 'indicadores' ->> 'gasto')::numeric <> 3150 then
    raise exception 'FALLO T3: gasto % (esperado 3150: sin el albarán ya facturado)', t -> 'indicadores' ->> 'gasto';
  end if;
  if (t -> 'indicadores' ->> 'documentos')::int <> 10 then
    raise exception 'FALLO T3: documentos % (esperado 10)', t -> 'indicadores' ->> 'documentos';
  end if;
  if (t -> 'indicadores' ->> 'abonos')::numeric <> -100 or (t -> 'indicadores' ->> 'abonos_n')::int <> 1 then
    raise exception 'FALLO T3: abonos % / %', t -> 'indicadores' ->> 'abonos', t -> 'indicadores' ->> 'abonos_n';
  end if;
  if (t -> 'indicadores' ->> 'albaranes_sin_factura')::int <> 1
     or (t -> 'indicadores' ->> 'albaranes_sin_factura_importe')::numeric <> 50 then
    raise exception 'FALLO T3: albaranes sin factura %', t -> 'indicadores';
  end if;
  if (t -> 'indicadores' ->> 'regalado')::numeric <> 5 or (t -> 'indicadores' ->> 'regalado_valia')::numeric <> 25 then
    raise exception 'FALLO T3: regalado % / valía %', t -> 'indicadores' ->> 'regalado', t -> 'indicadores' ->> 'regalado_valia';
  end if;
  if t -> 'indicadores' ->> 'variacion_pct' is not null then
    raise exception 'FALLO T3: sin periodo anterior no debe haber variación';
  end if;
  if jsonb_array_length(t -> 'meses') <> 3
     or (t -> 'meses' -> 0 ->> 'casa_tomas')::numeric <> 1500 or (t -> 'meses' -> 0 ->> 'touza')::numeric <> 0
     or (t -> 'meses' -> 1 ->> 'casa_tomas')::numeric <> 300 or (t -> 'meses' -> 1 ->> 'touza')::numeric <> 300
     or (t -> 'meses' -> 2 ->> 'casa_tomas')::numeric <> 1050 or (t -> 'meses' -> 2 ->> 'total')::numeric <> 1050 then
    raise exception 'FALLO T3: meses %', t -> 'meses';
  end if;
  if (t -> 'proveedores' -> 0 ->> 'id')::bigint <> v_a or (t -> 'proveedores' -> 0 ->> 'gasto')::numeric <> 1650
     or (t -> 'proveedores' -> 0 ->> 'pct')::numeric <> 52.4
     or (t -> 'proveedores' -> 1 ->> 'id')::bigint <> v_c or (t -> 'proveedores' -> 2 ->> 'id')::bigint <> v_b then
    raise exception 'FALLO T3: proveedores %', t -> 'proveedores';
  end if;
  if jsonb_array_length(t -> 'subidas' -> 'productos') <> 1
     or t -> 'subidas' -> 'productos' -> 0 ->> 'nombre_normalizado' <> 'producto prueba tablero'
     or (t -> 'subidas' -> 'productos' -> 0 ->> 'variacion_pct')::numeric <> 50
     or (t -> 'subidas' -> 'productos' -> 0 ->> 'proveedor_id')::bigint <> v_a then
    raise exception 'FALLO T3: subidas % (los portes no deben salir)', t -> 'subidas';
  end if;
  if jsonb_array_length(t -> 'fijos' -> 'proveedores') <> 1
     or (t -> 'fijos' -> 'proveedores' -> 0 ->> 'id')::bigint <> v_c
     or (t -> 'fijos' -> 'proveedores' -> 0 ->> 'medio_mes')::numeric <> 400 then
    raise exception 'FALLO T3: fijos %', t -> 'fijos';
  end if;
  if (t -> 'abonos' -> 0 ->> 'id')::bigint <> v_a or (t -> 'abonos' -> 0 ->> 'importe')::numeric <> -100 then
    raise exception 'FALLO T3: abonos por proveedor %', t -> 'abonos';
  end if;
  if (t -> 'locales' -> 'casa_tomas' ->> 'gasto')::numeric <> 2850 or (t -> 'locales' -> 'touza' ->> 'gasto')::numeric <> 300
     or (t -> 'locales' -> 'touza' ->> 'documentos')::int <> 1 then
    raise exception 'FALLO T3: locales %', t -> 'locales';
  end if;
  if (t -> 'familias' -> 'sin_clasificar' ->> 'lineas')::int > (t -> 'familias' ->> 'lineas')::int
     or (t -> 'familias' ->> 'lineas')::int <> 11 then
    raise exception 'FALLO T3: familias %', t -> 'familias';
  end if;
  -- Filtro por local: Touza solo ve lo suyo; «locales» sigue enseñando los dos.
  t := tablero_compras('2031-01-01', '2031-03-31', 'touza')::jsonb;
  if (t -> 'indicadores' ->> 'gasto')::numeric <> 300 or (t -> 'locales' -> 'casa_tomas' ->> 'gasto')::numeric <> 2850 then
    raise exception 'FALLO T3: filtro Touza %', t -> 'indicadores';
  end if;
  t := tablero_compras('2031-01-01', '2031-03-31', 'casa_tomas')::jsonb;
  if (t -> 'indicadores' ->> 'gasto')::numeric <> 2850 then
    raise exception 'FALLO T3: filtro Casa Tomás (local NULL incluido) %', t -> 'indicadores' ->> 'gasto';
  end if;

  -- T4 ─────────────────────────────────────────────────────────────────────
  t := tablero_compras('2031-03-01', '2031-03-31')::jsonb;
  if t -> 'periodo' -> 'anterior' <> '{"desde": "2031-02-01", "hasta": "2031-02-28"}'::jsonb then
    raise exception 'FALLO T4: anterior de marzo %', t -> 'periodo' -> 'anterior';
  end if;
  if (t -> 'indicadores' ->> 'gasto_anterior')::numeric <> 600 then
    raise exception 'FALLO T4: gasto anterior %', t -> 'indicadores' ->> 'gasto_anterior';
  end if;
  -- marzo 1050 (4 documentos) frente a febrero 600 (3: comparable) → +75 %.
  if (t -> 'indicadores' ->> 'variacion_pct')::numeric <> 75 then
    raise exception 'FALLO T4: variación %', t -> 'indicadores' ->> 'variacion_pct';
  end if;
  t := tablero_compras('2031-01-01', '2031-03-31')::jsonb;
  if t -> 'periodo' -> 'anterior' <> '{"desde": "2030-10-01", "hasta": "2030-12-31"}'::jsonb then
    raise exception 'FALLO T4: anterior del trimestre %', t -> 'periodo' -> 'anterior';
  end if;
  t := tablero_compras('2031-02-10', '2031-02-19')::jsonb;
  if t -> 'periodo' -> 'anterior' <> '{"desde": "2031-01-31", "hasta": "2031-02-09"}'::jsonb then
    raise exception 'FALLO T4: anterior de un rango suelto %', t -> 'periodo' -> 'anterior';
  end if;
  t := tablero_compras(null, null)::jsonb;
  if t -> 'periodo' -> 'anterior' <> 'null'::jsonb or (t -> 'periodo' ->> 'hasta')::date < '2031-03-20' then
    raise exception 'FALLO T4: «todo» %', t -> 'periodo';
  end if;

  -- T5 datos reales de 2026 ────────────────────────────────────────────────
  t := tablero_compras('2026-01-01', '2026-12-31')::jsonb;
  select coalesce(sum(coalesce(total, 0)), 0) into v_n from facturas
   where fecha between '2026-01-01' and '2026-12-31' and not (tipo = 'albaran' and facturado_en_id is not null);
  if (t -> 'indicadores' ->> 'gasto')::numeric <> round(v_n, 2) then
    raise exception 'FALLO T5: gasto 2026 % ≠ consulta directa %', t -> 'indicadores' ->> 'gasto', v_n;
  end if;
  select coalesce(sum(x.v::numeric), 0) into v_m from jsonb_array_elements(t -> 'meses') e, lateral (select e ->> 'total' as v) x;
  if abs(v_m - (t -> 'indicadores' ->> 'gasto')::numeric) > 0.05 then
    raise exception 'FALLO T5: la suma de los meses (%) no cuadra con el gasto', v_m;
  end if;
  if abs((t -> 'locales' -> 'casa_tomas' ->> 'gasto')::numeric + (t -> 'locales' -> 'touza' ->> 'gasto')::numeric
         - (t -> 'indicadores' ->> 'gasto')::numeric) > 0.05 then
    raise exception 'FALLO T5: Casa Tomás + Touza no cuadra con el gasto';
  end if;
  select coalesce(sum(total), 0) into v_n from facturas
   where fecha between '2026-01-01' and '2026-12-31' and total < 0 and not (tipo = 'albaran' and facturado_en_id is not null);
  if (t -> 'indicadores' ->> 'abonos')::numeric <> round(v_n, 2) then
    raise exception 'FALLO T5: abonos % ≠ %', t -> 'indicadores' ->> 'abonos', v_n;
  end if;
  select coalesce(sum(pf.importe_bruto - pf.total), 0) into v_n
    from productos_factura pf join facturas f on f.id = pf.factura_id
   where f.fecha between '2026-01-01' and '2026-12-31' and pf.importe_bruto > pf.total
     and not (f.tipo = 'albaran' and f.facturado_en_id is not null);
  if (t -> 'indicadores' ->> 'regalado')::numeric <> round(v_n, 2) then
    raise exception 'FALLO T5: regalado % ≠ %', t -> 'indicadores' ->> 'regalado', v_n;
  end if;
  for v_x in select * from jsonb_array_elements(t -> 'subidas' -> 'productos') loop
    if es_linea_no_producto_tablero(v_x ->> 'nombre_normalizado', v_x ->> 'unidad') or (v_x ->> 'variacion_pct')::numeric <= 0 then
      raise exception 'FALLO T5: subida que no es producto o no sube: %', v_x;
    end if;
  end loop;
  if jsonb_array_length(t -> 'proveedores') > 10 then
    raise exception 'FALLO T5: más de 10 proveedores';
  end if;

  -- T6 RLS ─────────────────────────────────────────────────────────────────
  perform set_config('request.jwt.claims', '{"role": "authenticated"}', true);
  set local role authenticated;
  t := tablero_compras('2031-01-01', '2031-03-31')::jsonb;
  reset role;
  if (t ->> 'sin_datos')::boolean is distinct from true or (t -> 'indicadores' ->> 'gasto')::numeric <> 0 then
    raise exception 'FALLO T6: un usuario sin permiso ve datos: %', t -> 'indicadores';
  end if;
end;
$$;

rollback;

select 'tablero_compras_test: OK' as resultado;
