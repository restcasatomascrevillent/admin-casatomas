set client_encoding = 'UTF8';
-- ===========================================================================
-- Pruebas de 20261005160000_productos_factura_unidades_normalizadas.sql
-- SQL plano con ASSERT dentro de BEGIN … ROLLBACK: no deja nada escrito.
-- DESPUÉS de aplicar la migración:
--   npx supabase db query --linked -f supabase/tests/productos_factura_unidades_normalizadas_test.sql
-- Si termina sin ERROR e imprime «productos_factura_unidades_normalizadas_test: OK», todo ha pasado.
--
-- Cubre: el mapa de la función (los mismos casos que magnitudes.ts); que en
-- la tabla real no queda ninguna variante; que 'ca' (caja) y 'm' (metros)
-- siguen como estaban; un escenario con líneas «sucias» insertadas dentro de
-- la transacción (uds, unidades, Ud., Kilos, KG., lt, Litros, NULL, vacío,
-- caja…) al que se aplica el mismo UPDATE de la migración: solo cambia la
-- unidad (cuenta de filas y sumas de cantidad, precio, total y bultos
-- iguales antes y después), lo desconocido ('caja', 'ca', 'm'…) no se inventa
-- y el UPDATE es idempotente; que el único trigger de productos_factura es el de historial
-- (AFTER INSERT) y un UPDATE de unidad no escribe en historial_precios; y
-- que Luga 54 sigue con 19 líneas en kg y 0 descuadres.
-- Y el trigger trg_productos_factura_normalizar_unidad (BEFORE INSERT OR UPDATE
-- OF unidad) y el DEFAULT 'ud': un INSERT con 'uds', 'Kilos', NULL o sin
-- unidad sale ud/kg/ud/ud sin tocar los bultos; un UPDATE de unidad también
-- se normaliza; trigger_historial_precios sigue escribiendo una fila por
-- línea con su precio; y una sustitución real (ocr_sustituir_factura, sobre
-- una COPIA de la 54) con unidad ausente, NULL, 'unidades' y 'Kilos' acaba en
-- ud/ud/ud/kg con sus bultos.
-- ===========================================================================

begin;

do $$
declare
  v_factura bigint;
  v_user  uuid;
  v_copia bigint;
  v_dup   uuid := '00000000-0000-4000-8000-0000000000b2';
  j jsonb;
  a record;
  d record;
  n integer;
  n_hist_antes bigint;
  r record;
