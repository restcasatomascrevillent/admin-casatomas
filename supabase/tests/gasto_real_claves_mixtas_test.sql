set client_encoding = 'UTF8';
-- Test de 20261010100000_gasto_real_claves_mixtas. BEGIN … ROLLBACK: no deja nada
-- escrito (borra y reinserta datos de prueba DENTRO de la transacción). Acaba
-- en «gasto_real_claves_mixtas_test: OK».
--   npx supabase db query --linked -f supabase/tests/gasto_real_claves_mixtas_test.sql
begin;

do $$
declare
  v_admin uuid := (select user_id from public.super_admins limit 1);
  v_hoy   date := (now() at time zone 'utc')::date;
  d0 date := (now() at time zone 'utc')::date - 6;   -- Default: clave mixta con gasto muy superior a ia_uso (tope 1,3)
  d1 date := (now() at time zone 'utc')::date - 5;   -- Default: mixto + ajeno + ocr, con ia_uso
  d2 date := (now() at time zone 'utc')::date - 4;   -- Default: solo la clave mixta, sin ia_uso
  d3 date := (now() at time zone 'utc')::date - 3;   -- Default sin uso (se excluye); Casa sin uso (su proceso)
  d4 date := (now() at time zone 'utc')::date - 2;   -- Default con un modelo sin tarifa: por peticiones
  v_def text;
  v_n integer;
  v_suma numeric;
  r record;
