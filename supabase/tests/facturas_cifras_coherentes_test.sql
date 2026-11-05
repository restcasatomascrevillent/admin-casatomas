set client_encoding = 'UTF8';
-- Test de 20261106120000_facturas_cifras_coherentes. BEGIN … ROLLBACK: no deja nada escrito.
-- Acaba en «facturas_cifras_coherentes_test: OK». Pasar también tablero_compras_test,
-- explorar_compras_test, analisis_rapido_test y compras_lista_ligera_test.
--   supabase db query --linked -f supabase/tests/facturas_cifras_coherentes_test.sql
--
--   C1 permisos: anon no ejecuta; authenticated y service_role sí; SECURITY
--      INVOKER; search_path fijo; marca 20261106120000 en las seis funciones.
--   Datos de prueba en 2032 (periodo vacío):
--   C2 (fallo 1) Productos no cuenta las líneas del albarán ya facturado y cuadra
--      con las familias del tablero, el explorador y documentos_de_cifra.
--   C3 (fallo 2) una línea sin importe (total NULL) no suma en ningún sitio y se
--      cuenta en lineas_sin_importe; documentos_lista no la da por «regalado».
--   C4 (fallo 3) un periodo sin documentos no da «−100 %» ni gasto anterior.
--   C5 (fallo 5) gastos fijos con desde_media / hasta_media.
--   C6 (fallo 10) una caja leída como unidad (×21) no sale como subida ni mueve
--      el precio del explorador; atipicos_excluidos la cuenta.
--   C7 datos reales (2026 y todo): tablero = explorador = documentos_de_cifra =
--      productos_gasto_por_categoria = productos_resumen = SQL directo, al céntimo.
--   C8 rapidez: tablero_compras(2026) y explorar_compras(2026, precio) < 1 s.
begin;

do $$
declare
  f       text;
  v_prov  bigint;
  v_alq   bigint;
  v_cat   bigint;
  v_prod  bigint;
  v_f1    bigint;
  v_f2    bigint;
  v_f3    bigint;
  v_f4    bigint;
  v_f5    bigint;
  v_alb   bigint;
  v_alb2  bigint;
  v_doc   bigint;
  t       jsonb;
  e       jsonb;
  d       jsonb;
  x       jsonb;
  v_n     numeric;
  v_m     numeric;
  v_k     bigint;
  t0      timestamptz;
  ms      numeric;
  anio    record;
