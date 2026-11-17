set client_encoding = 'UTF8';
-- Test de 20261209120000_informe_subidas_envases_tallas. BEGIN … ROLLBACK: no deja nada escrito.
-- Acaba en «informe_subidas_envases_tallas_test: OK».
--   supabase db query --linked -f supabase/tests/informe_subidas_envases_tallas_test.sql
--
-- Datos entre 10/2034 y 11/2035 («hoy» = 01/12/2035), proveedores A y B:
--   REFRESCO (catálogo 0,33 l × 24): A factura «ZZISP REFRESCO 350 CL. E.R. *24» por caja con 8,4 l
--     corregidos a mano (botella de vidrio de 35 cl); B, «ZZISP REFRESCO LT 33CL» por pack (lata).
--     → el precio de A sale de 8,4 l (21 € → 2,50 €/l), no de 7,92 l (2,65 €/l);
--     → A frente a B (vidrio 35 cl frente a lata 33 cl): «Revisar», no suma en el ahorro.
--   LATA (catálogo 0,33 l × 24): A y B, las dos en lata de 33 cl → se compara (no es «Revisar»).
--   QUISQ (kg, pescado): la última nota de A trae «ZZISP QUISQUILLA X/P/M» a 65 y a 39 €/kg
--     (dos tallas) → la subida y el más barato quedan en «Revisar» con el motivo de las tallas.
begin;

