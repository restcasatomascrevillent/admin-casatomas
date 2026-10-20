set client_encoding = 'UTF8';
-- ===========================================================================
-- Pruebas de 20261007160000_productos_catalogo_categorias.sql
-- SQL plano con ASSERT dentro de BEGIN … ROLLBACK: no deja nada escrito.
-- DESPUÉS de aplicar la migración, POR TERMINAL:
--   npx supabase db query --linked -f supabase/tests/productos_catalogo_categorias_test.sql
-- Si termina sin ERROR e imprime «productos_catalogo_categorias_test: OK», todo ha pasado.
--
-- Cubre:
--   T1 semilla (11 categorías + 9 subcategorías con clave) y carga inicial
--      (las 165 líneas del 07/10/2026 con producto, todos con categoría).
--   T2 trigger: una línea nueva con texto conocido se asigna sola; una
--      desconocida queda sin producto; al corregir su texto, se asigna.
--   T3 privilegios: anon nada; authenticated no ejecuta la RPC de la IA; cron
--      instalado.
--   T4 usuario SIN la sección: no ve nada y no puede escribir.
--   T5 usuario con VISTA: lee catálogo y resúmenes, no puede cambiar nada.
--   T6 usuario con EDICIÓN: asignar líneas (producto nuevo/existente),
--      fusionar (mueve líneas y alias, borra el duplicado), renombrar
--      (colisión → 23505), recategorizar, borrar (con líneas → 23503),
--      categorías (crear sí, tercer nivel no); el resumen cuadra.
--   T7 clasificación de la IA (service_role): crea producto 'ia', asigna la
--      línea y NO pisa un alias que ya exista.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- Datos de prueba (como postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000c501', 'test-productos-vista@rls.local'),
  ('00000000-0000-0000-0000-00000000c502', 'test-productos-edicion@rls.local'),
  ('00000000-0000-0000-0000-00000000c503', 'test-productos-sin-seccion@rls.local');
insert into public.user_permissions (user_id, section_key, can_view, can_edit) values
  ('00000000-0000-0000-0000-00000000c501', 'facturas', true, false),
  ('00000000-0000-0000-0000-00000000c502', 'facturas', true, true);

insert into public.facturas (tipo, proveedor, numero_documento, fecha, subtotal, total)
values ('factura', 'TEST PRODUCTOS SL', 'TEST-PROD-0001', date '2099-01-15', 100, 121);

insert into public.productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total)
select f.id, x.nombre, x.cantidad, x.unidad, x.precio, x.total
  from public.facturas f,
       (values ('NATOP (20% nata animal de 35mg) 2 L -Debic-', 24::numeric, 'kg', 4.14::numeric, 99.36::numeric),
               ('TEST línea desconocida XYZ',                  1,             'ud', 0.64,             0.64),
               ('TEST otra línea ABC',                         2,             'ud', 5,                10),
               ('TEST texto para la IA 123',                   1,             'ud', 10,               10)) as x(nombre, cantidad, unidad, precio, total)
 where f.numero_documento = 'TEST-PROD-0001' and f.proveedor = 'TEST PRODUCTOS SL';

-- ---------------------------------------------------------------------------
-- T1-T3 (como postgres)
-- ---------------------------------------------------------------------------
do $t1$
declare
  v_fid bigint;
  v_nata bigint;
  v_portes bigint;
  r record;
