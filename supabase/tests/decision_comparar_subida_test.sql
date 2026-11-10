set client_encoding = 'UTF8';
-- Test de 20261122100100_decision_comparar_subida. BEGIN … ROLLBACK: no deja nada escrito.
-- Acaba en «decision_comparar_subida_test: OK».
--   supabase db query --linked -f supabase/tests/decision_comparar_subida_test.sql
--
--   Datos en 2035 (proveedor A, B):
--     · GAMBA (kg, A): 05/01 a 9 €, 10/01 a 10 €, 10/02 a 16 €, 10/03 a 15 € (la subida);
--       de B a 5 € el 20/02 y de A por «ud» a 3 € el 25/02 (no cuentan).
--       → doc_otro de la subida = 10/01 (la última anterior MÁS BARATA, no la del 10/02).
--     · PULPO (kg, A): 10/01 a 20 €, 10/02 a 12 €, 10/03 a 15 € (la bajada)
--       → doc_otro de la bajada = 10/01 (la última anterior MÁS CARA).
--     · CIGALA (kg, A): solo 10/03 → sin doc_otro.
--     · SEPIA (kg, A): 10/02 a 20 € (no es más barata) y 10/03 a 15 € → la última anterior.
--     · Un aviso con datos.factura_otro_id lo respeta (no se pisa).
begin;

do $$
declare
  v_a    bigint;
  v_b    bigint;
  v_f    bigint;
  v_doc  jsonb := '{}'::jsonb;   -- etiqueta → id de factura
  v_nom  jsonb := '{}'::jsonb;   -- producto → nombre_normalizado
  v_r    jsonb;
  v_n    uuid;
  rec    record;
  v_ids  uuid[] := '{}';
  v_got  jsonb;
