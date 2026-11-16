set client_encoding = 'UTF8';
-- Test de 20261202100000_chat_vinos_denominacion. BEGIN … ROLLBACK: no deja nada escrito.
-- Acaba en «chat_vinos_denominacion_test: OK».
--   supabase db query --linked -f supabase/tests/chat_vinos_denominacion_test.sql
--
--   T1 permisos: anon no ejecuta las RPC ni los ayudantes; authenticated sí; el sincronizador solo
--      service_role; no quedan las firmas anteriores.
--   T2 vino_terminos / vino_coincide: Rioja, Ribera (= Ribera del Duero), champán francés, gallegos,
--      Rías Bajas, D.O.Ca. Rioja; Ribeira Sacra no es Ribera; vino_region_de y vino_denominacion_canonica.
--   T3 relleno desde la carta: enlazar un vino de Rioja rellena el producto ('carta'); pisa 'ia';
--      no pisa 'manual'; al desenlazar se vacía lo que venía de la carta.
--   T4 datos de prueba (septiembre de 2031): gasto_categorias_agente y volumen_comprado_agente con
--      p_denominacion = 'Rioja' cuentan solo el Rioja (sin «Rioja» en el nombre de la línea) y avisan del
--      vino sin D.O. (vino_sin_denominacion); 'Ribera' no lo cuenta; sin filtro, todo como antes.
begin;

do $$
declare
  v_vin  bigint := categoria_agente('vino');
  v_rio  text;
  v_otro text;
  v_pc1  bigint;
  v_pc2  bigint;
  v_p    bigint;
  v_f    bigint;
  r      json;
  f      text;
  pc     record;
