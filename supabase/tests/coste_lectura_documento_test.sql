set client_encoding = 'UTF8';
-- Test de 20261010120000_coste_lectura_documento. BEGIN … ROLLBACK: no deja nada
-- escrito (vacía y reinserta datos de prueba DENTRO de la transacción). Acaba
-- en «coste_lectura_documento_test: OK».
--   npx supabase db query --linked -f supabase/tests/coste_lectura_documento_test.sql
begin;

do $$
declare
  v_admin uuid := (select user_id from public.super_admins limit 1);
  v_ok boolean;
  v_def text;
  r record;
  v_trabajo uuid := gen_random_uuid();
  v_f1 bigint; v_f2 bigint; v_f3 bigint; v_f4 bigint; v_f5 bigint;
  v_coste numeric; v_llamadas integer;
begin
  -- 1. Columnas
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'facturas'
        and column_name in ('coste_lectura_usd', 'lectura_llamadas', 'lectura_modelo')) <> 3 then
    raise exception 'FALLO 1: faltan columnas de facturas';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ocr_trabajos'
                  and column_name = 'llamadas') then
    raise exception 'FALLO 1: falta ocr_trabajos.llamadas';
  end if;

  -- 2. Backfill: toda factura con trabajo de OCR de coste > 0 tiene su coste
  if exists (select 1 from public.facturas f join public.ocr_trabajos t on t.id = f.ocr_trabajo_id
              where t.coste_usd > 0 and f.coste_lectura_usd is distinct from t.coste_usd) then
    raise exception 'FALLO 2: una factura con trabajo de OCR no tiene el coste del trabajo';
  end if;

  -- 3. Funciones: SECURITY DEFINER con search_path; permisos
  if exists (select 1 from pg_proc where oid in ('public.estadisticas_lectura(integer)'::regprocedure,
                                                  'public.ocr_sumar_gasto(uuid, numeric, integer)'::regprocedure)
              and not (prosecdef and proconfig::text like '%search_path=public%')) then
    raise exception 'FALLO 3: RPC sin SECURITY DEFINER o sin search_path';
  end if;
  if has_function_privilege('anon', 'public.estadisticas_lectura(integer)', 'execute')
     or not has_function_privilege('authenticated', 'public.estadisticas_lectura(integer)', 'execute') then
    raise exception 'FALLO 3: EXECUTE de estadisticas_lectura mal';
  end if;
  if has_function_privilege('anon', 'public.ocr_sumar_gasto(uuid, numeric, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.ocr_sumar_gasto(uuid, numeric, integer)', 'execute')
     or not has_function_privilege('service_role', 'public.ocr_sumar_gasto(uuid, numeric, integer)', 'execute') then
    raise exception 'FALLO 3: EXECUTE de ocr_sumar_gasto mal (solo service_role)';
  end if;

  -- 4. Sin sesión con permiso, estadisticas_lectura se niega (42501)
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  v_ok := false;
  begin
    perform * from public.estadisticas_lectura(30);
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'FALLO 4: estadisticas_lectura aceptó a un anónimo'; end if;

  -- 5. Con datos controlados (se vacía el coste de todas las facturas: es una transacción)
  if v_admin is null then
    raise exception 'FALLO 5: no hay super admin para probar';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  update public.facturas set coste_lectura_usd = null where coste_lectura_usd is not null;

  -- Sin documentos: una fila con documentos = 0 y el resto NULL
  select * into r from public.estadisticas_lectura(30);
  if r.documentos <> 0 or r.media_usd is not null or r.mas_cara_id is not null
     or r.por_paginas <> '[]'::jsonb or r.por_lineas <> '[]'::jsonb then
    raise exception 'FALLO 5: sin documentos debería salir todo vacío: %', to_jsonb(r);
  end if;

  insert into public.facturas (tipo, proveedor, numero_documento, fecha, total, paginas, procesado_en,
                               coste_lectura_usd, lectura_llamadas, lectura_modelo)
  values ('factura', 'PRUEBA LECTURA A', 'TEST-LECT-A', current_date, 10, 1, now(), 0.010000, 2, 'gpt-5.6-luna')
  returning id into v_f1;
  insert into public.facturas (tipo, proveedor, numero_documento, fecha, total, paginas, procesado_en,
                               coste_lectura_usd, lectura_llamadas, lectura_modelo)
  values ('factura', 'PRUEBA LECTURA B', 'TEST-LECT-B', current_date, 10, 2, now(), 0.030000, 6, 'gpt-5.6-luna')
  returning id into v_f2;
  insert into public.facturas (tipo, proveedor, numero_documento, fecha, total, paginas, procesado_en,
                               coste_lectura_usd, lectura_llamadas, lectura_modelo)
  values ('albaran', 'PRUEBA LECTURA C', 'TEST-LECT-C', current_date, 10, 1, now(), 0.020000, 4, 'gpt-5.6-luna')
  returning id into v_f3;
  -- Sin coste: no cuenta
  insert into public.facturas (tipo, proveedor, numero_documento, fecha, total, paginas, procesado_en)
  values ('factura', 'PRUEBA LECTURA D', 'TEST-LECT-D', current_date, 10, 1, now())
  returning id into v_f4;
  -- Antigua (100 días): fuera de 30 días, dentro de 365
  insert into public.facturas (tipo, proveedor, numero_documento, fecha, total, paginas, procesado_en, coste_lectura_usd)
  values ('factura', 'PRUEBA LECTURA E', 'TEST-LECT-E', current_date, 10, 1, now() - interval '100 days', 9.000000)
  returning id into v_f5;

  -- Líneas: A = 3, B = 30, C = 0
  insert into public.productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total)
  select v_f1, 'linea ' || g, 1, 'ud', 1, 1 from generate_series(1, 3) g;
  insert into public.productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total)
  select v_f2, 'linea ' || g, 1, 'ud', 1, 1 from generate_series(1, 30) g;

  select * into r from public.estadisticas_lectura(30);
  if r.documentos <> 3 then raise exception 'FALLO 5: documentos = % (esperado 3)', r.documentos; end if;
  if r.total_usd <> 0.06 or round(r.media_usd, 6) <> 0.02 or round(r.mediana_usd, 6) <> 0.02 then
    raise exception 'FALLO 5: total/media/mediana mal: %', to_jsonb(r);
  end if;
  if r.llamadas_media <> 4 then raise exception 'FALLO 5: llamadas_media = %', r.llamadas_media; end if;
  if r.mas_cara_id <> v_f2 or r.mas_cara_numero <> 'TEST-LECT-B' or r.mas_cara_usd <> 0.03
     or r.mas_cara_proveedor <> 'PRUEBA LECTURA B' then
    raise exception 'FALLO 5: la más cara mal: %', to_jsonb(r);
  end if;
  if (select (e->>'documentos')::int from jsonb_array_elements(r.por_paginas) e where e->>'tramo' = '1 página') <> 2
     or (select (e->>'documentos')::int from jsonb_array_elements(r.por_paginas) e where e->>'tramo' = '2 páginas') <> 1 then
    raise exception 'FALLO 5: reparto por páginas mal: %', r.por_paginas;
  end if;
  if (select (e->>'documentos')::int from jsonb_array_elements(r.por_lineas) e where e->>'tramo' = '1-10 líneas') <> 2
     or (select (e->>'documentos')::int from jsonb_array_elements(r.por_lineas) e where e->>'tramo' = '26-50 líneas') <> 1 then
    raise exception 'FALLO 5: reparto por líneas mal: %', r.por_lineas;
  end if;

  select * into r from public.estadisticas_lectura(365);
  if r.documentos <> 4 or r.mas_cara_id <> v_f5 then
    raise exception 'FALLO 5: con 365 días debería entrar la antigua: %', to_jsonb(r);
  end if;
  -- p_dias fuera de rango se acota (no falla)
  select * into r from public.estadisticas_lectura(null);
  if r.documentos <> 3 then raise exception 'FALLO 5: p_dias nulo debería valer 30'; end if;
  select * into r from public.estadisticas_lectura(-5);
  if r.documentos > 3 then raise exception 'FALLO 5: p_dias negativo debería valer 1 día'; end if;

  -- 6. ocr_sumar_gasto suma coste y llamadas, y no resta nunca
  insert into public.ocr_trabajos (id, creado_por, estado, num_paginas, origen, nombre_original, coste_usd)
  values (v_trabajo, v_admin, 'pagina1', 1, 'imagen', 'prueba.jpg', 0.001);
  perform public.ocr_sumar_gasto(v_trabajo, 0.002, 3);
  perform public.ocr_sumar_gasto(v_trabajo, -1, -4);
  perform public.ocr_sumar_gasto(v_trabajo, null, null);
  select coste_usd, llamadas into v_coste, v_llamadas from public.ocr_trabajos where id = v_trabajo;
  if v_coste <> 0.003 or v_llamadas <> 3 then
    raise exception 'FALLO 6: ocr_sumar_gasto dejó coste % y llamadas % (esperado 0.003 y 3)', v_coste, v_llamadas;
  end if;

  -- 7. La columna rechaza valores negativos
  v_ok := false;
  begin
    update public.facturas set coste_lectura_usd = -1 where id = v_f1;
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'FALLO 7: la columna acepta un coste negativo'; end if;
end;
$$;

rollback;

select 'coste_lectura_documento_test: OK' as resultado;
