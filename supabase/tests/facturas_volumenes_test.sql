set client_encoding = 'UTF8';
-- Test de 20261106400000_facturas_volumenes. BEGIN … ROLLBACK: no deja nada escrito.
-- Acaba en «facturas_volumenes_test: OK».
--   supabase db query --linked -f supabase/tests/facturas_volumenes_test.sql
--
--   T1 permisos: anon no ejecuta las funciones nuevas ni lee la vista; todas SECURITY INVOKER
--      (salvo los dos triggers); explorador con la marca de esta migración.
--   T2 envase_texto: «1/3 * 24», «200ml*28», «C/6B», «C24», «12 unidades», «24x33cl», magnum, litro.
--   T3 volumen_linea: caja, barril, l, caja sin unidades, ud que por precio es caja, precio dudoso,
--      «caja 10 kg», unidad no convertible.
--   T4 datos reales: todas las cervezas de 2026 se convierten y suman entre 10.000 y 40.000 l.
--   T5 datos de prueba (2031): producto nuevo → envase del nombre (trigger); líneas en caja,
--      barril y ud; albarán facturado fuera; RPC y explorador dan los mismos litros.
--   T6 RLS: sin permiso de Facturas no se ve nada.
begin;

do $$
declare
  e      record;
  v      record;
  v_n    numeric;
  v_cat  bigint;
  v_pc1  bigint;
  v_pc2  bigint;
  v_p    bigint;
  v_f    bigint;
  v_alb  bigint;
  r      json;
  x      json;
  f      text;
