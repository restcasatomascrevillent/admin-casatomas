set client_encoding = 'UTF8';
-- Test de 20261107100000_chat_facturas_asociacion. BEGIN … ROLLBACK: no deja nada escrito.
-- Acaba en «chat_facturas_asociacion_test: OK».
--   supabase db query --linked -f supabase/tests/chat_facturas_asociacion_test.sql
--
--   T1 permisos: anon no ejecuta ni lee terminos_agente; authenticated sí; SECURITY INVOKER; RLS.
--   T2 asociar_termino_agente: familias (cerveza, birra, vino, marisco, pescado y marisco),
--      formatos (cerveza de barril, tercios, lata), productos (gamba, ginebra) y texto suelto.
--   T3 categoria_agente con la tabla: birra, gamba, conserva, vino, nombre exacto.
--   T4 datos de prueba (junio de 2031), dos proveedores: «birra» y «cerveza» son la familia
--      (sin la mostaza de cerveza), precio por litro total/proveedor/formato/producto con
--      mínimo y máximo, formato pedido («cerveza de barril», «tercios»), comparables;
--      lineas_producto_agente: familia, y «gamba» sin la croqueta de gambas (derivado).
--   T5 asociar_pregunta_agente: las preguntas reales del dueño.
--   T6 datos reales (si los hay): cerveza 2026 con €/l por proveedor y formato.
--   T7 RLS: sin permiso de Facturas no se ve nada.
begin;

do $$
declare
  v_cer  bigint;
  v_des  bigint;
  v_mar  bigint;
  v_con  bigint;
  v_pc1  bigint;
  v_pc2  bigint;
  v_pc3  bigint;
  v_pc4  bigint;
  v_pc5  bigint;
  v_p1   bigint;
  v_p2   bigint;
  v_f    bigint;
  r      json;
  x      json;
  f      text;
  c      record;
  l      record;