begin
  -- 1. Marca de la migración en la función + permisos intactos
  v_def := pg_get_functiondef('public.gasto_ia_real_resumen(integer)'::regprocedure);
  if position('20261010100000_gasto_real_claves_mixtas' in v_def) = 0 then
    raise exception 'FALLO 1: gasto_ia_real_resumen no es la versión de esta migración';
  end if;
  if not exists (select 1 from pg_proc where oid = 'public.gasto_ia_real_resumen(integer)'::regprocedure
                  and prosecdef and proconfig::text like '%search_path=public%') then
    raise exception 'FALLO 1: gasto_ia_real_resumen sin SECURITY DEFINER o sin search_path';
  end if;
  if has_function_privilege('anon', 'public.gasto_ia_real_resumen(integer)', 'execute')
     or not has_function_privilege('authenticated', 'public.gasto_ia_real_resumen(integer)', 'execute') then
    raise exception 'FALLO 1: EXECUTE de gasto_ia_real_resumen mal';
  end if;

  -- 2. Datos del proyecto Default (solo si existe en este entorno)
  if exists (select 1 from public.openai_claves k join public.openai_proyectos p using (project_id)
              where p.nombre ilike 'default%' and k.nombre = 'restaurante') then
    if exists (select 1 from public.openai_claves k join public.openai_proyectos p using (project_id)
                where p.nombre ilike 'default%' and k.nombre = 'restaurante' and k.proceso <> 'mixto') then
      raise exception 'FALLO 2: la clave «restaurante» de Default no es mixto';
    end if;
    if exists (select 1 from public.openai_claves k join public.openai_proyectos p using (project_id)
                where p.nombre ilike 'default%' and k.nombre in ('n8n', 'n8n web', 'n', 'My Test Key', 'pruebita')
                  and k.proceso <> 'ajeno') then
      raise exception 'FALLO 2: una clave ajena de Default no es ajeno';
    end if;
    if exists (select 1 from public.openai_claves k join public.openai_proyectos p using (project_id)
                where p.nombre ilike 'default%' and k.nombre = 'OCR facturas' and k.proceso <> 'ocr')
       or exists (select 1 from public.openai_claves k join public.openai_proyectos p using (project_id)
                where p.nombre ilike 'default%' and k.nombre = 'chat facturas' and k.proceso <> 'chat') then
      raise exception 'FALLO 2: OCR facturas / chat facturas de Default mal';
    end if;
    if exists (select 1 from public.openai_proyectos p where p.nombre ilike 'default%' and p.proceso <> 'ajeno') then
      raise exception 'FALLO 2: el proyecto Default debe seguir ajeno';
    end if;
  end if;

  -- 3. La restricción admite ajeno y mixto en claves, y rechaza lo demás
  begin
    insert into public.openai_claves (api_key_id, project_id, proceso) values ('zz_k_aj', 'zz_p', 'ajeno');
    insert into public.openai_claves (api_key_id, project_id, proceso) values ('zz_k_mx', 'zz_p', 'mixto');
    delete from public.openai_claves where api_key_id in ('zz_k_aj', 'zz_k_mx');
  exception when check_violation then
    raise exception 'FALLO 3: openai_claves no admite ajeno/mixto';
  end;
  begin
    insert into public.openai_claves (api_key_id, project_id, proceso) values ('zz_k_mal', 'zz_p', 'inventado');
    raise exception 'FALLO 3: se aceptó un proceso de clave inválido';
  exception when check_violation then null;
  end;

  if v_admin is null then
    raise notice 'sin super admin: se saltan los pasos 4 a 8';
    return;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);

  -- Datos de prueba: se vacían las tablas implicadas DENTRO de la transacción.
  delete from public.openai_costes_diarios;
  delete from public.openai_uso_diario;
  delete from public.openai_claves;
  delete from public.openai_proyectos;
  delete from public.ia_uso;
  delete from public.chat_web_uso;

  insert into public.openai_proyectos (project_id, proceso, nombre) values
    ('p_def', 'ajeno', 'Default project'), ('p_casa', 'otros', 'Casa tomas'), ('p_sin', null, 'Sin marcar');
  insert into public.openai_claves (api_key_id, project_id, nombre, proceso) values
    ('k_mix', 'p_def', 'restaurante', 'mixto'),
    ('k_ocr', 'p_def', 'OCR facturas', 'ocr'),
    ('k_aj',  'p_def', 'n8n', 'ajeno'),
    ('k_gen', 'p_casa', 'GENERAL', 'otros');
  -- Tarifa de prueba: 1 $/M input (sin cacheados ni output en las pruebas)
  insert into public.ia_precios (modelo, usd_por_m_input, usd_por_m_cached, usd_por_m_output)
    values ('zz-test-modelo', 1, 0.5, 2);

  -- d1: Default 10 $ → pesos mixto 3 : ocr 1 : ajeno 1 (+ clave sin fila en proyecto ajeno: ajeno, peso 0 aquí)
  --     mixto 6, ocr 2, ajeno 2 (excluido). Casa 1 $ con uso de su clave general → otros 1.
  --     ia_uso de d1: ocr 1,0 · chat 3,0 · chatweb 1,0 → el mixto (6) se reparte 1/5 · 3/5 · 1/5 = 1,2 · 3,6 · 1,2
  insert into public.openai_uso_diario (fecha, project_id, api_key_id, modelo, input_tokens, peticiones) values
    (d0, 'p_def',  'k_mix', 'zz-test-modelo',            1000000, 10),
    (d1, 'p_def',  'k_mix', 'zz-test-modelo-2026-01-01', 3000000, 10),
    (d1, 'p_def',  'k_ocr', 'zz-test-modelo',            1000000, 10),
    (d1, 'p_def',  'k_aj',  'zz-test-modelo',            1000000, 10),
    (d1, 'p_def',  'k_desconocida', 'zz-test-modelo',    0, 0),
    (d1, 'p_casa', 'k_gen', 'zz-test-modelo',            1000000, 10),
    (d2, 'p_def',  'k_mix', 'zz-test-modelo',            2000000, 10),
    (d4, 'p_def',  'k_mix', 'zz-modelo-sin-tarifa',      1000, 10),
    (d4, 'p_def',  'k_aj',  'zz-modelo-sin-tarifa',      1000, 30);
  insert into public.openai_costes_diarios (fecha, project_id, line_item, usd) values
    (d0, 'p_def',  'a', 10.00),                             -- R = 10, E = 2 (chat) → chat 2 × 1,3 = 2,6 · sin_identificar 7,4
    (d1, 'p_def',  'a', 6.00), (d1, 'p_def', 'b', 4.00),   -- 10,00
    (d1, 'p_casa', 'a', 1.00),
    (d2, 'p_def',  'a', 4.00),                              -- todo mixto, sin ia_uso → otros
    (d3, 'p_def',  'a', 5.00),                              -- ajeno sin uso → se excluye
    (d3, 'p_casa', 'a', 2.00),                              -- Casa sin uso → su proceso (otros)
    (d4, 'p_def',  'a', 8.00),                              -- por peticiones: mixto 10 : ajeno 30 → mixto 2
    (d1, 'p_sin',  'x', 0.30),                              -- sin marcar → sin_asignar, no suma
    (d1, '',       '',  0.05),                              -- sin proyecto → sin_asignar
    (v_hoy, 'p_def', 'a', 99.00),                           -- día en curso: se ignora
    (d1 - 60, 'p_def', 'a', 7.00);                          -- fuera de la ventana
  insert into public.ia_uso (funcion, modelo, coste_usd, created_at) values
    ('procesar-factura', 'gpt-4.1', 1.0, (d1::timestamp + interval '12 hours') at time zone 'utc'),
    ('chat-facturas',    'gpt-4.1', 2.0, (d0::timestamp + interval '12 hours') at time zone 'utc'),
    ('chat-facturas',    'gpt-4.1', 3.0, (d1::timestamp + interval '13 hours') at time zone 'utc');
  insert into public.chat_web_uso (session_id, estado, coste_usd, created_at) values
    ('s1', 'ok', 1.0, (d1::timestamp + interval '14 hours') at time zone 'utc'),
    ('s2', 'rechazado', 50, (d1::timestamp + interval '14 hours') at time zone 'utc');

  -- 4. Totales por proceso (30 días)
  --    ocr = 2 + 1,2 = 3,2 · chat = 3,6 + 2,6 (d0) = 6,2 · chatweb = 1,2 · vinos = 0
  --    otros = 1 (Casa d1) + 4 (d2: E = 0, sin identificar) + 2 (Casa d3) + 2 (d4: sin identificar)
  --            + 7,4 (d0: R − 1,3 × E, sin identificar) = 16,4  (de ellos sin_identificar = 4 + 2 + 7,4 = 13,4)
  --    total = 27,00 (se excluyen: 2 de la clave ajena d1, 5 de Default d3, 6 de la clave ajena d4)
  for r in select * from public.gasto_ia_real_resumen(30) where proceso not like 'otros:%' loop
    if r.ultimo_dia_real <> d4 then raise exception 'FALLO 4: ultimo_dia_real % (se esperaba %)', r.ultimo_dia_real, d4; end if;
    if r.proceso = 'ocr'     and round(r.usd_real, 4) <> 3.2 then raise exception 'FALLO 4: ocr % (3.2)', r.usd_real; end if;
    if r.proceso = 'chat'    and round(r.usd_real, 4) <> 6.2 then raise exception 'FALLO 4: chat % (6.2)', r.usd_real; end if;
    if r.proceso = 'chatweb' and round(r.usd_real, 4) <> 1.2 then raise exception 'FALLO 4: chatweb % (1.2)', r.usd_real; end if;
    if r.proceso = 'vinos'   and r.usd_real <> 0 then raise exception 'FALLO 4: vinos % (0)', r.usd_real; end if;
    if r.proceso = 'otros'   and round(r.usd_real, 4) <> 16.4 then raise exception 'FALLO 4: otros % (16.4)', r.usd_real; end if;
    if r.proceso = 'sin_asignar' and r.usd_real <> 0.35 then raise exception 'FALLO 4: sin_asignar % (0.35)', r.usd_real; end if;
    if r.reparto <> 'clave_peticiones' then raise exception 'FALLO 4: reparto % (clave_peticiones: d4 sin tarifa)', r.reparto; end if;
  end loop;
  select coalesce(sum(usd_real), 0) into v_suma
    from public.gasto_ia_real_resumen(30) where proceso in ('ocr', 'chat', 'chatweb', 'vinos', 'otros');
  if v_suma <> 27.00 then raise exception 'FALLO 4: la suma por procesos (%) no es el total no ajeno exacto 27,00', v_suma; end if;
  -- Sub-líneas de «otros»: sin_identificar 13,4 + resto 3,0 (no hay ia_uso de otros) = 16,4
  if (select usd_real from public.gasto_ia_real_resumen(30) where proceso = 'otros:sin_identificar') <> 13.4 then
    raise exception 'FALLO 4: otros:sin_identificar % (13,4)', (select usd_real from public.gasto_ia_real_resumen(30) where proceso = 'otros:sin_identificar');
  end if;
  select coalesce(sum(usd_real), 0) into v_suma from public.gasto_ia_real_resumen(30) where proceso like 'otros:%';
  if v_suma <> 16.4 then raise exception 'FALLO 4: las sub-líneas de otros suman % (16,4)', v_suma; end if;
  select count(*) into v_n from public.gasto_ia_real_resumen(30) where proceso not like 'otros:%';
  if v_n <> 6 then raise exception 'FALLO 4: se esperaban 6 filas (5 procesos + sin_asignar), hay %', v_n; end if;

  -- 5. Una ventana más corta (solo d4): 2,00 de la clave mixta sin ia_uso → otros (sin identificar)
  select coalesce(sum(usd_real), 0) into v_suma
    from public.gasto_ia_real_resumen(1) where proceso in ('ocr', 'chat', 'chatweb', 'vinos', 'otros');
  if v_suma <> 2.00 then raise exception 'FALLO 5: con p_dias = 1 el total es % (2,00)', v_suma; end if;

  -- 6. Si la clave mixta pasa a ajeno, su parte sale del total (Default entero excluido)
  update public.openai_claves set proceso = 'ajeno' where api_key_id in ('k_mix', 'k_ocr');
  select coalesce(sum(usd_real), 0) into v_suma
    from public.gasto_ia_real_resumen(30) where proceso in ('ocr', 'chat', 'chatweb', 'vinos', 'otros');
  if v_suma <> 3.00 then raise exception 'FALLO 6: con Default entero ajeno el total es % (3,00: solo Casa)', v_suma; end if;
  if (select max(ultimo_dia_real) from public.gasto_ia_real_resumen(30)) <> d3 then
    raise exception 'FALLO 6: ultimo_dia_real debería ser % (último día con costes de Casa)', d3;
  end if;
  update public.openai_claves set proceso = 'mixto' where api_key_id = 'k_mix';
  update public.openai_claves set proceso = 'ocr' where api_key_id = 'k_ocr';

  -- 7. Sin proyectos ni claves cuentables: estimado puro (sin_datos, ultimo_dia_real NULL)
  delete from public.openai_costes_diarios where project_id = 'p_casa';
  update public.openai_claves set proceso = 'ajeno' where project_id = 'p_def';
  for r in select * from public.gasto_ia_real_resumen(30) loop
    if r.ultimo_dia_real is not null or r.usd_real <> 0 or r.reparto <> 'sin_datos' then
      raise exception 'FALLO 7: sin nada cuentable debería ser estimado puro (%)', r.proceso;
    end if;
  end loop;

  -- 8. Sin permiso de Facturas: 42501
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated')::text, true);
  begin
    perform * from public.gasto_ia_real_resumen(30);
    raise exception 'FALLO 8: un usuario sin permiso ha leído el resumen';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select 'gasto_real_claves_mixtas_test: OK' as resultado;
rollback;