begin
  -- T1 semilla
  assert (select count(*) from public.categorias_producto where clave is not null) = 20,
    'T1a: la semilla tiene que tener 20 categorías con clave';
  assert (select count(*) from public.categorias_producto where clave is not null and padre_id is null) = 11,
    'T1b: 11 categorías de primer nivel';
  assert (select count(*) from public.categorias_producto c join public.categorias_producto p on p.id = c.padre_id
           where p.clave = 'bebidas') = 5, 'T1c: Bebidas tiene 5 subcategorías';
  assert exists (select 1 from public.categorias_producto c join public.categorias_producto p on p.id = c.padre_id
                  where c.clave = 'pescado_marisco.marisco' and c.nombre = 'Marisco' and p.nombre = 'Pescado y marisco'),
    'T1d: Pescado y marisco › Marisco';

  -- T1 carga inicial
  assert (select count(*) from public.productos_catalogo) >= 116, 'T1e: faltan productos de la carga inicial';
  assert not exists (
    select 1 from public.productos_factura
     where producto_id is null
       and id = any(array[
      362, 363, 364, 365, 366, 367, 368, 369, 370, 371, 372, 373, 374, 375, 376,
      377, 378, 379, 380, 381, 382, 383, 384, 385, 386, 387, 388, 392, 393, 394,
      395, 396, 397, 398, 399, 400, 401, 402, 403, 404, 405, 406, 407, 408, 409,
      410, 411, 412, 413, 414, 415, 416, 417, 418, 419, 420, 421, 422, 423, 424,
      425, 426, 427, 428, 429, 430, 431, 432, 433, 434, 435, 436, 437, 438, 439,
      440, 441, 442, 443, 444, 445, 446, 447, 448, 449, 450, 451, 452, 453, 454,
      455, 456, 457, 458, 459, 460, 461, 462, 463, 464, 465, 466, 997, 998, 999,
      1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009, 1010, 1011, 1012, 1013, 1014,
      1015, 1016, 1017, 1018, 1019, 1020, 1021, 1022, 1023, 1024, 1025, 1026, 1027, 1028, 1029,
      1030, 1031, 1032, 1033, 1034, 1035, 1036, 1037, 1038, 1039, 1040, 1041, 1042, 1043, 1044,
      1045, 1046, 1047, 1048, 1049, 1050, 1324, 1325, 1326, 1501, 1502, 1503, 1504, 1505, 1506]::bigint[])),
    'T1f: alguna de las 165 líneas de la carga inicial sigue sin producto';
  assert not exists (select 1 from public.productos_catalogo p
                      where exists (select 1 from public.productos_factura pf where pf.producto_id = p.id)
                        and p.categoria_id is null and p.origen = 'ia'),
    'T1g: hay productos de la carga inicial sin categoría';
  -- Ejemplos de la revisión a mano.
  select p.id into v_nata from public.productos_catalogo p where p.nombre = 'Nata Natop Debic 2 L';
  assert v_nata is not null, 'T1h: falta «Nata Natop Debic 2 L»';
  assert (select count(*) from public.productos_factura where producto_id = v_nata and id between 997 and 1050) = 5,
    'T1i: las 5 líneas NATOP de Luga tienen que ir a la misma nata';
  assert (select c.clave from public.productos_catalogo p join public.categorias_producto c on c.id = p.categoria_id
           where p.nombre = 'Centolla hembra 1-1,5 kg') = 'pescado_marisco.marisco', 'T1j: la centolla es marisco';
  assert (select count(distinct producto_id) from public.productos_factura where id in (1002, 1026, 1048)) = 1,
    'T1k: «Rústico pomodoro» y la errata «romodico» son el mismo producto';
  assert (select c.clave from public.productos_factura pf join public.productos_catalogo p on p.id = pf.producto_id
            join public.categorias_producto c on c.id = p.categoria_id where pf.id = 443) = 'bebidas.vinos',
    'T1l: Flor de Pingus es vino';

  -- T2 trigger
  select id into v_fid from public.facturas where numero_documento = 'TEST-PROD-0001';
  assert (select producto_id from public.productos_factura where factura_id = v_fid and nombre like 'NATOP%') = v_nata,
    'T2a: una línea NATOP nueva tiene que asignarse sola a la nata';
  assert (select producto_id from public.productos_factura where factura_id = v_fid and nombre = 'TEST línea desconocida XYZ') is null,
    'T2b: una línea desconocida queda sin producto';
  select p.id into v_portes from public.productos_catalogo p where p.nombre = 'Portes';
  update public.productos_factura set nombre = 'PORTES' where factura_id = v_fid and nombre = 'TEST línea desconocida XYZ';
  assert (select producto_id from public.productos_factura where factura_id = v_fid and nombre = 'PORTES') = v_portes,
    'T2c: al corregir el texto a uno conocido, se asigna';
  update public.productos_factura set nombre = 'PORTES Y EMBALAJE' where factura_id = v_fid and nombre = 'PORTES';
  assert (select producto_id from public.productos_factura where factura_id = v_fid and nombre = 'PORTES Y EMBALAJE') = v_portes,
    'T2d: si ya tiene producto, cambiar el texto no lo cambia';

  -- T3 privilegios
  assert not has_table_privilege('anon', 'public.productos_catalogo', 'select'), 'T3a: anon lee productos_catalogo';
  assert not has_table_privilege('anon', 'public.categorias_producto', 'select'), 'T3b: anon lee categorias_producto';
  assert not has_table_privilege('anon', 'public.productos_alias', 'select'), 'T3c: anon lee productos_alias';
  assert not has_table_privilege('authenticated', 'public.productos_catalogo', 'insert'), 'T3d: authenticated inserta en el catálogo sin RPC';
  assert not has_function_privilege('authenticated', 'public.productos_aplicar_clasificacion_ia(jsonb)', 'execute'),
    'T3e: authenticated ejecuta la RPC de la IA';
  assert not has_function_privilege('anon', 'public.productos_fusionar(bigint[],bigint)', 'execute'), 'T3f: anon fusiona';
  assert not has_function_privilege('authenticated', 'public.productos_despachar_clasificacion()', 'execute'),
    'T3g: authenticated lanza el despachador';
  assert (select count(*) from cron.job where jobname = 'clasificar-productos' and schedule = '*/5 * * * *') = 1,
    'T3h: falta el cron clasificar-productos';
  assert to_regclass('public.ia_funciones') is null
         or exists (select 1 from public.ia_funciones where funcion = 'clasificar-productos'),
    'T3i: falta clasificar-productos en ia_funciones';
