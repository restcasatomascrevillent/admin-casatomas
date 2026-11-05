set client_encoding = 'UTF8';
-- Test de 20261105190000_compras_lista_ligera. BEGIN … ROLLBACK: no deja nada escrito.
-- Acaba en «compras_lista_ligera_test: OK».
--   supabase db query --linked -f supabase/tests/compras_lista_ligera_test.sql
--
--   T1 permisos: anon no ejecuta; authenticated y service_role sí; SECURITY INVOKER.
--   T2 normalizar y servicios: sin tildes ni mayúsculas, espacios colapsados;
--      portes / punto verde son servicio, merluza no. Columna nombre_busqueda al día.
--   T3 lista con datos de prueba: tipo, proveedor unificado, nº de líneas, avisos
--      compactos, regalado [importe, estimado, regalos], precio atípico (mismo
--      proveedor y tipo; los portes y los precios a 0 no cuentan; facturas y
--      albaranes no se mezclan), orden (más reciente primero).
--   T4 buscar: palabra de una línea, del producto del catálogo, de las
--      observaciones, dos palabras repartidas entre cabecera y línea, sin tildes;
--      lo que no está → vacío; texto vacío → vacío.
--   T5 ficha: líneas en orden, media de referencia (sin ella misma), null en
--      portes, categoría con ruta; documento inexistente → null.
--   T6 con los datos reales: tantos documentos como `facturas`, Σ líneas =
--      `productos_factura`, Σ regalado = consulta directa.
--   T7 RLS: un usuario sin permiso de Facturas recibe la lista vacía.
begin;

do $$
declare
  v_p     bigint;
  v_q     bigint;
  v_f1    bigint;
  v_f2    bigint;
  v_f3    bigint;
  v_a1    bigint;
  v_cat   bigint;
  v_sub   bigint;
  v_prod  bigint;
  v_l1    bigint;
  v_l3    bigint;
  l       jsonb;
  d       jsonb;
  x       jsonb;
  ids     bigint[];
  v_n     numeric;
  v_m     numeric;
