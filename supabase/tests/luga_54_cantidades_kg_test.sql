set client_encoding = 'UTF8';
-- ===========================================================================
-- Pruebas de 20261005151000_luga_54_cantidades_kg.sql
-- SQL plano con ASSERT dentro de BEGIN … ROLLBACK: no deja nada escrito.
-- DESPUÉS de aplicar la migración:
--   npx supabase db query --linked -f supabase/tests/luga_54_cantidades_kg_test.sql
-- Si termina sin ERROR e imprime «luga_54_cantidades_kg_test: OK», todo ha pasado.
--
-- Cubre: las 54 líneas cuadran cantidad × precio = importe; 19 en kg con sus
-- bultos y 35 en ud; los cuatro ejemplos del dueño; precios, importes, total
-- e historial sin tocar; copia de seguridad con las 54 líneas de antes; sin
-- avisos de descuadre de línea; y que validar_cordura_factura ya no los ve.
-- ===========================================================================

begin;

do $$
declare
  n integer;
  r record;
begin
  assert (select count(*) from public.productos_factura where factura_id = 54) = 54, 'T1: la 54 tiene 54 líneas';

  -- T2. Todas cuadran (margen de redondeo de magnitudes.ts).
  select count(*) into n from public.productos_factura
   where factura_id = 54
     and abs(cantidad * precio_unitario - total) > greatest(0.05, abs(cantidad) * 0.005 + 0.01);
  assert n = 0, format('T2: %s líneas no cuadran', n);

  -- T3. 19 por kilo con bultos; 35 por unidad sin bultos; ninguna otra unidad.
  assert (select count(*) from public.productos_factura where factura_id = 54 and unidad = 'kg' and bultos > 0) = 19,
    'T3: 19 líneas en kg con bultos';
  assert (select count(*) from public.productos_factura where factura_id = 54 and unidad = 'ud' and bultos is null) = 35,
    'T3: 35 líneas en ud sin bultos';

  -- T4. Los cuatro ejemplos del dueño (por orden).
  select cantidad, unidad, bultos, precio_unitario, total into r from public.productos_factura where factura_id = 54 and orden = 2;
  assert r.cantidad = 24 and r.unidad = 'kg' and r.bultos = 12 and r.precio_unitario = 4.14 and r.total = 99.46, 'T4: NATOP 12 ud · 24 kg · 4,14 → 99,46';
  select cantidad, unidad, bultos, precio_unitario, total into r from public.productos_factura where factura_id = 54 and orden = 17;
  assert r.cantidad = 15 and r.unidad = 'kg' and r.bultos = 3 and r.precio_unitario = 5.80 and r.total = 87.00, 'T4: CG 3 ud · 15 kg · 5,80 → 87,00';
  select cantidad, unidad, bultos, precio_unitario, total into r from public.productos_factura where factura_id = 54 and orden = 44;
  assert r.cantidad = 75.48 and r.unidad = 'kg' and r.bultos = 8 and r.precio_unitario = 20.50 and r.total = 1547.26, 'T4: JAMÓN 8 ud · 75,48 kg · 20,50';
  select cantidad, unidad, bultos, precio_unitario, total into r from public.productos_factura where factura_id = 54 and orden = 1;
  assert r.cantidad = 2 and r.unidad = 'kg' and r.bultos = 1 and r.precio_unitario = 4.20 and r.total = 8.40, 'T4: ESPINAS 1 ud · 2 kg · 4,20 → 8,40';
  -- LAMINAS: trae kilos pero el precio es por unidad → se queda en ud.
  select cantidad, unidad, bultos into r from public.productos_factura where factura_id = 54 and orden = 4;
  assert r.cantidad = 3 and r.unidad = 'ud' and r.bultos is null, 'T4: LAMINAS 3 ud (precio por unidad)';

  -- T5. Importes, total e historial intactos.
  assert (select sum(total) from public.productos_factura where factura_id = 54) = 3787.53, 'T5: suma de importes';
  -- 3.787,53 es la BASE: desde 20261006110000 va en subtotal y el total es
  -- 4.162,54 (con IVA); antes de esa migración estaba (mal) en total.
  assert (select coalesce(subtotal, total) from public.facturas where id = 54) = 3787.53, 'T5: base de la factura';
  assert (select count(*) from public.historial_precios where factura_id = 54) = 54, 'T5: historial con 54 filas';
  assert (select count(*) from public.historial_precios h join public.productos_factura p
            on p.factura_id = 54 and p.nombre = h.producto_nombre and p.precio_unitario = h.precio
          where h.factura_id = 54) >= 54, 'T5: precios del historial = precios de las líneas';

  -- T6. Copia de seguridad: las 54 líneas de antes, con las Uds.
  select * into r from public.facturas_sustituciones
   where factura_id = 54 and resumen_antes->>'migracion' = '20261005151000';
  assert found, 'T6: falta la copia de seguridad';
  assert jsonb_array_length(r.productos_antes) = 54 and jsonb_array_length(r.historial_antes) = 54,
    'T6: la copia no tiene 54 líneas y 54 de historial';
  assert (select (b->>'cantidad')::numeric from jsonb_array_elements(r.productos_antes) b where (b->>'orden')::int = 2) = 12,
    'T6: la copia guarda NATOP con 12 (las Uds de antes)';
  assert r.trabajo_id is null and not (r.factura_antes ? 'embedding'), 'T6: copia sin trabajo ni embedding';

  -- T7. Avisos.
  assert not exists (select 1 from jsonb_array_elements(coalesce((select alertas_validacion from public.facturas where id = 54), '[]'::jsonb)) a
                      where a->>'codigo' = 'descuadre_linea'), 'T7: siguen avisos de descuadre de línea guardados';
  assert not exists (select 1 from jsonb_array_elements(public.validar_cordura_factura(54)) a
                      where a->>'codigo' = 'descuadre_linea'), 'T7: validar_cordura_factura sigue viendo descuadres';
  assert exists (select 1 from jsonb_array_elements((select alertas_validacion from public.facturas where id = 54)) a
                  where a->>'codigo' = 'total_deducido'), 'T7: el aviso total_deducido se conserva';
end;
$$;

select 'luga_54_cantidades_kg_test: OK' as resultado;

rollback;