begin
  if exists (select 1 from facturas where fecha between '2035-01-01' and '2035-12-31') then
    raise exception 'FALLO datos: ya hay documentos en 2035; el test necesita ese año vacío';
  end if;
  insert into proveedores (nombre, cif) values ('PRUEBA COMPARAR A', 'B00000851') returning id into v_a;
  insert into proveedores (nombre, cif) values ('PRUEBA COMPARAR B', 'B00000852') returning id into v_b;

  for rec in
    select * from (values
      ('g0', v_a, '2035-01-05'::date, 'PRUEBA GAMBA COMPARAR', 'kg', 9::numeric),
      ('g1', v_a, '2035-01-10', 'PRUEBA GAMBA COMPARAR', 'kg', 10),
      ('g2', v_a, '2035-02-10', 'PRUEBA GAMBA COMPARAR', 'kg', 16),
      ('gb', v_b, '2035-02-20', 'PRUEBA GAMBA COMPARAR', 'kg', 5),
      ('gu', v_a, '2035-02-25', 'PRUEBA GAMBA COMPARAR', 'ud', 3),
      ('g3', v_a, '2035-03-10', 'PRUEBA GAMBA COMPARAR', 'kg', 15),
      ('p1', v_a, '2035-01-10', 'PRUEBA PULPO COMPARAR', 'kg', 20),
      ('p2', v_a, '2035-02-10', 'PRUEBA PULPO COMPARAR', 'kg', 12),
      ('p3', v_a, '2035-03-10', 'PRUEBA PULPO COMPARAR', 'kg', 15),
      ('c3', v_a, '2035-03-10', 'PRUEBA CIGALA COMPARAR', 'kg', 30),
      ('s2', v_a, '2035-02-10', 'PRUEBA SEPIA COMPARAR', 'kg', 20),
      ('s3', v_a, '2035-03-10', 'PRUEBA SEPIA COMPARAR', 'kg', 25)
    ) x(et, prov, fecha, nombre, unidad, precio)
  loop
    insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
    values ('factura', 'PRUEBA COMPARAR', 'B00000851', rec.prov, 'CMP-' || rec.et, rec.fecha, rec.precio * 10, 'casa_tomas')
    returning id into v_f;
    insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total)
    values (v_f, rec.nombre, 10, rec.unidad, rec.precio, rec.precio * 10);
    v_doc := v_doc || jsonb_build_object(rec.et, v_f);
    v_nom := v_nom || jsonb_build_object(rec.nombre,
               (select coalesce(nullif(pf.nombre_normalizado::text, ''), lower(pf.nombre::text))
                  from productos_factura pf where pf.factura_id = v_f limit 1));
  end loop;

  -- Avisos (como los generaría facturas_generar_alertas).
  for rec in
    select * from (values
      ('sube', 'facturas_precio_sube', 'PRUEBA GAMBA COMPARAR', 'g3', 15::numeric, null::text),
      ('baja', 'facturas_precio_baja', 'PRUEBA PULPO COMPARAR', 'p3', 15, null),
      ('sin',  'facturas_precio_sube', 'PRUEBA CIGALA COMPARAR', 'c3', 30, null),
      ('sepia','facturas_precio_sube', 'PRUEBA SEPIA COMPARAR', 's3', 25, null),
      ('otro', 'facturas_precio_sube', 'PRUEBA GAMBA COMPARAR', 'g3', 15, 'g0')
    ) x(et, tipo, nombre, doc, precio, otro)
  loop
    insert into notificaciones_dashboard (tipo, titulo, mensaje, prioridad, clave, caduca_en, datos)
    values (rec.tipo, 'PRUEBA COMPARAR ' || rec.et, 'prueba', 'normal', 'prueba_comparar:' || rec.et, now() + interval '1 day',
            jsonb_build_object('factura_id', (v_doc ->> rec.doc)::bigint, 'fecha', (select fecha from facturas where id = (v_doc ->> rec.doc)::bigint),
                               'local', 'casa_tomas', 'proveedor_id', v_a, 'producto', rec.nombre,
                               'nombre_normalizado', v_nom ->> rec.nombre, 'unidad', 'kg', 'medida', 'kg',
                               'precio', rec.precio, 'precio_ref', 12, 'precio_ud', rec.precio, 'importe_90', 300)
            || case when rec.otro is not null then jsonb_build_object('factura_otro_id', (v_doc ->> rec.otro)::bigint) else '{}'::jsonb end)
    returning id into v_n;
    v_ids := v_ids || v_n;
  end loop;

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_r := public.facturas_decision('2035-03-01', '2035-03-31', null);
  perform set_config('request.jwt.claims', null, true);

  select jsonb_object_agg(x ->> 'titulo', x -> 'doc_otro' ->> 'id') into v_got
    from (select jsonb_array_elements(v_r -> 'cambios' -> 'sube') x
          union all select jsonb_array_elements(v_r -> 'cambios' -> 'baja')) s
   where (x ->> 'id')::uuid = any(v_ids);

  if v_got ->> 'PRUEBA COMPARAR sube' is distinct from v_doc ->> 'g1' then
    raise exception 'FALLO subida: doc_otro % y se esperaba g1 % (%)', v_got ->> 'PRUEBA COMPARAR sube', v_doc ->> 'g1', v_got;
  end if;
  if v_got ->> 'PRUEBA COMPARAR baja' is distinct from v_doc ->> 'p1' then
    raise exception 'FALLO bajada: doc_otro % y se esperaba p1 % (%)', v_got ->> 'PRUEBA COMPARAR baja', v_doc ->> 'p1', v_got;
  end if;
  if not (v_got ? 'PRUEBA COMPARAR sin') or v_got ->> 'PRUEBA COMPARAR sin' is not null then
    raise exception 'FALLO sin anterior: doc_otro debería ser null (%)', v_got;
  end if;
  if v_got ->> 'PRUEBA COMPARAR sepia' is distinct from v_doc ->> 's2' then
    raise exception 'FALLO sepia: sin anterior más barata debe dar la última anterior (%)', v_got;
  end if;
  if v_got ->> 'PRUEBA COMPARAR otro' is distinct from v_doc ->> 'g0' then
    raise exception 'FALLO factura_otro_id: no se respeta (%)', v_got;
  end if;
  -- El documento de la subida sigue siendo el caro.
  if (select x -> 'doc' ->> 'id' from jsonb_array_elements(v_r -> 'cambios' -> 'sube') x
       where (x ->> 'id')::uuid = v_ids[1]) is distinct from v_doc ->> 'g3' then
    raise exception 'FALLO: doc de la subida no es la factura cara';
  end if;
end;
$$;

rollback;

select 'decision_comparar_subida_test: OK' as resultado;
