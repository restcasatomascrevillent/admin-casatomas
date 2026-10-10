set client_encoding = 'UTF8';
-- ===========================================================================
-- Pruebas de 20261010170000_chatbot_ronda9.sql
-- SQL plano con ASSERT dentro de BEGIN … ROLLBACK: no deja nada escrito.
-- DESPUÉS de aplicar la migración, POR TERMINAL (no en el SQL Editor):
--   npx supabase db query --linked -f supabase/tests/chatbot_ronda9_test.sql
-- Si termina sin ERROR e imprime «chatbot_ronda9_test: OK», todo ha pasado.
--
-- Documentos SIMULADOS en marzo de 2098 (el ROLLBACK final los deshace):
--   proveedor «R9 Prueba SL»
--     F1  factura 10/03   MEJILLON R9 20 kg × 4,50 (cita el albarán 14.877)
--                         LANGOSTINO R9 2 kg × 10   (cita R9-POST, que es de DESPUÉS)
--     A1  albarán '14.877' 01/03  MEJILLON R9 20 kg × 4,50   → facturado (cita)
--     A2  albarán 'SN-R9-0310' 10/03  MEJILLON R9 20 kg × 4,50 → NO facturado
--                         (misma línea que la de F1, pero F1 no cita su número)
--     A3  albarán 'R9-POST' 20/03  LANGOSTINO R9 2 kg × 10    → NO facturado
--                         (F1 lo cita, pero es POSTERIOR a la factura)
--   proveedor «R9 Atun SL»: ATUN R9 ROJO 4 kg × 42 y KAMA ATUN R9 ROJO RACION
--     3 kg × 23 (variantes con precios distintos); SAL R9 FINA 1 kg × 2 y
--     SAL R9 GRUESA 1 kg × 2,10 (variantes con precio parecido).
--   T1 la regla única (albaranes_facturados_agente): cita sí, coincidencia de
--      líneas no, albarán posterior a la factura no, desvinculado a mano no.
--   T2 compras_producto sigue esa regla (y con tipo albaranes cuenta todos).
--   T3 albaranes_sin_factura_agente.
--   T4 por_variante (compras_producto e historial_precios).
--   T5 sugerencias solo con parecido claro.
--   T6 filtrar_documentos remite a la herramienta nueva.
--   P  permisos.
-- ===========================================================================

begin;

insert into facturas (tipo, proveedor, numero_documento, fecha, subtotal, iva, total, total_origen, verificada)
values ('factura', 'R9 Prueba SL', 'R9-F1',      '2098-03-10', 110,  11,  121,  'leido', true),
       ('albaran', 'R9 Prueba SL', '14.877',     '2098-03-01', null, null, 90,  'leido', false),
       ('albaran', 'R9 Prueba SL', 'SN-R9-0310', '2098-03-10', null, null, 90,  'leido', false),
       ('albaran', 'R9 Prueba SL', 'R9-POST',    '2098-03-20', null, null, 20,  'leido', false),
       ('factura', 'R9 Atun SL',   'R9-F2',      '2098-03-12', 237,  23.7, 260.7, 'leido', true),
       ('factura', 'R9 Atun SL',   'R9-F3',      '2098-03-13',  4.1, 0.41, 4.51, 'leido', true);

insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, albaran_ref)
select f.id, l.nombre, l.cantidad, l.unidad, l.precio, l.total, l.ref
  from (values
    ('R9-F1',      'MEJILLON R9',               20::numeric, 'kg', 4.5::numeric, 90::numeric, '14.877'),
    ('R9-F1',      'LANGOSTINO R9',              2, 'kg', 10, 20, 'R9-POST'),
    ('14.877',     'MEJILLON R9',               20, 'kg', 4.5, 90, null),
    ('SN-R9-0310', 'MEJILLON R9',               20, 'kg', 4.5, 90, null),
    ('R9-POST',    'LANGOSTINO R9',              2, 'kg', 10, 20, null),
    ('R9-F2',      'ATUN R9 ROJO',               4, 'kg', 42, 168, null),
    ('R9-F2',      'KAMA ATUN R9 ROJO RACION',   3, 'kg', 23, 69, null),
    ('R9-F3',      'SAL R9 FINA',                1, 'kg', 2, 2, null),
    ('R9-F3',      'SAL R9 GRUESA',              1, 'kg', 2.1, 2.1, null)
  ) l(doc, nombre, cantidad, unidad, precio, total, ref)
  join facturas f on f.numero_documento = l.doc;

do $$
declare
  j   jsonb;
  k   jsonb;
  f1  bigint;
  a1  bigint;
  a2  bigint;
  a3  bigint;
