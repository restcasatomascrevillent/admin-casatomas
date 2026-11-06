set client_encoding = 'UTF8';
-- Test de 20261105170000_explorar_compras. BEGIN … ROLLBACK: no deja nada escrito.
-- Acaba en «explorar_compras_test: OK».
--   supabase db query --linked -f supabase/tests/explorar_compras_test.sql
--
--   E1 permisos: anon no ejecuta nada; authenticated y service_role sí; SECURITY INVOKER.
--   E2 parámetros inválidos (listas blancas): medida, eje, desglose, filtros,
--      top, combinaciones imposibles, rango al revés, demasiados días, límites.
--   E3 datos de prueba en 2031 (periodo vacío): gasto por mes / local / tipo /
--      proveedor (top + resto), abonos en positivo, documentos, base por
--      familia (raíz + sin clasificar), producto sin portes, precio y cantidad
--      con la unidad más usada, regalado, filtro por local, días y semanas.
--   E4 periodo anterior y variación.
--   E5 documentos_de_cifra: la suma de lo que aporta cada documento CUADRA con
--      la cifra de explorar_compras (mes, mes × local, familia, «Otros»,
--      precio, abonos) y la paginación recorre todo.
--   E6 datos reales de 2026: cuadra con tablero_compras y con consultas directas.
--   E7 RLS: un usuario sin permiso de Facturas no ve nada.
begin;

do $$
declare
  v_a    bigint;
  v_b    bigint;
  v_c    bigint;
  v_raiz bigint;
  v_hijo bigint;
  v_p1   bigint;
  v_p2   bigint;
  v_f1   bigint;
  v_f2   bigint;
  v_f3   bigint;
  v_f4   bigint;
  v_tz   bigint;
  v_alb  bigint;
  v_doc  bigint;
  e      jsonb;
  d      jsonb;
  t      jsonb;
  v_n    numeric;
  v_m    numeric;
  v_i    int;
  v_x    jsonb;
  v_fn   text;
