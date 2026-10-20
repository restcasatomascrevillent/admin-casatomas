set client_encoding = 'UTF8';
-- ===========================================================================
-- Pruebas de 20261007150000_chatbot_compras_producto.sql
-- SQL plano con ASSERT dentro de BEGIN … ROLLBACK. DESPUÉS de aplicar la
-- migración, POR TERMINAL (no en el SQL Editor):
--   npx supabase db query --linked -f supabase/tests/chatbot_compras_producto_test.sql
-- Si termina sin ERROR e imprime «… todas las comprobaciones han pasado»,
-- todo ha pasado. Dos partes:
--   R. Datos REALES del 07/10/2026 (preguntas del dueño): centolla de
--      Angelmar 5,7 kg / 279,30 €, merluza 172,7 kg Flope, NATOP, jamón,
--      mayonesa, gambón. Si alguien corrige esas líneas, ajustar aquí.
--   S. Documentos SIMULADOS en marzo de 2031 (un mes sin datos reales) que
--      el ROLLBACK final deshace:
--        T-CP-F1 factura Pescados Prueba SL   MERLUZA CG. 2-3 KG 10 kg × 10
--                                             Pulpo cocido 2 kg × 20
--        T-CP-F2 factura Mariscos Prueba SA   Merluzas frescas 5 kg × 16
--                                             Merluza sin precio 3 kg (sin precio)
--        T-CP-A1 albarán PESCADOS PRUEBA, S.L. MERLUZA CG. 2-3 KG 10 kg × 10 (= F1: ya facturado)
--        T-CP-A2 albarán Pescados Prueba SL   MERLUZA CG. 2-3 KG 4 kg × 10
--        T-CP-F3 factura Lacteos Prueba       NATA COCINA 1L 6 l × 3; Nata montar 35% 12 ud × 2,5
--        T-CP-F4 factura Lacteos Barata SL    Nata cocina 10 l × 1,5 (fecha dudosa)
-- ===========================================================================

begin;

insert into facturas (tipo, proveedor, numero_documento, fecha, subtotal, iva, total, total_origen, verificada, alertas_validacion)
values ('factura', 'Pescados Prueba SL',    'T-CP-F1', '2031-03-10', 140, 14.0, 154.0, 'leido', true, null),
       ('factura', 'Mariscos Prueba SA',    'T-CP-F2', '2031-03-20',  80,  8.0,  88.0, 'leido', true, null),
       ('albaran', 'PESCADOS PRUEBA, S.L.', 'T-CP-A1', '2031-03-05', null, null, 100, 'leido', false, null),
       ('albaran', 'Pescados Prueba SL',    'T-CP-A2', '2031-03-25', null, null,  40, 'leido', false, null),
       ('factura', 'Lacteos Prueba',        'T-CP-F3', '2031-03-15',  48, 4.8,  52.8, 'leido', true, null),
       ('factura', 'Lacteos Barata SL',     'T-CP-F4', '2031-03-16',  15, 1.5,  16.5, 'leido', false,
        '[{"codigo": "fecha_ausente", "mensaje": "Sin fecha: se usa la de subida"}]'::jsonb);

insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total)
select f.id, l.nombre, l.cantidad, l.unidad, l.precio, l.total
  from (values
    ('T-CP-F1', 'MERLUZA CG. 2-3 KG',  10::numeric, 'kg', 10::numeric, 100::numeric),
    ('T-CP-F1', 'Pulpo cocido',          2, 'kg', 20,   40),
    ('T-CP-F2', 'Merluzas frescas',      5, 'kg', 16,   80),
    ('T-CP-F2', 'Merluza sin precio',    3, 'kg', null, null),
    ('T-CP-A1', 'MERLUZA CG. 2-3 KG',   10, 'kg', 10,  100),
    ('T-CP-A2', 'MERLUZA CG. 2-3 KG',    4, 'kg', 10,   40),
    ('T-CP-F3', 'NATA COCINA 1L',        6, 'l',  3,    18),
    ('T-CP-F3', 'Nata montar 35%',      12, 'ud', 2.5,  30),
    ('T-CP-F4', 'Nata cocina',          10, 'l',  1.5,  15)
  ) l(doc, nombre, cantidad, unidad, precio, total)
  join facturas f on f.numero_documento = l.doc;

