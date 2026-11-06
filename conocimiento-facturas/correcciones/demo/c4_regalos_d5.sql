set client_encoding = 'UTF8';
-- Caso 4 (D5) · DEMO · líneas a 0 € con precio impreso y «Dto. 100 %» en el original:
-- importe_bruto = cantidad × precio impreso (no estimado). Va DESPUÉS de c2 (cantidades del 46 corregidas).
begin;
update productos_factura pf
   set importe_bruto = round(pf.cantidad * pf.precio_unitario, 2),
       importe_bruto_estimado = false,
       descuento_pct = 100
 where pf.id in (363, 407, 415, 417, 422, 423, 424, 429, 432)
   and pf.factura_id in (35, 46, 48)
   and pf.total = 0 and pf.importe_bruto is null;
select id, factura_id, nombre, cantidad, precio_unitario, total, importe_bruto, descuento_pct
  from productos_factura where id in (363, 407, 415, 417, 422, 423, 424, 429, 432) order by factura_id, orden;
commit;