begin
  -- E1 ─────────────────────────────────────────────────────────────────────
  foreach v_fn in array array[
    'public.explorar_compras(date,date,text,text,text,jsonb,integer)',
    'public.documentos_de_cifra(date,date,text,text,text,jsonb,text,text,integer,integer,integer)',
    'public.explorar_compras_hechos(date,date,text,text,text,jsonb)',
    'public.explorar_compras_error(text,text,text,jsonb,integer)',
    'public.explorar_compras_clave(text,date,text,text,text,bigint,text)',
    'public.explorar_compras_etiqueta(text,text,bigint,text,text)',
    'public.explorar_compras_por_lineas(text,text,text,jsonb)'] loop
    if has_function_privilege('anon', v_fn, 'execute') then
      raise exception 'FALLO E1: anon puede ejecutar %', v_fn;
    end if;
    if not has_function_privilege('authenticated', v_fn, 'execute') or not has_function_privilege('service_role', v_fn, 'execute') then
      raise exception 'FALLO E1: authenticated o service_role no pueden ejecutar %', v_fn;
    end if;
    if (select prosecdef from pg_proc where oid = v_fn::regprocedure) then
      raise exception 'FALLO E1: % no es SECURITY INVOKER', v_fn;
    end if;
  end loop;
  if position('20261105170000' in pg_get_functiondef('public.explorar_compras(date,date,text,text,text,jsonb,integer)'::regprocedure)) = 0 then
    raise exception 'FALLO E1: explorar_compras no es la de 20261105170000';
  end if;

  -- E2 ─────────────────────────────────────────────────────────────────────
  if explorar_compras('2026-01-01', '2026-12-31', 'beneficio', 'mes')::jsonb ->> 'error' is null then raise exception 'FALLO E2: medida desconocida'; end if;
  if explorar_compras('2026-01-01', '2026-12-31', 'gasto', 'hora')::jsonb ->> 'error' is null then raise exception 'FALLO E2: agrupar desconocido'; end if;
  if explorar_compras('2026-01-01', '2026-12-31', 'gasto', null)::jsonb ->> 'error' is null then raise exception 'FALLO E2: agrupar null'; end if;
  if explorar_compras('2026-01-01', '2026-12-31', 'gasto', 'mes; drop table facturas')::jsonb ->> 'error' is null then raise exception 'FALLO E2: agrupar con SQL'; end if;
  if explorar_compras('2026-01-01', '2026-12-31', 'gasto', 'local', 'local')::jsonb ->> 'error' is null then raise exception 'FALLO E2: desglose = agrupar'; end if;
  if explorar_compras('2026-01-01', '2026-12-31', 'gasto', 'proveedor', 'mes')::jsonb ->> 'error' is null then raise exception 'FALLO E2: desglose por tiempo'; end if;
  if explorar_compras('2026-01-01', '2026-12-31', 'gasto', 'mes', null, '{"clave":"1"}')::jsonb ->> 'error' is null then raise exception 'FALLO E2: filtro desconocido'; end if;
  if explorar_compras('2026-01-01', '2026-12-31', 'gasto', 'mes', null, '[]')::jsonb ->> 'error' is null then raise exception 'FALLO E2: filtros no objeto'; end if;
  if explorar_compras('2026-01-01', '2026-12-31', 'gasto', 'mes', null, '{"proveedores":["1"]}')::jsonb ->> 'error' is null then raise exception 'FALLO E2: proveedores como texto'; end if;
  if explorar_compras('2026-01-01', '2026-12-31', 'gasto', 'mes', null, '{"proveedores":[-3]}')::jsonb ->> 'error' is null then raise exception 'FALLO E2: proveedor negativo'; end if;
  if explorar_compras('2026-01-01', '2026-12-31', 'gasto', 'mes', null, '{"tipos":["pedido"]}')::jsonb ->> 'error' is null then raise exception 'FALLO E2: tipo desconocido'; end if;
  if explorar_compras('2026-01-01', '2026-12-31', 'gasto', 'mes', null, '{"local":"bar"}')::jsonb ->> 'error' is null then raise exception 'FALLO E2: local desconocido'; end if;
  if explorar_compras('2026-01-01', '2026-12-31', 'gasto', 'mes', null, '{}', 0)::jsonb ->> 'error' is null then raise exception 'FALLO E2: top 0'; end if;
  if explorar_compras('2026-01-01', '2026-12-31', 'gasto', 'mes', null, '{}', 51)::jsonb ->> 'error' is null then raise exception 'FALLO E2: top 51'; end if;
  if explorar_compras('2026-01-01', '2026-12-31', 'gasto', 'familia')::jsonb ->> 'error' is null then raise exception 'FALLO E2: gasto por familia'; end if;
  if explorar_compras('2026-01-01', '2026-12-31', 'abonos', 'mes', null, '{"productos":["gamba"]}')::jsonb ->> 'error' is null then raise exception 'FALLO E2: abonos de un producto'; end if;
  if explorar_compras('2026-01-01', '2026-12-31', 'precio', 'mes')::jsonb ->> 'error' is null then raise exception 'FALLO E2: precio sin producto'; end if;
  if explorar_compras('2026-12-31', '2026-01-01', 'gasto', 'mes')::jsonb ->> 'error' is null then raise exception 'FALLO E2: desde > hasta'; end if;
  if explorar_compras('2024-01-01', '2026-12-31', 'gasto', 'dia')::jsonb ->> 'error' is null then raise exception 'FALLO E2: demasiados días'; end if;
  if documentos_de_cifra('2026-01-01', '2026-12-31', 'gasto', null, null, '{}', '2026-01')::jsonb ->> 'error' is null then raise exception 'FALLO E2: clave sin agrupar'; end if;
  if documentos_de_cifra('2026-01-01', '2026-12-31', 'gasto', 'mes', null, '{}', null, 'touza')::jsonb ->> 'error' is null then raise exception 'FALLO E2: clave_desglose sin desglose'; end if;
  if documentos_de_cifra('2026-01-01', '2026-12-31', 'gasto', p_limite => 0)::jsonb ->> 'error' is null then raise exception 'FALLO E2: limite 0'; end if;
  if documentos_de_cifra('2026-01-01', '2026-12-31', 'gasto', p_limite => 201)::jsonb ->> 'error' is null then raise exception 'FALLO E2: limite 201'; end if;
  if documentos_de_cifra('2026-01-01', '2026-12-31', 'gasto', p_desplazamiento => -1)::jsonb ->> 'error' is null then raise exception 'FALLO E2: desplazamiento negativo'; end if;
  begin
    perform * from explorar_compras_hechos('2026-01-01', '2026-12-31', 'gasto; select 1', null, null, '{}');
    raise exception 'FALLO E2: explorar_compras_hechos acepta una medida desconocida';
  exception when invalid_parameter_value then null;
  end;

  -- E3 datos ───────────────────────────────────────────────────────────────
  if exists (select 1 from facturas where fecha between '2030-10-01' and '2031-03-31') then
    raise exception 'FALLO datos: ya hay documentos en 2030-10 … 2031-03; el test necesita ese periodo vacío';
  end if;
  insert into proveedores (nombre, cif) values ('PRUEBA EXPLORAR MAYORISTA SL', 'B00000171') returning id into v_a;
  insert into proveedores (nombre, cif) values ('PRUEBA EXPLORAR TOUZA SL', 'B00000172') returning id into v_b;
  insert into proveedores (nombre, cif) values ('PRUEBA EXPLORAR ALQUILERES SL', 'B00000173') returning id into v_c;
  insert into categorias_producto (clave, nombre, orden) values ('prueba_explorar', 'Prueba explorar', 999) returning id into v_raiz;
  insert into categorias_producto (clave, nombre, padre_id, orden) values ('prueba_explorar_hijo', 'Prueba explorar hija', v_raiz, 999) returning id into v_hijo;
  insert into productos_catalogo (nombre, categoria_id) values ('Producto prueba explorar', v_hijo) returning id into v_p1;
  insert into productos_catalogo (nombre, categoria_id) values ('Cerveza prueba explorar', null) returning id into v_p2;

  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
  values ('factura', 'PRUEBA EXPLORAR MAYORISTA SL', 'B00000171', v_a, 'EXP-1', '2031-01-10', 1000, null) returning id into v_f1;
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
  values ('factura', 'PRUEBA EXPLORAR MAYORISTA SL', 'B00000171', v_a, 'EXP-2', '2031-01-12', 100, 'casa_tomas') returning id into v_f2;
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
  values ('factura', 'PRUEBA EXPLORAR MAYORISTA SL', 'B00000171', v_a, 'EXP-3', '2031-03-10', 500, 'casa_tomas') returning id into v_f3;
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
  values ('factura', 'PRUEBA EXPLORAR MAYORISTA SL', 'B00000171', v_a, 'EXP-4', '2031-03-20', 100, 'casa_tomas') returning id into v_f4;
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
  values ('factura', 'PRUEBA EXPLORAR MAYORISTA SL', 'B00000171', v_a, 'EXP-AB', '2031-02-10', -100, 'casa_tomas');
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
  values ('albaran', 'PRUEBA EXPLORAR MAYORISTA SL', 'B00000171', v_a, 'EXP-ALB-1', '2031-01-05', 200, 'casa_tomas') returning id into v_alb;
  update facturas set facturado_en_id = v_f1, facturado_origen = 'manual' where id = v_alb;
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
  values ('albaran', 'PRUEBA EXPLORAR MAYORISTA SL', 'B00000171', v_a, 'EXP-ALB-2', '2031-03-15', 50, 'casa_tomas');
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
  values ('factura', 'PRUEBA EXPLORAR TOUZA SL', 'B00000172', v_b, 'EXP-TZ', '2031-02-20', 300, 'touza') returning id into v_tz;
  for i in 1..3 loop
    insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
    values ('factura', 'PRUEBA EXPLORAR ALQUILERES SL', 'B00000173', v_c, 'EXP-ALQ-' || i, make_date(2031, i, 1), 400, 'casa_tomas');
  end loop;

  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, importe_bruto, producto_id)
  values (v_f1, 'PRODUCTO PRUEBA EXPLORAR', 10, 'kg', 2, 20, 25, v_p1),
         (v_f2, 'PRODUCTO PRUEBA EXPLORAR', 10, 'kg', 2, 20, null, v_p1),
         (v_f3, 'PRODUCTO PRUEBA EXPLORAR', 10, 'KG', 3, 30, null, v_p1),
         (v_f4, 'PRODUCTO PRUEBA EXPLORAR', 5, 'ud', 4, 20, null, v_p1),
         (v_f1, 'PORTES', 1, 'ud', 5, 5, null, null),
         (v_tz, 'CERVEZA PRUEBA EXPLORAR', 24, 'ud', 1, 24, null, v_p2),
         (v_alb, 'PRODUCTO PRUEBA EXPLORAR', 10, 'kg', 100, 1000, null, v_p1);

  -- E3 ─────────────────────────────────────────────────────────────────────
  e := explorar_compras('2031-01-01', '2031-03-31', 'gasto', 'mes')::jsonb;
  if (e -> 'total' ->> 'valor')::numeric <> 3150 or (e -> 'total' ->> 'documentos')::int <> 10 then
    raise exception 'FALLO E3: gasto total % (esperado 3150 y 10 documentos, sin el albarán facturado)', e -> 'total';
  end if;
  if jsonb_array_length(e -> 'puntos') <> 3
     or e -> 'puntos' -> 0 ->> 'clave' <> '2031-01' or (e -> 'puntos' -> 0 ->> 'valor')::numeric <> 1500
     or (e -> 'puntos' -> 1 ->> 'valor')::numeric <> 600 or (e -> 'puntos' -> 2 ->> 'valor')::numeric <> 1050 then
    raise exception 'FALLO E3: gasto por mes %', e -> 'puntos';
  end if;
  e := explorar_compras('2031-01-01', '2031-03-31', 'gasto', 'mes', 'local')::jsonb;
  if (e -> 'puntos' -> 1 -> 'desglose' ->> 'touza')::numeric <> 300 or (e -> 'puntos' -> 1 -> 'desglose' ->> 'casa_tomas')::numeric <> 300
     or (e -> 'puntos' -> 0 -> 'desglose' ->> 'casa_tomas')::numeric <> 1500 or e -> 'puntos' -> 0 -> 'desglose' ? 'touza'
     or jsonb_array_length(e -> 'series') <> 2 or e -> 'series' -> 0 ->> 'etiqueta' <> 'Casa Tomás' then
    raise exception 'FALLO E3: mes × local % / series %', e -> 'puntos', e -> 'series';
  end if;
  e := explorar_compras('2031-01-01', '2031-03-31', 'gasto', 'proveedor', null, '{}', 2)::jsonb;
  if jsonb_array_length(e -> 'puntos') <> 2
     or (e -> 'puntos' -> 0 ->> 'id')::bigint <> v_a or (e -> 'puntos' -> 0 ->> 'valor')::numeric <> 1650
     or (e -> 'puntos' -> 1 ->> 'id')::bigint <> v_c or (e -> 'puntos' -> 1 ->> 'valor')::numeric <> 1200
     or (e -> 'resto' ->> 'entidades')::int <> 1 or (e -> 'resto' ->> 'valor')::numeric <> 300 then
    raise exception 'FALLO E3: top proveedores % / resto %', e -> 'puntos', e -> 'resto';
  end if;
  e := explorar_compras('2031-01-01', '2031-03-31', 'gasto', 'tipo')::jsonb;
  if (select (p ->> 'valor')::numeric from jsonb_array_elements(e -> 'puntos') p where p ->> 'clave' = 'factura') <> 3200
     or (select (p ->> 'valor')::numeric from jsonb_array_elements(e -> 'puntos') p where p ->> 'clave' = 'albaran') <> 50
     or (select (p ->> 'valor')::numeric from jsonb_array_elements(e -> 'puntos') p where p ->> 'clave' = 'abono') <> -100 then
    raise exception 'FALLO E3: por tipo %', e -> 'puntos';
  end if;
  e := explorar_compras('2031-01-01', '2031-03-31', 'abonos', 'proveedor')::jsonb;
  if jsonb_array_length(e -> 'puntos') <> 1 or (e -> 'puntos' -> 0 ->> 'valor')::numeric <> 100 or (e -> 'total' ->> 'valor')::numeric <> 100 then
    raise exception 'FALLO E3: abonos (en positivo) %', e -> 'puntos';
  end if;
  e := explorar_compras('2031-01-01', '2031-03-31', 'documentos', 'local')::jsonb;
  if (e -> 'total' ->> 'valor')::int <> 10 or (e -> 'puntos' -> 0 ->> 'valor')::int <> 9 or (e -> 'puntos' -> 1 ->> 'valor')::int <> 1 then
    raise exception 'FALLO E3: documentos por local %', e -> 'puntos';
  end if;
  e := explorar_compras('2031-01-01', '2031-03-31', 'base', 'familia')::jsonb;
  if (e -> 'total' ->> 'valor')::numeric <> 119
     or (select (p ->> 'valor')::numeric from jsonb_array_elements(e -> 'puntos') p where (p ->> 'id')::bigint = v_raiz) <> 90
     -- (los PORTES pueden caer en «Servicios» si el catálogo los reconoce: solo se exige la cerveza sin familia)
     or (select (p ->> 'valor')::numeric from jsonb_array_elements(e -> 'puntos') p where p ->> 'clave' = '0') < 24
     or (select p ->> 'etiqueta' from jsonb_array_elements(e -> 'puntos') p where p ->> 'clave' = '0') <> 'Sin clasificar'
     or (e -> 'parametros' ->> 'por_lineas')::boolean is not true then
    raise exception 'FALLO E3: base por familia (raíz y sin clasificar) %', e -> 'puntos';
  end if;
  v_m := (select (p ->> 'valor')::numeric from jsonb_array_elements(e -> 'puntos') p where p ->> 'clave' = '0');
  e := explorar_compras('2031-01-01', '2031-03-31', 'base', 'mes', null, jsonb_build_object('familias', jsonb_build_array(v_raiz)))::jsonb;
  if (e -> 'total' ->> 'valor')::numeric <> 90 then raise exception 'FALLO E3: filtro familia %', e -> 'total'; end if;
  e := explorar_compras('2031-01-01', '2031-03-31', 'base', 'mes', null, '{"familias":[0]}')::jsonb;
  if (e -> 'total' ->> 'valor')::numeric <> v_m then raise exception 'FALLO E3: filtro sin clasificar % ≠ %', e -> 'total', v_m; end if;
  e := explorar_compras('2031-01-01', '2031-03-31', 'base', 'producto')::jsonb;
  if (e -> 'total' ->> 'valor')::numeric <> 114 or (e -> 'parametros' ->> 'solo_productos')::boolean is not true
     or exists (select 1 from jsonb_array_elements(e -> 'puntos') p where p ->> 'clave' = 'portes') then
    raise exception 'FALLO E3: base por producto sin portes %', e -> 'puntos';
  end if;
  e := explorar_compras('2031-01-01', '2031-03-31', 'precio', 'mes', null, '{"productos":["Producto prueba explorar"]}')::jsonb;
  if e -> 'parametros' ->> 'unidad' <> 'kg' or (e -> 'total' ->> 'valor')::numeric <> 2.3333
     or (e -> 'puntos' -> 0 ->> 'valor')::numeric <> 2 or (e -> 'puntos' -> 2 ->> 'valor')::numeric <> 3
     or e -> 'puntos' -> 1 ->> 'valor' is not null
     or jsonb_array_length(e -> 'unidades') <> 2 or e -> 'unidades' -> 0 ->> 'unidad' <> 'kg' then
    raise exception 'FALLO E3: precio medio en kg % / %', e -> 'total', e -> 'puntos';
  end if;
  e := explorar_compras('2031-01-01', '2031-03-31', 'cantidad', 'mes', null, '{"productos":["PRODUCTO PRUEBA EXPLORAR"],"unidad":"ud"}')::jsonb;
  if (e -> 'total' ->> 'valor')::numeric <> 5 then raise exception 'FALLO E3: cantidad en ud %', e -> 'total'; end if;
  e := explorar_compras('2031-01-01', '2031-03-31', 'regalado', 'proveedor')::jsonb;
  if (e -> 'total' ->> 'valor')::numeric <> 5 then raise exception 'FALLO E3: regalado %', e -> 'total'; end if;
  e := explorar_compras('2031-01-01', '2031-03-31', 'gasto', 'proveedor', null, '{"local":"touza"}')::jsonb;
  if (e -> 'total' ->> 'valor')::numeric <> 300 or (e -> 'puntos' -> 0 ->> 'id')::bigint <> v_b then
    raise exception 'FALLO E3: filtro Touza %', e -> 'total';
  end if;
  e := explorar_compras('2031-01-01', '2031-03-31', 'gasto', 'mes', null, '{"local":"casa_tomas"}')::jsonb;
  if (e -> 'total' ->> 'valor')::numeric <> 2850 then raise exception 'FALLO E3: filtro Casa Tomás (NULL incluido) %', e -> 'total'; end if;
  e := explorar_compras('2031-01-01', '2031-03-31', 'gasto', 'dia')::jsonb;
  if jsonb_array_length(e -> 'puntos') <> 90 or (e -> 'puntos' -> 9 ->> 'valor')::numeric <> 1000 then
    raise exception 'FALLO E3: por día % puntos', jsonb_array_length(e -> 'puntos');
  end if;
  e := explorar_compras('2031-01-01', '2031-03-31', 'gasto', 'semana')::jsonb;
  select sum((p ->> 'valor')::numeric) into v_n from jsonb_array_elements(e -> 'puntos') p;
  if v_n <> 3150 or e -> 'puntos' -> 0 ->> 'clave' <> '2030-12-30' then
    raise exception 'FALLO E3: por semana (suma %, primera %)', v_n, e -> 'puntos' -> 0 ->> 'clave';
  end if;
  e := explorar_compras('2031-01-01', '2031-03-31', 'gasto', 'trimestre')::jsonb;
  if e -> 'puntos' -> 0 ->> 'clave' <> '2031-T1' or (e -> 'puntos' -> 0 ->> 'valor')::numeric <> 3150 then
    raise exception 'FALLO E3: por trimestre %', e -> 'puntos';
  end if;

  -- E4 ─────────────────────────────────────────────────────────────────────
  e := explorar_compras('2031-03-01', '2031-03-31', 'gasto', 'proveedor')::jsonb;
  if e -> 'anterior' ->> 'desde' <> '2031-02-01' or (e -> 'anterior' ->> 'valor')::numeric <> 600
     or (e -> 'total' ->> 'variacion_pct')::numeric <> 75 then
    raise exception 'FALLO E4: anterior % / total %', e -> 'anterior', e -> 'total';
  end if;

  -- E5 documentos_de_cifra ─────────────────────────────────────────────────
  d := documentos_de_cifra('2031-01-01', '2031-03-31', 'gasto', 'mes', null, '{}', '2031-02')::jsonb;
  select sum((r ->> 'importe_aportado')::numeric) into v_n from jsonb_array_elements(d -> 'filas') r;
  if (d ->> 'cifra')::numeric <> 600 or (d ->> 'documentos')::int <> 3 or v_n <> 600 then
    raise exception 'FALLO E5: documentos de febrero %', d;
  end if;
  if (d -> 'filas' -> 0 ->> 'fecha')::date < (d -> 'filas' -> 2 ->> 'fecha')::date
     or (select count(*) from jsonb_array_elements(d -> 'filas') r where r ->> 'tipo' = 'abono') <> 1 then
    raise exception 'FALLO E5: orden por fecha o tipo abono %', d -> 'filas';
  end if;
  d := documentos_de_cifra('2031-01-01', '2031-03-31', 'gasto', 'mes', 'local', '{}', '2031-02', 'touza')::jsonb;
  if (d ->> 'cifra')::numeric <> 300 or (d -> 'filas' -> 0 ->> 'id')::bigint <> v_tz then
    raise exception 'FALLO E5: febrero × Touza %', d;
  end if;
  d := documentos_de_cifra('2031-01-01', '2031-03-31', 'base', 'familia', null, '{}', v_raiz::text)::jsonb;
  select sum((r ->> 'importe_aportado')::numeric) into v_n from jsonb_array_elements(d -> 'filas') r;
  if (d ->> 'cifra')::numeric <> 90 or (d ->> 'documentos')::int <> 4 or v_n <> 90 then
    raise exception 'FALLO E5: familia raíz %', d;
  end if;
  d := documentos_de_cifra('2031-01-01', '2031-03-31', 'gasto', 'proveedor', null, '{}', '__otros__', null, 2)::jsonb;
  if (d ->> 'cifra')::numeric <> 300 or (d -> 'filas' -> 0 ->> 'proveedor_id')::bigint <> v_b then
    raise exception 'FALLO E5: «Otros» del top 2 %', d;
  end if;
  d := documentos_de_cifra('2031-01-01', '2031-03-31', 'precio', 'mes', null, '{"productos":["producto prueba explorar"]}')::jsonb;
  if (d ->> 'cifra')::numeric <> 2.3333 or (d ->> 'importe_total')::numeric <> 70 or (d ->> 'cantidad_total')::numeric <> 30
     or d ->> 'unidad' <> 'kg' or (d ->> 'documentos')::int <> 3 then
    raise exception 'FALLO E5: precio %', d;
  end if;
  d := documentos_de_cifra('2031-01-01', '2031-03-31', 'abonos')::jsonb;
  if (d ->> 'cifra')::numeric <> 100 or (d -> 'filas' -> 0 ->> 'importe_aportado')::numeric <> 100 then
    raise exception 'FALLO E5: abonos %', d;
  end if;
  d := documentos_de_cifra('2031-01-01', '2031-03-31', 'gasto')::jsonb;
  t := tablero_compras('2031-01-01', '2031-03-31')::jsonb;
  if (d ->> 'cifra')::numeric <> (t -> 'indicadores' ->> 'gasto')::numeric or (d ->> 'documentos')::int <> (t -> 'indicadores' ->> 'documentos')::int then
    raise exception 'FALLO E5: total % frente a tablero %', d ->> 'cifra', t -> 'indicadores' ->> 'gasto';
  end if;
  -- Paginación: 3 páginas de 4 recorren los 10 documentos sin repetir.
  v_n := 0; v_i := 0;
  for p in 0..2 loop
    d := documentos_de_cifra('2031-01-01', '2031-03-31', 'gasto', p_limite => 4, p_desplazamiento => p * 4)::jsonb;
    v_i := v_i + jsonb_array_length(d -> 'filas');
    select v_n + coalesce(sum((r ->> 'importe_aportado')::numeric), 0) into v_n from jsonb_array_elements(d -> 'filas') r;
  end loop;
  if v_i <> 10 or v_n <> 3150 then raise exception 'FALLO E5: paginación % filas, suma %', v_i, v_n; end if;

  -- E6 datos reales de 2026 ────────────────────────────────────────────────
  t := tablero_compras('2026-01-01', '2026-12-31')::jsonb;
  e := explorar_compras('2026-01-01', '2026-12-31', 'gasto', 'mes', 'local')::jsonb;
  if (e -> 'total' ->> 'valor')::numeric <> (t -> 'indicadores' ->> 'gasto')::numeric
     or (e -> 'total' ->> 'documentos')::int <> (t -> 'indicadores' ->> 'documentos')::int then
    raise exception 'FALLO E6: gasto 2026 % ≠ tablero %', e -> 'total', t -> 'indicadores' ->> 'gasto';
  end if;
  select sum((p ->> 'valor')::numeric) into v_n from jsonb_array_elements(e -> 'puntos') p;
  select sum((s ->> 'valor')::numeric) into v_m from jsonb_array_elements(e -> 'series') s;
  if abs(v_n - (e -> 'total' ->> 'valor')::numeric) > 0.05 or abs(v_m - (e -> 'total' ->> 'valor')::numeric) > 0.05 then
    raise exception 'FALLO E6: puntos (%) o series (%) no suman el total', v_n, v_m;
  end if;
  for v_x in select * from jsonb_array_elements(t -> 'meses') loop
    if (select (p ->> 'valor')::numeric from jsonb_array_elements(e -> 'puntos') p where p ->> 'clave' = v_x ->> 'mes')
       is distinct from (v_x ->> 'total')::numeric then
      raise exception 'FALLO E6: mes % no cuadra con el tablero', v_x ->> 'mes';
    end if;
  end loop;
  e := explorar_compras('2026-01-01', '2026-12-31', 'gasto', 'proveedor', null, '{}', 10)::jsonb;
  for v_i in 0 .. jsonb_array_length(t -> 'proveedores') - 1 loop
    if (e -> 'puntos' -> v_i ->> 'valor')::numeric <> (t -> 'proveedores' -> v_i ->> 'gasto')::numeric then
      raise exception 'FALLO E6: proveedor % (% ≠ %)', v_i, e -> 'puntos' -> v_i, t -> 'proveedores' -> v_i;
    end if;
  end loop;
  e := explorar_compras('2026-01-01', '2026-12-31', 'abonos', 'proveedor')::jsonb;
  if (e -> 'total' ->> 'valor')::numeric <> -(t -> 'indicadores' ->> 'abonos')::numeric then
    raise exception 'FALLO E6: abonos % ≠ −%', e -> 'total' ->> 'valor', t -> 'indicadores' ->> 'abonos';
  end if;
  e := explorar_compras('2026-01-01', '2026-12-31', 'regalado', 'mes')::jsonb;
  if (e -> 'total' ->> 'valor')::numeric <> (t -> 'indicadores' ->> 'regalado')::numeric then
    raise exception 'FALLO E6: regalado % ≠ %', e -> 'total' ->> 'valor', t -> 'indicadores' ->> 'regalado';
  end if;
  e := explorar_compras('2026-01-01', '2026-12-31', 'base', 'familia')::jsonb;
  if abs((e -> 'total' ->> 'valor')::numeric - (t -> 'familias' ->> 'importe_total')::numeric) > 0.05
     or (select (p ->> 'valor')::numeric from jsonb_array_elements(e -> 'puntos') p where p ->> 'clave' = '0')
        <> (t -> 'familias' -> 'sin_clasificar' ->> 'importe')::numeric then
    raise exception 'FALLO E6: familias % ≠ %', e -> 'total' ->> 'valor', t -> 'familias' ->> 'importe_total';
  end if;
  for v_x in select * from jsonb_array_elements(t -> 'familias' -> 'familias') loop
    if (select (p ->> 'valor')::numeric from jsonb_array_elements(e -> 'puntos') p where (p ->> 'id')::bigint = (v_x ->> 'id')::bigint)
       is distinct from (v_x ->> 'importe')::numeric then
      raise exception 'FALLO E6: familia % no cuadra', v_x ->> 'familia';
    end if;
  end loop;
  select coalesce(sum(coalesce(total, 0)), 0) into v_n from facturas
   where fecha between '2026-03-01' and '2026-03-31' and not (tipo = 'albaran' and facturado_en_id is not null) and local = 'touza';
  e := explorar_compras('2026-03-01', '2026-03-31', 'gasto', 'dia', null, '{"local":"touza"}')::jsonb;
  if (e -> 'total' ->> 'valor')::numeric <> v_n then
    raise exception 'FALLO E6: Touza marzo % ≠ consulta directa %', e -> 'total' ->> 'valor', v_n;
  end if;
  -- documentos_de_cifra cuadra con explorar en datos reales (mes, proveedor, familia), recorriendo todas las páginas.
  e := explorar_compras('2026-01-01', '2026-12-31', 'gasto', 'mes')::jsonb;
  for v_x in select * from jsonb_array_elements(e -> 'puntos') where (value ->> 'documentos')::int > 0 limit 4 loop
    d := documentos_de_cifra('2026-01-01', '2026-12-31', 'gasto', 'mes', null, '{}', v_x ->> 'clave', p_limite => 200)::jsonb;
    v_n := 0; v_i := 0;
    while v_i < (d ->> 'documentos')::int loop
      d := documentos_de_cifra('2026-01-01', '2026-12-31', 'gasto', 'mes', null, '{}', v_x ->> 'clave', p_limite => 200, p_desplazamiento => v_i)::jsonb;
      select v_n + coalesce(sum((r ->> 'importe_aportado')::numeric), 0) into v_n from jsonb_array_elements(d -> 'filas') r;
      v_i := v_i + jsonb_array_length(d -> 'filas');
      exit when jsonb_array_length(d -> 'filas') = 0;
    end loop;
    if abs(v_n - (v_x ->> 'valor')::numeric) > 0.05 or v_i <> (v_x ->> 'documentos')::int then
      raise exception 'FALLO E6: documentos de % suman % (% docs) y la barra dice % (% docs)', v_x ->> 'clave', v_n, v_i, v_x ->> 'valor', v_x ->> 'documentos';
    end if;
  end loop;
  e := explorar_compras('2026-01-01', '2026-12-31', 'base', 'familia')::jsonb;
  for v_x in select * from jsonb_array_elements(e -> 'puntos') where value ->> 'clave' <> '0' limit 3 loop
    d := documentos_de_cifra('2026-01-01', '2026-12-31', 'base', 'familia', null, '{}', v_x ->> 'clave', p_limite => 200)::jsonb;
    if abs((d ->> 'importe_total')::numeric - (v_x ->> 'valor')::numeric) > 0.05 or (d ->> 'documentos')::int <> (v_x ->> 'documentos')::int then
      raise exception 'FALLO E6: familia % documentos % ≠ %', v_x ->> 'etiqueta', d ->> 'importe_total', v_x ->> 'valor';
    end if;
    if (d ->> 'documentos')::int <= 200 then
      select sum((r ->> 'importe_aportado')::numeric) into v_n from jsonb_array_elements(d -> 'filas') r;
      if abs(v_n - (v_x ->> 'valor')::numeric) > 0.05 then
        raise exception 'FALLO E6: familia % filas suman %', v_x ->> 'etiqueta', v_n;
      end if;
    end if;
  end loop;

  -- E7 RLS ─────────────────────────────────────────────────────────────────
  perform set_config('request.jwt.claims', '{"role": "authenticated"}', true);
  set local role authenticated;
  e := explorar_compras('2031-01-01', '2031-03-31', 'gasto', 'mes')::jsonb;
  d := documentos_de_cifra('2031-01-01', '2031-03-31', 'gasto')::jsonb;
  reset role;
  if (e -> 'total' ->> 'valor')::numeric <> 0 or (e ->> 'sin_datos')::boolean is not true
     or (d ->> 'documentos')::int <> 0 or jsonb_array_length(d -> 'filas') <> 0 then
    raise exception 'FALLO E7: un usuario sin permiso ve datos: % / %', e -> 'total', d ->> 'documentos';
  end if;
end;
$$;

rollback;

select 'explorar_compras_test: OK' as resultado;
