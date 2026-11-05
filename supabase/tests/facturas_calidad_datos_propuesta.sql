set client_encoding = 'UTF8';
-- ===========================================================================
-- Calidad de datos de Facturas · PROPUESTA (2026-11-06) · NO cambia nada
-- ===========================================================================
--
-- QA de Facturas, punto 11. Este fichero NO es una migración ni cambia datos:
--   · la parte 1 son consultas de solo lectura (recuentos y listas);
--   · la parte 2 son los UPDATE propuestos, COMENTADOS y dentro de un
--     BEGIN … ROLLBACK. Para aplicar uno, el dueño lo revisa contra el
--     documento original, lo descomenta y cambia el ROLLBACK final por COMMIT.
-- Recuentos en la demo (sfonaclosuafvlhutkon) el 2026-11-06:
--   D5  110 líneas con total 0 y sin importe_bruto; 9 de ellas tienen precio > 0
--       (albaranes Campoluz 46 y 48, factura MR FRIOSAT 35): 343,48 € de valor.
--   D12 7 albaranes sin factura con una factura del mismo proveedor en los 45 días
--       siguientes (lista abajo, con la factura propuesta y la confianza).
--   D13 13 documentos cuya suma de líneas difiere del subtotal en más de 1 €.
--   D14 2 documentos POSITIVOS con IVA negativo (1103 y 1762); los otros 44 con
--       IVA negativo son abonos (total < 0) y están bien.
--   D6  id 529, abono Campoluz AB2025/0000455, fecha 2025-02-28: es el documento
--       más antiguo con diferencia (el siguiente es de 2025-11-17) y alarga
--       «todo el histórico» del panel con 8 meses vacíos.
--
--   supabase db query --linked -f supabase/tests/facturas_calidad_datos_propuesta.sql
-- ===========================================================================

-- ── Parte 1: diagnóstico (solo lectura) ─────────────────────────────────────
select jsonb_pretty(jsonb_build_object(
  'D5_lineas_total_0_sin_bruto', (select count(*) from productos_factura where total = 0 and importe_bruto is null),
  'D5_con_precio', (select jsonb_agg(jsonb_build_object('linea', pf.id, 'doc', pf.factura_id, 'nombre', pf.nombre,
                                                        'cantidad', pf.cantidad, 'precio', pf.precio_unitario,
                                                        'valor', round(pf.cantidad * pf.precio_unitario, 2)) order by pf.factura_id, pf.id)
                      from productos_factura pf
                     where pf.total = 0 and pf.importe_bruto is null and pf.precio_unitario > 0 and pf.cantidad > 0),
  'D12_albaranes_posibles_facturados', (
     select jsonb_agg(jsonb_build_object('albaran', a.id, 'numero', a.numero_documento, 'fecha', a.fecha, 'total', a.total,
                                         'proveedor', a.proveedor,
                                         'facturas_45_dias', (select jsonb_agg(jsonb_build_object('id', fx.id, 'numero', fx.numero_documento,
                                                                                                  'fecha', fx.fecha, 'total', fx.total) order by fx.fecha)
                                                                from facturas fx
                                                               where fx.tipo = 'factura' and fx.proveedor_id = a.proveedor_id
                                                                 and fx.fecha between a.fecha and a.fecha + 45)) order by a.id)
       from facturas a
      where a.tipo = 'albaran' and a.facturado_en_id is null and a.proveedor_id is not null
        and exists (select 1 from facturas fx where fx.tipo = 'factura' and fx.proveedor_id = a.proveedor_id
                                                and fx.fecha between a.fecha and a.fecha + 45)),
  'D13_lineas_distintas_del_subtotal', (
     select jsonb_agg(jsonb_build_object('doc', f.id, 'proveedor', f.proveedor, 'fecha', f.fecha, 'subtotal', f.subtotal,
                                         'iva', f.iva, 'total', f.total, 'total_menos_iva', f.total - f.iva,
                                         'suma_lineas', s.suma, 'diferencia', round(s.suma - f.subtotal, 2)) order by abs(s.suma - f.subtotal) desc)
       from facturas f
       join (select factura_id, sum(total) as suma from productos_factura group by factura_id) s on s.factura_id = f.id
      where f.subtotal is not null and abs(s.suma - f.subtotal) > 1),
  'D14_iva_negativo_en_documento_positivo', (
     select jsonb_agg(jsonb_build_object('doc', f.id, 'numero', f.numero_documento, 'proveedor', f.proveedor, 'fecha', f.fecha,
                                         'subtotal', f.subtotal, 'iva', f.iva, 'total', f.total,
                                         'suma_lineas', (select sum(pf.total) from productos_factura pf where pf.factura_id = f.id)))
       from facturas f where f.iva < 0 and f.total >= 0),
  'D6_id_529', (select jsonb_build_object('fecha', f.fecha, 'numero', f.numero_documento, 'total', f.total,
                                          'siguiente_documento', (select min(x.fecha) from facturas x where x.id <> f.id))
                  from facturas f where f.id = 529)
)) as diagnostico;

