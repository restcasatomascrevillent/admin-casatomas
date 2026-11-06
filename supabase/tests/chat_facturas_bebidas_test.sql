set client_encoding = 'UTF8';
-- Test de 20261113100000_chat_facturas_bebidas. BEGIN … ROLLBACK: no deja nada escrito.
-- Acaba en «chat_facturas_bebidas_test: OK».
--   supabase db query --linked -f supabase/tests/chat_facturas_bebidas_test.sql
--
--   T1 permisos: anon no ejecuta; authenticated sí; SECURITY INVOKER; ya no existe la firma de 6.
--   T2 volumen_tipo_envase: barril, tercio, quinto, botellín, lata («LATA», «LT 33CL»), brick,
--      bidón, magnum (solo vino), botella, kilos y nulos.
--   T3 datos de prueba (junio de 2031): cajas, sueltas y barriles de cerveza + una mostaza de
--      cerveza (Despensa) que NO cuenta; formato, compra, proveedor, cajas, orden y límite.
--   T4 datos reales (si los hay): cerveza 2026 con barriles y tercios y sin productos de comida;
--      vino 2026 por botellas ordenado de más a menos.
--   T5 RLS: sin permiso de Facturas no se ve nada.
begin;

do $$
declare
  v_cer  bigint;
  v_des  bigint;
  v_pc1  bigint;
  v_pc2  bigint;
  v_pc3  bigint;
  v_p    bigint;
  v_f    bigint;
  v_prev numeric;
  r      json;
  x      json;
  f      text;
  c      record;