begin
  -- C1 ─────────────────────────────────────────────────────────────────────
  foreach f in array array['public.tablero_compras(date,date,text)',
                           'public.explorar_compras(date,date,text,text,text,jsonb,integer)',
                           'public.explorar_compras_hechos(date,date,text,text,text,jsonb)',
                           'public.documentos_lista()',
                           'public.productos_resumen(date,date,text)',
                           'public.productos_gasto_por_categoria(date,date,text)'] loop
    if has_function_privilege('anon', f, 'execute') then
      raise exception 'FALLO C1: anon puede ejecutar %', f;
    end if;
    if not has_function_privilege('authenticated', f, 'execute') or not has_function_privilege('service_role', f, 'execute') then
      raise exception 'FALLO C1: authenticated o service_role no pueden ejecutar %', f;
    end if;
    if (select prosecdef or proconfig is null or not ('search_path=public' = any(proconfig)) from pg_proc where oid = f::regprocedure) then
      raise exception 'FALLO C1: % no es SECURITY INVOKER con search_path=public', f;
    end if;
    if position('20261106120000' in pg_get_functiondef(f::regprocedure)) = 0 then
      raise exception 'FALLO C1: % no es la de 20261106120000', f;
    end if;
  end loop;

  -- Datos ──────────────────────────────────────────────────────────────────
  if exists (select 1 from facturas where fecha between '2031-10-01' and '2032-12-31') then
    raise exception 'FALLO datos: ya hay documentos en 2031-10 … 2032-12; el test necesita ese periodo vacío';
  end if;
  insert into proveedores (nombre, cif) values ('PRUEBA CIFRAS PANADERIA SL', 'B00000161') returning id into v_prov;
  insert into proveedores (nombre, cif) values ('PRUEBA CIFRAS ALQUILERES SL', 'B00000162') returning id into v_alq;
  select id into v_cat from categorias_producto where padre_id is null order by id limit 1;
  insert into productos_catalogo (nombre, categoria_id) values ('PRUEBA CIFRAS PAN', v_cat) returning id into v_prod;

  -- Facturas de la panadería: enero (2), marzo (3, una con «3 ud a 29,40»).
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
  values ('factura', 'PRUEBA CIFRAS PANADERIA SL', 'B00000161', v_prov, 'CIF-1', '2032-01-10', 200, 'casa_tomas') returning id into v_f1;
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
  values ('factura', 'PRUEBA CIFRAS PANADERIA SL', 'B00000161', v_prov, 'CIF-2', '2032-01-20', 200, 'casa_tomas') returning id into v_f2;
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
  values ('factura', 'PRUEBA CIFRAS PANADERIA SL', 'B00000161', v_prov, 'CIF-3', '2032-03-10', 200, 'casa_tomas') returning id into v_f3;
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
  values ('factura', 'PRUEBA CIFRAS PANADERIA SL', 'B00000161', v_prov, 'CIF-4', '2032-03-20', 200, 'casa_tomas') returning id into v_f4;
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
  values ('factura', 'PRUEBA CIFRAS PANADERIA SL', 'B00000161', v_prov, 'CIF-5', '2032-03-25', 100, 'casa_tomas') returning id into v_f5;
  -- Albarán ya facturado en CIF-1 (no suma) y albarán sin factura (suma).
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
  values ('albaran', 'PRUEBA CIFRAS PANADERIA SL', 'B00000161', v_prov, 'CIF-ALB-1', '2032-01-05', 50, 'casa_tomas') returning id into v_alb;
  update facturas set facturado_en_id = v_f1, facturado_origen = 'manual' where id = v_alb;
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
  values ('albaran', 'PRUEBA CIFRAS PANADERIA SL', 'B00000161', v_prov, 'CIF-ALB-2', '2032-03-05', 30, 'casa_tomas') returning id into v_alb2;

  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total)
  values (v_f1, 'PAN PRUEBA CIFRAS', 100, 'ud', 1.40, 140),
         (v_f2, 'PAN PRUEBA CIFRAS', 100, 'ud', 1.40, 140),
         (v_f3, 'PAN PRUEBA CIFRAS', 100, 'ud', 1.40, 140),
         (v_f4, 'PAN PRUEBA CIFRAS', 100, 'ud', 1.40, 140),
         (v_f5, 'PAN PRUEBA CIFRAS', 3, 'ud', 29.40, 88.20),          -- 3 cajas de 21 leídas como «ud»
         (v_alb, 'PAN PRUEBA CIFRAS', 20, 'ud', 1.40, 28),            -- ya facturado: no suma
         (v_alb2, 'PAN PRUEBA CIFRAS', 10, 'ud', 1.40, 14),           -- sin factura: suma
         (v_f3, 'PAN PRUEBA CIFRAS SIN IMPORTE', 5, 'ud', 10, null),  -- sin importe leído (con precio)
         (v_f3, 'PAN PRUEBA CIFRAS SIN PRECIO', 1, 'ud', null, null); -- sin importe ni precio
  update productos_factura set producto_id = v_prod
   where factura_id in (v_f1, v_f2, v_f3, v_f4, v_f5, v_alb, v_alb2);
  -- Antes, documentos_lista la daba por «regalado» (50 − 0).
  update productos_factura set importe_bruto = 50 where factura_id = v_f3 and precio_unitario is null;

  -- Alquiler: una factura al mes de enero a marzo, siempre 400.
  for i in 1..3 loop
    insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
    values ('factura', 'PRUEBA CIFRAS ALQUILERES SL', 'B00000162', v_alq, 'CIF-ALQ-' || i, make_date(2032, i, 1), 400, 'casa_tomas')
    returning id into v_doc;
    insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total)
    values (v_doc, 'Alquiler local', 1, 'ud', 330.58, 330.58);
    update productos_factura set producto_id = null where factura_id = v_doc;
  end loop;

  -- C2 ─────────────────────────────────────────────────────────────────────
  -- Líneas que cuentan: 4×140 + 88,20 + 14 (sin el albarán facturado ni la sin importe).
  select sum(gasto), sum(lineas_sin_importe) into v_n, v_m
    from productos_gasto_por_categoria('2032-01-01', '2032-03-31') where categoria_id = v_cat;
  if v_n <> 662.20 then
    raise exception 'FALLO C2: productos_gasto_por_categoria % (esperado 662,20: sin el albarán ya facturado)', v_n;
  end if;
  select gasto, compras, documentos into v_n, v_k, v_m from productos_resumen('2032-01-01', '2032-03-31') where producto_id = v_prod;
  if v_n <> 662.20 or v_k <> 8 or v_m <> 6 then
    raise exception 'FALLO C2: productos_resumen gasto % / compras % / documentos % (esperado 662,20 / 8 / 6)', v_n, v_k, v_m;
  end if;
  t := tablero_compras('2032-01-01', '2032-03-31')::jsonb;
  select (fa ->> 'importe')::numeric into v_n from jsonb_array_elements(t -> 'familias' -> 'familias') fa where (fa ->> 'id')::bigint = v_cat;
  if v_n is distinct from 662.20 then
    raise exception 'FALLO C2: familia del tablero % (esperado 662,20)', v_n;
  end if;
  e := explorar_compras('2032-01-01', '2032-03-31', 'base', 'familia', null, jsonb_build_object('familias', jsonb_build_array(v_cat)))::jsonb;
  d := documentos_de_cifra('2032-01-01', '2032-03-31', 'base', 'familia', null, jsonb_build_object('familias', jsonb_build_array(v_cat)), v_cat::text)::jsonb;
  if (e -> 'total' ->> 'valor')::numeric <> 662.20 or (d ->> 'cifra')::numeric <> 662.20 then
    raise exception 'FALLO C2: explorador % / documentos_de_cifra % (esperado 662,20)', e -> 'total' ->> 'valor', d ->> 'cifra';
  end if;

  -- C3 ─────────────────────────────────────────────────────────────────────
  if (t -> 'familias' ->> 'lineas_sin_importe')::int <> 2 then
    raise exception 'FALLO C3: familias.lineas_sin_importe % (esperado 2)', t -> 'familias' ->> 'lineas_sin_importe';
  end if;
  if (t -> 'familias' ->> 'importe_total')::numeric <> 662.20 + 3 * 330.58 then
    raise exception 'FALLO C3: familias.importe_total % (la línea sin importe no suma)', t -> 'familias' ->> 'importe_total';
  end if;
  e := explorar_compras('2032-01-01', '2032-03-31', 'base', 'mes')::jsonb;
  if (e -> 'total' ->> 'lineas_sin_importe')::int <> 2 or (e -> 'total' ->> 'valor')::numeric <> 662.20 + 3 * 330.58 then
    raise exception 'FALLO C3: explorador %', e -> 'total';
  end if;
  -- documentos_lista: la factura CIF-3 no lleva «regalado» por la línea sin importe.
  select x2 into x from json_array_elements(documentos_lista() -> 'docs') x2 where (x2 ->> 0)::bigint = v_f3;
  if x ->> 18 is not null then
    raise exception 'FALLO C3: documentos_lista da regalado a la línea sin importe: %', x -> 18;
  end if;
  -- El regalado del tablero tampoco la cuenta.
  if (t -> 'indicadores' ->> 'regalado')::numeric <> 0 then
    raise exception 'FALLO C3: regalado del tablero % (esperado 0)', t -> 'indicadores' ->> 'regalado';
  end if;

  -- C4 ─────────────────────────────────────────────────────────────────────
  t := tablero_compras('2032-04-01', '2032-04-30')::jsonb;   -- abril vacío, marzo con documentos
  if t -> 'indicadores' ->> 'variacion_pct' is not null or t -> 'indicadores' ->> 'gasto_anterior' is not null then
    raise exception 'FALLO C4: periodo vacío con variación % / gasto anterior %',
      t -> 'indicadores' ->> 'variacion_pct', t -> 'indicadores' ->> 'gasto_anterior';
  end if;
  e := explorar_compras('2032-04-01', '2032-04-30', 'gasto', 'mes')::jsonb;
  if e -> 'total' ->> 'variacion_pct' is not null then
    raise exception 'FALLO C4: explorador con periodo vacío da variación %', e -> 'total' ->> 'variacion_pct';
  end if;
  -- Con documentos sí compara (marzo frente a febrero: febrero solo tiene el alquiler).
  t := tablero_compras('2032-03-01', '2032-03-31')::jsonb;
  if (t -> 'indicadores' ->> 'gasto_anterior')::numeric <> 400 then
    raise exception 'FALLO C4: gasto anterior de marzo % (esperado 400)', t -> 'indicadores' ->> 'gasto_anterior';
  end if;

  -- C5 ─────────────────────────────────────────────────────────────────────
  t := tablero_compras('2032-01-01', '2032-03-31')::jsonb;
  select fx into x from jsonb_array_elements(t -> 'fijos' -> 'proveedores') fx where (fx ->> 'id')::bigint = v_alq;
  if x is null or (x ->> 'medio_mes')::numeric <> 400
     or (x ->> 'desde_media')::date <> '2032-01-01' or (x ->> 'hasta_media')::date <> '2032-03-31' then
    raise exception 'FALLO C5: gasto fijo del alquiler %', x;
  end if;
  if exists (select 1 from jsonb_array_elements(t -> 'fijos' -> 'proveedores') fx
              where not (fx ? 'desde_media' and fx ? 'hasta_media')) then
    raise exception 'FALLO C5: hay gastos fijos sin desde_media/hasta_media';
  end if;

  -- C6 ─────────────────────────────────────────────────────────────────────
  -- Sin el atípico el pan está a 1,40 en los dos tramos: no hay subida.
  if exists (select 1 from jsonb_array_elements(t -> 'subidas' -> 'productos') s
              where s ->> 'nombre_normalizado' like 'pan prueba cifras%') then
    raise exception 'FALLO C6: el pan sale como subida por una caja leída como unidad: %', t -> 'subidas';
  end if;
  if (t -> 'subidas' ->> 'atipicos_excluidos')::int <> 1 then
    raise exception 'FALLO C6: atipicos_excluidos % (esperado 1)', t -> 'subidas' ->> 'atipicos_excluidos';
  end if;
  e := explorar_compras('2032-01-01', '2032-03-31', 'precio', 'mes', null,
                        jsonb_build_object('productos', jsonb_build_array('PAN PRUEBA CIFRAS')))::jsonb;
  if (e -> 'total' ->> 'valor')::numeric <> 1.40 or (e -> 'parametros' ->> 'precio_sin_atipicos')::boolean is not true then
    raise exception 'FALLO C6: precio del explorador % (esperado 1,40 sin el atípico)', e -> 'total';
  end if;
  d := documentos_de_cifra('2032-01-01', '2032-03-31', 'precio', 'mes', null,
                           jsonb_build_object('productos', jsonb_build_array('PAN PRUEBA CIFRAS')))::jsonb;
  if (d ->> 'cifra')::numeric <> 1.40 then
    raise exception 'FALLO C6: documentos_de_cifra da % (el explorador 1,40)', d ->> 'cifra';
  end if;
  -- Con menos de 3 compras no se descarta nada (el importe no cambia nunca).
  e := explorar_compras('2032-03-25', '2032-03-25', 'base', 'mes')::jsonb;
  if (e -> 'total' ->> 'valor')::numeric <> 88.20 then
    raise exception 'FALLO C6: el importe de la línea atípica no debe cambiar: %', e -> 'total';
  end if;

  -- C7 datos reales ────────────────────────────────────────────────────────
  for anio in select * from (values ('2026-01-01'::date, '2026-12-31'::date), (null::date, null::date)) v(desde, hasta) loop
    t := tablero_compras(anio.desde, anio.hasta)::jsonb;
    e := explorar_compras(anio.desde, anio.hasta, 'base', 'familia')::jsonb;
    d := documentos_de_cifra(anio.desde, anio.hasta, 'base', 'familia', p_limite => 1)::jsonb;
    select coalesce(sum(pf.total), 0) into v_n
      from productos_factura pf join facturas fa on fa.id = pf.factura_id
     where (anio.desde is null or fa.fecha between anio.desde and anio.hasta)
       and not (fa.tipo = 'albaran' and fa.facturado_en_id is not null);
    if (t -> 'familias' ->> 'importe_total')::numeric <> round(v_n, 2)
       or (e -> 'total' ->> 'valor')::numeric <> round(v_n, 2)
       or (d ->> 'cifra')::numeric <> round(v_n, 2) then
      raise exception 'FALLO C7 (%): líneas SQL % · tablero % · explorador % · documentos_de_cifra %', coalesce(anio.desde::text, 'todo'),
        round(v_n, 2), t -> 'familias' ->> 'importe_total', e -> 'total' ->> 'valor', d ->> 'cifra';
    end if;
    select coalesce(sum(pf.total), 0) into v_n
      from productos_factura pf join facturas fa on fa.id = pf.factura_id
     where (anio.desde is null or fa.fecha between anio.desde and anio.hasta)
       and not (fa.tipo = 'albaran' and fa.facturado_en_id is not null)
       and pf.producto_id is not null;
    select coalesce(sum(gasto), 0) into v_m from productos_resumen(anio.desde, anio.hasta);
    if v_m <> round(v_n, 2) then
      raise exception 'FALLO C7 (%): productos_resumen % ≠ SQL %', coalesce(anio.desde::text, 'todo'), v_m, round(v_n, 2);
    end if;
    select coalesce(sum(gasto), 0) into v_m from productos_gasto_por_categoria(anio.desde, anio.hasta) where not sin_clasificar;
    if v_m <> round(v_n, 2) then
      raise exception 'FALLO C7 (%): productos_gasto_por_categoria % ≠ SQL %', coalesce(anio.desde::text, 'todo'), v_m, round(v_n, 2);
    end if;
    select coalesce(sum(fa.total), 0) into v_n from facturas fa
     where (anio.desde is null or fa.fecha between anio.desde and anio.hasta)
       and not (fa.tipo = 'albaran' and fa.facturado_en_id is not null);
    e := explorar_compras(anio.desde, anio.hasta, 'gasto', 'mes')::jsonb;
    if (t -> 'indicadores' ->> 'gasto')::numeric <> round(v_n, 2) or (e -> 'total' ->> 'valor')::numeric <> round(v_n, 2) then
      raise exception 'FALLO C7 (%): gasto SQL % · tablero % · explorador %', coalesce(anio.desde::text, 'todo'),
        round(v_n, 2), t -> 'indicadores' ->> 'gasto', e -> 'total' ->> 'valor';
    end if;
  end loop;
  t := tablero_compras('2026-01-01', '2026-12-31')::jsonb;
  if exists (select 1 from jsonb_array_elements(t -> 'subidas' -> 'productos') s
              where s ->> 'nombre_normalizado' = 'pan de cristal' and s ->> 'unidad' = 'ud') then
    raise exception 'FALLO C7: PAN DE CRISTAL (ud) sigue en «Lo que más ha subido»: %', t -> 'subidas' -> 'productos';
  end if;

  -- C8 ─────────────────────────────────────────────────────────────────────
  t0 := clock_timestamp();
  t := tablero_compras('2026-01-01', '2026-12-31')::jsonb;
  ms := extract(epoch from clock_timestamp() - t0) * 1000;
  if ms > 1000 then
    raise exception 'FALLO C8: tablero_compras del año tarda % ms', round(ms);
  end if;
  t0 := clock_timestamp();
  e := explorar_compras('2026-01-01', '2026-12-31', 'precio', 'mes')::jsonb;
  ms := extract(epoch from clock_timestamp() - t0) * 1000;
  if ms > 1000 then
    raise exception 'FALLO C8: explorar_compras(precio) del año tarda % ms', round(ms);
  end if;
end;
$$;

rollback;

select 'facturas_cifras_coherentes_test: OK' as resultado;
