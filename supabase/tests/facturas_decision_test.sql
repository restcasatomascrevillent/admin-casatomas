set client_encoding = 'UTF8';
-- Test de 20261115100000_facturas_decision. BEGIN … ROLLBACK: no deja nada escrito.
-- Acaba en «facturas_decision_test: OK».
--   supabase db query --linked -f supabase/tests/facturas_decision_test.sql
--
--   T1 permisos: facturas_decision y las acciones, SECURITY DEFINER, sin anon;
--      generar/compras/candidatas_extra solo service_role; RLS de las dos tablas
--      nuevas con (select can_read_section('facturas')) envuelto.
--   T2 datos de prueba en 2033 (hoy simulado = 25/03/2033):
--      · mayorista: merluza, gamba y pulpo suben la misma semana → tres subidas con
--        impacto_mes y UN aviso facturas_precio_proveedor; las sueltas, sin campana;
--      · verdulería: perejil sube +25 % pero cuesta < 10 €/mes → sin campana (leída);
--        aceite baja −20 % (6 compras en 90 días) → facturas_precio_baja;
--        barril con precio pactado 100 € y compra a 101 € → facturas_precio_pactado.
--   T3 silencios: «Es normal» del perejil y «Visto» de la bajada → al regenerar
--      caducan y no vuelven; lo demás sigue.
--   T4 facturas_decision: sin permiso → 42501; con un usuario del panel con permiso
--      (si hay sesión): subidas ordenadas por € al mes (merluza primero), documento
--      de origen, gasto con IVA = documentos (abono resta, albarán facturado no
--      suma), «Revisar unidades» con el jamón por pieza y por kilo (y fuera del
--      top), y < 1 s con los datos reales.
--   T5 acciones con un usuario con «Editar» (si hay sesión): Visto, Es normal,
--      pactado marcar/quitar; sin permiso de edición → 42501.
begin;

do $$
declare
  v_p1   bigint;
  v_p2   bigint;
  v_f    bigint;
  v_fmer bigint;
  v_r    jsonb;
  v_n    int;
  v_t    timestamptz;
  v_ok   boolean := false;
  v_ed   boolean := false;
  v_id   uuid;
  v_err  text;
  rec    record;