-- 20261010170000_chatbot_ronda9: el albarán A1 solo cuenta como facturado si la factura F1 CITA su
-- número (antes bastaba con que la línea coincidiera).
update productos_factura set albaran_ref = 'T-CP-A1'
 where factura_id = (select id from facturas where numero_documento = 'T-CP-F1') and nombre like 'MERLUZA%';

do $$
declare
  j  jsonb;
  j2 jsonb;
  f  jsonb;
  n  int;
  v_emb vector;
begin
  -- -------------------------------------------------------------------------
  -- R1. «¿Cuántos kilos de centollo he comprado y a quién?»: la factura dice
  --     «Centolla hembra 1-1.5 kg» (albarán de Angelmar, 29/12/2025).
  -- -------------------------------------------------------------------------
  j := compras_producto_agente('centollo', '2025-01-01', '2026-12-31')::jsonb;
  assert j ->> 'coincidencia' = 'raiz', format('R1 coincidencia: %s', j);
  assert j -> 'productos_coincidentes' @> '[{"nombre": "Centolla hembra 1-1.5 kg"}]', format('R1 variantes: %s', j);
  select x into f from jsonb_array_elements(j -> 'por_proveedor') x where x ->> 'proveedor' ilike '%ANGEL MARI%';
  assert f ->> 'unidad' = 'kg' and (f ->> 'cantidad')::numeric = 5.7 and (f ->> 'importe')::numeric = 279.30
     and (f ->> 'precio_medio')::numeric = 49 and f ->> 'tipo' = 'albaran' and f ->> 'primera' = '2025-12-29',
    format('R1 Angelmar: %s', f);
  assert (j ->> 'incluye_albaranes')::boolean and j ? 'criterio', format('R1 albaranes: %s', j);

  -- R2. «este año» (2026) la deja fuera: sin sumas, y dice cuándo fue la última.
  j := compras_producto_agente('centollo', '2026-01-01', '2026-10-07')::jsonb;
  assert (j ->> 'sin_datos')::boolean and not j ? 'total' and not j ? 'por_proveedor', format('R2 vacio: %s', j);
  assert j -> 'fuera_del_filtro' ->> 'ultima' = '2025-12-29'
     and j -> 'fuera_del_filtro' -> 'productos' ? 'Centolla hembra 1-1.5 kg', format('R2 fuera: %s', j);

  -- R3. Plurales, tildes y mayúsculas: lo mismo.
  assert (compras_producto_agente('CENTOLLAS')::jsonb -> 'total' ->> 'importe')::numeric = 279.30, 'R3 CENTOLLAS';
  assert (compras_producto_agente('centollos')::jsonb -> 'total' ->> 'importe')::numeric = 279.30, 'R3 centollos';
  assert compras_producto_agente('jamón')::jsonb -> 'total' = compras_producto_agente('JAMONES')::jsonb -> 'total'
     and compras_producto_agente('jamon')::jsonb -> 'total' = compras_producto_agente('jamones')::jsonb -> 'total', 'R3 jamon';
  assert compras_producto_agente('mayonesas')::jsonb -> 'total' = compras_producto_agente('Mayonesa')::jsonb -> 'total', 'R3 mayonesa';

  -- R4. Merluza: 172,7 kg de Flope.
  j := compras_producto_agente('merluza', null, '2030-12-31')::jsonb;
  select x into f from jsonb_array_elements(j -> 'por_proveedor') x where x ->> 'proveedor' ilike 'FLOPE%';
  assert f ->> 'unidad' = 'kg' and (f ->> 'cantidad')::numeric = 172.7 and (f ->> 'importe')::numeric = 1986.05
     and (f ->> 'precio_medio')::numeric = 11.5, format('R4 merluza: %s', j);

  -- R5. «nata» encuentra NATOP (20% nata animal…): palabra dentro del nombre.
  j := compras_producto_agente('nata', null, '2030-12-31', null, 10, 'precio')::jsonb;
  assert j ->> 'coincidencia' = 'exacta'
     and exists (select 1 from jsonb_array_elements(j -> 'productos_coincidentes') x where x ->> 'nombre' ilike 'NATOP%'),
    format('R5 nata: %s', j);
  -- «20% nata» y «20%nata» son la misma variante.
  assert (select count(*) from jsonb_array_elements(j -> 'productos_coincidentes') x where x ->> 'nombre' ilike 'NATOP%') = 1,
    format('R5 variantes agrupadas: %s', j -> 'productos_coincidentes');

  -- R6. Jamón: kg, ud y ca por separado; nunca se suman entre sí.
  j := compras_producto_agente('jamón')::jsonb;
  assert jsonb_array_length(j -> 'por_unidad') >= 2 and (j -> 'avisos' ->> 'unidades_mezcladas')::boolean, format('R6 unidades: %s', j);
  assert not j -> 'total' ? 'cantidad', 'R6 el total global no suma cantidades';
  assert (select sum((u ->> 'importe')::numeric) from jsonb_array_elements(j -> 'por_unidad') u) = (j -> 'total' ->> 'importe')::numeric,
    'R6 importes por unidad = total';
  assert (select count(*) from jsonb_array_elements(j -> 'por_proveedor') p where p ->> 'proveedor' ilike '%joselito%') >= 2, 'R6 joselito';
  -- «sin las cajas»: excluir quita «CAJA CON ASA…» y «CAJA REGALO…».
  j2 := compras_producto_agente('jamón', null, null, null, 10, null, 'caja')::jsonb;
  assert not exists (select 1 from jsonb_array_elements(j2 -> 'productos_coincidentes') x where x ->> 'nombre' ilike 'caja%')
     and (j2 -> 'total' ->> 'lineas')::int = (j -> 'total' ->> 'lineas')::int - 2, format('R6 excluir: %s', j2);

  -- R7. «cajas de mayonesa»: «cajas» es relleno; 18 ud de Luga a 17,25.
  j := compras_producto_agente('cajas de mayonesa', '2025-10-01', '2025-12-31')::jsonb;
  select x into f from jsonb_array_elements(j -> 'por_proveedor') x where x ->> 'proveedor' ilike 'LUGA%';
  assert f ->> 'unidad' = 'ud' and (f ->> 'cantidad')::numeric = 18 and (f ->> 'importe')::numeric = 310.5
     and (f ->> 'precio_medio')::numeric = 17.25, format('R7 mayonesa: %s', j);

  -- R8. Gambón: 2 kg de Luga, en singular y plural.
  assert (compras_producto_agente('gambones')::jsonb -> 'por_unidad' -> 0 ->> 'cantidad')::numeric = 2, 'R8 gambones';

  -- R9. Erratas: aproximada y marcada. «salmon» NO cae en «salmonete».
  j := compras_producto_agente('merlusa', null, '2030-12-31')::jsonb;
  assert j ->> 'coincidencia' = 'aproximada' and (j -> 'por_unidad' -> 0 ->> 'cantidad')::numeric = 172.7, format('R9 merlusa: %s', j);
  j := compras_producto_agente('salmón')::jsonb;
  assert (j ->> 'sin_datos')::boolean and not j ? 'total', format('R9 salmon no suma salmonete: %s', j);
  assert exists (select 1 from jsonb_array_elements_text(j -> 'sugerencias') s where s ilike '%salmonete%'), format('R9 sugerencia: %s', j);

  -- R10. Sin coincidencias: vacío, coincidencia «ninguna», sin sumas.
  j := compras_producto_agente('zzqxw')::jsonb;
  assert j ->> 'coincidencia' = 'ninguna' and (j ->> 'sin_datos')::boolean and not j ? 'total' and not j ? 'error',
    format('R10: %s', j);
  -- Con embedding (el de la línea del buey de mar, como si el usuario dijera
  -- «bogavante»): solo sugerencias semánticas, nunca sumas.
  select pf.embedding into v_emb from productos_factura pf where pf.nombre ilike 'Buey de mar%' and pf.embedding is not null limit 1;
  if v_emb is not null then
    j := compras_producto_agente('bogavante', null, null, null, 10, null, null, v_emb)::jsonb;
    assert j ->> 'coincidencia' = 'semantica' and not j ? 'total'
       and (j -> 'sugerencias' ->> 0) ilike 'Buey de mar%', format('R10 semantica: %s', j);
  end if;

  -- -------------------------------------------------------------------------
  -- S1. Agregación sobre los simulados de marzo de 2031.
  -- -------------------------------------------------------------------------
  j := compras_producto_agente('merluza', '2031-03-01', '2031-03-31')::jsonb;
  assert j ->> 'coincidencia' = 'exacta+raiz', format('S1 coincidencia: %s', j ->> 'coincidencia');
  assert (j -> 'por_unidad' -> 0 ->> 'cantidad')::numeric = 22
     and (j -> 'por_unidad' -> 0 ->> 'importe')::numeric = 220
     and not (j -> 'por_unidad' -> 0) ? 'precio_medio'                      -- ronda 9: variantes de 10 y 16 €/kg: sin media global
     and (j -> 'total' ->> 'en_albaranes_sin_factura')::numeric = 40, format('S1 por_unidad: %s', j);
  assert jsonb_array_length(j -> 'por_variante') = 3 and (j -> 'por_variante' -> 0 ->> 'precio_medio')::numeric = 10
     and (j -> 'por_variante' -> 1 ->> 'precio_medio')::numeric = 16,
    format('S1 por_variante: %s', j -> 'por_variante');
  -- El albarán A1 repite la línea de F1: no se cuenta dos veces.
  assert (j -> 'avisos' ->> 'albaranes_ya_facturados')::int = 1 and (j -> 'avisos' ->> 'sin_importe')::int = 1,
    format('S1 avisos: %s', j -> 'avisos');
  f := j -> 'por_proveedor' -> 0;
  assert f ->> 'proveedor' ilike 'Pescados Prueba%' and (f ->> 'cantidad')::numeric = 14 and (f ->> 'importe')::numeric = 140
     and (f ->> 'precio_medio')::numeric = 10 and (f ->> 'compras')::int = 2 and f ->> 'tipo' = 'factura+albaran'
     and f ->> 'primera' = '2031-03-10' and f ->> 'ultima' = '2031-03-25', format('S1 Pescados: %s', f);
  f := j -> 'por_proveedor' -> 1;
  assert f ->> 'proveedor' = 'Mariscos Prueba SA' and (f ->> 'cantidad')::numeric = 8 and (f ->> 'precio_medio')::numeric = 16
     and not f ? 'tipo', format('S1 Mariscos (precio solo de las lineas con precio): %s', f);
  assert (j -> 'total' ->> 'compras')::int = 3 and (j -> 'total' ->> 'proveedores')::int = 2, format('S1 total: %s', j -> 'total');

  -- S2. Abreviaturas: «merluza congelada» = «MERLUZA CG.»; excluir «cg».
  j := compras_producto_agente('merluza congelada', '2031-03-01', '2031-03-31')::jsonb;
  assert j ->> 'coincidencia' = 'raiz' and (j -> 'total' ->> 'importe')::numeric = 140
     and j -> 'productos_coincidentes' = '[{"nombre": "MERLUZA CG. 2-3 KG", "lineas": 2}]'::jsonb, format('S2 cg: %s', j);
  j := compras_producto_agente('merluza', '2031-03-01', '2031-03-31', null, 10, null, 'cg')::jsonb;
  assert (j -> 'total' ->> 'importe')::numeric = 80 and not j ? 'incluye_albaranes', format('S2 excluir: %s', j);

  -- S3. Tipo: solo albaranes (sin facturas no hay nada que descontar) y solo facturas.
  j := compras_producto_agente('merluza', '2031-03-01', '2031-03-31', 'albaranes')::jsonb;
  assert j ->> 'tipo' = 'albaran' and (j -> 'total' ->> 'importe')::numeric = 140 and not coalesce(j -> 'avisos', '{}') ? 'albaranes_ya_facturados',
    format('S3 albaranes: %s', j);
  j := compras_producto_agente('merluza', '2031-03-01', '2031-03-31', 'factura')::jsonb;
  assert (j -> 'por_unidad' -> 0 ->> 'cantidad')::numeric = 18 and not j ? 'incluye_albaranes' and not j ? 'criterio',
    format('S3 facturas: %s', j);

  -- S4. Orden y truncado: la nata más barata primero; litros y unidades aparte.
  j := compras_producto_agente('nata', '2031-03-01', '2031-03-31', null, 10, 'precio')::jsonb;
  assert j -> 'por_proveedor' -> 0 ->> 'proveedor' = 'Lacteos Barata SL' and j -> 'por_proveedor' -> 0 ->> 'unidad' = 'l'
     and (j -> 'por_proveedor' -> 0 ->> 'precio_medio')::numeric = 1.5, format('S4 precio: %s', j -> 'por_proveedor');
  assert (j -> 'avisos' ->> 'unidades_mezcladas')::boolean and (j -> 'avisos' ->> 'fecha_dudosa')::int = 1, format('S4 avisos: %s', j -> 'avisos');
  j := compras_producto_agente('nata', '2031-03-01', '2031-03-31', null, 10, 'importe')::jsonb;
  assert j -> 'por_proveedor' -> 0 ->> 'proveedor' = 'Lacteos Prueba' and j -> 'por_proveedor' -> 0 ->> 'unidad' = 'l', format('S4 importe: %s', j -> 'por_proveedor');
  j := compras_producto_agente('nata', '2031-03-01', '2031-03-31', null, 1)::jsonb;
  assert (j ->> 'truncado')::boolean and (j ->> 'filas_total')::int = 3 and jsonb_array_length(j -> 'por_proveedor') = 1,
    format('S4 truncado: %s', j);

  -- S5. Argumentos inválidos: error legible, sin cifras.
  assert compras_producto_agente('nata', '2031-04-01', '2031-03-01')::jsonb ? 'error', 'S5 rango';
  assert compras_producto_agente('nata', null, null, 'pedido')::jsonb ? 'error', 'S5 tipo';
  assert compras_producto_agente('nata', null, null, null, 10, 'barato')::jsonb ? 'error', 'S5 orden';
  assert compras_producto_agente('  ')::jsonb ? 'error' and compras_producto_agente(null)::jsonb ? 'error', 'S5 vacio';

  -- -------------------------------------------------------------------------
  -- P. Permisos y configuración de las 4 funciones nuevas.
  -- -------------------------------------------------------------------------
  select count(*) into n
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public'
     and p.proname in ('palabras_producto_agente', 'raiz_producto_agente', 'raices_producto_agente', 'compras_producto_agente')
     and not has_function_privilege('anon', p.oid, 'execute')
     and has_function_privilege('authenticated', p.oid, 'execute')
     and has_function_privilege('service_role', p.oid, 'execute')
     and not p.prosecdef
     and p.proconfig @> array['search_path=public'];
  assert n = 4, format('P: %s de 4 funciones con permisos/search_path correctos', n);
end;
$$;

select 'chatbot_compras_producto: todas las comprobaciones han pasado' as resultado;

rollback;
