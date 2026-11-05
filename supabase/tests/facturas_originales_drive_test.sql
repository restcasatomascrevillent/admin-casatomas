set client_encoding = 'UTF8';
-- Test de 20261105193000_facturas_originales_drive. BEGIN … ROLLBACK: no deja
-- nada escrito. Acaba en «facturas_originales_drive_test: OK».
--   npx supabase db query --linked -f supabase/tests/facturas_originales_drive_test.sql
begin;

do $$
declare
  v_id bigint;
  v_n integer;
  v_avisos integer;
  v_j jsonb;
  v_ruta text := 'temporal/zz-test-' || gen_random_uuid() || '.pdf';
begin
  -- 1. Columnas
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'facturas'
        and column_name in ('drive_intentos', 'drive_error', 'drive_intento_at')) <> 3 then
    raise exception 'FALLO 1: faltan columnas de facturas';
  end if;

  -- 2. Permisos: nada fuera de service_role
  if has_function_privilege('anon', 'public.facturas_original_drive_fallo(bigint, text)', 'execute')
     or has_function_privilege('authenticated', 'public.facturas_original_drive_fallo(bigint, text)', 'execute')
     or has_function_privilege('authenticated', 'public.facturas_originales_por_pasar(integer)', 'execute')
     or has_function_privilege('anon', 'public.facturas_originales_por_pasar(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.facturas_originales_hay_trabajo()', 'execute')
     or has_function_privilege('authenticated', 'public.facturas_originales_drive_disparar()', 'execute') then
    raise exception 'FALLO 2: alguna RPC es ejecutable fuera de service_role';
  end if;
  if not has_function_privilege('service_role', 'public.facturas_originales_por_pasar(integer)', 'execute') then
    raise exception 'FALLO 2: service_role no puede ejecutar facturas_originales_por_pasar';
  end if;

  -- 3. Cron instalado una vez
  if (select count(*) from cron.job where jobname = 'facturas-originales-drive' and active) <> 1 then
    raise exception 'FALLO 3: el cron facturas-originales-drive no está activo una vez';
  end if;

  -- 4. Una factura «pendiente de Drive» (copia temporal que no existe en Storage)
  select id into v_id from public.facturas order by id limit 1;
  update public.facturas
     set archivo_path = v_ruta, drive_url = null, drive_intentos = 0, drive_error = null, drive_intento_at = null
   where id = v_id;
  v_j := public.facturas_originales_por_pasar(500);
  if not exists (select 1 from jsonb_array_elements(v_j->'facturas') x
                  where (x->>'id')::bigint = v_id and x->>'archivo_path' = v_ruta and (x->>'existe')::boolean = false) then
    raise exception 'FALLO 4: la factura pendiente de Drive no sale en facturas_originales_por_pasar';
  end if;
  if not public.facturas_originales_hay_trabajo() then
    raise exception 'FALLO 4: hay_trabajo dice que no hay nada';
  end if;

  -- 5. Fallos: cuenta y aviso UNA vez al llegar a 5
  select count(*) into v_avisos from public.notificaciones_dashboard where tipo = 'original_sin_drive';
  for i in 1..4 loop
    v_n := public.facturas_original_drive_fallo(v_id, 'Drive token 400');
  end loop;
  if v_n <> 4 or (select count(*) from public.notificaciones_dashboard where tipo = 'original_sin_drive') <> v_avisos then
    raise exception 'FALLO 5: con 4 fallos no debe haber aviso (n=%)', v_n;
  end if;
  v_n := public.facturas_original_drive_fallo(v_id, 'Drive token 400');
  v_n := public.facturas_original_drive_fallo(v_id, 'Drive token 400');
  if v_n <> 6 or (select count(*) from public.notificaciones_dashboard where tipo = 'original_sin_drive') <> v_avisos + 1 then
    raise exception 'FALLO 5: al 5.º fallo tiene que haber exactamente un aviso nuevo (n=%)', v_n;
  end if;
  if not exists (select 1 from public.notificaciones_dashboard where tipo = 'original_sin_drive'
                  and prioridad = 'alta' and referencia_tipo = 'facturas_original' and mensaje like '%Drive token 400%') then
    raise exception 'FALLO 5: el aviso no lleva prioridad, referencia o error';
  end if;
  if (select drive_error from public.facturas where id = v_id) <> 'Drive token 400'
     or (select drive_intento_at from public.facturas where id = v_id) is null then
    raise exception 'FALLO 5: no se guardó el error o la hora del intento';
  end if;
  if public.facturas_original_drive_fallo(-1, 'x') is not null then
    raise exception 'FALLO 5: una factura que no existe debe devolver null';
  end if;

  -- 6. Tras 5 fallos recientes: fuera del lote (espera 6 h); pasadas 6 h, vuelve
  v_j := public.facturas_originales_por_pasar(500);
  if exists (select 1 from jsonb_array_elements(v_j->'facturas') x where (x->>'id')::bigint = v_id) then
    raise exception 'FALLO 6: con 6 fallos recientes no debe reintentarse en cada pasada';
  end if;
  update public.facturas set drive_intento_at = now() - interval '7 hours' where id = v_id;
  v_j := public.facturas_originales_por_pasar(500);
  if not exists (select 1 from jsonb_array_elements(v_j->'facturas') x where (x->>'id')::bigint = v_id) then
    raise exception 'FALLO 6: pasadas 6 h tiene que reintentarse';
  end if;

  -- 7. Con drive_url, la copia sobra: siempre sale (para borrarla)
  update public.facturas set drive_url = 'https://drive.google.com/file/d/x/view', drive_intento_at = now() where id = v_id;
  v_j := public.facturas_originales_por_pasar(500);
  if not exists (select 1 from jsonb_array_elements(v_j->'facturas') x
                  where (x->>'id')::bigint = v_id and x->>'drive_url' is not null) then
    raise exception 'FALLO 7: una copia con drive_url tiene que salir para borrarse';
  end if;

  -- 8. Forma del resultado
  if jsonb_typeof(v_j->'huerfanos') <> 'array' or jsonb_typeof(v_j->'pendientes') <> 'array' then
    raise exception 'FALLO 8: faltan las listas huerfanos/pendientes';
  end if;

  raise notice 'facturas_originales_drive_test: OK';
end;
$$;

rollback;

select 'facturas_originales_drive_test: OK' as resultado;
