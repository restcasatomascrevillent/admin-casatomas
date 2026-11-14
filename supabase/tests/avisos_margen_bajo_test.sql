set client_encoding = 'UTF8';
-- Test de 20261125110000_avisos_margen_bajo. BEGIN … ROLLBACK: no deja nada
-- escrito. Acaba en «avisos_margen_bajo_test: OK».
--   npx supabase db query --linked -f supabase/tests/avisos_margen_bajo_test.sql
--
--   T1 permisos: tabla de estado sin acceso para el panel; funciones internas sin
--      EXECUTE para authenticated.
--   T2 margen bajo: vino a 30 € con botella a 10 € (2,73×); llega una factura a
--      14 € → coste 14 € (desde 20261128140000, el de la ÚLTIMA factura; antes, la
--      mediana: 12 €) → 1,95× < 2,3× → UN aviso facturas_margen_bajo con el texto
--      sencillo, enlace a la factura y texto_telegram; repetir el cron no lo duplica.
--      La tienda (desactivada) cruza también su límite y NO avisa.
--   T3 vuelve a estar bien (límite 1,9): su aviso caduca.
--   T4 texto de la subida de precio: cuánto, factura, la factura anterior (la referencia,
--      20261130120000) y carta.
--   T5 facturas_generar_alertas devuelve el resumen de márgenes.
begin;

do $$
declare
  v_vin bigint; v_p bigint; v_prov bigint; v_f bigint; v_f2 bigint;
  j jsonb; n record; v_cuantos int;