end
$t1$;

-- ---------------------------------------------------------------------------
-- T4 usuario SIN la sección facturas
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000c503';
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000c503","role":"authenticated"}';

do $t4$
begin
  assert auth.uid() = '00000000-0000-0000-0000-00000000c503'::uuid, 'T4a: auth.uid() no es el usuario de prueba';
  assert (select count(*) from public.productos_catalogo) = 0, 'T4b: sin la sección ve el catálogo';
  assert (select count(*) from public.categorias_producto) = 0, 'T4c: sin la sección ve las categorías';
  assert (select count(*) from public.productos_resumen()) = 0, 'T4d: sin la sección ve el resumen';
  begin
    perform public.productos_renombrar(1, 'x');
    raise exception 'T4e: sin la sección pudo renombrar';
  exception when insufficient_privilege then null;
  end;
end
$t4$;

reset role;

-- ---------------------------------------------------------------------------
-- T5 usuario con VISTA de facturas (sin edición)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000c501';
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000c501","role":"authenticated"}';

do $t5$
declare
  v_id bigint;
begin
  assert (select count(*) from public.productos_catalogo) >= 116, 'T5a: con vista no ve el catálogo';
  assert (select count(*) from public.categorias_producto) >= 20, 'T5b: con vista no ve las categorías';
  assert (select count(*) from public.productos_resumen() where compras > 0) >= 116, 'T5c: el resumen no trae los productos';
  assert exists (select 1 from public.productos_gasto_por_categoria() where categoria = 'Vinos' and gasto > 12000),
    'T5d: el gasto en vinos tiene que pasar de 12.000 (Insula Roma)';
  select id into v_id from public.productos_catalogo where nombre = 'Portes';
  begin
    perform public.productos_renombrar(v_id, 'Portes y envíos');
    raise exception 'T5e: con solo vista pudo renombrar';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.productos_fusionar(array[v_id], v_id + 1);
    raise exception 'T5f: con solo vista pudo fusionar';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.categorias_producto (nombre) values ('TEST categoría vista');
    raise exception 'T5g: con solo vista pudo crear una categoría';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.productos_factura set producto_id = null where id = 362;
    assert not found, 'T5h: con solo vista pudo cambiar una línea';
  end;
end
$t5$;

reset role;

-- ---------------------------------------------------------------------------
-- T6 usuario con EDICIÓN de facturas
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000c502';
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000c502","role":"authenticated"}';