do $$
declare
  v_hoy  constant date := '2035-12-01';
  v_a    bigint;
  v_b    bigint;
  v_f    bigint;
  v_refr bigint;
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
  select coalesce(
           (select id from categorias_producto where nombre = 'Refrescos y aguas' limit 1),
           (select id from categorias_producto where padre_id is null and nombre = 'Despensa')) into v_refr;
  select id into v_pesc from categorias_producto where padre_id is null and nombre = 'Pescado y marisco';
  if v_refr is null or v_pesc is null then
    raise exception 'FALLO datos: faltan las categorías del test';
  end if;

  insert into proveedores (nombre, cif) values ('PRUEBA IET A', 'B00000971') returning id into v_a;
  insert into proveedores (nombre, cif) values ('PRUEBA IET B', 'B00000972') returning id into v_b;

  insert into productos_catalogo (nombre, origen, categoria_id) values ('Zziet Refresco 33 cl', 'manual', v_refr) returning id into v_id;
  v_pc := v_pc || jsonb_build_object('REFRESCO', v_id);
  insert into productos_catalogo (nombre, origen, categoria_id) values ('Zziet Lata 33 cl', 'manual', v_refr) returning id into v_id;
  v_pc := v_pc || jsonb_build_object('LATA', v_id);
  insert into productos_catalogo (nombre, origen, categoria_id) values ('Zziet Quisquilla', 'manual', v_pesc) returning id into v_id;
  v_pc := v_pc || jsonb_build_object('QUISQ', v_id);
  update productos_catalogo set envase_cantidad = 0.33, envase_unidad = 'l', envases_por_bulto = 24, envase_origen = 'manual'
   where id in ((v_pc ->> 'REFRESCO')::bigint, (v_pc ->> 'LATA')::bigint);

  for rec in
    select * from (values
      -- prod, proveedor, fecha, nombre, unidad, cantidad, precio, contenido (l, manual)
      ('REFRESCO', v_a, '2034-11-20'::date, 'ZZISP REFRESCO 350 CL. E.R. *24', 'caja', 10::numeric, 20::numeric, 8.4::numeric),
      ('REFRESCO', v_a, '2035-08-20', 'ZZISP REFRESCO 350 CL. E.R. *24', 'caja', 10, 21, 8.4),
      ('REFRESCO', v_a, '2035-09-20', 'ZZISP REFRESCO 350 CL. E.R. *24', 'caja', 10, 21, 8.4),
      ('REFRESCO', v_a, '2035-10-20', 'ZZISP REFRESCO 350 CL. E.R. *24', 'caja', 10, 21, 8.4),
      ('REFRESCO', v_a, '2035-11-20', 'ZZISP REFRESCO 350 CL. E.R. *24', 'caja', 10, 21, 8.4),
      ('REFRESCO', v_b, '2035-09-22', 'ZZISP REFRESCO LT 33CL', 'pack', 2, 15.10, 7.92),
      ('REFRESCO', v_b, '2035-10-22', 'ZZISP REFRESCO LT 33CL', 'pack', 2, 15.10, 7.92),
      ('REFRESCO', v_b, '2035-11-22', 'ZZISP REFRESCO LT 33CL', 'pack', 2, 15.10, 7.92),
      ('LATA', v_a, '2035-09-20', 'ZZISP LATA 33CL *24', 'caja', 10, 21, 7.92),
      ('LATA', v_a, '2035-10-20', 'ZZISP LATA 33CL *24', 'caja', 10, 21, 7.92),
      ('LATA', v_a, '2035-11-20', 'ZZISP LATA 33CL *24', 'caja', 10, 21, 7.92),
      ('LATA', v_b, '2035-09-22', 'ZZISP LATA LT 33CL', 'pack', 2, 15.10, 7.92),
      ('LATA', v_b, '2035-10-22', 'ZZISP LATA LT 33CL', 'pack', 2, 15.10, 7.92),
      ('LATA', v_b, '2035-11-22', 'ZZISP LATA LT 33CL', 'pack', 2, 15.10, 7.92)
    ) x(prod, prov, fecha, nombre, unidad, cantidad, precio, cont)
  loop
    insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
    values ('factura', 'PRUEBA IET', 'B00000971', rec.prov, 'IET-' || rec.prod || '-' || rec.prov || '-' || rec.fecha, rec.fecha, rec.cantidad * rec.precio, 'casa_tomas')
    returning id into v_f;
    insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, producto_id,
                                   contenido_cantidad, contenido_unidad, contenido_origen)
    values (v_f, rec.nombre, rec.cantidad, rec.unidad, rec.precio, rec.cantidad * rec.precio, (v_pc ->> rec.prod)::bigint,
            rec.cont, 'l', 'manual');
  end loop;

  -- QUISQ: A, 60 €/kg cada mes desde 11/2034; la última nota (20/11/2035) con dos tallas a 65 y 39 €/kg.
  for i in 0..12 loop
    v_d := ('2034-11-10'::date + make_interval(months => i))::date;
    insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
    values ('factura', 'PRUEBA IET A', 'B00000971', v_a, 'IET-Q' || i, v_d, 600, 'casa_tomas') returning id into v_f;
    insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, producto_id)
    values (v_f, 'ZZISP QUISQUILLA X/P/M', 10, 'kg', 60, 600, (v_pc ->> 'QUISQ')::bigint);
  end loop;
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
  values ('factura', 'PRUEBA IET A', 'B00000971', v_a, 'IET-QX', '2035-11-20', 1040, 'casa_tomas') returning id into v_f;
  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, producto_id)
  values (v_f, 'ZZISP QUISQUILLA X/P/M', 10, 'kg', 65, 650, (v_pc ->> 'QUISQ')::bigint),
         (v_f, 'ZZISP QUISQUILLA X/P/M', 10, 'kg', 39, 390, (v_pc ->> 'QUISQ')::bigint);
  -- B la vende a 50 €/kg (3 compras).
  for i in 0..2 loop
    v_d := ('2035-09-12'::date + make_interval(months => i))::date;
    insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
    values ('factura', 'PRUEBA IET B', 'B00000972', v_b, 'IET-QB' || i, v_d, 250, 'casa_tomas') returning id into v_f;
    insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, producto_id)
    values (v_f, 'ZZISP QUISQUILLA', 5, 'kg', 50, 250, (v_pc ->> 'QUISQ')::bigint);
  end loop;

  -- ── Permisos de las funciones nuevas ──
  if has_function_privilege('authenticated', 'public.informe_precios_compras(date,text)', 'execute')
     or has_function_privilege('authenticated', 'public.informe_precios_envases_distintos(numeric,text,text,numeric,text,text)', 'execute')
     or has_function_privilege('anon', 'public.informe_precios_motivo_tallas(numeric,numeric,text)', 'execute') then
    raise exception 'FALLO permisos: las funciones internas del informe no pueden estar abiertas';
  end if;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- ── 1 · Contenido manual: 21 € la caja de 8,4 l = 2,50 €/l (no 2,6515 de 7,92 l) ──
  select * into rec from public.informe_precios_compras(v_hoy, null) c
   where c.producto_id = (v_pc ->> 'REFRESCO')::bigint and c.proveedor_id = v_a and c.fecha = '2035-11-20';
  if rec.med is distinct from 'l' or round(rec.precio, 4) <> 2.5 or round(rec.cant, 2) <> 84 then
    raise exception 'FALLO contenido manual: esperaba 2,50 €/l y 84 l, sale % %/% y %', rec.precio, rec.med, rec.uni, rec.cant;
  end if;
  if round(rec.tam, 3) <> 0.35 or rec.mat is distinct from 'vidrio' then
    raise exception 'FALLO envase: esperaba 0,35 l de vidrio, sale % % %', rec.tam, rec.tam_u, rec.mat;
  end if;
  select * into rec from public.informe_precios_compras(v_hoy, null) c
   where c.producto_id = (v_pc ->> 'REFRESCO')::bigint and c.proveedor_id = v_b and c.fecha = '2035-11-22';
  if round(rec.tam, 3) <> 0.33 or rec.mat is distinct from 'lata' then
    raise exception 'FALLO envase: esperaba 0,33 l en lata para el pack, sale % % %', rec.tam, rec.tam_u, rec.mat;
  end if;

  -- ── 2 · Proveedor más barato: vidrio 35 cl frente a lata 33 cl → Revisar; lata frente a lata → se compara ──
  j := public.informe_proveedor_mas_barato(null, null, null, v_hoy, 200, 0);
  select x into f from jsonb_array_elements(j -> 'filas') x where (x ->> 'producto_id')::bigint = (v_pc ->> 'REFRESCO')::bigint;
  if f is null then
    raise exception 'FALLO barato: falta la fila del refresco: %', j -> 'filas';
  end if;
  if f ->> 'confianza' <> 'baja' or f ->> 'motivo' not like 'Envases distintos (35 cl de vidrio y 33 cl en lata)%'
     or round((f ->> 'precio')::numeric, 4) <> 2.5 then
    raise exception 'FALLO barato envases: %', f;
  end if;
  select x into f from jsonb_array_elements(j -> 'filas') x where (x ->> 'producto_id')::bigint = (v_pc ->> 'LATA')::bigint;
  if f is null or f ->> 'confianza' = 'baja' or f ->> 'motivo' like '%Envases distintos%' then
    raise exception 'FALLO barato: lata frente a lata debe compararse: %', f;
  end if;

  -- ── 3 · Subidas: la del refresco usa 8,4 l (20 → 21 €: +5 %) y la de la quisquilla con dos tallas es Revisar ──
  j := public.informe_subidas_precio(12, null, null, null, v_hoy, 200, 0);
  select x into f from jsonb_array_elements(j -> 'filas') x where (x ->> 'producto_id')::bigint = (v_pc ->> 'REFRESCO')::bigint;
  if f is null or (f ->> 'variacion_pct')::numeric <> 5 or f ->> 'confianza' = 'baja' then
    raise exception 'FALLO subidas refresco: %', f;
  end if;
  select x into f from jsonb_array_elements(j -> 'filas') x where (x ->> 'producto_id')::bigint = (v_pc ->> 'QUISQ')::bigint;
  if f is not null then
    -- (65 + 39) / 2 = 52 < 60: con la media es una BAJADA; no debe salir como subida.
    raise exception 'FALLO subidas quisquilla: la media de dos tallas no es una subida: %', f;
  end if;
  j := public.informe_subidas_precio(3, null, null, null, v_hoy, 200, 0);
  if (j -> 'totales' -> 'bajadas_fiable' ->> 'n')::int <> 0 then
    raise exception 'FALLO subidas: la bajada de la quisquilla (dos tallas) no es fiable: %', j -> 'totales';
  end if;

  j := public.informe_proveedor_mas_barato(null, null, null, v_hoy, 200, 0);
  select x into f from jsonb_array_elements(j -> 'filas') x where (x ->> 'producto_id')::bigint = (v_pc ->> 'QUISQ')::bigint;
  if f is null or f ->> 'confianza' <> 'baja' or f ->> 'motivo' not like '%de 39,00 a 65,00 €/kg%tallas%' then
    raise exception 'FALLO barato quisquilla: dos tallas en la última nota deben quedar en Revisar: %', f;
  end if;
  if (j -> 'totales' ->> 'ahorro_fiable')::numeric <> (
       select coalesce(sum((x ->> 'ahorro_anual')::numeric), 0) from jsonb_array_elements(j -> 'filas') x where x ->> 'confianza' <> 'baja') then
    raise exception 'FALLO barato: el total fiable no cuadra con sus filas: %', j -> 'totales';
  end if;

  raise notice 'informe_subidas_envases_tallas_test: OK';
end $$;

select 'informe_subidas_envases_tallas_test: OK' as resultado;
rollback;