begin
  -- T1 ─────────────────────────────────────────────────────────────────────
  foreach f in array array['public.envase_texto(text)',
                           'public.volumen_linea(text,text,numeric,numeric,numeric,text,numeric,text,numeric,numeric)',
                           'public.volumen_comprado_agente(text,text,date,date,text,text,integer,text)',
                           'public.productos_envase_recalcular(bigint[])'] loop
    if has_function_privilege('anon', f, 'execute') then
      raise exception 'FALLO T1: anon puede ejecutar %', f;
    end if;
    if not has_function_privilege('authenticated', f, 'execute') then
      raise exception 'FALLO T1: authenticated no ejecuta %', f;
    end if;
    if (select prosecdef from pg_proc where oid = f::regprocedure) then
      raise exception 'FALLO T1: % no es SECURITY INVOKER', f;
    end if;
  end loop;
  if has_table_privilege('anon', 'public.volumen_lineas', 'select') then
    raise exception 'FALLO T1: anon lee volumen_lineas';
  end if;
  if position('20261106400000' in pg_get_functiondef('public.explorar_compras(date,date,text,text,text,jsonb,integer)'::regprocedure)) = 0
     or position('20261106310000' in pg_get_functiondef('public.explorar_compras(date,date,text,text,text,jsonb,integer)'::regprocedure)) = 0
     or position('20261106400000' in pg_get_functiondef('public.explorar_compras_hechos(date,date,text,text,text,jsonb)'::regprocedure)) = 0 then
    raise exception 'FALLO T1: el explorador no es el de 20261106400000';
  end if;

  -- T2 ─────────────────────────────────────────────────────────────────────
  select * into e from envase_texto('HEINEKEN 1/3 LONG NET * 24');
  if (e.volumen, e.unidad, e.unidades) is distinct from (0.33, 'l', 24::numeric) then raise exception 'FALLO T2 tercio: %', e; end if;
  select * into e from envase_texto('SCHWEPPES TONICA E/R 200ml*28');
  if (e.volumen, e.unidades) is distinct from (0.2, 28::numeric) then raise exception 'FALLO T2 200ml*28: %', e; end if;
  select * into e from envase_texto('C/6B LP LA CUVEE 0,75L');
  if (e.volumen, e.unidades) is distinct from (0.75, 6::numeric) then raise exception 'FALLO T2 C/6B: %', e; end if;
  select * into e from envase_texto('AGUA SOLAN DE CABRAS 33CL C36');
  if (e.volumen, e.unidades) is distinct from (0.33, 36::numeric) then raise exception 'FALLO T2 C36: %', e; end if;
  select * into e from envase_texto('CERRO DE LA CRUZ vino blanco brik 12 unidades 1L');
  if (e.volumen, e.unidades) is distinct from (1::numeric, 12::numeric) then raise exception 'FALLO T2 12 unidades: %', e; end if;
  select * into e from envase_texto('24x33cl');
  if (e.volumen, e.unidades) is distinct from (0.33, 24::numeric) then raise exception 'FALLO T2 24x33cl: %', e; end if;
  select * into e from envase_texto('Aalto Magnum');
  if e.volumen is distinct from 1.5 then raise exception 'FALLO T2 magnum: %', e; end if;
  select * into e from envase_texto('PACHARAN BEREZKO LITRO');
  if e.volumen is distinct from 1::numeric then raise exception 'FALLO T2 litro: %', e; end if;
  select * into e from envase_texto('Cruzcampo barril 50 l');
  if (e.volumen, e.unidades) is distinct from (50::numeric, null::numeric) then raise exception 'FALLO T2 barril: %', e; end if;
  select * into e from envase_texto('PATATA MINI MC C 25/35 CJ 5 K');
  if (e.volumen, e.unidad, e.unidades) is distinct from (5::numeric, 'kg', null::numeric) then raise exception 'FALLO T2 calibre: %', e; end if;

  -- T3 ─────────────────────────────────────────────────────────────────────
  select * into v from volumen_linea('HEINEKEN 1/3 LONG NET * 24', 'caja', 10, 41.85, null, null, 0.33, 'l', null, 20);
  if (v.medida, v.cantidad_base, v.envases, v.metodo) is distinct from ('l', 79.2, 240::numeric, 'caja') then raise exception 'FALLO T3 caja: %', v; end if;
  select * into v from volumen_linea('BARRIL CRUZCAMPO 50 L. ESP.', 'barril', 3, 203.98, 50, 'l', 50, 'l', null, 20);
  if (v.cantidad_base, v.envases, v.metodo) is distinct from (150::numeric, 3::numeric, 'envase') then raise exception 'FALLO T3 barril: %', v; end if;
  select * into v from volumen_linea('LITROS DE ACEITE DE GIRASOL', 'l', 25, 1.9, null, null, null, null, null, null);
  if (v.medida, v.cantidad_base, v.metodo) is distinct from ('l', 25::numeric, 'unidad') then raise exception 'FALLO T3 litros: %', v; end if;
  select * into v from volumen_linea('REFRESCO SEVEN UP ZERO RETORNABLE 200', 'caja', 4, 11.64, null, null, 0.2, 'l', null, 15);
  if (v.medida, v.metodo) is distinct from (null::text, 'sin_unidades_por_caja') then raise exception 'FALLO T3 caja sin unidades: %', v; end if;
  select * into v from volumen_linea('REFRESCO SEVEN UP ZERO RETORNABLE 200', 'caja', 4, 11.64, null, null, 0.2, 'l', 24, 15);
  if (v.cantidad_base, v.metodo) is distinct from (19.2, 'caja') then raise exception 'FALLO T3 caja con unidades del catálogo: %', v; end if;
  select * into v from volumen_linea('AGUA CG S.PELLEGRINO BT50CL', 'botella', 2, 20.75, null, null, 0.5, 'l', 24, 15);
  if (v.cantidad_base, v.envases, v.metodo) is distinct from (24::numeric, 48::numeric, 'precio') then raise exception 'FALLO T3 precio: %', v; end if;
  select * into v from volumen_linea('AGUA SAN PELLEGRINO 50,5CL C24', 'botella', 720, 0.72, 0.505, 'l', 0.5, 'l', 24, 15);
  if (v.cantidad_base, v.metodo) is distinct from (360::numeric, 'envase') then raise exception 'FALLO T3 botella suelta: %', v; end if;
  select * into v from volumen_linea('AQUARIUS LT 33CL LIMON', 'lata', 1, 17.59, 0.33, 'l', 0.33, 'l', null, 15);
  if (v.medida, v.metodo) is distinct from (null::text, 'precio_dudoso') then raise exception 'FALLO T3 precio dudoso: %', v; end if;
  select * into v from volumen_linea('PATATA LAV AGRIA CJ 12K', 'caja', 4, 11.45, 12, 'kg', null, null, null, null);
  if (v.medida, v.cantidad_base, v.metodo) is distinct from ('kg', 48::numeric, 'texto') then raise exception 'FALLO T3 caja 12 kg: %', v; end if;
  select * into v from volumen_linea('DOCENA HUEVOS', 'docena', 3, 2.5, null, null, null, null, null, null);
  if (v.medida, v.metodo) is distinct from (null::text, 'unidad_no_convertible') then raise exception 'FALLO T3 docena: %', v; end if;
  select * into v from volumen_linea('VINO X 75CL', 'ud', 6, 1200, 0.75, 'l', 0.75, 'l', 6, null);
  if (v.cantidad_base, v.metodo) is distinct from (4.5, 'envase') then raise exception 'FALLO T3 vino caro (sin tope de precio): %', v; end if;

  -- T4 datos reales ─────────────────────────────────────────────────────────
  select id into v_cat from categorias_producto where nombre = 'Cervezas';
  if exists (select 1 from volumen_lineas where categoria_id = v_cat and fecha >= '2026-01-01' and fecha < '2027-01-01') then
    if exists (select 1 from volumen_lineas where categoria_id = v_cat and fecha >= '2026-01-01' and fecha < '2027-01-01' and medida is null) then
      raise exception 'FALLO T4: hay cervezas de 2026 sin convertir';
    end if;
    select sum(cantidad_base) into v_n from volumen_lineas where categoria_id = v_cat and fecha >= '2026-01-01' and fecha < '2027-01-01';
    if v_n not between 10000 and 40000 then
      raise exception 'FALLO T4: litros de cerveza 2026 fuera de lo razonable: %', v_n;
    end if;
    r := volumen_comprado_agente('cerveza', null, '2026-01-01', '2026-12-31');
    if (r ->> 'total')::numeric <> round(v_n, 2) then
      raise exception 'FALLO T4: la RPC (%) no da lo mismo que la vista (%)', r ->> 'total', v_n;
    end if;
  end if;

  -- T5 datos de prueba ─────────────────────────────────────────────────────
  if exists (select 1 from facturas where fecha between '2031-06-01' and '2031-06-30') then
    raise exception 'FALLO datos: ya hay documentos en junio de 2031; el test necesita ese mes vacío';
  end if;
  insert into productos_catalogo (nombre, categoria_id, origen)
  values ('PruebaVol Cerveza 33 cl', v_cat, 'manual') returning id into v_pc1;
  insert into productos_catalogo (nombre, categoria_id, origen)
  values ('PruebaVol Cerveza barril 30 l', v_cat, 'manual') returning id into v_pc2;
  if (select (envase_cantidad, envase_unidad, envase_origen) from productos_catalogo where id = v_pc2)
     is distinct from (30::numeric, 'l'::text, 'nombre'::text) then
    raise exception 'FALLO T5: el producto nuevo no lleva su envase del nombre';
  end if;
  insert into proveedores (nombre, cif) values ('PRUEBA VOLUMEN BEBIDAS', 'B00000401') returning id into v_p;
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
  values ('factura', 'PRUEBA VOLUMEN BEBIDAS', 'B00000401', v_p, 'VOL-1', '2031-06-10', 500, 'casa_tomas') returning id into v_f;
  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, producto_id)
  values (v_f, 'PRUEBAVOL 1/3 * 24', 2, 'caja', 30, 60, v_pc1),           -- 2 × 24 × 0,33 = 15,84 l
         (v_f, 'PRUEBAVOL 1/3', 12, 'ud', 0.9, 10.8, v_pc1),             -- 12 × 0,33 = 3,96 l
         (v_f, 'PRUEBAVOL 1/3', 1, 'ud', 30, 30, v_pc1),                 -- 30 € la «ud»: caja de 24 = 7,92 l
         (v_f, 'BARRIL PRUEBAVOL 30 L', 3, 'barril', 90, 270, v_pc2);    -- 90 l
  if (select envases_por_bulto from productos_catalogo where id = v_pc1) is distinct from 24::numeric then
    raise exception 'FALLO T5: el catálogo no aprende las unidades por caja de sus líneas';
  end if;
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
  values ('albaran', 'PRUEBA VOLUMEN BEBIDAS', 'B00000401', v_p, 'VOL-ALB', '2031-06-05', 90, 'casa_tomas') returning id into v_alb;
  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, producto_id)
  values (v_alb, 'BARRIL PRUEBAVOL 30 L', 1, 'barril', 90, 90, v_pc2);
  update facturas set facturado_en_id = v_f, facturado_origen = 'manual' where id = v_alb;

  r := volumen_comprado_agente('cerveza', null, '2031-06-01', '2031-06-30');
  if (r ->> 'total')::numeric <> 117.72 or (r ->> 'lineas_convertidas')::int <> 4 or (r ->> 'unidad') <> 'l' then
    raise exception 'FALLO T5: RPC cerveza junio 2031 = % (esperado 117,72 l en 4 líneas)', r;
  end if;
  select pe into x from json_array_elements(r -> 'por_envase') pe where pe ->> 'envase' = '30 l';
  if (x ->> 'envases')::numeric <> 3 then
    raise exception 'FALLO T5: barriles de 30 l = % (esperado 3)', x;
  end if;
  r := volumen_comprado_agente('pruebavol', null, '2031-06-01', '2031-06-30', null, 'kg');
  if (r ->> 'total')::numeric <> 0 or (r ->> 'unidad') <> 'kg' then
    raise exception 'FALLO T5: en kilos una cerveza no suma: %', r;
  end if;
  r := explorar_compras('2031-06-01', '2031-06-30', 'litros', 'producto', null,
                        jsonb_build_object('proveedores', jsonb_build_array(v_p)), 10);
  if (r -> 'total' ->> 'valor')::numeric <> 117.72 or (r -> 'parametros' ->> 'unidad') <> 'l' then
    raise exception 'FALLO T5: explorador litros = %', r -> 'total';
  end if;
  r := explorar_compras('2031-06-01', '2031-06-30', 'litros', 'mes', null, '{"unidad": "caja"}'::jsonb, 10);
  if r ->> 'error' is null then
    raise exception 'FALLO T5: litros con filtro de unidad debería dar error';
  end if;
  r := volumen_comprado_agente(null, null, null, null);
  if r ->> 'error' is null then
    raise exception 'FALLO T5: sin producto ni categoría debería dar error';
  end if;

  -- T6 RLS ─────────────────────────────────────────────────────────────────
  perform set_config('request.jwt.claims', '{"role": "authenticated"}', true);
  set local role authenticated;
  select count(*) into v_n from volumen_lineas;
  r := volumen_comprado_agente('cerveza', null, '2031-06-01', '2031-06-30');
  reset role;
  if v_n <> 0 or (r ->> 'total')::numeric <> 0 then
    raise exception 'FALLO T6: un usuario sin permiso ve % líneas / % l', v_n, r ->> 'total';
  end if;
end;
$$;

rollback;

select 'facturas_volumenes_test: OK' as resultado;
