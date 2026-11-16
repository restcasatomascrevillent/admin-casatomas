set client_encoding = 'UTF8';
-- ===========================================================================
-- Pruebas de 20261207300000_ocr_contenido_packs.sql sobre la base real.
-- BEGIN … ROLLBACK: no deja nada escrito. DESPUÉS de aplicar la migración:
--   npx supabase db query --linked -f supabase/tests/ocr_contenido_packs_test.sql
-- Tiene que acabar en «ocr_contenido_packs_test: OK». La batería completa (las
-- 16 reglas y los contraejemplos) está en scripts/test-ocr-contenido-packs.mjs.
-- ===========================================================================
begin;

do $$
declare
  v_f bigint; v_a bigint; v_b bigint; v_c bigint;
  r record;
begin
  -- Lectura
  assert (select cantidad from contenido_linea('COCA COLA 237 CL. * 24', 'caja', 1)) = 5.688, '237 CL * 24';
  assert (select cantidad from contenido_linea('LANJARON VIDRIO RET. 0''50 L. * 20', 'caja', 1)) = 10, '0''50 L * 20';
  assert (select cantidad from contenido_linea('SCHWEPPES TONICA E/R 200ml*28', 'caja', 1)) = 5.6, '200ml*28';
  assert (select cantidad from contenido_linea('LCA TDV GASEOSA RET. 24*275 ML', 'caja', 1)) = 6.6, '24*275 ML';
  assert (select cantidad from contenido_linea('JUAN GIL NACAR C.x06 BOT.0,75 L ES-ECO-024-MU', 'caja', 1)) = 4.5, 'C.x06';
  assert (select cantidad from contenido_linea('C/6B LP ROSE 0,75', 'caja', 1)) = 4.5, 'C/6B';
  assert (select cantidad from contenido_linea('HEINEKEN 1/3 LONG NET * 24', 'caja', 1)) = 7.92, '1/3 * 24';
  assert (select cantidad from contenido_linea('aro leche entera 1 L contiene 6 unidades', 'brik', 1)) = 6, 'contiene 6';
  assert (select cantidad from contenido_linea('L/ Gordal DH F/5G 3000 neto (lectura dudosa)', 'lata', 1)) = 3, 'neto';
  assert (select cantidad from contenido_linea('AGUA BEZOYA 1,5L', 'pack de 6', 1)) = 9, 'pack de 6';
  assert (select cantidad from contenido_linea('W.JOHNNIE WALKER E/N 70CL 40º C12', 'botella', 1)) = 0.7, 'C12 por botella';
  assert not exists (select 1 from contenido_linea('COCACOLA LT 33CL REGULAR', 'pack', 1)), 'pack sin unidades = nada';
  assert (select cantidad from contenido_linea('Juan Gil Etiqueta Plata 12 meses 75 cl', 'botella', 12)) = 0.75, '12 meses';
  assert not exists (select 1 from contenido_linea('Vino Reserva 2016', 'botella', 1)), 'Reserva 2016';
  assert not exists (select 1 from contenido_linea('C/ Mayor 24', 'ud', 1)), 'C/ Mayor 24';
  assert not exists (select 1 from contenido_linea('Whisky 12 años', 'botella', 1)), '12 años';
  assert (select cantidad from extraer_contenido('caja 10 kg')) = 10 and (select cantidad from extraer_contenido('LEJIA 5L c/3u')) = 5, 'extraer_contenido de siempre';
  select * into r from envase_texto('COCA COLA 237 CL. * 24');
  assert r.volumen = 0.237 and r.unidades = 24, 'envase_texto 237 CL';

  -- Trigger sobre la tabla real
  insert into facturas (tipo, proveedor, numero_documento, fecha, total)
  values ('factura', 'ZZPRUEBA PACKS', 'ZZ-PACKS-1', '2026-01-10', 100) returning id into v_f;
  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total)
  values (v_f, 'ZZPRUEBA COLA 237 CL. * 24', 2, 'caja', 20, 40) returning id into v_a;
  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total)
  values (v_f, 'ZZPRUEBA COLA LT 33CL', 2, 'pack', 15, 30) returning id into v_b;
  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, contenido_cantidad, contenido_unidad)
  values (v_f, 'ZZPRUEBA COLA 237 CL. * 24', 2, 'caja', 20, 40, 7, 'l') returning id into v_c;
  select contenido_cantidad c, contenido_unidad u, contenido_origen o into r from productos_factura where id = v_a;
  assert r.c = 5.688 and r.u = 'l' and r.o = 'texto', 'trigger: caja de 24';
  select contenido_cantidad c, contenido_origen o into r from productos_factura where id = v_b;
  assert r.c is null and r.o is null, 'trigger: pack sin unidades';
  select contenido_cantidad c, contenido_origen o into r from productos_factura where id = v_c;
  assert r.c = 7 and r.o = 'manual', 'trigger: lo manual no se pisa';
  raise notice 'ocr_contenido_packs_test: OK';
end;
$$;

rollback;

select 'ocr_contenido_packs_test: OK' as resultado;