begin
  -- T1 ─────────────────────────────────────────────────────────────────────
  if has_table_privilege('authenticated', 'public.margenes_avisos_estado', 'select')
     or has_function_privilege('authenticated', 'public.margenes_generar_avisos(date,boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.facturas_alerta_subida_texto(jsonb)', 'execute') then
    raise exception 'FALLO T1: el panel puede leer el estado o ejecutar una función interna';
  end if;

  update margenes_carta_config set multiplicador_min_vino = 2.3, multiplicador_min_tienda = 1.5, iva_pct = 10, iva_tienda_pct = 21 where id;
  update configuracion_tienda set activa = false, descuento_pct = 30, vinos_excluidos = '{}' where id;

  select id into v_vin from categorias_producto where clave = 'bebidas.vinos';
  insert into productos_catalogo (nombre, categoria_id, origen, envase_cantidad, envase_unidad)
  values ('Pruebaf5av Ribera 75 cl', v_vin, 'manual', 0.75, 'l') returning id into v_p;
  insert into proveedores (nombre, cif) values ('PRUEBA CATRAL F5', 'B00000626') returning id into v_prov;
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, subtotal, iva, total)
  values ('factura', 'PRUEBA CATRAL F5', 'B00000626', v_prov, 'F5A-1', '2031-06-01', 60, 12.6, 72.6) returning id into v_f;
  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, producto_id, iva_pct)
  values (v_f, 'PRUEBAF5AV RIBERA 75 CL', 6, 'botella', 10, 60, v_p, 21);
  insert into "Vinos" (id, nombre, categoria, precio_eur, activado, restaurante, ubicacion_pais, ubicacion_region)
  values ('prueba-f5av-ribera', 'PRUEBA Ribera', 'VINOS — PRUEBA F5', 30, true, true, 'España', 'Ribera del Duero');
  insert into vino_producto (vino_id, producto_id, origen) values ('prueba-f5av-ribera', v_p, 'manual');

  -- Estado de partida (como al aplicar la migración): sin avisos.
  j := public.margenes_generar_avisos('2031-06-30', true);
  if (j->>'nuevos')::int <> 0 then raise exception 'FALLO T2: el estado inicial avisa %', j; end if;

  -- T2 ─────────────────────────────────────────────────────────────────────
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, subtotal, iva, total)
  values ('factura', 'PRUEBA CATRAL F5', 'B00000626', v_prov, 'F5A-2', '2031-06-29', 84, 17.64, 101.64) returning id into v_f2;
  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, producto_id, iva_pct)
  values (v_f2, 'PRUEBAF5AV RIBERA 75 CL', 6, 'botella', 14, 84, v_p, 21);
  j := public.margenes_generar_avisos('2031-06-30');
  select count(*) into v_cuantos from notificaciones_dashboard
   where tipo = 'facturas_margen_bajo' and datos->>'articulo_id' = 'prueba-f5av-ribera';
  if v_cuantos <> 1 then raise exception 'FALLO T2: % avisos del vino (esperaba 1, solo restaurante) %', v_cuantos, j; end if;
  select * into n from notificaciones_dashboard where tipo = 'facturas_margen_bajo' and datos->>'articulo_id' = 'prueba-f5av-ribera';
  if n.mensaje not like 'El vino «PRUEBA Ribera» ha bajado a 1,95× (límite 2,3×): la botella te cuesta ahora 14,00 € (antes 10,00 €), según la factura de PRUEBA CATRAL F5 del 29/06.%' then
    raise exception 'FALLO T2: texto «%»', n.mensaje;
  end if;
  if n.datos->>'enlace' <> '?tab=compras&modo=documentos&doc=' || v_f2 or n.referencia_tipo <> 'facturas_alerta'
     or coalesce(n.datos->>'texto_telegram', '') = '' or n.datos->>'canal' <> 'vino' or n.leida
     or n.clave <> 'margen_bajo:vino:prueba-f5av-ribera:2031-06-30' then
    raise exception 'FALLO T2: datos %', row_to_json(n);
  end if;
  if (select bajo from margenes_avisos_estado where canal = 'tienda' and articulo_id = 'prueba-f5av-ribera') is not true then
    raise exception 'FALLO T2: el estado de la tienda no se guarda';
  end if;
  -- Al día siguiente sigue por debajo: no hay aviso nuevo.
  j := public.margenes_generar_avisos('2031-07-01');
  select count(*) into v_cuantos from notificaciones_dashboard
   where tipo = 'facturas_margen_bajo' and datos->>'articulo_id' = 'prueba-f5av-ribera';
  if v_cuantos <> 1 then raise exception 'FALLO T2: se duplica el aviso (% avisos)', v_cuantos; end if;

  -- T3 ─────────────────────────────────────────────────────────────────────
  update margenes_carta_config set multiplicador_min_vino = 1.9 where id;
  perform public.margenes_generar_avisos('2031-07-01');
  if exists (select 1 from notificaciones_dashboard where tipo = 'facturas_margen_bajo'
              and datos->>'articulo_id' = 'prueba-f5av-ribera' and datos->>'canal' = 'vino' and caduca_en > now()) then
    raise exception 'FALLO T3: el aviso no caduca al volver a estar bien';
  end if;

  -- T4 ─────────────────────────────────────────────────────────────────────
  j := public.facturas_alerta_subida_texto(jsonb_build_object(
         'producto_id', v_p, 'producto', 'PRUEBAF5AV RIBERA 75 CL', 'proveedor', 'PRUEBA CATRAL F5', 'proveedor_id', v_prov,
         'nombre_normalizado', 'pruebaf5av ribera 75 cl', 'factura_id', v_f2, 'fecha', '2031-06-29',
         'medida', 'l', 'unidad', 'botella', 'precio', 18.6667, 'precio_ref', 13.3333, 'precio_ud', 14,
         'variacion_pct', 40, 'compras_ref', 2, 'impacto_mes', 25,
         -- 20261130120000: la referencia es la factura anterior (la trae la regla).
         'fecha_ref', '2031-06-01', 'factura_ref_id', v_f, 'cantidad_90', 12));
  if j->>'mensaje' <> 'En la factura de PRUEBA CATRAL F5 del 29/06 pagaste Pruebaf5av Ribera 75 cl a 18,67 €/l. En la factura anterior, del 01/06, estaba a 13,33 €/l: 5,33 € más por cada litro (un 40 % más). Compras unos 4,0 l al mes, así que te cuesta unos 25 € más al mes. Lo usa la carta en: PRUEBA Ribera. Qué puedes hacer: pregunta a PRUEBA CATRAL F5 por qué ha subido o mira si otro proveedor te lo deja más barato. Precios sin IVA.' then
    raise exception 'FALLO T4: mensaje «%»', j->>'mensaje';
  end if;
  if j->>'titulo' <> 'Pruebaf5av Ribera 75 cl sube un 40 % en PRUEBA CATRAL F5' or coalesce(j->'datos'->>'texto_telegram', '') = ''
     or (j->'datos'->'compra_anterior'->>'factura_id')::bigint <> v_f then
    raise exception 'FALLO T4: título/datos %', j;
  end if;

  -- T5 ─────────────────────────────────────────────────────────────────────
  j := public.facturas_generar_alertas(current_date);
  if not (j ? 'margenes') or (j->'margenes' ? 'error') then
    raise exception 'FALLO T5: facturas_generar_alertas sin resumen de márgenes %', j;
  end if;
end $$;

select 'avisos_margen_bajo_test: OK' as resultado;
rollback;
