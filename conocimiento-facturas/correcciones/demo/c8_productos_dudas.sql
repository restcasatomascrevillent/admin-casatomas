set client_encoding = 'UTF8';
-- Caso 8 · DEMO · productos con «duda» de clasificacion/REPASO.md resueltos con el PDF.
begin;
do $$
declare v_n int;
begin
  -- 8a · Pescados y Mariscos Colorao: columnas PESO (kg) y PRECIO (€/kg) leídas al revés en TODAS
  --      sus líneas de producto (brillante, cigalas, quisquillas). Total, IVA y cajas no cambian.
  update productos_factura pf
     set cantidad = pf.precio_unitario, precio_unitario = pf.cantidad
    from facturas f
   where f.id = pf.factura_id
     and f.proveedor ilike '%colorao%'
     and pf.nombre not ilike 'ENVASES%'
     and pf.cantidad > pf.precio_unitario                       -- aún sin corregir
     and abs(pf.cantidad * pf.precio_unitario - pf.total) <= 0.02;
  get diagnostics v_n = row_count;
  raise notice 'Colorao: % líneas', v_n;

  -- 8b · «Brillante» = Plesiopenaeus edwardsianus (nombre científico impreso) = carabinero.
  update productos_catalogo set nombre = 'Carabinero brillante', categoria_id = 18, unidad_habitual = 'kg'
   where id = 2147 and nombre = 'Brillante';

  -- 8c · Makro: «BJ» y «BO» eran el código de envase (bandeja / bote), no el artículo.
  update productos_catalogo set nombre = 'Pimiento California amarillo ristra 500 g', categoria_id = 5
   where id = 636 and nombre = 'Bj';
  update productos_catalogo set nombre = 'Ñora en bote 380 g', categoria_id = 6
   where id = 637 and nombre = 'Bo';
  update productos_factura set nombre = 'METRO Chef Pimiento California amarillo ristra 500g'
   where id = 8885 and factura_id = 1561 and nombre = 'BJ';
  update productos_factura set nombre = 'LA ESPECIERA DEL NORTE Ñora en bote 380g'
   where id = 7769 and factura_id = 1391 and nombre = 'BO';
  insert into productos_alias (texto_normalizado, producto_id, origen)
  select normalizar_nombre_producto(v.t), v.p, 'manual'
    from (values ('METRO Chef Pimiento California amarillo ristra 500g', 636),
                 ('LA ESPECIERA DEL NORTE Ñora en bote 380g', 637),
                 ('Punto verde (P.V.) 21 %', 338), ('Punto verde (P.V.) 10 %', 338)) as v(t, p)
   where not exists (select 1 from productos_alias a where a.texto_normalizado = normalizar_nombre_producto(v.t));
  -- Los alias «bj» y «bo» harían que cualquier código de envase mal leído cayera en estos productos.
  delete from productos_alias where texto_normalizado in ('bj', 'bo') and producto_id in (636, 637);

  -- 8d · La Bohemia (R1439): «OBSEQUIO SIERRA CANTABRIA» es el rótulo del albarán de obsequio
  --      (El Puntido 21 3 L y San Vicente 19 Magnum, que ya son líneas propias), no un producto.
  delete from productos_factura where id = 12743 and factura_id = 2145 and nombre = 'OBSEQUIO SIERRA CANTABRIA';
end $$;
select pf.factura_id, pf.nombre, pf.cantidad, pf.unidad, pf.precio_unitario, pf.total
  from productos_factura pf join facturas f on f.id = pf.factura_id
 where f.proveedor ilike '%colorao%' and pf.nombre not ilike 'ENVASES%' order by f.fecha, pf.orden;
select id, nombre, categoria_id from productos_catalogo where id in (636, 637, 2147);
commit;
