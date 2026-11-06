set client_encoding = 'UTF8';
-- Caso 6 · DEMO · líneas con total NULL y precio.
begin;
-- D. Primeras Marcas (R860, R1017): segunda línea con «% Descuento 100» e importe en blanco = 0 €.
update productos_factura set total = 0, descuento_pct = 100, importe_bruto_estimado = false
 where id in (8597, 9598, 9600) and factura_id in (1511, 1665) and total is null;
-- Musgrave (R34, abono lote de Navidad): los componentes no tienen Total impreso (el total va en la
-- línea del lote, -276,21); su «Pvp S/Iva» es la base de las 5 unidades -> importe_bruto = esa base,
-- precio por unidad = base / 5. El total sigue NULL para no duplicar.
update productos_factura p set precio_unitario = v.precio, importe_bruto = v.bruto, importe_bruto_estimado = false
  from (values (2681, 6.81, -34.05), (2682, 31.56, -157.82), (2683, 16.87, -84.34)) as v(id, precio, bruto)
 where p.id = v.id and p.factura_id = 582 and p.total is null;
select id, factura_id, nombre, cantidad, precio_unitario, total, importe_bruto, descuento_pct
  from productos_factura where id in (8597, 9598, 9600, 2681, 2682, 2683) order by factura_id, orden;
commit;