do $t6$
declare
  v_fid   bigint;
  v_abc   bigint;
  v_def   bigint;
  v_l_abc bigint;
  v_l_def bigint;
  v_desp  bigint;
  v_vinos bigint;
  v_cat   bigint;
  j       jsonb;
  r       record;
begin
  select id into v_fid from public.facturas where numero_documento = 'TEST-PROD-0001';
  select id into v_l_abc from public.productos_factura where factura_id = v_fid and nombre = 'TEST otra línea ABC';
  select id into v_l_def from public.productos_factura where factura_id = v_fid and nombre = 'PORTES Y EMBALAJE';
  select id into v_desp from public.categorias_producto where clave = 'despensa';
  select id into v_vinos from public.categorias_producto where clave = 'bebidas.vinos';

  -- Asignar a un producto NUEVO
  j := public.productos_asignar_lineas(array[v_l_abc], null, '  Producto   prueba ABC ', v_desp);
  v_abc := (j->>'producto_id')::bigint;
  assert (j->>'creado')::boolean and (j->>'lineas')::int = 1, format('T6a: %s', j);
  select * into r from public.productos_catalogo where id = v_abc;
  assert r.nombre = 'Producto prueba ABC' and r.categoria_id = v_desp and r.origen = 'manual' and r.unidad_habitual = 'ud',
    format('T6b: producto nuevo %s', to_jsonb(r));
  assert (select producto_id from public.productos_alias where texto_normalizado = 'test otra linea abc') = v_abc,
    'T6c: el texto de la línea tiene que quedar como alias';

  -- Otro producto nuevo y moverle la línea de portes (alias manual manda)
  j := public.productos_asignar_lineas(array[v_l_def], null, 'Producto prueba DEF', null);
  v_def := (j->>'producto_id')::bigint;
  assert (select producto_id from public.productos_factura where id = v_l_def) = v_def, 'T6d: la línea no se movió';
  assert (select producto_id from public.productos_alias where texto_normalizado = 'portes y embalaje') = v_def,
    'T6e: alias del texto movido';

  -- Asignar a uno EXISTENTE con los dos parámetros a la vez → error
  begin
    perform public.productos_asignar_lineas(array[v_l_def], v_abc, 'otro nombre', null);
    raise exception 'T6f: aceptó producto y nombre nuevo a la vez';
  exception when invalid_parameter_value then null;
  end;

  -- Fusionar DEF en ABC
  j := public.productos_fusionar(array[v_def], v_abc);
  assert (j->>'lineas_movidas')::int = 1 and (j->>'productos_borrados')::int = 1, format('T6g: %s', j);
  assert not exists (select 1 from public.productos_catalogo where id = v_def), 'T6h: el fusionado sigue existiendo';
  assert (select count(*) from public.productos_factura where producto_id = v_abc) = 2, 'T6i: ABC tiene que tener 2 líneas';
  assert (select producto_id from public.productos_alias where texto_normalizado = 'portes y embalaje') = v_abc,
    'T6j: el alias del fusionado tiene que pasar al que queda';
  assert (select producto_id from public.productos_alias where texto_normalizado = 'producto prueba def') = v_abc,
    'T6k: el nombre del fusionado tiene que quedar como alias';
  begin
    perform public.productos_fusionar(array[v_abc], v_abc);
    raise exception 'T6l: fusionó un producto consigo mismo';
  exception when invalid_parameter_value then null;
  end;

  -- Renombrar
  begin
    perform public.productos_renombrar(v_abc, 'nata natop DEBIC 2 l');
    raise exception 'T6m: renombró a un nombre que ya existe';
  exception when unique_violation then null;
  end;
  j := public.productos_renombrar(v_abc, 'Producto prueba renombrado');
  assert j->>'nombre' = 'Producto prueba renombrado', format('T6n: %s', j);

  -- Recategorizar
  assert public.productos_recategorizar(array[v_abc], v_vinos) = 1, 'T6o: recategorizar';
  assert (select categoria_id from public.productos_catalogo where id = v_abc) = v_vinos, 'T6p: categoría no cambiada';

  -- Borrar con líneas → no
  begin
    perform public.productos_borrar(v_abc);
    raise exception 'T6q: borró un producto con líneas';
  exception when foreign_key_violation then null;
  end;

  -- Resumen del producto
  select * into r from public.productos_resumen() where producto_id = v_abc;
  assert r.compras = 2 and r.gasto = 10.64 and r.cantidades = '{"ud": 3.000}'::jsonb
         and r.proveedores = array['TEST PRODUCTOS SL'],
    format('T6r: resumen %s', to_jsonb(r));
  -- El gasto por categoría cuadra con la suma de todas las líneas
  assert (select sum(gasto) from public.productos_gasto_por_categoria())
         = (select round(coalesce(sum(total), 0), 2) from public.productos_factura),
    'T6s: el gasto por categoría no cuadra con la suma de las líneas';
  assert exists (select 1 from public.productos_gasto_por_categoria() where sin_clasificar and categoria = 'Sin clasificar'),
    'T6t: falta la fila «Sin clasificar» (queda la línea de la IA)';

  -- Categorías: crear sí, tercer nivel no
  insert into public.categorias_producto (nombre, padre_id) values ('  TEST   Mariscos de concha ', (select id from public.categorias_producto where clave = 'pescado_marisco'))
  returning id into v_cat;
  assert (select nombre from public.categorias_producto where id = v_cat) = 'TEST Mariscos de concha', 'T6u: nombre no limpiado';
  begin
    insert into public.categorias_producto (nombre, padre_id) values ('TEST tercer nivel', v_cat);
    raise exception 'T6v: aceptó un tercer nivel';
  exception when invalid_parameter_value then null;
  end;
  update public.categorias_producto set activa = false where id = v_cat;
  assert found, 'T6w: no pudo desactivar una categoría';
  begin
    delete from public.categorias_producto where id = v_cat;
    raise exception 'T6x: pudo borrar una categoría';
  exception when insufficient_privilege then null;
  end;
