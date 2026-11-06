set client_encoding = 'UTF8';
-- Caso 8 (continuación) · DEMO · «Bj» y «Bo» ya existían en el catálogo con su nombre bueno:
--   pimiento California amarillo ristra 500 g -> #534 «Pimiento California amarillo» (alias del mismo texto)
--   Ñora en bote 380 g (La Especiera del Norte) -> #746 «Ñora» (Makro «ÑORA 380G», mismo bote)
-- Las dos líneas pasan a esos productos y los productos falsos 636 / 637 (sin líneas ni alias) se borran.
begin;
update productos_factura set producto_id = 534 where id = 8885 and producto_id = 636;
update productos_factura set producto_id = 746 where id = 7769 and producto_id = 637;
update productos_alias set producto_id = 746, origen = 'manual'
 where texto_normalizado = normalizar_nombre_producto('LA ESPECIERA DEL NORTE Ñora en bote 380g') and producto_id = 637;
delete from productos_catalogo c
 where c.id in (636, 637)
   and not exists (select 1 from productos_factura pf where pf.producto_id = c.id)
   and not exists (select 1 from productos_alias a where a.producto_id = c.id)
   and not exists (select 1 from avisos_subida_precio s where s.producto_id = c.id);
select pf.id, pf.nombre, pf.producto_id, c.nombre as producto, c.categoria_id
  from productos_factura pf join productos_catalogo c on c.id = pf.producto_id where pf.id in (8885, 7769);
commit;
