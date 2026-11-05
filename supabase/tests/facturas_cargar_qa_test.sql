set client_encoding = 'UTF8';
-- Test de 20261106200000_facturas_cargar_qa. BEGIN … ROLLBACK: no deja nada
-- escrito (ni en Storage: las filas de storage.objects son de mentira y se
-- deshacen). Acaba en «facturas_cargar_qa_test: OK».
--   supabase db query --linked -f supabase/tests/facturas_cargar_qa_test.sql
begin;

do $$
declare
  v_uid uuid;
  v_t1 uuid := gen_random_uuid();   -- duplicado reciente
  v_t2 uuid := gen_random_uuid();   -- consolidando
  v_t3 uuid := gen_random_uuid();   -- fallido sin ficheros
  v_t4 uuid := gen_random_uuid();   -- fallido con ficheros (se reanuda)
  v_t5 uuid := gen_random_uuid();   -- completado, factura SIN original (rescate)
  v_t6 uuid := gen_random_uuid();   -- duplicado caducado con fichero
  v_t7 uuid := gen_random_uuid();   -- duplicado caducado sin fichero
  v_f1 bigint;
  v_f2 bigint;
  v_j jsonb;
  v_r jsonb;
  v_avisos integer;
  v_url text;
  v_base text;
begin
  -- 1. Cron, URL desde Vault, nada fijo
  if (select count(*) from cron.job where jobname = 'reanudar-trabajos-ocr' and active) <> 1 then
    raise exception 'FALLO 1: el cron reanudar-trabajos-ocr no está activo una vez';
  end if;
  v_url := public.url_funcion_edge('ocr-trabajo');
  if exists (select 1 from vault.decrypted_secrets where name = 'project_url')
     and (v_url is null or v_url !~ '^https://.+/functions/v1/ocr-trabajo$') then
    raise exception 'FALLO 1: url_funcion_edge no compone la URL desde Vault (%)', v_url;
  end if;
  if public.url_funcion_edge('') is not null then
    raise exception 'FALLO 1: url_funcion_edge('''') tiene que ser null';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.prosrc ~ 'https://[a-z0-9]{20}\.supabase\.co/functions') then
    raise exception 'FALLO 1: queda una función con la URL de un proyecto fija';
  end if;
  if exists (select 1 from cron.job where command ~ '''https://[a-z0-9]{20}\.supabase\.co/functions') then
    raise exception 'FALLO 1: queda un cron con la URL de un proyecto fija';
  end if;

  -- 2. Storage y permisos
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
              and policyname in ('facturas_originales_insert', 'facturas_originales_update')) then
    raise exception 'FALLO 2: siguen las políticas de escritura fuera de pendientes/';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                  and policyname = 'facturas_originales_pendientes_insert') then
    raise exception 'FALLO 2: falta la política de pendientes/ (el panel no podría subir)';
  end if;
  if (select file_size_limit from storage.buckets where id = 'facturas-originales') < 20971520 then
    raise exception 'FALLO 2: el bucket no admite 20 MB';
  end if;
  if has_function_privilege('anon', 'public.ocr_descartar_trabajo(uuid)', 'execute')
     or has_function_privilege('anon', 'public.ocr_reintentar_trabajo(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.ocr_descartar_trabajo(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.ocr_reintentar_trabajo(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.url_funcion_edge(text)', 'execute')
     or has_function_privilege('authenticated', 'public.ocr_caducar_duplicados()', 'execute')
     or has_function_privilege('authenticated', 'public.facturas_originales_por_pasar(integer)', 'execute') then
    raise exception 'FALLO 2: permisos de las RPC mal puestos';
  end if;

  -- Datos de prueba
  select id into v_uid from auth.users order by created_at limit 1;
  select id into v_f1 from public.facturas order by id limit 1;
  select id into v_f2 from public.facturas where id <> v_f1 order by id limit 1;
  v_base := 'pendientes/' || v_uid || '/';
  insert into public.ocr_trabajos (id, creado_por, estado, num_paginas, origen, nombre_original, original_path, original_mime, modelo, terminado_at, documento_pendiente)
  values
    (v_t1, v_uid, 'duplicado', 1, 'imagen', 'dup.jpg', v_base || v_t1 || '/01.jpg', 'image/jpeg', 'm', now(),
       jsonb_build_object('existente', jsonb_build_object('id', v_f2))),  -- la existente tiene original: lo descartado sobra
    (v_t2, v_uid, 'consolidando', 1, 'imagen', 'cons.jpg', null, null, 'm', null, null),
    (v_t3, v_uid, 'fallido', 1, 'imagen', 'f3.jpg', v_base || v_t3 || '/01.jpg', 'image/jpeg', 'm', now(), null),
    (v_t4, v_uid, 'fallido', 2, 'pdf', 'f4.pdf', v_base || v_t4 || '/original.pdf', 'application/pdf', 'm', now(), null),
    (v_t5, v_uid, 'completado', 1, 'imagen', 'rescate.jpg', v_base || v_t5 || '/01.jpg', 'image/jpeg', 'm', now(), null),
    (v_t6, v_uid, 'duplicado', 1, 'imagen', 'caducado.jpg', v_base || v_t6 || '/01.jpg', 'image/jpeg', 'm', now() - interval '8 days',
       jsonb_build_object('existente', jsonb_build_object('id', v_f2))),
    (v_t7, v_uid, 'duplicado', 1, 'imagen', 'sinfichero.jpg', v_base || v_t7 || '/01.jpg', 'image/jpeg', 'm', now() - interval '8 days',
       jsonb_build_object('existente', jsonb_build_object('id', v_f2)));
  insert into public.ocr_trabajo_paginas (trabajo_id, numero, storage_path, mime, bytes, estado)
  values
    (v_t3, 1, v_base || v_t3 || '/01.jpg', 'image/jpeg', 10, 'fallida'),
    (v_t4, 1, v_base || v_t4 || '/01.pdf', 'application/pdf', 10, 'completada'),
    (v_t4, 2, v_base || v_t4 || '/02.pdf', 'application/pdf', 10, 'fallida'),
    (v_t5, 1, v_base || v_t5 || '/01.jpg', 'image/jpeg', 10, 'completada');
  insert into storage.objects (bucket_id, name, created_at, metadata)
  values
    ('facturas-originales', v_base || v_t1 || '/01.jpg', now() - interval '2 hours', '{"size": 10}'),
    ('facturas-originales', v_base || v_t4 || '/original.pdf', now() - interval '2 hours', '{"size": 10}'),
    ('facturas-originales', v_base || v_t4 || '/01.pdf', now() - interval '2 hours', '{"size": 10}'),
    ('facturas-originales', v_base || v_t4 || '/02.pdf', now() - interval '2 hours', '{"size": 10}'),
    ('facturas-originales', v_base || v_t5 || '/01.jpg', now() - interval '2 hours', '{"size": 10}'),
    ('facturas-originales', v_base || v_t6 || '/01.jpg', now() - interval '9 days', '{"size": 10}');
  -- La factura del trabajo 5 se quedó sin original (la consolidación murió a medias).
  update public.facturas set ocr_trabajo_id = null where ocr_trabajo_id = v_t5;
  update public.facturas set ocr_trabajo_id = v_t5, drive_url = null, archivo_path = null where id = v_f1;
  update public.facturas set drive_url = 'https://drive.google.com/file/d/x/view' where id = v_f2;

  -- 3. Descartar: sin sesión, no
  perform set_config('request.jwt.claims', '', true);
  v_r := public.ocr_descartar_trabajo(v_t1);
  if (v_r->>'ok')::boolean then raise exception 'FALLO 3: sin sesión no se puede descartar (%)', v_r; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  v_r := public.ocr_descartar_trabajo(v_t1);
  if not (v_r->>'ok')::boolean or v_r->>'estado' <> 'cancelado'
     or (select estado from public.ocr_trabajos where id = v_t1) <> 'cancelado' then
    raise exception 'FALLO 3: el duplicado no se descartó (%)', v_r;
  end if;
  v_r := public.ocr_descartar_trabajo(v_t1);
  if not (v_r->>'ok')::boolean then raise exception 'FALLO 3: descartar dos veces tiene que ser ok (%)', v_r; end if;
  v_r := public.ocr_descartar_trabajo(v_t2);
  if (v_r->>'ok')::boolean or (select estado from public.ocr_trabajos where id = v_t2) <> 'consolidando' then
    raise exception 'FALLO 3: no se descarta un trabajo que se está guardando (%)', v_r;
  end if;
  v_r := public.ocr_descartar_trabajo(gen_random_uuid());
  if (v_r->>'ok')::boolean then raise exception 'FALLO 3: un trabajo que no existe no se descarta'; end if;

  -- 4. Reintentar
  v_r := public.ocr_reintentar_trabajo(v_t2);
  if not (v_r->>'ok')::boolean or v_r->>'estado' <> 'consolidando' then
    raise exception 'FALLO 4: un trabajo en marcha se sigue, no se reintenta (%)', v_r;
  end if;
  v_r := public.ocr_reintentar_trabajo(v_t3);
  if (v_r->>'ok')::boolean or (select estado from public.ocr_trabajos where id = v_t3) <> 'fallido' then
    raise exception 'FALLO 4: sin ficheros no se puede reanudar (%)', v_r;
  end if;
  v_r := public.ocr_reintentar_trabajo(v_t4);
  if not (v_r->>'ok')::boolean or v_r->>'estado' <> 'reanudado'
     or (select estado from public.ocr_trabajos where id = v_t4) not in ('paginas', 'pagina1')
     or (select limite_at from public.ocr_trabajos where id = v_t4) < now() + interval '14 minutes'
     or (select estado from public.ocr_trabajo_paginas where trabajo_id = v_t4 and numero = 1) <> 'completada'
     or (select estado from public.ocr_trabajo_paginas where trabajo_id = v_t4 and numero = 2) <> 'pendiente' then
    raise exception 'FALLO 4: el trabajo fallido con ficheros tiene que reanudarse sin releer la pieza 1 (%)', v_r;
  end if;
  v_r := public.ocr_reintentar_trabajo(v_t1);
  if (v_r->>'ok')::boolean then raise exception 'FALLO 4: un trabajo descartado no se reanuda (%)', v_r; end if;

  -- 5. Rescate (S-1) y caducados (S-5)
  v_j := public.facturas_originales_por_pasar(500);
  if not exists (select 1 from jsonb_array_elements(v_j->'huerfanos') x
                  where x->>'name' = v_base || v_t5 || '/01.jpg' and (x->>'factura_id')::bigint = v_f1
                    and (x->>'es_su_original')::boolean and x->>'nombre' = 'rescate.jpg') then
    raise exception 'FALLO 5: el original de una factura sin ninguno tiene que rescatarse';
  end if;
  if exists (select 1 from jsonb_array_elements_text(v_j->'pendientes') x where x = v_base || v_t5 || '/01.jpg') then
    raise exception 'FALLO 5: el ÚNICO original de una factura no puede ir a borrarse';
  end if;
  if not exists (select 1 from jsonb_array_elements(v_j->'huerfanos') x
                  where x->>'name' = v_base || v_t6 || '/01.jpg' and (x->>'trabajo_id')::uuid = v_t6
                    and not (x->>'es_su_original')::boolean) then
    raise exception 'FALLO 5: un duplicado caducado tiene que ir a Drive (como «anterior-»)';
  end if;
  if exists (select 1 from jsonb_array_elements_text(v_j->'pendientes') x where x = v_base || v_t6 || '/01.jpg') then
    raise exception 'FALLO 5: un duplicado caducado no se borra sin subirlo';
  end if;
  if not exists (select 1 from jsonb_array_elements_text(v_j->'pendientes') x where x = v_base || v_t1 || '/01.jpg') then
    raise exception 'FALLO 5: lo de un trabajo descartado tiene que borrarse';
  end if;
  if exists (select 1 from jsonb_array_elements_text(v_j->'pendientes') x where x like v_base || v_t4 || '/%') then
    raise exception 'FALLO 5: lo de un trabajo fallido se guarda 24 h (para reintentar)';
  end if;
  if not public.facturas_originales_hay_trabajo() then
    raise exception 'FALLO 5: hay_trabajo dice que no hay nada';
  end if;
  -- Con el original ya en Drive, la copia de pendientes/ sobra.
  update public.facturas set drive_url = 'https://drive.google.com/file/d/y/view' where id = v_f1;
  v_j := public.facturas_originales_por_pasar(500);
  if not exists (select 1 from jsonb_array_elements_text(v_j->'pendientes') x where x = v_base || v_t5 || '/01.jpg')
     or exists (select 1 from jsonb_array_elements(v_j->'huerfanos') x where x->>'name' = v_base || v_t5 || '/01.jpg') then
    raise exception 'FALLO 5: con drive_url la copia de pendientes/ tiene que borrarse';
  end if;
  -- Fallido de más de 24 h: ya se borra.
  update public.ocr_trabajos set estado = 'fallido', terminado_at = now() - interval '25 hours' where id = v_t4;
  v_j := public.facturas_originales_por_pasar(500);
  if not exists (select 1 from jsonb_array_elements_text(v_j->'pendientes') x where x = v_base || v_t4 || '/02.pdf') then
    raise exception 'FALLO 5: lo de un fallido de más de 24 h tiene que borrarse';
  end if;

  -- 6. Caducar los duplicados sin nada que salvar
  perform public.ocr_caducar_duplicados();
  if (select estado from public.ocr_trabajos where id = v_t7) <> 'cancelado' then
    raise exception 'FALLO 6: un duplicado caducado sin fichero tiene que cancelarse';
  end if;
  if (select estado from public.ocr_trabajos where id = v_t6) <> 'duplicado' then
    raise exception 'FALLO 6: un duplicado caducado CON fichero espera a que su original vaya a Drive';
  end if;

  -- 7. Aviso de Drive agrupado (S-12): dos facturas atascadas → un aviso
  update public.notificaciones_dashboard set leida = true where tipo = 'original_sin_drive';
  select count(*) into v_avisos from public.notificaciones_dashboard where tipo = 'original_sin_drive';
  update public.facturas set archivo_path = 'temporal/zz-test-' || id || '.pdf', drive_url = null, drive_intentos = 0
   where id in (v_f1, v_f2);
  for i in 1..5 loop
    perform public.facturas_original_drive_fallo(v_f1, 'Drive 503');
    perform public.facturas_original_drive_fallo(v_f2, 'Drive 503');
  end loop;
  if (select count(*) from public.notificaciones_dashboard where tipo = 'original_sin_drive') <> v_avisos + 1 then
    raise exception 'FALLO 7: con Drive caído tiene que haber UN aviso por hora, no uno por factura';
  end if;
  if not exists (select 1 from public.notificaciones_dashboard where tipo = 'original_sin_drive' and not leida
                  and prioridad = 'alta' and mensaje like '%facturas tienen el original sin subir%') then
    raise exception 'FALLO 7: el aviso agrupado no dice cuántas facturas';
  end if;

  raise notice 'facturas_cargar_qa_test: OK';
end;
$$;

rollback;

select 'facturas_cargar_qa_test: OK' as resultado;