end
$t6$;

reset role;

-- ---------------------------------------------------------------------------
-- T7 clasificación de la IA (como postgres, igual que service_role)
-- ---------------------------------------------------------------------------
do $t7$
declare
  v_fid    bigint;
  v_desp   bigint;
  v_portes bigint;
  j        jsonb;
  r        record;
begin
  select id into v_fid from public.facturas where numero_documento = 'TEST-PROD-0001';
  select id into v_desp from public.categorias_producto where clave = 'despensa';
  select id into v_portes from public.productos_catalogo where nombre = 'Portes';
  j := public.productos_aplicar_clasificacion_ia(jsonb_build_array(
         jsonb_build_object('textos', jsonb_build_array('test texto para la ia 123'), 'producto_id', null,
                            'nombre', 'Producto IA de prueba', 'categoria_id', v_desp, 'unidad', 'ud'),
         -- Un alias que ya existe NO se pisa aunque la IA proponga otro producto.
         jsonb_build_object('textos', jsonb_build_array('portes'), 'producto_id', null,
                            'nombre', 'Transporte (IA)', 'categoria_id', v_desp)));
  assert (j->>'productos_creados')::int = 1 and (j->>'lineas_asignadas')::int = 1, format('T7a: %s', j);
  select p.* into r from public.productos_factura pf join public.productos_catalogo p on p.id = pf.producto_id
   where pf.factura_id = v_fid and pf.nombre = 'TEST texto para la IA 123';
  assert r.nombre = 'Producto IA de prueba' and r.origen = 'ia' and r.categoria_id = v_desp, format('T7b: %s', to_jsonb(r));
  assert (select producto_id from public.productos_alias where texto_normalizado = 'portes') = v_portes,
    'T7c: la IA pisó un alias existente';
  -- Elementos basura no rompen nada.
  j := public.productos_aplicar_clasificacion_ia('[{"textos": []}, {"textos": ["x"], "nombre": ""}, {}]'::jsonb);
  assert (j->>'productos_creados')::int = 0, format('T7d: %s', j);
end
$t7$;

select 'productos_catalogo_categorias_test: OK' as resultado;

rollback;
