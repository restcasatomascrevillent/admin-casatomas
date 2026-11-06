set client_encoding = 'UTF8';
-- Caso 2 (D13) · DEMO sfonaclosuafvlhutkon · 06/11/2026 · comprobado en el PDF (ver INFORME.md)
begin;
do $$
declare v_n int;
begin
  -- 2a · Mª Carmen Virola: la base impresa es ANTES del 20 % de descuento sobre el total con IVA.
  update facturas f set subtotal = round(f.total - f.iva, 2)
   where f.id in (532, 729, 1061, 1455, 1954) and f.subtotal > f.total;
  get diagnostics v_n = row_count;
  raise notice 'Virola: % documentos', v_n;

  -- 2b · Campoluz: punto verde (P.V.) incluido en la base y que no estaba en ninguna línea.
  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, iva_pct, pagina, orden, producto_id)
  select v.fid, v.nombre, v.cant, 'ud', v.precio, v.total, v.iva, 1,
         (select coalesce(max(orden), -1) from productos_factura where factura_id = v.fid) + v.n, 338
    from (values
      (1658, 'Punto verde (P.V.) 21 %', 1, 0.59, 0.59, 21, 1), (1658, 'Punto verde (P.V.) 10 %', 1, 0.49, 0.49, 10, 2),
      (1907, 'Punto verde (P.V.) 21 %', 1, 0.86, 0.86, 21, 1), (1907, 'Punto verde (P.V.) 10 %', 1, 0.16, 0.16, 10, 2),
      (1923, 'Punto verde (P.V.) 21 %', 1, 0.70, 0.70, 21, 1),
      (2126, 'Punto verde (P.V.) 10 %', 1, 0.19, 0.19, 10, 1),
      (531,  'Punto verde (P.V.) 10 %', 1, 0.55, 0.55, 10, 1),
      (529,  'Punto verde (P.V.) 21 %', -1, 0.48, -0.48, 21, 1),
      (2308, 'Punto verde (P.V.) 10 %', 1, 0.44, 0.44, 10, 1),
      (1131, 'Punto verde (P.V.) 21 %', 1, 0.35, 0.35, 21, 1),
      (1444, 'Punto verde (P.V.) 21 %', 1, 0.04, 0.04, 21, 1),
      -- albaranes Campoluz de la demo (originales: fotos de Desktop/Oficiosos/facturas)
      (46,   'Punto verde (P.V.) 21 %', 1, 6.00, 6.00, 21, 1),
      (48,   'Punto verde (P.V.) 21 %', 1, 0.72, 0.72, 21, 1)
    ) as v(fid, nombre, cant, precio, total, iva, n)
   where not exists (select 1 from productos_factura x where x.factura_id = v.fid and x.nombre like 'Punto verde (P.V.)%');
  get diagnostics v_n = row_count;
  raise notice 'P.V.: % líneas', v_n;

  -- 2c · Abonos con una línea que REDUCE el abono: va en positivo.
  update productos_factura set total = 32.93, cantidad = 1
   where factura_id = 1531 and nombre like 'Descuento comercial 9 %' and total = -32.93;
  update productos_factura set total = 0.95, cantidad = 1
   where factura_id = 1716 and nombre like 'Oferta Calendario adviento%' and total = -0.95;

  -- 2d · Albarán Campoluz 46 (AL2025/0009781, foto 22.04.59 (2)): cantidades mal leídas.
  update productos_factura set cantidad = 1 where id = 417 and factura_id = 46 and cantidad = 2;           -- Amaretto 100 %: 1
  update productos_factura set cantidad = 2, total = 68.10 where id = 418 and factura_id = 46 and total = 34.05; -- Brugal 1888: 2 × 34,05
  update productos_factura set cantidad = 1, total = 2.37 where id = 421 and factura_id = 46 and total = 4.74;  -- Gestión y logística: 1 × 2,37
  update productos_factura set cantidad = 2 where id = 422 and factura_id = 46 and cantidad = 1;           -- J. Walker Red 100 %: 2
end $$;

-- Comprobación: estos documentos ya cuadran (líneas = subtotal)
select f.id, f.subtotal, (select sum(total) from productos_factura where factura_id = f.id) as suma_lineas
  from facturas f where f.id in (532, 729, 1061, 1455, 1954, 1658, 1907, 1923, 2126, 531, 529, 2308, 1131, 1444, 46, 48, 1531, 1716)
 order by f.id;
commit;