begin
  -- T1. El mapa (casos de magnitudes.ts / magnitudes.test.ts).
  assert public.normalizar_unidad_factura('uds')       = 'ud', 'T1: uds';
  assert public.normalizar_unidad_factura('unidades')  = 'ud', 'T1: unidades';
  assert public.normalizar_unidad_factura('Ud.')       = 'ud', 'T1: Ud.';
  assert public.normalizar_unidad_factura(' U ')       = 'ud', 'T1: " U "';
  assert public.normalizar_unidad_factura('UN')        = 'ud', 'T1: UN';
  assert public.normalizar_unidad_factura('unid.')     = 'ud', 'T1: unid.';
  assert public.normalizar_unidad_factura('Unidád')    = 'ud', 'T1: acento';
  assert public.normalizar_unidad_factura('kgs')       = 'kg', 'T1: kgs';
  assert public.normalizar_unidad_factura('Kilos')     = 'kg', 'T1: Kilos';
  assert public.normalizar_unidad_factura('KG.')       = 'kg', 'T1: KG.';
  assert public.normalizar_unidad_factura('k g')       = 'kg', 'T1: "k g" (sin espacios interiores) → kg';
  assert public.normalizar_unidad_factura('kg')        = 'kg', 'T1: kg';
  assert public.normalizar_unidad_factura('l')         = 'l',  'T1: l';
  assert public.normalizar_unidad_factura('lt')        = 'l',  'T1: lt';
  assert public.normalizar_unidad_factura('Litros')    = 'l',  'T1: Litros';
  assert public.normalizar_unidad_factura(null)        = 'ud', 'T1: null → ud';
  assert public.normalizar_unidad_factura('')          = 'ud', 'T1: vacío → ud';
  assert public.normalizar_unidad_factura('  .  ')     = 'ud', 'T1: solo espacios y puntos → ud';
  -- Lo desconocido se conserva (minúsculas, sin espacios de los bordes): no se inventa.
  assert public.normalizar_unidad_factura('Caja')      = 'caja',   'T1: caja se deja';
  assert public.normalizar_unidad_factura('CA')        = 'ca',     'T1: ca se deja';
  assert public.normalizar_unidad_factura(' Docena ')  = 'docena', 'T1: docena se deja';
  assert public.normalizar_unidad_factura('m')         = 'm',      'T1: m (metros) se deja';
  assert public.normalizar_unidad_factura('ml')        = 'ml',     'T1: ml se deja';
  assert public.normalizar_unidad_factura('g')         = 'g',      'T1: g se deja';
  assert public.normalizar_unidad_factura('Pza.')      = 'pza.',   'T1: pza. se deja tal cual (con el punto, como normalizarUnidad)';
  assert public.normalizar_unidad_factura('bot')       = 'bot',    'T1: bot se deja';
  -- Idempotente: normalizar lo normalizado no cambia nada.
  assert public.normalizar_unidad_factura(public.normalizar_unidad_factura('Pza.')) = 'pza.', 'T1: idempotente';
  assert public.normalizar_unidad_factura('ud') = 'ud' and public.normalizar_unidad_factura('kg') = 'kg'
     and public.normalizar_unidad_factura('l') = 'l', 'T1: ud/kg/l intactas';

  -- T2. En la tabla real ya no queda ninguna variante del mapa.
  select count(*) into n from public.productos_factura
   where unidad is distinct from public.normalizar_unidad_factura(unidad);
  assert n = 0, format('T2: %s líneas con una unidad que el mapa cambiaría', n);
  assert not exists (select 1 from public.productos_factura where unidad is null or btrim(unidad) = ''),
    'T2: líneas sin unidad';
  assert not exists (select 1 from public.productos_factura
                      where lower(btrim(unidad)) in ('uds','unidades','unidad','u','un','und','unid','kgs','kilo','kilos','lt','lts','litro','litros')),
    'T2: quedan sinónimos sueltos';

  -- T4. Luga 54: 19 líneas en kg (con bultos), 35 en ud y 0 descuadres.
  assert (select count(*) from public.productos_factura where factura_id = 54) = 54, 'T4: la 54 tiene 54 líneas';
  assert (select count(*) from public.productos_factura where factura_id = 54 and unidad = 'kg') = 19, 'T4: 19 líneas en kg';
  assert (select count(*) from public.productos_factura where factura_id = 54 and unidad = 'ud') = 35, 'T4: 35 líneas en ud';
  select count(*) into n from public.productos_factura
   where factura_id = 54
     and abs(cantidad * precio_unitario - total) > greatest(0.05, abs(cantidad) * 0.005 + 0.01);
  assert n = 0, format('T4: Luga 54 tiene %s descuadres', n);
  assert (select sum(total) from public.productos_factura where factura_id = 54) = 3787.53, 'T4: suma de importes de la 54';
  assert not exists (select 1 from jsonb_array_elements(public.validar_cordura_factura(54)) x
                      where x->>'codigo' = 'descuadre_linea'), 'T4: validar_cordura_factura ve descuadres en la 54';

  -- T5. Triggers: el del historial (AFTER INSERT) y el de normalización
  --     (BEFORE INSERT OR UPDATE OF unidad, por fila); y el DEFAULT.
  assert (select count(*) from pg_trigger where tgrelid = 'public.productos_factura'::regclass and not tgisinternal) = 2,
    'T5: productos_factura debería tener exactamente dos triggers';
  assert exists (select 1 from pg_trigger t
                  where t.tgrelid = 'public.productos_factura'::regclass and not t.tgisinternal
                    and t.tgname = 'trigger_historial_precios'
                    and (t.tgtype & 2) = 0 and (t.tgtype & 4) = 4 and (t.tgtype & 16) = 0 and (t.tgtype & 8) = 0),
    'T5: trigger_historial_precios debe seguir siendo AFTER INSERT';
  assert exists (select 1 from pg_trigger t
                  where t.tgrelid = 'public.productos_factura'::regclass and not t.tgisinternal
                    and t.tgname = 'trg_productos_factura_normalizar_unidad'
                    and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2 and (t.tgtype & 4) = 4
                    and (t.tgtype & 16) = 16 and (t.tgtype & 8) = 0
                    and t.tgattr::text <> ''),
    'T5: falta trg_productos_factura_normalizar_unidad (BEFORE INSERT OR UPDATE OF unidad, FOR EACH ROW)';
  assert (select column_default from information_schema.columns
           where table_schema = 'public' and table_name = 'productos_factura' and column_name = 'unidad') like '''ud''%',
    'T5: el DEFAULT de unidad debe ser ''ud''';
  assert not has_function_privilege('authenticated', 'public.trg_productos_factura_normalizar_unidad()', 'execute')
     and not has_function_privilege('anon', 'public.trg_productos_factura_normalizar_unidad()', 'execute'),
    'T5: la función del trigger no debe ser ejecutable por authenticated/anon';

  -- T6. Escenario sucio: líneas insertadas AQUÍ (se deshacen con el ROLLBACK)
  --     en una factura de tipo albarán (no tocan historial_precios).
  select f.id into v_factura from public.facturas f where f.tipo = 'albaran' order by f.id limit 1;
  if v_factura is null then
    select f.id into v_factura from public.facturas f order by f.id limit 1;
  end if;
  assert v_factura is not null, 'T6: no hay ninguna factura sobre la que probar';

  -- (Con el trigger quitado de en medio: aquí se prueba el UPDATE de la migración
  --  sobre líneas que ya estuvieran sucias. Se vuelve a activar al final de T6.)
  alter table public.productos_factura disable trigger trg_productos_factura_normalizar_unidad;
  insert into public.productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, bultos) values
    (v_factura, 'ZZ_T uds',      3,    'uds',      2.50,  7.50, null),
    (v_factura, 'ZZ_T unidades', 2,    'unidades', 4.00,  8.00, null),
    (v_factura, 'ZZ_T Ud.',      1,    'Ud.',      9.99,  9.99, null),
    (v_factura, 'ZZ_T U',        5,    ' U ',      1.10,  5.50, null),
    (v_factura, 'ZZ_T kgs',      12.5, 'kgs',      3.00, 37.50, 5),
    (v_factura, 'ZZ_T Kilos',    2.25, 'Kilos',   10.00, 22.50, null),
    (v_factura, 'ZZ_T KG.',      4,    'KG.',      6.00, 24.00, 2),
    (v_factura, 'ZZ_T lt',       6,    'lt',       1.20,  7.20, null),
    (v_factura, 'ZZ_T Litros',   3,    'Litros',   2.00,  6.00, null),
    (v_factura, 'ZZ_T NULL',     1,    null,       5.00,  5.00, null),
    (v_factura, 'ZZ_T vacio',    1,    '',         5.00,  5.00, null),
    (v_factura, 'ZZ_T caja',     2,    'Caja',    30.00, 60.00, null),
    (v_factura, 'ZZ_T CA',       1,    'CA',      11.00, 11.00, null),
    (v_factura, 'ZZ_T docena',   1,    'Docena',   8.00,  8.00, null),
    (v_factura, 'ZZ_T m',        6,    'm',        3.71, 22.26, null),
    (v_factura, 'ZZ_T ya ud',    1,    'ud',       1.00,  1.00, null),
    (v_factura, 'ZZ_T ya kg',    1,    'kg',       1.00,  1.00, null);
  assert (select count(*) from public.productos_factura where nombre like 'ZZ\_T %') = 17, 'T6: 17 líneas de prueba';

  select count(*)::bigint filas, coalesce(sum(cantidad), 0) s_cantidad, coalesce(sum(precio_unitario), 0) s_precio,
         coalesce(sum(total), 0) s_total, coalesce(sum(bultos), 0) s_bultos
    into a from public.productos_factura;
  select count(*) into n_hist_antes from public.historial_precios;

  -- El UPDATE de la migración, tal cual.
  update public.productos_factura p
     set unidad = public.normalizar_unidad_factura(p.unidad)
   where p.unidad is distinct from public.normalizar_unidad_factura(p.unidad);
  get diagnostics n = row_count;
  assert n = 14, format('T6: debían cambiar 14 líneas y han cambiado %s', n);

  select count(*)::bigint filas, coalesce(sum(cantidad), 0) s_cantidad, coalesce(sum(precio_unitario), 0) s_precio,
         coalesce(sum(total), 0) s_total, coalesce(sum(bultos), 0) s_bultos
    into d from public.productos_factura;
  assert d.filas = a.filas, 'T6: ha cambiado el número de filas';
  assert d.s_cantidad = a.s_cantidad, 'T6: ha cambiado la suma de cantidades';
  assert d.s_precio = a.s_precio, 'T6: ha cambiado la suma de precios';
  assert d.s_total = a.s_total, 'T6: ha cambiado la suma de totales';
  assert d.s_bultos = a.s_bultos, 'T6: ha cambiado la suma de bultos';
  assert (select count(*) from public.historial_precios) = n_hist_antes, 'T6: el UPDATE ha escrito en historial_precios';

  -- Resultado línea a línea (unidad correcta; cantidad, precio y total sin tocar).
  for r in
    select * from (values
      ('ZZ_T uds', 'ud', 3::numeric, 2.50::numeric, 7.50::numeric),
      ('ZZ_T unidades', 'ud', 2, 4.00, 8.00),
      ('ZZ_T Ud.', 'ud', 1, 9.99, 9.99),
      ('ZZ_T U', 'ud', 5, 1.10, 5.50),
      ('ZZ_T kgs', 'kg', 12.5, 3.00, 37.50),
      ('ZZ_T Kilos', 'kg', 2.25, 10.00, 22.50),
      ('ZZ_T KG.', 'kg', 4, 6.00, 24.00),
      ('ZZ_T lt', 'l', 6, 1.20, 7.20),
      ('ZZ_T Litros', 'l', 3, 2.00, 6.00),
      ('ZZ_T NULL', 'ud', 1, 5.00, 5.00),
      ('ZZ_T vacio', 'ud', 1, 5.00, 5.00),
      ('ZZ_T caja', 'caja', 2, 30.00, 60.00),
      ('ZZ_T CA', 'ca', 1, 11.00, 11.00),
      ('ZZ_T docena', 'docena', 1, 8.00, 8.00),
      ('ZZ_T m', 'm', 6, 3.71, 22.26),
      ('ZZ_T ya ud', 'ud', 1, 1.00, 1.00),
      ('ZZ_T ya kg', 'kg', 1, 1.00, 1.00)
    ) as v(nombre, unidad, cantidad, precio, total)
  loop
    assert exists (select 1 from public.productos_factura p
                    where p.nombre = r.nombre and p.unidad = r.unidad and p.cantidad = r.cantidad
                      and p.precio_unitario = r.precio and p.total = r.total),
      format('T6: %s no ha quedado como %s (cantidad %s, precio %s, total %s)', r.nombre, r.unidad, r.cantidad, r.precio, r.total);
  end loop;
  assert (select bultos from public.productos_factura where nombre = 'ZZ_T kgs') = 5
     and (select bultos from public.productos_factura where nombre = 'ZZ_T KG.') = 2, 'T6: los bultos no se tocan';

  -- Idempotente: una segunda pasada no cambia nada.
  update public.productos_factura p
     set unidad = public.normalizar_unidad_factura(p.unidad)
   where p.unidad is distinct from public.normalizar_unidad_factura(p.unidad);
  get diagnostics n = row_count;
  assert n = 0, format('T6: la segunda pasada cambió %s líneas', n);
  alter table public.productos_factura enable trigger trg_productos_factura_normalizar_unidad;

  -- T8. El trigger y el DEFAULT, sobre una COPIA de la 54 (tipo factura: el
  --     trigger del historial SÍ salta en los INSERT).
  select id into v_user from auth.users order by created_at limit 1;
  assert v_user is not null, 'T8: no hay ningún usuario en auth.users';
  insert into public.facturas (tipo, proveedor, cif, numero_documento, fecha, subtotal, iva, total, total_origen,
                               observaciones, resumen, verificada, archivo_path, alertas_validacion)
  select tipo, proveedor, cif, 'TEST-UNIDADES-' || numero_documento, fecha, subtotal, iva, total, total_origen,
         observaciones, resumen, verificada, archivo_path, alertas_validacion
    from public.facturas where id = 54
  returning id into v_copia;

  insert into public.productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, bultos) values
    (v_copia, 'ZZ_U uds',   3,    'uds',    2.50,  7.50, 3),
    (v_copia, 'ZZ_U Kilos', 2.25, 'Kilos', 10.00, 22.50, 1),
    (v_copia, 'ZZ_U NULL',  1,    null,     5.00,  5.00, null),
    (v_copia, 'ZZ_U Caja',  2,    'Caja',  30.00, 60.00, null);
  insert into public.productos_factura (factura_id, nombre, cantidad, precio_unitario, total)  -- sin unidad: DEFAULT
  values (v_copia, 'ZZ_U sin unidad', 4, 1.00, 4.00);

  assert (select unidad from public.productos_factura where nombre = 'ZZ_U uds')        = 'ud',   'T8: INSERT uds → ud';
  assert (select unidad from public.productos_factura where nombre = 'ZZ_U Kilos')      = 'kg',   'T8: INSERT Kilos → kg';
  assert (select unidad from public.productos_factura where nombre = 'ZZ_U NULL')       = 'ud',   'T8: INSERT NULL → ud';
  assert (select unidad from public.productos_factura where nombre = 'ZZ_U Caja')       = 'caja', 'T8: INSERT Caja → caja (no se inventa)';
  assert (select unidad from public.productos_factura where nombre = 'ZZ_U sin unidad') = 'ud',   'T8: sin unidad → ud (DEFAULT)';
  -- Bultos, cantidad, precio y total intactos.
  assert (select bultos from public.productos_factura where nombre = 'ZZ_U uds') = 3
     and (select bultos from public.productos_factura where nombre = 'ZZ_U Kilos') = 1
     and (select cantidad from public.productos_factura where nombre = 'ZZ_U Kilos') = 2.25
     and (select total from public.productos_factura where nombre = 'ZZ_U Caja') = 60.00, 'T8: el trigger solo toca la unidad';
  -- trigger_historial_precios no se ha estorbado: una fila por línea, con su precio.
  assert (select count(*) from public.historial_precios where factura_id = v_copia) = 5, 'T8: historial con 5 filas';
  assert exists (select 1 from public.historial_precios where factura_id = v_copia and producto_nombre = 'ZZ_U Kilos' and precio = 10.00),
    'T8: el historial guarda el precio de la línea';
  -- UPDATE OF unidad: se normaliza; el resto de columnas, no.
  update public.productos_factura set unidad = 'unidades' where nombre = 'ZZ_U Caja';
  assert (select unidad from public.productos_factura where nombre = 'ZZ_U Caja') = 'ud', 'T8: UPDATE unidad=unidades → ud';
  update public.productos_factura set unidad = 'KG.' where nombre = 'ZZ_U uds';
  assert (select unidad from public.productos_factura where nombre = 'ZZ_U uds') = 'kg', 'T8: UPDATE unidad=KG. → kg';
  update public.productos_factura set unidad = null where nombre = 'ZZ_U Kilos';
  assert (select unidad from public.productos_factura where nombre = 'ZZ_U Kilos') = 'ud', 'T8: UPDATE unidad=NULL → ud';
  update public.productos_factura set unidad = 'Lt', nombre = 'ZZ_U litros' where nombre = 'ZZ_U NULL';
  assert (select unidad from public.productos_factura where nombre = 'ZZ_U litros') = 'l', 'T8: UPDATE Lt + nombre → l';
  assert (select count(*) from public.historial_precios where factura_id = v_copia) = 5, 'T8: los UPDATE no escriben en el historial';

  -- T9. Sustitución real (ocr_sustituir_factura): su coalesce(l->>'unidad','unidades')
  --     y los NULL del JSON salen normalizados; los bultos se guardan.
  insert into public.ocr_trabajos (id, creado_por, num_paginas, origen, nombre_original, estado)
  values (v_dup, v_user, 1, 'sincrono', 'ML101511.pdf', 'duplicado');
  j := public.ocr_sustituir_factura(v_copia, v_dup, v_user,
    jsonb_build_object('tipo', 'factura', 'proveedor', 'LUGA SABORES S.L. (TEST)', 'cif', 'B-54529045',
                       'numero_documento', 'TEST-UNIDADES-SUST', 'fecha', '2025-12-31', 'subtotal', null,
                       'iva', null, 'total', 100, 'total_origen', 'deducido', 'resumen', 'prueba', 'paginas', 1),
    '[{"nombre":"S sin unidad","cantidad":2,"precio_unitario":9.03,"total":18.06,"orden":0},
      {"nombre":"S unidad null","cantidad":1,"unidad":null,"precio_unitario":5,"total":5,"orden":1},
      {"nombre":"S unidades","cantidad":3,"unidad":"unidades","precio_unitario":2,"total":6,"orden":2},
      {"nombre":"S Kilos","cantidad":24,"unidad":"Kilos","bultos":12,"precio_unitario":4.14,"total":99.36,"orden":3}]'::jsonb,
    jsonb_build_object('lineas', 5), null);
  assert (j->>'lineas')::int = 4, format('T9: resultado inesperado %s', j);
  select string_agg(unidad, ',' order by orden) as u, string_agg(coalesce(bultos::text, 'null'), ',' order by orden) as b
    into r from public.productos_factura where factura_id = v_copia;
  assert r.u = 'ud,ud,ud,kg', format('T9: unidades tras sustituir %s (se esperaba ud,ud,ud,kg)', r.u);
  assert r.b = 'null,null,null,12', format('T9: bultos tras sustituir %s', r.b);
  assert (select count(*) from public.historial_precios where factura_id = v_copia) = 4, 'T9: historial rehecho con 4 filas';
  assert (select count(*) from public.productos_factura where factura_id = 54) = 54, 'T9: la 54 original no se ha tocado';

  -- T7. La tabla de respaldo existe, con RLS y sin permisos para anon/authenticated.
  assert to_regclass('public.productos_factura_unidades_respaldo') is not null, 'T7: falta la tabla de respaldo';
  assert (select relrowsecurity from pg_class where oid = 'public.productos_factura_unidades_respaldo'::regclass),
    'T7: el respaldo debe tener RLS';
  assert not has_table_privilege('anon', 'public.productos_factura_unidades_respaldo', 'select')
     and not has_table_privilege('authenticated', 'public.productos_factura_unidades_respaldo', 'select'),
    'T7: anon/authenticated no deben leer el respaldo';
  assert not has_function_privilege('anon', 'public.normalizar_unidad_factura(text)', 'execute'),
    'T7: anon no debe ejecutar la función';
end;
$$;

select 'productos_factura_unidades_normalizadas_test: OK' as resultado;

rollback;