begin
  -- T1 ─────────────────────────────────────────────────────────────────────
  foreach f in array array['public.asociar_termino_agente(text)', 'public.asociar_pregunta_agente(text)',
                           'public.lineas_producto_agente(text,text)', 'public.lineas_producto_base_agente(text,text)',
                           'public.categoria_agente(text)',
                           'public.volumen_comprado_agente(text,text,date,date,text,text,integer,text)'] loop
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
  if has_table_privilege('anon', 'public.terminos_agente', 'select')
     or has_table_privilege('authenticated', 'public.terminos_agente', 'insert')
     or not has_table_privilege('authenticated', 'public.terminos_agente', 'select')
     or not (select relrowsecurity from pg_class where oid = 'public.terminos_agente'::regclass) then
    raise exception 'FALLO T1: permisos o RLS de terminos_agente';
  end if;

  -- T2 ─────────────────────────────────────────────────────────────────────
  for c in select * from (values
      ('cerveza', 'familia', 'Cervezas', null),
      ('las cervezas', 'familia', 'Cervezas', null),
      ('birra', 'familia', 'Cervezas', null),
      ('cerveza de barril', 'familia', 'Cervezas', 'barril'),
      ('cañas', 'familia', 'Cervezas', 'barril'),
      ('tercios', 'familia', 'Cervezas', 'tercio'),
      ('vino', 'familia', 'Vinos', null),
      ('vinos', 'familia', 'Vinos', null),
      ('licores', 'familia', 'Licores y destilados', null),
      ('marisco', 'familia', 'Marisco', null),
      ('pescado y marisco', 'familia', 'Pescado y marisco', null),
      ('conservas', 'familia', 'Conservas y salazones', null),
      ('ginebra', 'producto', 'Licores y destilados', null),
      ('lata', 'formato', null, 'lata')
    ) t(txt, tipo, cat, fmt) loop
    r := asociar_termino_agente(c.txt);
    if (r ->> 'tipo', r ->> 'categoria', r ->> 'formato') is distinct from (c.tipo, c.cat, c.fmt) then
      raise exception 'FALLO T2: «%» = % (esperado % %, formato %)', c.txt, r, c.tipo, c.cat, c.fmt;
    end if;
  end loop;
  r := asociar_termino_agente('xyzzy plof');
  if r ->> 'tipo' <> 'texto' or r ->> 'categoria' is not null then
    raise exception 'FALLO T2: texto desconocido = %', r;
  end if;
  r := asociar_termino_agente('de la');
  if r ->> 'tipo' <> 'ninguno' then
    raise exception 'FALLO T2: solo relleno = %', r;
  end if;

  -- T3 ─────────────────────────────────────────────────────────────────────
  for c in select * from (values
      ('birra', 'Cervezas'), ('gamba', 'Marisco'), ('conserva', 'Conservas y salazones'),
      ('vino', 'Vinos'), ('cerveza', 'Cervezas'), ('Refrescos y aguas', 'Refrescos y aguas'),
      ('ginebra', 'Licores y destilados'), ('jamon', 'Embutidos e ibéricos'), ('limpieza', 'Limpieza y desechables')
    ) t(txt, cat) loop
    if (select nombre from categorias_producto where id = categoria_agente(c.txt)) is distinct from c.cat then
      raise exception 'FALLO T3: categoria_agente(«%») = % (esperado %)', c.txt,
        (select nombre from categorias_producto where id = categoria_agente(c.txt)), c.cat;
    end if;
  end loop;

  -- T4 ─────────────────────────────────────────────────────────────────────
  if exists (select 1 from facturas where fecha between '2031-06-01' and '2031-06-30') then
    raise exception 'FALLO datos: ya hay documentos en junio de 2031; el test necesita ese mes vacío';
  end if;
  select id into v_cer from categorias_producto where clave = 'bebidas.cervezas';
  select id into v_des from categorias_producto where clave = 'despensa';
  select id into v_mar from categorias_producto where clave = 'pescado_marisco.marisco';
  select id into v_con from categorias_producto where clave = 'congelados';
  insert into productos_catalogo (nombre, categoria_id, origen)
  values ('Pruebasoc Cerveza 33 cl', v_cer, 'manual') returning id into v_pc1;
  insert into productos_catalogo (nombre, categoria_id, origen)
  values ('Pruebasoc Cerveza barril 30 l', v_cer, 'manual') returning id into v_pc2;
  insert into productos_catalogo (nombre, categoria_id, origen)
  values ('Pruebasoc Mostaza de cerveza 150 g', v_des, 'manual') returning id into v_pc3;
  insert into productos_catalogo (nombre, categoria_id, origen)
  values ('Pruebasoc Gamba blanca', v_mar, 'manual') returning id into v_pc4;
  insert into productos_catalogo (nombre, categoria_id, origen)
  values ('Pruebasoc Croqueta de gambas', v_con, 'manual') returning id into v_pc5;
  insert into proveedores (nombre, cif) values ('PRUEBA ASOC UNO', 'B00000501') returning id into v_p1;
  insert into proveedores (nombre, cif) values ('PRUEBA ASOC DOS', 'B00000502') returning id into v_p2;
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
  values ('factura', 'PRUEBA ASOC UNO', 'B00000501', v_p1, 'ASOC-1', '2031-06-10', 400, 'casa_tomas') returning id into v_f;
  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, producto_id)
  values (v_f, 'CERVEZA PRUEBASOC 1/3 * 24', 2, 'caja', 23.76, 47.52, v_pc1),   -- 15,84 l a 3,00 €/l
         (v_f, 'BARRIL PRUEBASOC 30 L', 2, 'barril', 60, 120, v_pc2),          -- 60 l a 2,00 €/l
         (v_f, 'MOSTAZA DE CERVEZA PRUEBASOC 150g', 5, 'ud', 3, 15, v_pc3),    -- comida: no es cerveza
         (v_f, 'GAMBA BLANCA PRUEBASOC', 2, 'kg', 20, 40, v_pc4),
         (v_f, 'CROQUETA DE GAMBAS PRUEBASOC', 1, 'kg', 8, 8, v_pc5);
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
  values ('factura', 'PRUEBA ASOC DOS', 'B00000502', v_p2, 'ASOC-2', '2031-06-20', 200, 'casa_tomas') returning id into v_f;
  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, producto_id)
  values (v_f, 'BARRIL PRUEBASOC 30 L', 1, 'barril', 75, 75, v_pc2),           -- 30 l a 2,50 €/l
         (v_f, 'GAMBA BLANCA PRUEBASOC', 1, 'kg', 26, 26, v_pc4);

  -- «birra» como producto = familia Cervezas; la mostaza no entra.
  r := volumen_comprado_agente('birra', null, '2031-06-01', '2031-06-30');
  if (r ->> 'categoria') <> 'Cervezas' or (r ->> 'total')::numeric <> 105.84 or r::text ilike '%mostaza%' then
    raise exception 'FALLO T4: birra junio 2031 = % (esperado Cervezas, 105,84 l, sin mostaza)', r;
  end if;
  -- Precio total: (47,52 + 120 + 75) / 105,84 = 2,29 €/l; min 2,00 (barril uno), max 3,00 (tercios).
  if ((r ->> 'precio')::numeric, (r ->> 'precio_min')::numeric, (r ->> 'precio_max')::numeric, (r ->> 'proveedores')::int)
     is distinct from (2.29, 2.00, 3.00, 2) then
    raise exception 'FALLO T4: precio = % / % / %, proveedores % (esperado 2,29 / 2,00 / 3,00, 2)',
      r ->> 'precio', r ->> 'precio_min', r ->> 'precio_max', r ->> 'proveedores';
  end if;
  select pp into x from json_array_elements(r -> 'por_proveedor') pp where pp ->> 'proveedor' = 'PRUEBA ASOC UNO';
  if ((x ->> 'precio')::numeric, (x ->> 'importe')::numeric, (x ->> 'precio_min')::numeric, (x ->> 'precio_max')::numeric)
     is distinct from (2.21, 167.52, 2.00, 3.00) then
    raise exception 'FALLO T4: por_proveedor UNO = % (esperado 2,21 €/l, 167,52 €, 2,00-3,00)', x;
  end if;
  select pp into x from json_array_elements(r -> 'por_envase') pp where pp ->> 'formato' = 'barril 30 l';
  if ((x ->> 'precio')::numeric, (x ->> 'precio_min')::numeric, (x ->> 'precio_max')::numeric)
     is distinct from (2.17, 2.00, 2.50) then
    raise exception 'FALLO T4: por_envase barril = % (esperado 2,17 €/l, 2,00-2,50)', x;
  end if;
  select pp into x from json_array_elements(r -> 'por_proveedor_formato') pp
   where pp ->> 'proveedor' = 'PRUEBA ASOC DOS' and pp ->> 'formato' = 'barril 30 l';
  if (x ->> 'precio')::numeric is distinct from 2.50 then
    raise exception 'FALLO T4: por_proveedor_formato DOS barril = %', r -> 'por_proveedor_formato';
  end if;
  select pp into x from json_array_elements(r -> 'comparables') pp where pp ->> 'producto' = 'Pruebasoc Cerveza barril 30 l';
  if (x ->> 'n_proveedores')::int is distinct from 2 or (x -> 'proveedores' -> 0 ->> 'proveedor') <> 'PRUEBA ASOC UNO' then
    raise exception 'FALLO T4: comparables del barril = % (esperado 2 proveedores, el más barato primero)', x;
  end if;
  select pp into x from json_array_elements(r -> 'por_producto') pp where pp ->> 'producto' = 'Pruebasoc Cerveza 33 cl';
  if (x ->> 'precio')::numeric is distinct from 3.00 then
    raise exception 'FALLO T4: por_producto tercio = %', x;
  end if;
  if (select count(*) from json_array_elements(r -> 'por_mes') m where m ->> 'mes' = '2031-06' and (m ->> 'precio')::numeric = 2.29) <> 1 then
    raise exception 'FALLO T4: por_mes = %', r -> 'por_mes';
  end if;
  -- Formato pedido.
  r := volumen_comprado_agente('cerveza de barril', null, '2031-06-01', '2031-06-30');
  if (r ->> 'formato_pedido') <> 'barril' or (r ->> 'total')::numeric <> 90 or (r ->> 'precio')::numeric <> 2.17 then
    raise exception 'FALLO T4: cerveza de barril = % l a % €/l (esperado 90 l a 2,17)', r ->> 'total', r ->> 'precio';
  end if;
  r := volumen_comprado_agente(null, 'cerveza', '2031-06-01', '2031-06-30');
  if (r ->> 'total')::numeric <> 105.84 then
    raise exception 'FALLO T4: categoria cerveza = %', r ->> 'total';
  end if;
  r := volumen_comprado_agente('tercios', null, '2031-06-01', '2031-06-30');
  if (r ->> 'total')::numeric <> 15.84 or (r ->> 'precio')::numeric <> 3.00 then
    raise exception 'FALLO T4: tercios = % l a % €/l', r ->> 'total', r ->> 'precio';
  end if;
  r := volumen_comprado_agente('pruebasoc botellin', null, '2031-06-01', '2031-06-30');
  if (r ->> 'total')::numeric <> 15.84 then
    raise exception 'FALLO T4: «botellín» debería incluir los tercios: %', r ->> 'total';
  end if;
  -- Kilos de gamba: sin la croqueta de gambas (Congelados), que sale como derivado.
  r := volumen_comprado_agente('gamba pruebasoc', null, '2031-06-01', '2031-06-30', null, 'kg');
  if (r ->> 'total')::numeric <> 3 or (r ->> 'precio')::numeric <> 22.00 or r::text ilike '%croqueta de gambas", "total%' then
    raise exception 'FALLO T4: gamba = % kg a % €/kg (esperado 3 kg a 22,00)', r ->> 'total', r ->> 'precio';
  end if;
  if not (r -> 'derivados_excluidos')::text ilike '%croqueta%' then
    raise exception 'FALLO T4: la croqueta de gambas debería salir en derivados_excluidos: %', r -> 'derivados_excluidos';
  end if;
  -- lineas_producto_agente: familia, y producto sin derivados de otra familia.
  select * into l from lineas_producto_agente('pruebasoc cerveza');
  if l.metodo <> 'texto' then
    raise exception 'FALLO T4: «pruebasoc cerveza» es producto (texto), no %', l.metodo;
  end if;
  select * into l from lineas_producto_agente('cervezas');
  if l.metodo <> 'familia' or exists (select 1 from unnest(l.ids) i join productos_factura pf on pf.id = i
                                       where pf.producto_id = v_pc3) then
    raise exception 'FALLO T4: «cervezas» tiene que ser la familia sin la mostaza (metodo %)', l.metodo;
  end if;
  select * into l from lineas_producto_agente('gamba pruebasoc');
  if exists (select 1 from unnest(l.ids) i join productos_factura pf on pf.id = i where pf.producto_id = v_pc5)
     or not exists (select 1 from unnest(l.subproductos) s where s ilike '%croqueta%') then
    raise exception 'FALLO T4: «gamba» incluye la croqueta o no la aparta: % / %', l.ids, l.subproductos;
  end if;
  select * into l from lineas_producto_agente('croqueta de gambas pruebasoc');
  if not exists (select 1 from unnest(l.ids) i join productos_factura pf on pf.id = i where pf.producto_id = v_pc5) then
    raise exception 'FALLO T4: pedida la croqueta de gambas, tiene que salir';
  end if;
  select * into l from lineas_producto_agente('mostaza de cerveza pruebasoc');
  if not exists (select 1 from unnest(l.ids) i join productos_factura pf on pf.id = i where pf.producto_id = v_pc3) then
    raise exception 'FALLO T4: pedida la mostaza de cerveza, tiene que salir';
  end if;

  -- T5 ─────────────────────────────────────────────────────────────────────
  for c in select * from (values
      ('hazme una comparativa de a cuánto estoy comprando el litro de cerveza de todos los proveedores en el último año', 'cerveza', 'Cervezas'),
      ('Cuánto me he gastado en vino en el último mes', 'vino', 'Vinos'),
      ('y en cerveza?', 'cerveza', 'Cervezas'),
      ('qué proveedor de marisco me sale más caro', 'marisco', 'Marisco'),
      ('precio del litro de vino por proveedor', 'vino', 'Vinos'),
      ('kilos de gamba roja y precio por kilo', 'gamba', 'Marisco')
    ) t(q, palabra, cat) loop
    r := asociar_pregunta_agente(c.q);
    if not exists (select 1 from json_array_elements(r) e where e ->> 'palabra' = c.palabra and e ->> 'categoria' = c.cat) then
      raise exception 'FALLO T5: «%» → % (esperado % = %)', c.q, r, c.palabra, c.cat;
    end if;
    if exists (select 1 from json_array_elements(r) e
                where e ->> 'palabra' in ('litro', 'proveedor', 'proveedores', 'precio', 'ultimo', 'mes', 'comparativa', 'gastado')) then
      raise exception 'FALLO T5: «%» asocia palabras de la pregunta: %', c.q, r;
    end if;
  end loop;
  r := asociar_pregunta_agente('a cuánto me sale el litro de cerveza de barril frente al botellín');
  if not exists (select 1 from json_array_elements(r) e where e ->> 'formato' = 'barril')
     or not exists (select 1 from json_array_elements(r) e where e ->> 'formato' = 'botellin') then
    raise exception 'FALLO T5: barril frente a botellín = %', r;
  end if;
  if json_array_length(asociar_pregunta_agente('hazme la comparativa')) <> 0 then
    raise exception 'FALLO T5: «hazme la comparativa» no tiene tema: %', asociar_pregunta_agente('hazme la comparativa');
  end if;

  -- T6 datos reales ─────────────────────────────────────────────────────────
  if exists (select 1 from volumen_lineas where categoria_id = v_cer and fecha >= '2026-01-01' and fecha < '2027-01-01'
               and fecha < '2031-01-01') then
    r := volumen_comprado_agente('cerveza', null, '2026-01-01', '2026-12-31');
    if (r ->> 'categoria') <> 'Cervezas' or (r ->> 'precio') is null or (r -> 'por_proveedor' -> 0 ->> 'precio') is null
       or not exists (select 1 from json_array_elements(r -> 'por_envase') pe
                       where pe ->> 'formato' like 'barril %' and (pe ->> 'precio') is not null)
       or (r ->> 'precio')::numeric not between 1 and 20 then
      raise exception 'FALLO T6: cerveza 2026 sin €/l coherente: precio %, envases %', r ->> 'precio', r -> 'por_envase';
    end if;
    if length(r::text) > 12000 then
      raise exception 'FALLO T6: el resultado de cerveza pasa del tope del chatbot (% caracteres)', length(r::text);
    end if;
  end if;

  -- T7 RLS ─────────────────────────────────────────────────────────────────
  perform set_config('request.jwt.claims', '{"role": "authenticated"}', true);
  set local role authenticated;
  r := volumen_comprado_agente('birra', null, '2031-06-01', '2031-06-30');
  reset role;
  if (r ->> 'total')::numeric <> 0 or (r ->> 'precio') is not null then
    raise exception 'FALLO T7: un usuario sin permiso ve % l a % €/l', r ->> 'total', r ->> 'precio';
  end if;
end;
$$;

rollback;

select 'chat_facturas_asociacion_test: OK' as resultado;
