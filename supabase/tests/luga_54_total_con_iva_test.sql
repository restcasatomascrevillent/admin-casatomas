set client_encoding = 'UTF8';
-- ===========================================================================
-- Pruebas de 20261006110000_luga_54_total_con_iva.sql
-- SQL plano con ASSERT dentro de BEGIN … ROLLBACK: no deja nada escrito.
-- DESPUÉS de aplicar la migración, POR TERMINAL:
--   npx supabase db query --linked -f supabase/tests/luga_54_total_con_iva_test.sql
-- Si termina sin ERROR e imprime «luga_54_total_con_iva_test: OK», todo ha pasado.
--
-- Cubre: cabecera 3787.53 + 375.01 = 4162.54 deducida; 49 líneas al 10 % y 5
-- al 4 % (las de PICOS y ROSQUILLA); el IVA se recalcula igual desde las
-- líneas (una cuota por tipo); líneas, kilos, importes e historial intactos;
-- avisos (un total_deducido iva_por_linea, sin subtotal_ausente ni
-- descuadres) y validar_cordura_factura limpio; copia de seguridad.
-- ===========================================================================

begin;

do $$
declare
  f record;
  r record;
  a jsonb;
begin
  -- T1. Cabecera.
  select * into f from public.facturas where id = 54;
  assert f.numero_documento = 'ML/101511', 'T1: la 54 no es Luga ML/101511';
  assert f.subtotal = 3787.53 and f.iva = 375.01 and f.total = 4162.54,
    format('T1: cabecera %s + %s = %s (se esperaba 3787.53 + 375.01 = 4162.54)', f.subtotal, f.iva, f.total);
  assert f.total_origen = 'deducido', 'T1: total_origen tiene que seguir deducido';

  -- T2. Tipos por línea.
  assert (select count(*) from public.productos_factura where factura_id = 54 and iva_pct = 10) = 49, 'T2: 49 líneas al 10 %';
  assert (select string_agg(orden::text, ',' order by orden) from public.productos_factura
           where factura_id = 54 and iva_pct = 4) = '0,14,35,43,45', 'T2: al 4 % van las órdenes 0,14,35,43,45';
  assert not exists (select 1 from public.productos_factura where factura_id = 54 and iva_pct = 4
                      and nombre !~* '^(PICOS|ROS(QU|K)ILLA)'), 'T2: al 4 % solo PICOS Sin Gluten y ROSQUILLA';
  select iva_pct, total into r from public.productos_factura where factura_id = 54 and orden = 44;
  assert r.iva_pct = 10 and r.total = 1547.26, 'T2: el JAMÓN (orden 44) va al 10 %';

  -- T3. El IVA sale de las líneas: una cuota por tipo, redondeada a céntimos.
  select sum(base) as base, sum(cuota) as cuota into r
    from (select sum(total) as base, round(sum(total) * iva_pct / 100, 2) as cuota
            from public.productos_factura where factura_id = 54 group by iva_pct) t;
  assert r.base = f.subtotal and r.cuota = f.iva and r.base + r.cuota = f.total,
    format('T3: desde las líneas sale %s + %s', r.base, r.cuota);

  -- T4. Líneas, kilos, importes e historial sin tocar.
  assert (select count(*) from public.productos_factura where factura_id = 54) = 54, 'T4: 54 líneas';
  assert (select sum(total) from public.productos_factura where factura_id = 54) = 3787.53, 'T4: suma de importes';
  assert (select count(*) from public.productos_factura where factura_id = 54 and unidad = 'kg' and bultos > 0) = 19,
    'T4: siguen las 19 líneas en kg de 20261005151000';
  assert (select count(*) from public.historial_precios where factura_id = 54) = 54, 'T4: historial con 54 filas';

  -- T5. Avisos guardados.
  a := coalesce(f.alertas_validacion, '[]'::jsonb);
  assert (select count(*) from jsonb_array_elements(a) x where x->>'codigo' = 'total_deducido') = 1,
    'T5: tiene que haber UN aviso total_deducido';
  assert exists (select 1 from jsonb_array_elements(a) x
                  where x->>'codigo' = 'total_deducido' and x->'detalle'->>'metodo' = 'iva_por_linea'
                    and (x->'detalle'->>'subtotal')::numeric = 3787.53 and (x->'detalle'->>'iva')::numeric = 375.01
                    and (x->'detalle'->>'total')::numeric = 4162.54
                    and jsonb_array_length(x->'detalle'->'desglose') = 2
                    and x->>'mensaje' ~ 'IVA de cada') , 'T5: el aviso total_deducido no es el de iva_por_linea';
  assert not exists (select 1 from jsonb_array_elements(a) x
                      where x->>'codigo' in ('subtotal_ausente', 'total_ausente', 'descuadre_cabecera', 'iva_incoherente')),
    'T5: quedan avisos de importes que ya no aplican';
  assert not exists (select 1 from jsonb_array_elements(a) x where x->>'mensaje' ~ 'el total real sera mayor'),
    'T5: sigue el aviso viejo que daba la base por total';

  -- T6. validar_cordura_factura ya no ve nada de importes en la 54.
  assert not exists (select 1 from jsonb_array_elements(public.validar_cordura_factura(54)) x
                      where x->>'codigo' in ('subtotal_ausente', 'total_ausente', 'descuadre_cabecera', 'iva_incoherente')),
    'T6: validar_cordura_factura(54) sigue viendo descuadres de importes';

  -- T7. Copia de seguridad con la cabecera de antes.
  select * into r from public.facturas_sustituciones
   where factura_id = 54 and resumen_antes->>'migracion' = '20261006110000';
  assert found, 'T7: falta la copia de seguridad';
  assert (r.factura_antes->>'total')::numeric = 3787.53 and r.factura_antes->>'subtotal' is null
         and r.factura_antes->>'iva' is null, 'T7: la copia no guarda la cabecera de antes';
  assert jsonb_array_length(r.productos_antes) = 54 and jsonb_array_length(r.historial_antes) = 54,
    'T7: la copia no tiene 54 líneas y 54 de historial';
  assert r.trabajo_id is null and not (r.factura_antes ? 'embedding'), 'T7: copia sin trabajo ni embedding';
end;
$$;

select 'luga_54_total_con_iva_test: OK' as resultado;

rollback;