-- ── Parte 2: propuestas (comentadas; la transacción acaba en ROLLBACK) ──────
begin;

-- D5 · Las 9 líneas a 0 € con precio son, casi seguro, producto regalado: se
--      apunta lo que valían (importe_bruto = cantidad × precio, marcado como
--      estimado) para que salgan en «Regalado». Las otras 101 (precio 0: cajas,
--      copas, champaneras de regalo…) no tienen valor que apuntar: se quedan.
-- update productos_factura
--    set importe_bruto = round(cantidad * precio_unitario, 2), importe_bruto_estimado = true
--  where total = 0 and importe_bruto is null and precio_unitario > 0 and cantidad > 0;   -- 9 filas

-- D12 · Vínculos propuestos (facturado_origen = 'manual' para que la
--       vinculación automática no los toque). Confianza:
--   alta : 373 (Narejos 07/10, 49,50 €) y 407 (Narejos 10/10, 99,00 €) → 520
--          (Narejos 5419, 12/10, 222,75 €): a la 520 le faltan 90,00 € de líneas
--          (D13), justo la base del 407; 45,00 + 90,00 de bases caben en su subtotal.
--   media: 351 (Panadería Divina C.15 29/09, 83,04 €) → 2324 (2026-C-355, 30/09,
--          854,59 €): única factura del proveedor en 45 días.
--   media: 47 (ENCHENTA carta de porte 1-24669, 30/12/2025, 774,40 €) → 562
--          (1-4842, 09/01/2026, 1.034,05 €): la primera factura después.
--   baja : 386 (Makro 9-242608469, 06/10, sin total) → 2360 (Makro, mismo día).
--   NO   : 361 (ONCE DE ENERO, 2.986,50 €): sus dos facturas (564,07 y 129,59 €)
--          son mucho menores; 38 (Joselito 2509134, 15/12/2025, sin total): tres
--          facturas posibles (577, 584, 605); mirar el original.
-- update facturas set facturado_en_id = 520,  facturado_origen = 'manual' where id in (373, 407) and tipo = 'albaran' and facturado_en_id is null;
-- update facturas set facturado_en_id = 2324, facturado_origen = 'manual' where id = 351 and tipo = 'albaran' and facturado_en_id is null;
-- update facturas set facturado_en_id = 562,  facturado_origen = 'manual' where id = 47  and tipo = 'albaran' and facturado_en_id is null;
-- update facturas set facturado_en_id = 2360, facturado_origen = 'manual' where id = 386 and tipo = 'albaran' and facturado_en_id is null;
--   Efecto en el gasto si se aplican los cinco: −(49,50 + 99,00 + 83,04 + 774,40) = −1.005,94 €
--   (el 386 no tiene total). Octubre 2026 bajaría 148,50 € (373 y 407).

-- D13 · Mª CARMEN VIROLA BALCERA (532, 729, 1061, 1455, 1954): el subtotal leído
--       es MAYOR que el total y la suma de líneas cuadra con total − IVA: el
--       subtotal está mal leído. Propuesta: subtotal = total − iva.
-- update facturas set subtotal = round(total - iva, 2)
--  where id in (532, 729, 1061, 1455, 1954) and iva is not null and subtotal > total;
--       (En los cinco, suma de líneas = total − IVA al céntimo.)
--       Sin cambio: 2045 (gestoría) y 1554 (ITV): líneas = total − IVA, el
--       subtotal leído es solo la base con IVA (suplidos / tasa exentos): está bien.
--       A mirar en el original: 520 (le faltan las líneas del albarán 407 de
--       Narejos, D12), 1531 (abono, −65,86 €), 46 (albarán Campoluz, −37,68 €:
--       6 líneas a 0 € de D5); 1658, 1907 y 1716 difieren en 1-2 € (redondeos).

-- D14 · 1103 (COMERCIAL TABARCA 70.073373: subtotal 189,37, IVA −17,57, total
--       171,80) y 1762 (SANTACRUZ 7122: 14,40 / −0,55 / 13,85): documentos
--       positivos con IVA negativo. Suele ser una factura con un abono dentro
--       (envases devueltos) o un IVA mal leído: mirar el original. Sin propuesta
--       automática.

-- D6 · id 529 (abono Campoluz AB2025/0000455, −323,94 €, R153.pdf): la fecha
--      2025-02-28 deja 8 meses vacíos antes del resto de documentos. Lo más
--      probable es un 02 ↔ 12 del OCR (28/12/2025, después de los albaranes
--      Campoluz del 23/12). Comprobar en R153.pdf y, si es así:
-- update facturas set fecha = '2025-12-28' where id = 529 and fecha = '2025-02-28';

rollback;