begin
  -- T1 ─────────────────────────────────────────────────────────────────────
  foreach f in array array['public.volumen_comprado_agente(text,text,date,date,text,text,integer,text,text,text,text)',
                           'public.gasto_categorias_agente(text,date,date,text,text,text,text,text)',
                           'public.vino_terminos(text)', 'public.vino_coincide(text[],text,text,text)',
                           'public.vino_texto_normalizado(text)', 'public.vino_region_de(text,text,text)'] loop
    if has_function_privilege('anon', f, 'execute') then raise exception 'FALLO T1: anon puede ejecutar %', f; end if;
    if not has_function_privilege('authenticated', f, 'execute') then raise exception 'FALLO T1: authenticated no ejecuta %', f; end if;
  end loop;
  if has_function_privilege('authenticated', 'public.vino_denominacion_sincronizar(bigint[])', 'execute') then
    raise exception 'FALLO T1: authenticated ejecuta vino_denominacion_sincronizar';
  end if;
  if to_regprocedure('public.volumen_comprado_agente(text,text,date,date,text,text,integer,text)') is not null
     or to_regprocedure('public.gasto_categorias_agente(text,date,date,text,text)') is not null then
    raise exception 'FALLO T1: quedan firmas anteriores';
  end if;

  -- T2 ─────────────────────────────────────────────────────────────────────
  if vino_terminos('vinos de Rioja') <> array['rioja'] then raise exception 'FALLO T2: %', vino_terminos('vinos de Rioja'); end if;
  if vino_terminos('  ') is not null or vino_terminos(null) is not null then raise exception 'FALLO T2: vacío'; end if;
  if not vino_coincide(vino_terminos('Rioja'), 'D.O.Ca. Rioja', 'La Rioja', 'España') then raise exception 'FALLO T2: Rioja'; end if;
  if not vino_coincide(vino_terminos('RIOJA'), 'D.O.Ca. Rioja', 'País Vasco', 'España') then raise exception 'FALLO T2: Rioja Alavesa'; end if;
  if not vino_coincide(vino_terminos('Ribera'), 'D.O. Ribera del Duero', 'Castilla y León', 'España') then raise exception 'FALLO T2: Ribera'; end if;
  if vino_coincide(vino_terminos('Ribera'), 'D.O. Ribeira Sacra', 'Galicia', 'España') then raise exception 'FALLO T2: Ribeira Sacra no es Ribera'; end if;
  if vino_coincide(vino_terminos('Rioja'), 'D.O. Ribera del Duero', 'Castilla y León', 'España') then raise exception 'FALLO T2: Ribera no es Rioja'; end if;
  if not vino_coincide(vino_terminos('champán francés'), 'AOC Champagne', 'Champagne', 'Francia') then raise exception 'FALLO T2: champán francés'; end if;
  if vino_coincide(vino_terminos('champán francés'), 'D.O. Cava', 'Cataluña', 'España') then raise exception 'FALLO T2: cava no es champán'; end if;
  if not vino_coincide(vino_terminos('vinos gallegos'), 'D.O. Rías Baixas', 'Galicia', 'España') then raise exception 'FALLO T2: gallegos'; end if;
  if not vino_coincide(vino_terminos('Rías Bajas'), 'D.O. Rías Baixas', 'Galicia', 'España') then raise exception 'FALLO T2: Rías Bajas'; end if;
  if not vino_coincide(vino_terminos('D.O.Ca. Rioja'), 'D.O.Ca. Rioja', null, null) then raise exception 'FALLO T2: D.O.Ca.'; end if;
  if vino_coincide(vino_terminos('Rioja'), null, null, null) then raise exception 'FALLO T2: sin D.O. no casa'; end if;
  if vino_region_de('D.O.Ca. Rioja', 'Laguardia, Álava', 'España') <> 'País Vasco'
     or vino_region_de('D.O.Ca. Rioja', 'Alfaro, La Rioja', 'España') <> 'La Rioja'
     or vino_region_de('D.O. Rías Baixas', 'O Rosal, Pontevedra', 'España') <> 'Galicia'
     or vino_region_de('AOC Champagne', 'Champagne', 'Francia') <> 'Champagne'
     or vino_region_de('D.O. Ribera del Duero', 'Soria, Castilla y León', 'España') <> 'Castilla y León' then
    raise exception 'FALLO T2: vino_region_de';
  end if;
  if vino_denominacion_canonica('D.O. Rioja') <> 'D.O.Ca. Rioja' or vino_denominacion_canonica('Sin D.O.') is not null
     or vino_denominacion_canonica('D.O. Ribera Del Duero') <> 'D.O. Ribera del Duero' then
    raise exception 'FALLO T2: vino_denominacion_canonica';
  end if;

  -- T3 ─────────────────────────────────────────────────────────────────────
  select v.id into v_rio from "Vinos" v
   where vino_texto_normalizado(v.denominacion_origen) ~ 'rioja'
     and not exists (select 1 from vino_producto vp where vp.vino_id = v.id) order by v.id limit 1;
  select v.id into v_otro from "Vinos" v
   where v.denominacion_origen is not null and v.id <> v_rio
     and not exists (select 1 from vino_producto vp where vp.vino_id = v.id) order by v.id limit 1;
  if v_rio is null then raise exception 'FALLO T3: no hay ningún vino de Rioja sin enlazar en la carta'; end if;
  if v_otro is null then raise exception 'FALLO T3: no hay otro vino sin enlazar en la carta'; end if;
  insert into productos_catalogo (nombre, categoria_id, origen) values ('PruebaDO Tinto de la casa 75 cl', v_vin, 'manual')
    returning id into v_pc1;
  insert into productos_catalogo (nombre, categoria_id, origen) values ('PruebaDO Blanco sin carta 75 cl', v_vin, 'manual')
    returning id into v_pc2;
  update productos_catalogo set denominacion_origen = 'D.O. Rueda', denominacion_origen_origen = 'ia' where id = v_pc1;
  insert into vino_producto (vino_id, producto_id, origen) values (v_rio, v_pc1, 'manual');
  select * into pc from productos_catalogo where id = v_pc1;
  if pc.denominacion_origen_origen is distinct from 'carta' or pc.denominacion_origen <> 'D.O.Ca. Rioja' or pc.pais_vino is null then
    raise exception 'FALLO T3: el enlace no rellena desde la carta (%, %)', pc.denominacion_origen, pc.denominacion_origen_origen;
  end if;
  -- manual no se pisa
  update productos_catalogo set denominacion_origen = 'D.O. Toro', denominacion_origen_origen = 'manual' where id = v_pc2;
  insert into vino_producto (vino_id, producto_id, origen) values (v_otro, v_pc2, 'manual');
  if (select denominacion_origen from productos_catalogo where id = v_pc2) <> 'D.O. Toro' then
    raise exception 'FALLO T3: la carta pisa un dato manual';
  end if;
  delete from vino_producto where producto_id = v_pc2;
  if (select denominacion_origen_origen from productos_catalogo where id = v_pc2) <> 'manual' then
    raise exception 'FALLO T3: desenlazar borra un dato manual';
  end if;
  -- vuelve a sin D.O. para T4 (sin carta y sin dato)
  update productos_catalogo set denominacion_origen = null, region_vino = null, pais_vino = null,
                                denominacion_origen_origen = null where id = v_pc2;

  -- T4 ─────────────────────────────────────────────────────────────────────
  insert into proveedores (nombre, cif) values ('PRUEBA VINOS DO CHAT', 'B00000977') returning id into v_p;
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
  values ('factura', 'PRUEBA VINOS DO CHAT', 'B00000977', v_p, 'DO-1', '2031-09-12', 500, 'casa_tomas') returning id into v_f;
  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, producto_id)
  values (v_f, 'TINTO CASA PRUEBADO 75CL', 12, 'botella', 25, 300, v_pc1),   -- Rioja por la carta, sin «Rioja» en la línea
         (v_f, 'BLANCO PRUEBADO 75CL', 6, 'botella', 20, 120, v_pc2);       -- vino sin D.O.

  r := gasto_categorias_agente(null, '2031-09-01', '2031-09-30', null, null, 'Rioja', null, null);
  if (r -> 'total' ->> 'importe')::numeric <> 300 or (r -> 'filtro_vino' ->> 'denominacion') <> 'Rioja' then
    raise exception 'FALLO T4: gasto Rioja = % (esperado 300): %', r -> 'total' ->> 'importe', r;
  end if;
  if (r -> 'vino_sin_denominacion' ->> 'lineas')::int <> 1 or (r -> 'vino_sin_denominacion' ->> 'importe')::numeric <> 120 then
    raise exception 'FALLO T4: vino_sin_denominacion %', r -> 'vino_sin_denominacion';
  end if;
  r := gasto_categorias_agente('vinos', '2031-09-01', '2031-09-30', null, null, 'vinos de Ribera', null, null);
  if r -> 'total' is not null then raise exception 'FALLO T4: Ribera cuenta el Rioja: %', r -> 'total'; end if;
  r := gasto_categorias_agente('vinos', '2031-09-01', '2031-09-30', null, null);
  if (r -> 'total' ->> 'importe')::numeric <> 420 or r -> 'vino_sin_denominacion' is not null or r -> 'filtro_vino' is not null then
    raise exception 'FALLO T4: sin filtro cambia: %', r -> 'total';
  end if;

  r := volumen_comprado_agente(null, null, '2031-09-01', '2031-09-30', null, null, null, null, 'rioja', null, null);
  if (r ->> 'importe_base')::numeric <> 300 or (r ->> 'categoria') is null then
    raise exception 'FALLO T4: volumen Rioja = % (%): %', r ->> 'importe_base', r ->> 'categoria', r;
  end if;
  if (r -> 'vino_sin_denominacion' ->> 'lineas')::int <> 1 then
    raise exception 'FALLO T4: volumen vino_sin_denominacion %', r -> 'vino_sin_denominacion';
  end if;
  r := volumen_comprado_agente(null, 'vino', '2031-09-01', '2031-09-30', null, null, null, null, null, null, 'Francia');
  if (r ->> 'sin_datos')::boolean is not true then raise exception 'FALLO T4: Francia cuenta vinos españoles: %', r ->> 'total'; end if;

  raise notice 'chat_vinos_denominacion_test: OK';
end $$;

select 'chat_vinos_denominacion_test: OK' as resultado;
rollback;