begin
  -- T1 ─────────────────────────────────────────────────────────────────────
  if has_function_privilege('anon', 'public.documentos_lista()', 'execute')
     or has_function_privilege('anon', 'public.buscar_documentos_compras(text)', 'execute')
     or has_function_privilege('anon', 'public.documento_compras(bigint)', 'execute') then
    raise exception 'FALLO T1: anon puede ejecutar las funciones de Compras';
  end if;
  if not has_function_privilege('authenticated', 'public.documentos_lista()', 'execute')
     or not has_function_privilege('authenticated', 'public.buscar_documentos_compras(text)', 'execute')
     or not has_function_privilege('authenticated', 'public.documento_compras(bigint)', 'execute')
     or not has_function_privilege('service_role', 'public.documentos_lista()', 'execute') then
    raise exception 'FALLO T1: authenticated o service_role no pueden ejecutarlas';
  end if;
  if exists (select 1 from pg_proc where proname in ('documentos_lista', 'buscar_documentos_compras', 'documento_compras') and prosecdef) then
    raise exception 'FALLO T1: alguna no es SECURITY INVOKER';
  end if;

  -- T2 ─────────────────────────────────────────────────────────────────────
  if texto_busqueda_compras('  Merluza   DEL  Cantábrico ') <> 'merluza del cantabrico'
     or texto_busqueda_compras('ÑANDÚ') <> 'nandu' or texto_busqueda_compras(null) <> '' then
    raise exception 'FALLO T2: texto_busqueda_compras normaliza mal';
  end if;
  if not es_servicio_compras('portes') or not es_servicio_compras('punto verde envases')
     or not es_servicio_compras('gastos de envio') or es_servicio_compras('merluza')
     or es_servicio_compras('importe') then
    raise exception 'FALLO T2: es_servicio_compras clasifica mal';
  end if;

  -- T3 datos ───────────────────────────────────────────────────────────────
  if exists (select 1 from facturas where fecha between '2032-01-01' and '2032-12-31') then
    raise exception 'FALLO datos: ya hay documentos en 2032; el test necesita ese año vacío';
  end if;
  insert into proveedores (nombre, cif) values ('PRUEBA LISTA LIGERA PESCADOS SL', 'B00000191') returning id into v_p;
  insert into proveedores (nombre, cif) values ('PRUEBA LISTA LIGERA OTRO SL', 'B00000192') returning id into v_q;
  insert into categorias_producto (clave, nombre) values ('prueba_lista_ligera', 'Prueba Mar') returning id into v_cat;
  insert into categorias_producto (clave, nombre, padre_id) values ('prueba_lista_ligera_sub', 'Prueba Blanco', v_cat) returning id into v_sub;
  insert into productos_catalogo (nombre, categoria_id, origen) values ('Pescadilla prueba lista ligera', v_sub, 'manual') returning id into v_prod;

  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local, observaciones, alertas_validacion)
  values ('factura', 'Pescados Lista Ligera', 'B00000191', v_p, 'LL-1', '2032-01-10', 100, null, 'Entrega con ZORONGO especial',
          '[{"codigo": "iva_incoherente", "severidad": "alta", "mensaje": "El IVA no cuadra", "detalle": {"x": 1}}]')
  returning id into v_f1;
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
  values ('factura', 'PESCADOS LISTA LIGERA, S.L.', 'B00000191', v_p, 'LL-2', '2032-01-20', 50, 'casa_tomas') returning id into v_f2;
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
  values ('factura', 'Pescados Lista Ligera', 'B00000191', v_p, 'LL-3', '2032-02-01', 300, 'touza') returning id into v_f3;
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
  values ('albaran', 'Pescados Lista Ligera', 'B00000191', v_p, 'LL-A1', '2032-02-02', 999, 'casa_tomas') returning id into v_a1;

  -- «Merlúza Ñandú» a 10 y 12 €; en LL-3 a 30 € (> 2 × 11): atípico. Portes 5 → 50: no cuenta.
  -- El albarán la trae a 100 € pero es de otro tipo: ni lo marca ni marca a las facturas.
  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total)
  values (v_f1, 'Merlúza  Ñandú', 1, 'kg', 10, 10) returning id into v_l1;
  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, importe_bruto, importe_bruto_estimado)
  values (v_f1, 'Gamba regalo', 2, 'kg', 0, 0, 40, true),
         (v_f1, 'PORTES', 1, 'ud', 5, 5, null, false);
  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, importe_bruto)
  values (v_f2, 'merluza ñandu', 1, 'kg', 12, 12, 15),
         (v_f2, 'Portes', 1, 'ud', 5, 5, null);
  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, producto_id)
  values (v_f3, 'MERLUZA ÑANDÚ', 1, 'kg', 30, 30, null) returning id into v_l3;
  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, producto_id)
  values (v_f3, 'Portes', 1, 'ud', 50, 50, null),
         (v_f3, 'Pescadilla fina', 1, 'kg', 8, 8, v_prod);
  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total)
  values (v_a1, 'Merluza ñandú', 1, 'kg', 100, 100),
         (v_a1, 'Merluza ñandú', 1, 'kg', 10, 10);

  -- Al añadir líneas un trigger recalcula los avisos: se fijan a mano después.
  update facturas set alertas_validacion =
    '[{"codigo": "iva_incoherente", "severidad": "alta", "mensaje": "El IVA no cuadra", "detalle": {"x": 1}}]'
   where id = v_f1;
  update facturas set alertas_validacion = '[]' where id = v_f2;

  if (select nombre_busqueda from productos_factura where id = v_l1) <> 'merluza nandu' then
    raise exception 'FALLO T2: nombre_busqueda no se calcula al insertar';
  end if;

  -- T3 ─────────────────────────────────────────────────────────────────────
  l := documentos_lista()::jsonb;
  if (l ->> 'v')::int <> 1 or l -> 'proveedores' ->> v_p::text <> 'PRUEBA LISTA LIGERA PESCADOS SL' then
    raise exception 'FALLO T3: versión o nombre del proveedor unificado: % / %', l ->> 'v', l -> 'proveedores' ->> v_p::text;
  end if;
  -- El más reciente primero: LL-A1 (02/02) va antes que LL-3 (01/02).
  select array_agg((e ->> 0)::bigint order by o) into ids
    from jsonb_array_elements(l -> 'docs') with ordinality as t(e, o)
   where (e ->> 0)::bigint in (v_f1, v_f2, v_f3, v_a1);
  if ids <> array[v_a1, v_f3, v_f2, v_f1] then
    raise exception 'FALLO T3: orden %', ids;
  end if;

  select e into x from jsonb_array_elements(l -> 'docs') e where (e ->> 0)::bigint = v_f1;
  if x ->> 1 <> 'factura' or x ->> 2 <> 'LL-1' or (x ->> 4)::bigint <> v_p or x ->> 6 <> '2032-01-10'
     or x -> 8 <> 'null'::jsonb or (x ->> 10)::numeric <> 100 or (x ->> 16)::int <> 3 then
    raise exception 'FALLO T3: cabecera de LL-1: %', x;
  end if;
  if x -> 17 <> '[["iva_incoherente", "alta"]]'::jsonb then
    raise exception 'FALLO T3: avisos compactos de LL-1: %', x -> 17;
  end if;
  if x -> 18 <> '[40, true, 1]'::jsonb or (x ->> 19)::boolean then
    raise exception 'FALLO T3: regalado o atípico de LL-1: % / %', x -> 18, x -> 19;
  end if;

  select e into x from jsonb_array_elements(l -> 'docs') e where (e ->> 0)::bigint = v_f2;
  if x -> 18 <> '[3, false, 0]'::jsonb or (x ->> 19)::boolean or x -> 17 <> 'null'::jsonb then
    raise exception 'FALLO T3: LL-2 (descuento 3 €, sin aviso): %', x;
  end if;
  select e into x from jsonb_array_elements(l -> 'docs') e where (e ->> 0)::bigint = v_f3;
  if not (x ->> 19)::boolean or x ->> 8 <> 'touza' or x -> 18 <> 'null'::jsonb then
    raise exception 'FALLO T3: LL-3 debería tener precio atípico (30 > 2 × 11) y ser de Touza: %', x;
  end if;
  -- Albarán: 100 > 2 × 10 dentro de los albaranes → atípico; no lo compara con las facturas.
  select e into x from jsonb_array_elements(l -> 'docs') e where (e ->> 0)::bigint = v_a1;
  if not (x ->> 19)::boolean or x ->> 1 <> 'albaran' then
    raise exception 'FALLO T3: LL-A1: %', x;
  end if;
  -- Portes de LL-3 (50 frente a 5) no hacen atípica a LL-2 ni a LL-1: ya comprobado; y la media de
  -- LL-1 (10 frente a (12+30)/2 = 21) tampoco.

  -- T4 ─────────────────────────────────────────────────────────────────────
  ids := buscar_documentos_compras('ñandu');
  if not (ids @> array[v_f1, v_f2, v_f3, v_a1]) then
    raise exception 'FALLO T4: «ñandu» no encuentra los 4 documentos: %', ids;
  end if;
  ids := buscar_documentos_compras('PESCADILLA prueba lista');   -- producto del catálogo de LL-3
  if not (ids @> array[v_f3]) or ids && array[v_f1, v_f2, v_a1] then
    raise exception 'FALLO T4: producto del catálogo: %', ids;
  end if;
  ids := buscar_documentos_compras('zorongo');                   -- observaciones de LL-1
  if not (ids @> array[v_f1]) or ids && array[v_f2, v_f3, v_a1] then
    raise exception 'FALLO T4: observaciones: %', ids;
  end if;
  ids := buscar_documentos_compras('LL-2 merl');                 -- número (cabecera) + línea
  if not (ids @> array[v_f2]) or ids && array[v_f1, v_f3, v_a1] then
    raise exception 'FALLO T4: dos palabras repartidas: %', ids;
  end if;
  ids := buscar_documentos_compras('gamba portes');              -- dos líneas distintas del mismo documento
  if not (ids @> array[v_f1]) or ids && array[v_f2, v_f3] then
    raise exception 'FALLO T4: palabras en líneas distintas: %', ids;
  end if;
  if cardinality(buscar_documentos_compras('zzqqxx-no-existe')) <> 0 or cardinality(buscar_documentos_compras('   ')) <> 0
     or cardinality(buscar_documentos_compras(null)) <> 0 then
    raise exception 'FALLO T4: lo que no está (o texto vacío) debe dar vacío';
  end if;

  -- T5 ─────────────────────────────────────────────────────────────────────
  d := documento_compras(v_f3)::jsonb;
  if d ->> 'numero_documento' <> 'LL-3' or jsonb_array_length(d -> 'productos') <> 3
     or (d -> 'productos' -> 0 ->> 'id')::bigint <> v_l3 then
    raise exception 'FALLO T5: cabecera o líneas de LL-3: %', d;
  end if;
  if (d -> 'productos' -> 0 ->> 'media_referencia')::numeric <> 11 then
    raise exception 'FALLO T5: media de referencia de la merluza de LL-3 % (esperado 11 = (10+12)/2)', d -> 'productos' -> 0 ->> 'media_referencia';
  end if;
  if d -> 'productos' -> 1 -> 'media_referencia' <> 'null'::jsonb then
    raise exception 'FALLO T5: los portes no deberían tener media: %', d -> 'productos' -> 1;
  end if;
  if d -> 'productos' -> 2 -> 'categoria' <> '{"nombre": "Prueba Blanco", "ruta": "Prueba Mar › Prueba Blanco"}'::jsonb
     or d -> 'productos' -> 2 ->> 'producto_canonico' <> 'Pescadilla prueba lista ligera' then
    raise exception 'FALLO T5: categoría o producto del catálogo: %', d -> 'productos' -> 2;
  end if;
  d := documento_compras(v_f1)::jsonb;
  if (d -> 'productos' -> 0 ->> 'media_referencia')::numeric <> 21
     or d -> 'alertas_validacion' -> 0 ->> 'mensaje' <> 'El IVA no cuadra' or d ->> 'observaciones' is null then
    raise exception 'FALLO T5: LL-1 (media 21, aviso completo y observaciones): %', d;
  end if;
  if documento_compras(-1) is not null then
    raise exception 'FALLO T5: un documento que no existe debería dar null';
  end if;

  -- T6 datos reales ────────────────────────────────────────────────────────
  l := documentos_lista()::jsonb;
  if jsonb_array_length(l -> 'docs') <> (select count(*) from facturas) then
    raise exception 'FALLO T6: % documentos en la lista y % en facturas', jsonb_array_length(l -> 'docs'), (select count(*) from facturas);
  end if;
  select sum((e ->> 16)::int) into v_n from jsonb_array_elements(l -> 'docs') e;
  if v_n <> (select count(*) from productos_factura) then
    raise exception 'FALLO T6: Σ líneas % ≠ %', v_n, (select count(*) from productos_factura);
  end if;
  select coalesce(sum((e -> 18 ->> 0)::numeric), 0) into v_n from jsonb_array_elements(l -> 'docs') e;
  select coalesce(sum(round(r, 2)), 0) into v_m from (
    select sum(importe_bruto - coalesce(total, coalesce(precio_unitario, 0) * coalesce(cantidad, 0))) as r
      from productos_factura
     where importe_bruto - coalesce(total, coalesce(precio_unitario, 0) * coalesce(cantidad, 0)) > 0.005
     group by factura_id) s;
  if v_n <> v_m then
    raise exception 'FALLO T6: Σ regalado % ≠ consulta directa %', v_n, v_m;
  end if;

  -- T7 RLS ─────────────────────────────────────────────────────────────────
  perform set_config('request.jwt.claims', '{"role": "authenticated"}', true);
  set local role authenticated;
  l := documentos_lista()::jsonb;
  ids := buscar_documentos_compras('ñandu');
  d := documento_compras(v_f1)::jsonb;
  reset role;
  if jsonb_array_length(l -> 'docs') <> 0 or cardinality(ids) <> 0 or d is not null then
    raise exception 'FALLO T7: un usuario sin permiso ve documentos (% en la lista)', jsonb_array_length(l -> 'docs');
  end if;
end;
$$;

rollback;

select 'compras_lista_ligera_test: OK' as resultado;
