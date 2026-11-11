set client_encoding = 'UTF8';
-- Pruebas de 20261123120000_chatbot_compras_producto_proveedor.sql
--   npx supabase db query --linked --yes -f supabase/tests/chatbot_compras_producto_proveedor_test.sql
-- Documentos simulados en 2031 que el ROLLBACK final deshace.
begin;

insert into facturas (tipo, proveedor, numero_documento, fecha, subtotal, iva, total, total_origen, verificada)
values ('factura', 'Embajadores Madrid SL', 'T-PV-F1', '2031-04-10', 100, 10, 110, 'leido', true),
       ('factura', 'Cárnicas Otro SA',      'T-PV-F2', '2031-04-11',  60,  6,  66, 'leido', true);
insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total)
select f.id, l.nombre, l.cantidad, 'kg', l.precio, l.total
  from (values
    ('T-PV-F1', 'Chuletero pruebaternera', 10::numeric, 10::numeric, 100::numeric),
    ('T-PV-F2', 'Chuletero pruebaternera',  5, 12, 60)
  ) l(doc, nombre, cantidad, precio, total)
  join facturas f on f.numero_documento = l.doc;

do $$
declare r jsonb; n int; ejec boolean;
begin
  -- Sin proveedor: no cambia el comportamiento (2 proveedores).
  r := compras_producto_agente(p_texto => 'chuletero pruebaternera', p_desde => '2031-04-01', p_hasta => '2031-04-30')::jsonb;
  assert (r->'total'->>'proveedores')::int = 2, format('sin filtro: %s', r);
  assert r->>'proveedor_pedido' is null, 'sin filtro no debe devolver proveedor_pedido';

  -- «Grupo Embajadores» casa con «Embajadores Madrid SL» ignorando «grupo».
  r := compras_producto_agente(p_texto => 'chuletero pruebaternera', p_desde => '2031-04-01', p_hasta => '2031-04-30', p_proveedor => 'Grupo Embajadores')::jsonb;
  assert (r->'total'->>'proveedores')::int = 1, format('con filtro: %s', r);
  assert (r->'total'->>'importe')::numeric = 100, format('importe filtrado: %s', r);
  assert r->>'proveedor_pedido' = 'Grupo Embajadores', 'proveedor_pedido';

  -- Proveedor que no vende el producto: sin_datos, no error.
  r := compras_producto_agente(p_texto => 'chuletero pruebaternera', p_desde => '2031-04-01', p_hasta => '2031-04-30', p_proveedor => 'Inexistente Hnos')::jsonb;
  assert (r->>'sin_datos')::boolean is true, format('proveedor inexistente: %s', r);

  -- Solo existe UNA firma (dos sobrecargas con DEFAULT romperían PostgREST).
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'compras_producto_agente';
  assert n = 1, format('firmas: %s', n);

  -- Permisos: anon no; authenticated y service_role sí.
  select bool_and(not has_function_privilege('anon', p.oid, 'execute')
              and has_function_privilege('authenticated', p.oid, 'execute')
              and has_function_privilege('service_role', p.oid, 'execute')) into ejec
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'compras_producto_agente';
  assert ejec, 'permisos de compras_producto_agente';
end;
$$;

select 'chatbot_compras_producto_proveedor_test: OK' as resultado;
rollback;
