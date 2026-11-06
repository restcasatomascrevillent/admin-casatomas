set client_encoding = 'UTF8';
-- ===========================================================================
-- Correcciones de calidad de Facturas · PRODUCCIÓN (haqmmdfdzzatdnrrcgez) · preparado el 06/11/2026
-- ===========================================================================
-- Lo que NO cabe en los JSON del paquete de importación (importar/json, ya corregidos):
-- vínculo albarán → factura, facturas marcadas como revisadas, catálogo de productos y alias.
-- Comprobado todo contra el PDF original: ver correcciones/INFORME.md.
--
-- ORDEN: 1) importar el paquete importar/ (con los JSON corregidos por corregir_json.py);
--        2) clasificacion/aplicar_clasificacion.sql;   3) ESTE fichero.
-- Usa SOLO claves estables (import_clave, número de documento + CIF, nombres); ningún id de la demo.
-- Idempotente: se puede ejecutar varias veces. Si algo no existe en producción, no hace nada.
-- Ejecutar:  supabase db query --linked -f ../facturas-conocimiento/correcciones/aplicar_en_produccion.sql
--            (con el proyecto de PRODUCCIÓN enlazado y el «sí» del dueño)
-- ===========================================================================
begin;

-- ── 1 · D12 · Albarán Makro (pedido 9-242608469, 06/10/2026) facturado en la factura R1664 ──────────
--    R1664.pdf p.1: «*** Número de pedido 9-242608469 … Fecha: 06/10/2026» y las mismas 12 líneas.
--    El albarán es una subida de prueba del OCR de la demo: si no existe en producción, no hace nada.
do $$
declare v_alb bigint; v_fac bigint; r jsonb;
begin
  select id into v_fac from facturas where import_clave = 'zip2026:R1664.pdf#0';
  select a.id into v_alb from facturas a
   where a.tipo = 'albaran' and a.numero_documento = '9-242608469' and a.facturado_en_id is null
     and a.proveedor_id = (select proveedor_id from facturas where id = v_fac)
   limit 1;
  if v_fac is not null and v_alb is not null then
    r := vincular_albaran_factura(v_alb, v_fac, false);
    raise notice 'Vínculo Makro: %', r;
  else
    raise notice 'Vínculo Makro: no aplica (albarán % / factura %)', v_alb, v_fac;
  end if;
end $$;

-- ── 2 · D13/D5 · Documentos que solo existen si se subieron por el OCR (no están en el paquete) ─────
--    Albaranes Campoluz AL2025/0009781 y AL2025/0009780 (23/12/2025) y factura MR FRIOSAT 000016
--    (28/01/2026): originales en las fotos de Desktop/Oficiosos/facturas. Si no existen, no hace nada.
do $$
declare v46 bigint; v48 bigint; v35 bigint;
begin
  select id into v46 from facturas where numero_documento = 'AL2025/0009781' and tipo = 'albaran' and cif = 'B53375358' limit 1;
  select id into v48 from facturas where numero_documento = 'AL2025/0009780' and tipo = 'albaran' and cif = 'B53375358' limit 1;
  select id into v35 from facturas where numero_documento = '000016' and proveedor ilike 'MR FRIOSAT%' limit 1;
  if v46 is not null then
    update productos_factura set cantidad = 1 where factura_id = v46 and nombre = 'AMARETTO DISARONNO 70 CL.' and total = 0 and cantidad = 2;
    update productos_factura set cantidad = 2, total = 68.10 where factura_id = v46 and nombre = 'BRUGAL 1888 70 CL.' and total = 34.05;
    update productos_factura set cantidad = 1, total = 2.37 where factura_id = v46 and nombre = 'GESTION Y LOGISTICA' and total = 4.74;
    update productos_factura set cantidad = 2 where factura_id = v46 and nombre = 'JOHNNIE WALKER RED 70 CL.' and total = 0 and cantidad = 1;
  end if;
  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, iva_pct, pagina, orden)
  select v.fid, 'Punto verde (P.V.) 21 %', 1, 'ud', v.imp, v.imp, 21, 1,
         (select coalesce(max(orden), -1) + 1 from productos_factura where factura_id = v.fid)
    from (values (v46, 6.00), (v48, 0.72)) as v(fid, imp)
   where v.fid is not null
     and not exists (select 1 from productos_factura x where x.factura_id = v.fid and x.nombre like 'Punto verde (P.V.)%');
  -- Líneas a 0 € con «Dto. 100 %» y precio impreso: lo que valían.
  update productos_factura
     set importe_bruto = round(cantidad * precio_unitario, 2), importe_bruto_estimado = false, descuento_pct = 100
   where factura_id in (v46, v48, v35)
     and total = 0 and importe_bruto is null and precio_unitario > 0 and cantidad > 0;
end $$;

-- ── 3 · D17 · Importes extremos confirmados en el PDF: factura revisada (el aviso lo recalcula la BD) ─
--    R670 Embajadores 01/0005146 (solomillo 750,20 kg × 33,00 = 24.756,60; total 34.106,83)
--    R881 Galmar 202602540 (pulpo 754 kg × 14,80 = 11.159,20; total 25.294,56)
update facturas set verificada = true
 where import_clave in ('zip2026:R670.pdf#0', 'zip2026:R881.pdf#0') and not coalesce(verificada, false);