begin
  -- T1 ─────────────────────────────────────────────────────────────────────
  foreach f in array array['public.volumen_comprado_agente(text,text,date,date,text,text,integer,text)',
                           'public.volumen_tipo_envase(numeric,text,text,text)'] loop
    if has_function_privilege('anon', f, 'execute') then
      raise exception 'FALLO T1: anon puede ejecutar %', f;
    end if;
    if not has_function_privilege('authenticated', f, 'execute') then
      raise exception 'FALLO T1: authenticated no puede ejecutar %', f;
    end if;
    if (select prosecdef from pg_proc where oid = f::regprocedure) then
      raise exception 'FALLO T1: % es SECURITY DEFINER', f;
    end if;
  end loop;
  if to_regprocedure('public.volumen_comprado_agente(text,text,date,date,text,text)') is not null then
    raise exception 'FALLO T1: sigue existiendo la firma de 6 parámetros (PostgREST no sabría cuál llamar)';
  end if;

  -- T2 ─────────────────────────────────────────────────────────────────────
  for c in select * from (values
      (50::numeric, 'l', 'Cervezas', 'Cruzcampo barril 50 l', 'barril 50 l'),
      (20, 'l', 'Cervezas', 'EL AGUILA SIN FILTRAR 20L', 'barril 20 l'),
      (0.33, 'l', 'Cervezas', 'HEINEKEN 1/3 LONG NET * 24', 'tercio 33 cl'),
      (0.33, 'l', 'Cervezas', 'CERVEZA MAHOU LATA 33CL', 'lata 33 cl'),
      (0.33, 'l', 'Refrescos y aguas', 'AQUARIUS LT 33CL LIMON', 'lata 33 cl'),
      (0.2, 'l', 'Cervezas', 'QUINTO', 'quinto 20 cl'),
      (0.25, 'l', 'Cervezas', 'X', 'botellín 25 cl'),
      (0.5, 'l', 'Cervezas', 'X', 'botella 50 cl'),
      (1.5, 'l', 'Vinos', 'Laurent-Perrier La Cuvée Magnum', 'magnum 1,5 l'),
      (3, 'l', 'Vinos', 'Jeroboam', 'doble magnum 3 l'),
      (1.5, 'l', 'Refrescos y aguas', 'Agua 1,5 l', 'botella 1,5 l'),
      (0.75, 'l', 'Vinos', 'Arienzo 75 cl', 'botella 75 cl'),
      (1, 'l', 'Vinos', 'Vino blanco Viña Lanzar brick 1 L', 'brick 1 l'),
      (5, 'l', 'Vinos', 'Pedro Ximénez dulce Delgado 5 l bidón', 'bidón 5 l'),
      (0.15, 'kg', 'Despensa', 'Mostaza de cerveza 150 g', '150 g')
    ) t(cant, uni, cat, txt, esperado) loop
    if volumen_tipo_envase(c.cant, c.uni, c.cat, c.txt) is distinct from c.esperado then
      raise exception 'FALLO T2: % (% %, %) = % (esperado %)', c.txt, c.cant, c.uni, c.cat,
        volumen_tipo_envase(c.cant, c.uni, c.cat, c.txt), c.esperado;
    end if;
  end loop;
  if volumen_tipo_envase(null, 'l', 'Vinos', 'x') is not null or volumen_tipo_envase(0.75, null, 'Vinos', 'x') is not null then
    raise exception 'FALLO T2: sin contenido o sin unidad debería ser null';
  end if;

  -- T3 ─────────────────────────────────────────────────────────────────────
  if exists (select 1 from facturas where fecha between '2031-06-01' and '2031-06-30') then
    raise exception 'FALLO datos: ya hay documentos en junio de 2031; el test necesita ese mes vacío';
  end if;
  select id into v_cer from categorias_producto where nombre = 'Cervezas';
  select id into v_des from categorias_producto where nombre = 'Despensa';
  insert into productos_catalogo (nombre, categoria_id, origen)
  values ('PruebaBeb Cerveza 33 cl', v_cer, 'manual') returning id into v_pc1;
  insert into productos_catalogo (nombre, categoria_id, origen)
  values ('PruebaBeb Cerveza barril 30 l', v_cer, 'manual') returning id into v_pc2;
  insert into productos_catalogo (nombre, categoria_id, origen)
  values ('PruebaBeb Mostaza de cerveza 150 g', v_des, 'manual') returning id into v_pc3;
  insert into proveedores (nombre, cif) values ('PRUEBA BEBIDAS CHAT', 'B00000402') returning id into v_p;
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
  values ('factura', 'PRUEBA BEBIDAS CHAT', 'B00000402', v_p, 'BEB-1', '2031-06-12', 400, 'casa_tomas') returning id into v_f;
  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, producto_id)
  values (v_f, 'CERVEZA PRUEBABEB 1/3 * 24', 2, 'caja', 30, 60, v_pc1),     -- 2 × 24 × 0,33 = 15,84 l, 48 tercios
         (v_f, 'CERVEZA PRUEBABEB 1/3', 12, 'ud', 0.9, 10.8, v_pc1),       -- 12 tercios = 3,96 l
         (v_f, 'BARRIL PRUEBABEB 30 L', 3, 'barril', 90, 270, v_pc2),      -- 90 l, 3 barriles
         (v_f, 'MOSTAZA DE CERVEZA 150g', 5, 'ud', 3, 15, v_pc3);          -- comida: no es cerveza

  r := volumen_comprado_agente(null, 'cerveza', '2031-06-01', '2031-06-30');
  if (r ->> 'total')::numeric <> 109.80 or (r ->> 'envases')::numeric <> 63 or (r ->> 'cajas')::numeric <> 2
     or (r ->> 'productos')::int <> 2 or (r ->> 'productos_truncado')::boolean or (r ->> 'orden') <> 'total' then
    raise exception 'FALLO T3: cerveza junio 2031 = % (esperado 109,80 l, 63 envases, 2 cajas, 2 productos)', r;
  end if;
  if r::text ilike '%mostaza%' then
    raise exception 'FALLO T3: la mostaza de cerveza (Despensa) sale como cerveza: %', r -> 'por_producto';
  end if;
  x := r -> 'por_producto' -> 0;
  if (x ->> 'producto', x ->> 'formato', x ->> 'compra', (x ->> 'envases')::numeric)
     is distinct from ('PruebaBeb Cerveza barril 30 l', 'barril 30 l', '3 barril', 3::numeric) then
    raise exception 'FALLO T3: primer producto por litros = %', x;
  end if;
  x := r -> 'por_producto' -> 1;
  if (x ->> 'formato', x ->> 'compra', (x ->> 'envases')::numeric, x ->> 'proveedor', x ->> 'envase')
     is distinct from ('tercio 33 cl', '2 caja de 24, 12 ud', 60::numeric, 'PRUEBA BEBIDAS CHAT', '33 cl') then
    raise exception 'FALLO T3: tercios = % (esperado «2 caja de 24, 12 ud», 60 tercios)', x;
  end if;
  select pe into x from json_array_elements(r -> 'por_envase') pe where pe ->> 'formato' = 'tercio 33 cl';
  if (x ->> 'envases')::numeric <> 60 or (x ->> 'envase') <> '33 cl' then
    raise exception 'FALLO T3: por_envase tercio = %', x;
  end if;
  x := r -> 'por_proveedor' -> 0;
  if (x ->> 'proveedor', (x ->> 'envases')::numeric, (x ->> 'productos')::int)
     is distinct from ('PRUEBA BEBIDAS CHAT', 63::numeric, 2) then
    raise exception 'FALLO T3: por_proveedor = %', x;
  end if;

  r := volumen_comprado_agente(null, 'cerveza', '2031-06-01', '2031-06-30', null, null, null, 'envases');
  if (r -> 'por_producto' -> 0 ->> 'formato') <> 'tercio 33 cl' or (r ->> 'orden') <> 'envases' then
    raise exception 'FALLO T3: por envases tienen que ir primero los tercios: %', r -> 'por_producto';
  end if;
  r := volumen_comprado_agente(null, 'cerveza', '2031-06-01', '2031-06-30', null, null, 1, null);
  if json_array_length(r -> 'por_producto') <> 1 or not (r ->> 'productos_truncado')::boolean then
    raise exception 'FALLO T3: límite 1 = % productos, truncado %', json_array_length(r -> 'por_producto'), r ->> 'productos_truncado';
  end if;
  r := volumen_comprado_agente(null, 'cerveza', '2031-06-01', '2031-06-30', null, null, 999, 'botellas');
  if r ->> 'error' is not null or json_array_length(r -> 'por_producto') <> 2 or (r ->> 'orden') <> 'envases' then
    raise exception 'FALLO T3: límite fuera de rango o «botellas» = %', r;
  end if;
  -- Con 4 parámetros, como antes.
  r := volumen_comprado_agente('cerveza', null, '2031-06-01', '2031-06-30');
  if (r ->> 'total')::numeric <> 109.80 then
    raise exception 'FALLO T3: la llamada de 4 parámetros ya no vale: %', r ->> 'total';
  end if;

  -- T4 datos reales ─────────────────────────────────────────────────────────
  if exists (select 1 from volumen_lineas where categoria_id = v_cer and fecha >= '2026-01-01' and fecha < '2027-01-01') then
    r := volumen_comprado_agente(null, 'cerveza', '2026-01-01', '2026-12-31', null, null, 40, null);
    if not exists (select 1 from json_array_elements(r -> 'por_envase') pe where pe ->> 'formato' like 'barril %')
       or not exists (select 1 from json_array_elements(r -> 'por_envase') pe where pe ->> 'formato' = 'tercio 33 cl') then
      raise exception 'FALLO T4: cerveza 2026 sin barriles o sin tercios: %', r -> 'por_envase';
    end if;
    if exists (select 1 from json_array_elements(r -> 'por_producto') pp
                 join productos_catalogo pc on pc.nombre = pp ->> 'producto'
                 join categorias_producto cp on cp.id = pc.categoria_id
                where cp.nombre <> 'Cervezas') then
      raise exception 'FALLO T4: sale como cerveza un producto de otra categoría';
    end if;
  end if;
  if exists (select 1 from volumen_lineas v join categorias_producto cp on cp.id = v.categoria_id
              where cp.nombre = 'Vinos' and v.fecha >= '2026-01-01' and v.fecha < '2027-01-01') then
    r := volumen_comprado_agente(null, 'vino', '2026-01-01', '2026-12-31', null, null, 30, 'envases');
    v_prev := null;
    for x in select pp from json_array_elements(r -> 'por_producto') pp loop
      if v_prev is not null and (x ->> 'envases')::numeric > v_prev then
        raise exception 'FALLO T4: vino por botellas no va de más a menos: %', x;
      end if;
      v_prev := (x ->> 'envases')::numeric;
    end loop;
  end if;

  -- T5 RLS ─────────────────────────────────────────────────────────────────
  perform set_config('request.jwt.claims', '{"role": "authenticated"}', true);
  set local role authenticated;
  r := volumen_comprado_agente(null, 'cerveza', '2031-06-01', '2031-06-30');
  reset role;
  if (r ->> 'total')::numeric <> 0 or coalesce((r ->> 'envases')::numeric, 0) <> 0 then
    raise exception 'FALLO T5: un usuario sin permiso ve % l', r ->> 'total';
  end if;
end;
$$;

rollback;

select 'chat_facturas_bebidas_test: OK' as resultado;