begin
  -- T1 ─────────────────────────────────────────────────────────────────────
  if has_function_privilege('anon', 'public.facturas_decision(date,date,text)', 'execute')
     or has_function_privilege('anon', 'public.facturas_alerta_visto(uuid)', 'execute')
     or has_function_privilege('anon', 'public.facturas_alerta_es_normal(uuid,integer)', 'execute')
     or has_function_privilege('anon', 'public.facturas_precio_pactado_marcar(bigint,text,numeric,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.facturas_generar_alertas(date)', 'execute')
     or has_function_privilege('authenticated', 'public.facturas_alertas_compras(date,date)', 'execute')
     or has_function_privilege('authenticated', 'public.facturas_alertas_candidatas_extra(date)', 'execute') then
    raise exception 'FALLO T1: permisos de ejecución de más';
  end if;
  if not has_function_privilege('authenticated', 'public.facturas_decision(date,date,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.facturas_alerta_visto(uuid)', 'execute') then
    raise exception 'FALLO T1: faltan permisos de ejecución';
  end if;
  if exists (select 1 from pg_proc p where p.oid in (
               'public.facturas_decision(date,date,text)'::regprocedure, 'public.facturas_alerta_visto(uuid)'::regprocedure,
               'public.facturas_alerta_es_normal(uuid,integer)'::regprocedure,
               'public.facturas_precio_pactado_marcar(bigint,text,numeric,text,text)'::regprocedure,
               'public.facturas_precio_pactado_quitar(bigint,text)'::regprocedure)
              and (not p.prosecdef or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))) then
    raise exception 'FALLO T1: alguna RPC sin SECURITY DEFINER o sin search_path';
  end if;
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename in ('facturas_alertas_silencios', 'facturas_precios_pactados')
     and qual ~* '\(\s*select\s+can_read_section\(';
  if v_n <> 2 then
    raise exception 'FALLO T1: RLS sin (select can_read_section(...)) envuelto (% políticas)', v_n;
  end if;
  if has_table_privilege('authenticated', 'public.facturas_alertas_silencios', 'insert')
     or has_table_privilege('authenticated', 'public.facturas_precios_pactados', 'update')
     or has_table_privilege('anon', 'public.facturas_precios_pactados', 'select') then
    raise exception 'FALLO T1: las tablas nuevas se pueden escribir sin RPC';
  end if;

  -- T2 datos ───────────────────────────────────────────────────────────────
  if exists (select 1 from facturas where fecha between '2032-06-01' and '2033-12-31') then
    raise exception 'FALLO datos: ya hay documentos en 2032-06 … 2033; el test necesita ese periodo vacío';
  end if;
  insert into proveedores (nombre, cif) values ('PRUEBA DECISION MAYORISTA', 'B00000741') returning id into v_p1;
  insert into proveedores (nombre, cif) values ('PRUEBA DECISION VERDULERIA', 'B00000742') returning id into v_p2;

  for rec in select * from (values
      ('2033-01-05'::date, false), ('2033-01-20', false), ('2033-02-05', false),
      ('2033-02-20', false), ('2033-03-01', false), ('2033-03-20', true)) as t(fecha, nuevo) loop
    insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
    values ('factura', 'PRUEBA DECISION MAYORISTA', 'B00000741', v_p1, 'DEC-M-' || to_char(rec.fecha, 'YYYYMMDD'), rec.fecha,
            case when rec.nuevo then 260 + 240 + 180 + 4000 else 200 + 200 + 150 + 4000 end, 'casa_tomas')
    returning id into v_f;
    insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total) values
      (v_f, 'PRUEBA MERLUZA DECISION', 20, 'kg', case when rec.nuevo then 13 else 10 end, case when rec.nuevo then 260 else 200 end),
      (v_f, 'PRUEBA GAMBA DECISION', 10, 'kg', case when rec.nuevo then 24 else 20 end, case when rec.nuevo then 240 else 200 end),
      (v_f, 'PRUEBA PULPO DECISION', 10, 'kg', case when rec.nuevo then 18 else 15 end, case when rec.nuevo then 180 else 150 end),
      -- Jamón por pieza y por kilo (unidades mezcladas): mucho gasto, a «Revisar unidades».
      (v_f, 'PRUEBA JAMON DECISION', 1, case when extract(day from rec.fecha) < 10 then 'pieza' else 'kg' end,
            2000, 2000),
      (v_f, 'PRUEBA JAMON DECISION', 40, case when extract(day from rec.fecha) < 10 then 'kg' else 'pieza' end, 50, 2000);
    if rec.nuevo then v_fmer := v_f; end if;

    insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
    values ('factura', 'PRUEBA DECISION VERDULERIA', 'B00000742', v_p2, 'DEC-V-' || to_char(rec.fecha, 'YYYYMMDD'), rec.fecha,
            100, 'casa_tomas')
    returning id into v_f;
    insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total) values
      (v_f, 'PRUEBA PEREJIL DECISION', 1, 'kg', case when rec.nuevo then 2.5 else 2 end, case when rec.nuevo then 2.5 else 2 end),
      (v_f, 'PRUEBA ACEITE DECISION', 5, 'l', case when rec.nuevo then 8 else 10 end, case when rec.nuevo then 40 else 50 end),
      (v_f, 'PRUEBA BARRIL DECISION', 1, 'ud', case when rec.nuevo then 101 else 100 end, case when rec.nuevo then 101 else 100 end);
  end loop;
  -- Abono de marzo (resta) y albarán ya facturado (no suma).
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
  values ('factura', 'PRUEBA DECISION VERDULERIA', 'B00000742', v_p2, 'DEC-ABONO', '2033-03-22', -50, 'casa_tomas');
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local, facturado_en_id, facturado_origen)
  values ('albaran', 'PRUEBA DECISION MAYORISTA', 'B00000741', v_p1, 'DEC-ALB', '2033-03-18', 999, 'casa_tomas', v_fmer, 'manual');
  -- Precio pactado del barril desde el 1 de enero.
  insert into facturas_precios_pactados (proveedor_id, nombre_normalizado, unidad, producto, precio, created_at)
  values (v_p2, 'prueba barril decision', 'ud', 'Barril de prueba', 100, '2033-01-01');

  v_r := public.facturas_generar_alertas('2033-03-25');

  if not exists (select 1 from notificaciones_dashboard where tipo = 'facturas_precio_sube'
                  and datos ->> 'producto' = 'PRUEBA MERLUZA DECISION'
                  and (datos ->> 'impacto_mes')::numeric between 96.9 and 97.0) then
    raise exception 'FALLO T2: la merluza no trae impacto_mes ≈ 96,92 € (3/13 × 1.260 / 3): %',
      (select jsonb_agg(datos) from notificaciones_dashboard where tipo = 'facturas_precio_sube' and datos ->> 'proveedor_id' = v_p1::text);
  end if;
  if not exists (select 1 from notificaciones_dashboard where tipo = 'facturas_precio_proveedor'
                  and (datos ->> 'proveedor_id')::bigint = v_p1 and (datos ->> 'productos')::int = 3
                  and titulo like 'PRUEBA DECISION MAYORISTA ha subido 3 %' and not leida) then
    raise exception 'FALLO T2: no sale el aviso agrupado del mayorista: %', v_r;
  end if;
  if exists (select 1 from notificaciones_dashboard where tipo = 'facturas_precio_sube' and datos ->> 'proveedor_id' = v_p1::text
              and (datos ->> 'campana' <> 'false' or not leida)) then
    raise exception 'FALLO T2: las subidas agrupadas siguen yendo a la campana';
  end if;
  if not exists (select 1 from notificaciones_dashboard where tipo = 'facturas_precio_sube'
                  and datos ->> 'producto' = 'PRUEBA PEREJIL DECISION' and datos ->> 'campana' = 'false' and leida
                  and (caduca_en is null or caduca_en > now())) then
    raise exception 'FALLO T2: la subida pequeña del perejil no queda vigente y sin campana';
  end if;
  if not exists (select 1 from notificaciones_dashboard where tipo = 'facturas_precio_baja'
                  and datos ->> 'producto' = 'PRUEBA ACEITE DECISION' and (datos ->> 'variacion_pct')::numeric = -20
                  and (datos ->> 'compras_90')::int >= 3) then
    raise exception 'FALLO T2: no sale la bajada del aceite (−20 %%)';
  end if;
  if not exists (select 1 from notificaciones_dashboard where tipo = 'facturas_precio_pactado'
                  and datos ->> 'producto' = 'PRUEBA BARRIL DECISION' and (datos ->> 'precio_pactado')::numeric = 100
                  and (datos ->> 'variacion_pct')::numeric = 1 and prioridad = 'alta') then
    raise exception 'FALLO T2: no sale el precio pactado roto del barril (+1 %%)';
  end if;
  if exists (select 1 from notificaciones_dashboard where tipo like 'facturas_precio_%'
              and datos ->> 'producto' = 'PRUEBA JAMON DECISION') then
    raise exception 'FALLO T2: el jamón (unidades mezcladas) da avisos de precio';
  end if;

  -- T3 silencios ───────────────────────────────────────────────────────────
  insert into facturas_alertas_silencios (tipo, objeto, hasta)
  select tipo, public.facturas_alerta_objeto(tipo, datos), '2033-06-23'
    from notificaciones_dashboard where tipo = 'facturas_precio_sube' and datos ->> 'producto' = 'PRUEBA PEREJIL DECISION';
  insert into facturas_alertas_silencios (tipo, clave)
  select tipo, clave from notificaciones_dashboard where tipo = 'facturas_precio_baja' and datos ->> 'producto' = 'PRUEBA ACEITE DECISION';
  v_r := public.facturas_generar_alertas('2033-03-25');
  if (v_r ->> 'silenciadas')::int < 2 then
    raise exception 'FALLO T3: no respeta los silencios: %', v_r;
  end if;
  if exists (select 1 from notificaciones_dashboard
              where datos ->> 'producto' in ('PRUEBA PEREJIL DECISION', 'PRUEBA ACEITE DECISION')
                and tipo in ('facturas_precio_sube', 'facturas_precio_baja') and (caduca_en is null or caduca_en > now())) then
    raise exception 'FALLO T3: lo silenciado sigue vigente';
  end if;
  if not exists (select 1 from notificaciones_dashboard where tipo = 'facturas_precio_pactado'
                  and datos ->> 'producto' = 'PRUEBA BARRIL DECISION' and (caduca_en is null or caduca_en > now())) then
    raise exception 'FALLO T3: un silencio ha caducado lo que no debía';
  end if;

  -- T4 facturas_decision ───────────────────────────────────────────────────
  perform set_config('request.jwt.claims', '{"role": "authenticated"}', true);
  set local role authenticated;
  begin
    perform public.facturas_decision('2033-03-01', '2033-03-31', null);
    v_err := null;
  exception when others then
    v_err := sqlstate;
  end;
  reset role;
  if coalesce(v_err, '') <> '42501' then
    raise exception 'FALLO T4: sin permiso de Facturas no da 42501 (%)', v_err;
  end if;
  for rec in select s.user_id, s.id from auth.sessions s order by s.updated_at desc nulls last limit 30 loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', rec.user_id, 'session_id', rec.id, 'role', 'authenticated')::text, true);
    set local role authenticated;
    v_ok := public.can_read_section('facturas');
    reset role;
    if v_ok then exit; end if;
  end loop;
  if v_ok then
    set local role authenticated;
    v_r := public.facturas_decision('2033-03-01', '2033-03-31', 'casa_tomas');
    reset role;
    if v_r -> 'cambios' -> 'sube' -> 0 -> 'datos' ->> 'producto' <> 'PRUEBA MERLUZA DECISION'
       or (v_r -> 'cambios' -> 'sube' -> 0 -> 'doc' ->> 'id')::bigint <> v_fmer then
      raise exception 'FALLO T4: la primera subida por € al mes no es la merluza con su documento: %', v_r -> 'cambios' -> 'sube';
    end if;
    if (v_r -> 'resumen' ->> 'gasto')::numeric <> 4550 + 4680 + 100 + 100 - 50 then
      raise exception 'FALLO T4: gasto con IVA % (esperado 9.380: 2 facturas de cada proveedor en marzo, abono −50, sin el albarán facturado)', v_r -> 'resumen';
    end if;
    if not exists (select 1 from jsonb_array_elements(v_r -> 'revisar_unidades') x where x ->> 'producto' ilike 'prueba jamon decision')
       or exists (select 1 from jsonb_array_elements(v_r -> 'top') x where x ->> 'producto' ilike 'prueba jamon decision') then
      raise exception 'FALLO T4: el jamón no sale en «Revisar unidades» (o sale en el top): %', v_r -> 'revisar_unidades';
    end if;
    if not exists (select 1 from jsonb_array_elements(v_r -> 'top') x
                    where x ->> 'producto' ilike 'prueba merluza decision' and jsonb_array_length(x -> 'meses') = 6
                      and jsonb_array_length(x -> 'alertas') >= 1) then
      raise exception 'FALLO T4: la merluza no sale en el top con 6 meses y su alerta: %', v_r -> 'top';
    end if;
    if not exists (select 1 from jsonb_array_elements(v_r -> 'top') x
                    where x ->> 'producto' ilike 'prueba barril decision' and (x -> 'pactado' ->> 'precio')::numeric = 100)
       and exists (select 1 from jsonb_array_elements(v_r -> 'top') x where x ->> 'producto' ilike 'prueba barril decision') then
      raise exception 'FALLO T4: el barril del top no trae su precio pactado';
    end if;
    -- Rendimiento con los datos reales.
    v_t := clock_timestamp();
    set local role authenticated;
    perform public.facturas_decision(null, null, null);
    perform public.facturas_decision('2026-09-01', '2026-09-30', null);
    reset role;
    if clock_timestamp() - v_t > interval '2 seconds' then
      raise exception 'FALLO T4: dos llamadas a facturas_decision tardan %', clock_timestamp() - v_t;
    end if;
    raise notice 'T4: dos llamadas a facturas_decision en %', clock_timestamp() - v_t;
  else
    raise notice 'T4: no hay ninguna sesión de un usuario con permiso de Facturas; parte de usuario saltada';
  end if;

  -- T5 acciones ────────────────────────────────────────────────────────────
  for rec in select s.user_id, s.id from auth.sessions s order by s.updated_at desc nulls last limit 30 loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', rec.user_id, 'session_id', rec.id, 'role', 'authenticated')::text, true);
    set local role authenticated;
    v_ed := public.can_edit_section('facturas');
    reset role;
    if v_ed then exit; end if;
  end loop;
  if v_ed then
    select id into v_id from notificaciones_dashboard where tipo = 'facturas_precio_pactado' and datos ->> 'producto' = 'PRUEBA BARRIL DECISION';
    set local role authenticated;
    v_r := public.facturas_alerta_visto(v_id);
    reset role;
    if not exists (select 1 from notificaciones_dashboard where id = v_id and caduca_en <= now() and leida)
       or not exists (select 1 from facturas_alertas_silencios s join notificaciones_dashboard n on n.clave = s.clave where n.id = v_id) then
      raise exception 'FALLO T5: «Visto» no archiva la alerta';
    end if;
    select id into v_id from notificaciones_dashboard where tipo = 'facturas_precio_sube' and datos ->> 'producto' = 'PRUEBA GAMBA DECISION';
    set local role authenticated;
    v_r := public.facturas_alerta_es_normal(v_id, 90);
    reset role;
    if (v_r ->> 'archivadas')::int < 1 or (v_r ->> 'hasta')::date <> current_date + 90 then
      raise exception 'FALLO T5: «Es normal» no silencia 90 días: %', v_r;
    end if;
    set local role authenticated;
    v_r := public.facturas_precio_pactado_marcar(v_p1, 'prueba merluza decision', 10, 'kg', 'Merluza de prueba');
    v_r := public.facturas_precio_pactado_marcar(v_p1, 'prueba merluza decision', 11, 'kg', null);
    reset role;
    if (select precio from facturas_precios_pactados where proveedor_id = v_p1 and nombre_normalizado = 'prueba merluza decision') <> 11
       or (select producto from facturas_precios_pactados where proveedor_id = v_p1 and nombre_normalizado = 'prueba merluza decision') <> 'Merluza de prueba' then
      raise exception 'FALLO T5: marcar el pacto dos veces no actualiza el precio';
    end if;
    set local role authenticated;
    v_r := public.facturas_precio_pactado_quitar(v_p1, 'prueba merluza decision');
    reset role;
    if (v_r ->> 'quitados')::int <> 1 then
      raise exception 'FALLO T5: quitar el pacto: %', v_r;
    end if;
    set local role authenticated;
    begin
      perform public.facturas_precio_pactado_marcar(v_p1, 'x', -1, null, null);
      v_err := null;
    exception when others then v_err := sqlstate;
    end;
    reset role;
    if coalesce(v_err, '') <> '22023' then
      raise exception 'FALLO T5: un precio negativo no da 22023 (%)', v_err;
    end if;
  else
    raise notice 'T5: no hay ninguna sesión de un usuario con «Editar» en Facturas; parte saltada';
  end if;
  perform set_config('request.jwt.claims', '{"role": "authenticated"}', true);
  set local role authenticated;
  begin
    perform public.facturas_alerta_visto(gen_random_uuid());
    v_err := null;
  exception when others then v_err := sqlstate;
  end;
  reset role;
  perform set_config('request.jwt.claims', null, true);
  if coalesce(v_err, '') <> '42501' then
    raise exception 'FALLO T5: «Visto» sin permiso de edición no da 42501 (%)', v_err;
  end if;
end;
$$;

rollback;

select 'facturas_decision_test: OK' as resultado;