-- ── 4 · Catálogo (productos con «duda» de clasificacion/REPASO.md) ─────────────────────────────────
do $$
declare v_pv bigint; v_pim bigint; v_nora bigint; v_bj bigint; v_bo bigint;
begin
  -- 4a · «Brillante» de Pescados y Mariscos Colorao = Plesiopenaeus edwardsianus (impreso) = carabinero.
  if not exists (select 1 from productos_catalogo where nombre = 'Carabinero brillante') then
    update productos_catalogo set nombre = 'Carabinero brillante', categoria_id = 18, unidad_habitual = 'kg'
     where nombre = 'Brillante';
  end if;

  -- 4b · Punto verde (líneas nuevas de Campoluz): al producto de embalajes / punto verde.
  select id into v_pv from productos_catalogo where nombre = 'Embalajes, logística y punto verde';
  if v_pv is not null then
    insert into productos_alias (texto_normalizado, producto_id, origen)
    select normalizar_nombre_producto(t), v_pv, 'manual'
      from unnest(array['Punto verde (P.V.) 21 %', 'Punto verde (P.V.) 10 %']) t
    on conflict (texto_normalizado) do nothing;
    update productos_factura set producto_id = v_pv
     where producto_id is null and nombre in ('Punto verde (P.V.) 21 %', 'Punto verde (P.V.) 10 %');
  end if;

  -- 4c · «Bj» / «Bo» (Makro) eran el código de envase; el artículo es el pimiento California amarillo
  --      ristra 500 g y la ñora en bote 380 g. Los JSON ya llevan el nombre bueno.
  select id into v_pim from productos_catalogo where nombre = 'Pimiento California amarillo';
  select id into v_nora from productos_catalogo where nombre = 'Ñora';
  select id into v_bj from productos_catalogo where nombre = 'Bj';
  select id into v_bo from productos_catalogo where nombre = 'Bo';
  if v_pim is null and v_bj is not null then   -- sin producto bueno: se renombra el falso
    update productos_catalogo set nombre = 'Pimiento California amarillo', categoria_id = 5 where id = v_bj;
    v_pim := v_bj; v_bj := null;
  end if;
  if v_nora is null and v_bo is not null then
    update productos_catalogo set nombre = 'Ñora', categoria_id = 6 where id = v_bo;
    v_nora := v_bo; v_bo := null;
  end if;
  insert into productos_alias (texto_normalizado, producto_id, origen)
  select normalizar_nombre_producto(v.t), v.p, 'manual'
    from (values ('METRO Chef Pimiento California amarillo ristra 500g', v_pim),
                 ('LA ESPECIERA DEL NORTE Ñora en bote 380g', v_nora)) as v(t, p)
   where v.p is not null
  on conflict (texto_normalizado) do nothing;
  update productos_factura set producto_id = v_pim
   where nombre = 'METRO Chef Pimiento California amarillo ristra 500g' and v_pim is not null
     and (producto_id is null or producto_id = v_bj);
  update productos_factura set producto_id = v_nora
   where nombre = 'LA ESPECIERA DEL NORTE Ñora en bote 380g' and v_nora is not null
     and (producto_id is null or producto_id = v_bo);
  delete from productos_alias where texto_normalizado in ('bj', 'bo') and producto_id in (v_bj, v_bo);
  delete from productos_catalogo c
   where c.id in (v_bj, v_bo)
     and not exists (select 1 from productos_factura pf where pf.producto_id = c.id)
     and not exists (select 1 from productos_alias a where a.producto_id = c.id)
     and not exists (select 1 from avisos_subida_precio s where s.producto_id = c.id);
end $$;

-- ── Comprobación ─────────────────────────────────────────────────────────────────────────────────────
select jsonb_build_object(
  'vinculo_makro', (select jsonb_agg(jsonb_build_object('albaran', a.id, 'factura', a.facturado_en_id))
                      from facturas a where a.tipo = 'albaran' and a.numero_documento = '9-242608469'),
  'revisadas', (select jsonb_agg(jsonb_build_object('clave', import_clave, 'verificada', verificada))
                  from facturas where import_clave in ('zip2026:R670.pdf#0', 'zip2026:R881.pdf#0')),
  'productos', (select jsonb_agg(nombre order by nombre) from productos_catalogo
                 where nombre in ('Carabinero brillante', 'Brillante', 'Bj', 'Bo', 'Pimiento California amarillo', 'Ñora')),
  'lineas_pv_sin_producto', (select count(*) from productos_factura where nombre like 'Punto verde (P.V.)%' and producto_id is null),
  'descuadres_mayores_1', (select count(*) from facturas f
                             join (select factura_id, sum(total) s from productos_factura group by factura_id) l on l.factura_id = f.id
                            where f.subtotal is not null and abs(l.s - f.subtotal) > 1)
) as resultado;

commit;

-- Fusión «Carabinero brillante» → «Carabinero» (misma especie, Plesiopenaeus edwardsianus), 06/11/2026.
do $$
declare v_o bigint; v_d bigint;
begin
  select id into v_o from productos_catalogo where nombre = 'Carabinero brillante';
  select id into v_d from productos_catalogo where nombre = 'Carabinero';
  if v_o is null or v_d is null then return; end if;
  update productos_factura set producto_id = v_d where producto_id = v_o;
  update productos_alias set producto_id = v_d, origen = 'manual' where producto_id = v_o;
  insert into productos_alias (texto_normalizado, producto_id, origen)
    select normalizar_nombre_producto(nombre), v_d, 'manual' from productos_catalogo where id = v_o
    on conflict (texto_normalizado) do nothing;
  delete from productos_catalogo where id = v_o;
end $$;