begin
  select id into f1 from facturas where numero_documento = 'R9-F1';
  select id into a1 from facturas where numero_documento = '14.877' and tipo = 'albaran' and fecha = '2098-03-01';
  select id into a2 from facturas where numero_documento = 'SN-R9-0310';
  select id into a3 from facturas where numero_documento = 'R9-POST' and tipo = 'albaran';

  -- ─── T1. La regla única ─────────────────────────────────────────────────
  assert exists (select 1 from albaranes_facturados_agente() where albaran_id = a1 and factura_id = f1),
    'T1 el albarán citado por la factura es facturado';
  assert not exists (select 1 from albaranes_facturados_agente() where albaran_id = a2),
    'T1 la misma línea sin cita NO es facturado (coincidencia de producto/cantidad/precio no basta)';
  assert not exists (select 1 from albaranes_facturados_agente() where albaran_id = a3),
    'T1 un albarán POSTERIOR a la factura no es facturado aunque ella lo cite';
  -- Sin el vínculo guardado, la cita sola basta (b).
  update facturas set facturado_en_id = null, facturado_origen = null where id = a1;
  assert exists (select 1 from albaranes_facturados_agente() where albaran_id = a1 and motivo = 'cita'),
    'T1 (b) la cita basta sin vínculo guardado';
  -- Desvinculado a mano: no cuenta como facturado aunque el número se cite.
  update facturas set facturado_en_id = null, facturado_origen = 'manual' where id = a1;
  assert not exists (select 1 from albaranes_facturados_agente() where albaran_id = a1),
    'T1 desvinculado a mano no es facturado';
  -- Vinculado a mano a una factura sin cita: sí.
  update facturas set facturado_en_id = f1, facturado_origen = 'manual' where id = a2;
  assert exists (select 1 from albaranes_facturados_agente() where albaran_id = a2 and motivo = 'vinculo'),
    'T1 vinculado a mano es facturado';
  -- Se deja como al principio.
  update facturas set facturado_en_id = null, facturado_origen = null where id in (a1, a2);

  -- ─── T2. compras_producto sigue la regla ────────────────────────────────
  j := compras_producto_agente('mejillon r9', date '2098-01-01', date '2098-12-31')::jsonb;
  assert (j -> 'por_unidad' -> 0 ->> 'cantidad')::numeric = 40
     and (j -> 'total' ->> 'importe')::numeric = 180
     and (j -> 'avisos' ->> 'albaranes_ya_facturados')::int = 1,
    format('T2 mejillón: F1 + A2 (no A1, citado): %s', j);
  assert not j ? 'por_variante' and (j -> 'por_unidad' -> 0 ->> 'precio_medio')::numeric = 4.5,
    format('T2 una sola variante: sin por_variante y con precio medio: %s', j);
  j := compras_producto_agente('langostino r9', date '2098-01-01', date '2098-12-31')::jsonb;
  assert (j -> 'por_unidad' -> 0 ->> 'cantidad')::numeric = 4 and not coalesce(j -> 'avisos', '{}'::jsonb) ? 'albaranes_ya_facturados',
    format('T2 langostino: el albarán posterior a la factura cuenta: %s', j);
  -- Con tipo albaranes se cuentan todos los de mejillón (A1 y A2: 40 kg).
  j := compras_producto_agente('mejillon r9', date '2098-01-01', date '2098-12-31', 'albaranes')::jsonb;
  assert (j -> 'por_unidad' -> 0 ->> 'cantidad')::numeric = 40, format('T2 solo albaranes: %s', j);
  -- Desvinculado a mano: el albarán A1 vuelve a contar.
  update facturas set facturado_origen = 'manual', facturado_en_id = null where id = a1;
  j := compras_producto_agente('mejillon r9', date '2098-01-01', date '2098-12-31')::jsonb;
  assert (j -> 'por_unidad' -> 0 ->> 'cantidad')::numeric = 60, format('T2 desvinculado a mano cuenta: %s', j);
  -- El gasto por proveedor (ficha) y por producto dicen lo mismo: 121 + A1 + A2 + A3 = 121 + 90 + 90 + 20.
  k := ficha_proveedor_agente('r9 prueba')::jsonb;
  assert (k ->> 'gasto')::numeric = 321 and (k #>> '{reparto,en_albaranes_sin_factura}')::numeric = 200,
    format('T2 ficha_proveedor = misma regla: %s', k);
  update facturas set facturado_origen = null, facturado_en_id = null where id = a1;
  k := ficha_proveedor_agente('r9 prueba')::jsonb;
  assert (k ->> 'gasto')::numeric = 231 and (k #>> '{reparto,en_albaranes_sin_factura}')::numeric = 110,
    format('T2 ficha_proveedor con A1 citado: %s', k);

  -- ─── T3. albaranes_sin_factura_agente ───────────────────────────────────
  j := albaranes_sin_factura_agente('r9 prueba')::jsonb;
  assert (j ->> 'albaranes_sin_factura')::int = 2
     and (j -> 'albaranes' -> 0 ->> 'numero') = 'SN-R9-0310' and (j -> 'albaranes' -> 1 ->> 'numero') = 'R9-POST'
     and not exists (select 1 from jsonb_array_elements(j -> 'albaranes') x where x ->> 'numero' = '14.877'),
    format('T3 sin factura: A2 y A3, no el citado: %s', j);
  assert (j ->> 'suma_con_iva')::numeric = 110 and j ->> 'proveedor' = 'R9 Prueba SL'
     and (j -> 'albaranes' -> 0 ->> 'dias') is not null and (j -> 'albaranes' -> 0 ->> 'importe')::numeric = 90
     and j -> 'albaranes' -> 0 ? 'fecha', format('T3 campos: %s', j);
  j := albaranes_sin_factura_agente('r9 prueba', date '2098-03-15', date '2098-03-31')::jsonb;
  assert (j ->> 'albaranes_sin_factura')::int = 1, format('T3 periodo: %s', j);
  j := albaranes_sin_factura_agente('r9 prueba', date '2098-04-01')::jsonb;
  assert (j ->> 'albaranes_sin_factura')::int = 0 and j ->> 'nota' like 'Ninguno%' and not j ? 'albaranes',
    format('T3 ninguno: %s', j);
  j := albaranes_sin_factura_agente('zzqxw proveedor')::jsonb;
  assert (j ->> 'sin_datos')::boolean, format('T3 proveedor desconocido: %s', j);
  j := albaranes_sin_factura_agente(null, date '2098-03-01', date '2098-03-31')::jsonb;
  assert (j ->> 'albaranes_sin_factura')::int = 2, format('T3 sin proveedor: %s', j);
  assert albaranes_sin_factura_agente(null, date '2098-04-01', date '2098-03-01')::jsonb ? 'error', 'T3 rango';

  -- ─── T4. por_variante ───────────────────────────────────────────────────
  j := compras_producto_agente('atun r9')::jsonb;
  assert jsonb_array_length(j -> 'por_variante') = 2
     and (j -> 'por_variante' -> 0 ->> 'nombre') = 'ATUN R9 ROJO' and (j -> 'por_variante' -> 0 ->> 'precio_medio')::numeric = 42
     and (j -> 'por_variante' -> 1 ->> 'precio_medio')::numeric = 23 and j ? 'nota_variantes',
    format('T4 por_variante: %s', j);
  assert not (j -> 'por_unidad' -> 0) ? 'precio_medio'
     and not (j -> 'por_proveedor' -> 0) ? 'precio_medio' and not (j -> 'por_proveedor' -> 0) ? 'precio_min'
     and (j -> 'por_proveedor' -> 0 ->> 'varias_variantes')::boolean
     and (j -> 'por_proveedor' -> 0 ->> 'importe')::numeric = 237,
    format('T4 sin media global: %s', j);
  -- Variantes con precios parecidos (menos de un 15 %): la media vale.
  j := compras_producto_agente('sal r9')::jsonb;
  assert not j ? 'por_variante' and (j -> 'por_unidad' -> 0 ->> 'precio_medio')::numeric = 2.05,
    format('T4 precios parecidos: %s', j);
  j := historial_precios_agente('atun r9')::jsonb;
  assert (j ->> 'variantes_distintas')::int = 2 and jsonb_array_length(j -> 'por_variante') = 2
     and (j ->> 'nota_coincidencia') like '%por_variante%', format('T4 historial: %s', j);

  -- ─── T5. Sugerencias solo con parecido claro ────────────────────────────
  j := compras_producto_agente('pulpo de roca')::jsonb;
  assert (j ->> 'sin_datos')::boolean and not j ? 'sugerencias' and j ->> 'nota' like 'No hay compras%',
    format('T5 pulpo de roca: sin sugerencias absurdas: %s', j);
  j := compras_producto_agente('zzqxw')::jsonb;
  assert (j ->> 'sin_datos')::boolean and not j ? 'sugerencias', format('T5 zzqxw: %s', j);

  -- ─── T6. filtrar_documentos remite a la herramienta nueva ───────────────
  j := filtrar_documentos_agente('sin_factura')::jsonb;
  assert j ->> 'error' like '%albaranes_sin_factura%', format('T6: %s', j);
end;
$$;

-- ─── P. Permisos ───────────────────────────────────────────────────────────
do $$
declare
  n int;
begin
  select count(*) into n
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('albaranes_facturados_agente', 'albaranes_sin_factura_agente')
     and not has_function_privilege('anon', p.oid, 'execute')
     and has_function_privilege('authenticated', p.oid, 'execute')
     and has_function_privilege('service_role', p.oid, 'execute');
  assert n = 2, format('P: %s de 2 funciones con permisos correctos', n);
  select count(*) into n
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and position('20261010170000_chatbot_ronda9' in case when p.prokind = 'f' then pg_get_functiondef(p.oid) else '' end) > 0
     and not p.prosecdef;
  assert n = 10, format('P: %s de 10 funciones con la marca (y SECURITY INVOKER)', n);
end;
$$;

select 'chatbot_ronda9_test: OK' as resultado;

rollback;
