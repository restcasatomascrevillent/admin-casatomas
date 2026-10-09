set client_encoding = 'UTF8';
-- Test de 20261009100000_openai_gasto_por_clave. BEGIN … ROLLBACK: no deja nada
-- escrito (borra y reinserta datos de prueba DENTRO de la transacción). Acaba
-- en «openai_gasto_por_clave_test: OK».
--   npx supabase db query --linked -f supabase/tests/openai_gasto_por_clave_test.sql
begin;

do $$
declare
  v_admin    uuid := (select user_id from public.super_admins limit 1);
  v_hoy      date := (now() at time zone 'utc')::date;
  v_ayer     date := (now() at time zone 'utc')::date - 1;
  v_anteayer date := (now() at time zone 'utc')::date - 2;
  v_def text;
  r record;
  v_n integer;
  v_suma numeric;
  v_hoy_antes numeric;
begin
  -- 1. Objetos, RLS y privilegios
  if to_regclass('public.openai_claves') is null or to_regclass('public.openai_uso_diario') is null then
    raise exception 'FALLO 1: faltan tablas';
  end if;
  if exists (select 1 from pg_class where oid in ('public.openai_claves'::regclass, 'public.openai_uso_diario'::regclass)
              and not relrowsecurity) then
    raise exception 'FALLO 1: una tabla sin RLS';
  end if;
  if has_table_privilege('anon', 'public.openai_uso_diario', 'select')
     or has_table_privilege('authenticated', 'public.openai_uso_diario', 'insert')
     or has_table_privilege('authenticated', 'public.openai_claves', 'update')
     or has_table_privilege('authenticated', 'public.openai_claves', 'delete') then
    raise exception 'FALLO 1: privilegios de tabla demasiado amplios';
  end if;
  if not has_table_privilege('service_role', 'public.openai_uso_diario', 'insert')
     or not has_table_privilege('service_role', 'public.openai_claves', 'insert') then
    raise exception 'FALLO 1: service_role no puede escribir';
  end if;
  if not exists (select 1 from pg_proc where oid = 'public.gasto_ia_real_resumen(integer)'::regprocedure
                  and prosecdef and proconfig::text like '%search_path=public%') then
    raise exception 'FALLO 1: gasto_ia_real_resumen sin SECURITY DEFINER o sin search_path';
  end if;
  if has_function_privilege('anon', 'public.gasto_ia_real_resumen(integer)', 'execute')
     or not has_function_privilege('authenticated', 'public.gasto_ia_real_resumen(integer)', 'execute') then
    raise exception 'FALLO 1: EXECUTE de gasto_ia_real_resumen mal';
  end if;

  -- 2. Auditoría: derivadas sin trigger y en la lista de exclusión; las del dueño, no excluidas
  if exists (select 1 from pg_trigger t where not t.tgisinternal and t.tgname = 'trg_auditoria'
              and t.tgrelid in ('public.openai_uso_diario'::regclass, 'public.openai_costes_diarios'::regclass,
                                'public.tipo_cambio_usd_eur'::regclass)) then
    raise exception 'FALLO 2: una tabla derivada conserva el trigger de auditoría';
  end if;
  for v_def in select pg_get_functiondef(p.oid) from pg_proc p
                where p.pronamespace = 'public'::regnamespace
                  and p.proname in ('instalar_auditoria_panel', 'fn_audit_nueva_tabla') loop
    if position('''openai_uso_diario''' in v_def) = 0 or position('''openai_costes_diarios''' in v_def) = 0
       or position('''openai_claves''' in v_def) > 0 then
      raise exception 'FALLO 2: lista de exclusión de auditoría mal';
    end if;
  end loop;

  -- 3. Mapeos de función → proceso / sub-línea
  if public.ia_proceso_gasto('procesar-factura') <> 'ocr' or public.ia_proceso_gasto('ocr-trabajo') <> 'ocr'
     or public.ia_proceso_gasto('clasificar-productos') <> 'ocr' or public.ia_proceso_gasto('chat-facturas') <> 'chat'
     or public.ia_proceso_gasto('chat-web') <> 'chatweb' or public.ia_proceso_gasto('extraer-vino-foto') <> 'vinos'
     or public.ia_proceso_gasto('traducir-contenido') <> 'otros' or public.ia_proceso_gasto(null) <> 'otros' then
    raise exception 'FALLO 3: ia_proceso_gasto';
  end if;
  if public.ia_grupo_de_funcion('traducir-carta') <> 'traducciones' or public.ia_grupo_de_funcion('format-novedad') <> 'novedades'
     or public.ia_grupo_de_funcion('procesar-dibujo-perimetro') <> 'resto' then
    raise exception 'FALLO 3: ia_grupo_de_funcion';
  end if;

  -- 4. Sin permiso de Facturas: 42501
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated')::text, true);
  begin
    perform * from public.gasto_ia_real_resumen(30);
    raise exception 'FALLO 4: un usuario sin permiso ha leído el resumen';
  exception when insufficient_privilege then null;
  end;

  if v_admin is null then
    raise notice 'sin super admin: se saltan los pasos 5 a 12';
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

  -- 5. Sin proyectos marcados: estimado puro (ultimo_dia_real NULL, 5 procesos)
  insert into public.openai_proyectos (project_id, proceso, nombre) values ('proj_default', null, 'Default project');
  insert into public.openai_costes_diarios (fecha, project_id, line_item, usd) values (v_ayer, 'proj_default', 'x', 50);
  for r in select * from public.gasto_ia_real_resumen(30) loop
    if r.ultimo_dia_real is not null or r.usd_real <> 0 or r.reparto <> 'sin_datos' then
      raise exception 'FALLO 5: sin proyectos marcados debería ser estimado puro (%)', r.proceso;
    end if;
  end loop;
  select count(*) into v_n from public.gasto_ia_real_resumen(30);
  if v_n <> 5 then raise exception 'FALLO 5: se esperaban 5 procesos, hay %', v_n; end if;

  -- 6. UN proyecto del restaurante + Default ajeno + claves: reparto por tokens × tarifa
  update public.openai_proyectos set proceso = 'ajeno' where project_id = 'proj_default';
  insert into public.openai_proyectos (project_id, proceso, nombre) values
    ('proj_casa', 'otros', 'Casa Tomás'), ('proj_sin', null, 'Sin marcar');
  begin
    insert into public.openai_proyectos (project_id, proceso) values ('proj_mal', 'inventado');
    raise exception 'FALLO 6: se aceptó un proceso de proyecto inválido';
  exception when check_violation then null;
  end;
  insert into public.openai_claves (api_key_id, project_id, nombre, proceso) values
    ('key_ocr', 'proj_casa', 'OPENAI_API_KEY_OCR', 'ocr'),
    ('key_chat', 'proj_casa', 'OPENAI_API_KEY_CHAT', 'chat'),
    ('key_web', 'proj_casa', 'OPENAI_API_KEY_CHATWEB', 'chatweb'),
    ('key_vinos', 'proj_casa', 'OPENAI_API_KEY_VINOS', 'vinos'),
    ('key_gen', 'proj_casa', 'OPENAI_API_KEY', 'otros');
  begin
    insert into public.openai_claves (api_key_id, project_id, proceso) values ('key_mal', 'proj_casa', 'inventado');
    raise exception 'FALLO 6: se aceptó un proceso de clave inválido';
  exception when check_violation then null;
  end;
  -- Tarifa de prueba: 1 $/M input, 0,5 $/M cacheado, 2 $/M output. El uso trae sufijo de fecha.
  insert into public.ia_precios (modelo, usd_por_m_input, usd_por_m_cached, usd_por_m_output)
    values ('zz-test-modelo', 1, 0.5, 2);
  insert into public.openai_uso_diario (fecha, project_id, api_key_id, modelo, input_tokens, cached_tokens, output_tokens, peticiones) values
    (v_ayer, 'proj_casa', 'key_ocr',   'zz-test-modelo-2026-01-01', 3000000, 1000000, 500000, 10),   -- 2 + 0,5 + 1   = 3,5
    (v_ayer, 'proj_casa', 'key_chat',  'zz-test-modelo',            1000000, 0, 0, 20),              -- 1
    (v_ayer, 'proj_casa', 'key_web',   'zz-test-modelo',            500000,  0, 0, 30),              -- 0,5
    (v_ayer, 'proj_casa', 'key_vinos', 'zz-test-modelo',            250000,  0, 0, 5),               -- 0,25
    (v_ayer, 'proj_casa', 'key_gen',   'zz-test-modelo',            250000,  0, 0, 5),               -- 0,25  (total 5,5)
    (v_ayer, 'proj_casa', 'key_desconocida', 'zz-test-modelo',      0, 0, 0, 0),                    -- sin clave en openai_claves → otros
    (v_ayer, 'proj_default', 'key_ajena', 'zz-test-modelo',         99000000, 0, 0, 999);            -- proyecto ajeno: no cuenta
  insert into public.openai_costes_diarios (fecha, project_id, line_item, usd) values
    (v_ayer,     'proj_casa',    'a', 4.40),
    (v_ayer,     'proj_casa',    'b', 1.60),
    (v_anteayer, 'proj_casa',    'a', 5.00),                    -- sin uso ese día: entra en el total y se reparte igual
    (v_ayer,     'proj_default', 'y', 99.00),                   -- ajeno
    (v_ayer,     'proj_sin',     'x', 0.30),                    -- sin marcar → sin_asignar, no suma
    (v_ayer,     '',             '',  0.05),                    -- sin proyecto → sin_asignar
    (v_hoy,      'proj_casa',    'a', 99.00),                   -- día en curso: parcial, se ignora
    (v_ayer - 40, 'proj_casa',   'a', 7.00);                    -- fuera de la ventana de 30 días
  -- Total real del restaurante = 4,40 + 1,60 + 5,00 = 11,00. Pesos (tokens × tarifa): 3,5 : 1 : 0,5 : 0,25 : 0,25 = 5,5
  --   ocr 7,00 · chat 2,00 · chatweb 1,00 · vinos 0,50 · otros 0,50
  select coalesce(sum(usd_real), 0) into v_suma
    from public.gasto_ia_real_resumen(30) where proceso in ('ocr', 'chat', 'chatweb', 'vinos', 'otros');
  if v_suma <> 11.00 then raise exception 'FALLO 6: la suma por procesos (%) no es el total real exacto 11,00', v_suma; end if;
  for r in select * from public.gasto_ia_real_resumen(30) where proceso not like 'otros:%' loop
    if r.ultimo_dia_real <> v_ayer then raise exception 'FALLO 6: ultimo_dia_real % (se esperaba %)', r.ultimo_dia_real, v_ayer; end if;
    if r.reparto <> 'clave_tarifa' then raise exception 'FALLO 6: reparto % (clave_tarifa)', r.reparto; end if;
    if r.proceso = 'ocr'     and r.usd_real <> 7.00 then raise exception 'FALLO 6: ocr % (7.00)', r.usd_real; end if;
    if r.proceso = 'chat'    and r.usd_real <> 2.00 then raise exception 'FALLO 6: chat % (2.00)', r.usd_real; end if;
    if r.proceso = 'chatweb' and r.usd_real <> 1.00 then raise exception 'FALLO 6: chatweb % (1.00)', r.usd_real; end if;
    if r.proceso = 'vinos'   and r.usd_real <> 0.50 then raise exception 'FALLO 6: vinos % (0.50)', r.usd_real; end if;
    if r.proceso = 'otros'   and r.usd_real <> 0.50 then raise exception 'FALLO 6: otros % (0.50)', r.usd_real; end if;
    if r.proceso = 'sin_asignar' and r.usd_real <> 0.35 then raise exception 'FALLO 6: sin_asignar % (0.35)', r.usd_real; end if;
  end loop;
  select count(*) into v_n from public.gasto_ia_real_resumen(30) where proceso not like 'otros:%';
  if v_n <> 6 then raise exception 'FALLO 6: se esperaban 6 filas (5 procesos + sin_asignar), hay %', v_n; end if;
  -- p_dias = 1: la ventana es solo el último día cerrado → total 6,00 (4,40 + 1,60), mismos pesos
  select coalesce(sum(usd_real), 0) into v_suma
    from public.gasto_ia_real_resumen(1) where proceso in ('ocr', 'chat', 'chatweb', 'vinos', 'otros');
  if v_suma <> 6.00 then raise exception 'FALLO 6: con p_dias = 1 el total es % (6,00)', v_suma; end if;

  -- 7. Estimado de lo que OpenAI aún no ha publicado (hoy) y sub-líneas de «otros»
  insert into public.ia_uso (funcion, modelo, coste_usd, created_at) values
    ('procesar-factura',   'gpt-5.6-luna', 0.500, now()),
    ('extraer-vino-foto',  'gpt-4.1',      0.250, now()),
    ('traducir-contenido', 'gpt-4.1-mini', 0.100, now()),
    ('traducir-contenido', 'gpt-4.1-mini', 3.000, ((v_ayer)::timestamp at time zone 'utc')),  -- ayer: ventana real
    ('format-novedad',     'gpt-4o-mini',  1.000, ((v_ayer)::timestamp at time zone 'utc')),
    ('ocr-trabajo',        'gpt-5.6-luna', 3.000, ((v_ayer)::timestamp at time zone 'utc'));  -- ayer: no es «hoy»
  insert into public.chat_web_uso (session_id, estado, coste_usd, created_at) values
    ('s1', 'ok', 0.125, now()), ('s2', 'rechazado', 9, now()), ('s3', 'reservado', 9, now());
  for r in select * from public.gasto_ia_real_resumen(30) where proceso not like 'otros:%' loop
    if r.proceso = 'ocr'     and r.usd_estimado_hoy <> 0.5   then raise exception 'FALLO 7: hoy ocr %', r.usd_estimado_hoy; end if;
    if r.proceso = 'vinos'   and r.usd_estimado_hoy <> 0.25  then raise exception 'FALLO 7: hoy vinos %', r.usd_estimado_hoy; end if;
    if r.proceso = 'chatweb' and r.usd_estimado_hoy <> 0.125 then raise exception 'FALLO 7: hoy chatweb % (solo ok/error)', r.usd_estimado_hoy; end if;
    if r.proceso = 'otros'   and r.usd_estimado_hoy <> 0.1   then raise exception 'FALLO 7: hoy otros %', r.usd_estimado_hoy; end if;
    if r.proceso = 'chat'    and r.usd_estimado_hoy <> 0     then raise exception 'FALLO 7: hoy chat %', r.usd_estimado_hoy; end if;
  end loop;
  -- Sub-líneas de otros (real 0,50): traducciones 3,0 vs novedades 1,0 → 0,375 / 0,125 ; suman el real de otros
  select coalesce(sum(usd_real), 0) into v_suma from public.gasto_ia_real_resumen(30) where proceso like 'otros:%';
  if v_suma <> 0.50 then raise exception 'FALLO 7: las sub-líneas de otros suman % (0,50)', v_suma; end if;
  if (select usd_real from public.gasto_ia_real_resumen(30) where proceso = 'otros:traducciones') <> 0.375
     or (select usd_real from public.gasto_ia_real_resumen(30) where proceso = 'otros:novedades') <> 0.125 then
    raise exception 'FALLO 7: reparto de las sub-líneas de otros';
  end if;
  if (select usd_estimado_hoy from public.gasto_ia_real_resumen(30) where proceso = 'otros:traducciones') <> 0.1 then
    raise exception 'FALLO 7: hoy de otros:traducciones';
  end if;

  -- 8. Falta una tarifa: reparto a partes iguales por PETICIONES; la suma sigue siendo el total
  insert into public.openai_uso_diario (fecha, project_id, api_key_id, modelo, input_tokens, peticiones)
    values (v_ayer, 'proj_casa', 'key_web', 'zz-modelo-sin-tarifa', 1000, 60);
  -- peticiones: ocr 10 · chat 20 · chatweb 30+60 = 90 · vinos 5 · otros 5 + 0 = 5 (total 130)
  select coalesce(sum(usd_real), 0) into v_suma
    from public.gasto_ia_real_resumen(30) where proceso in ('ocr', 'chat', 'chatweb', 'vinos', 'otros');
  if v_suma <> 11.00 then raise exception 'FALLO 8: la suma por procesos (%) no es 11,00', v_suma; end if;
  select * into r from public.gasto_ia_real_resumen(30) where proceso = 'chatweb';
  if r.reparto <> 'clave_peticiones' then raise exception 'FALLO 8: reparto % (clave_peticiones)', r.reparto; end if;
  if round(r.usd_real, 4) <> round(11.00 * 90 / 130, 4) then raise exception 'FALLO 8: chatweb % por peticiones', r.usd_real; end if;
  delete from public.openai_uso_diario where modelo = 'zz-modelo-sin-tarifa';

  -- 9. Sin uso por clave: cada proyecto se queda con su proceso (comportamiento anterior)
  delete from public.openai_uso_diario;
  update public.openai_proyectos set proceso = 'ocr' where project_id = 'proj_casa';
  insert into public.openai_proyectos (project_id, proceso, nombre) values ('proj_chat', 'chat', 'Chat');
  insert into public.openai_costes_diarios (fecha, project_id, line_item, usd) values (v_ayer, 'proj_chat', 'x', 2.00);
  select * into r from public.gasto_ia_real_resumen(30) where proceso = 'ocr';
  if r.reparto <> 'proyecto' or r.usd_real <> 11.00 then raise exception 'FALLO 9: ocr % / %', r.usd_real, r.reparto; end if;
  if (select usd_real from public.gasto_ia_real_resumen(30) where proceso = 'chat') <> 2.00 then
    raise exception 'FALLO 9: chat por proyecto';
  end if;
  select coalesce(sum(usd_real), 0) into v_suma
    from public.gasto_ia_real_resumen(30) where proceso in ('ocr', 'chat', 'chatweb', 'vinos', 'otros');
  if v_suma <> 13.00 then raise exception 'FALLO 9: la suma por procesos (%) no es 13,00', v_suma; end if;

  -- 10. RLS real: un usuario normal no lee ni escribe las tablas nuevas
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.openai_uso_diario;
  if v_n <> 0 then raise exception 'FALLO 10: un usuario normal ve el uso (%)', v_n; end if;
  select count(*) into v_n from public.openai_claves;
  if v_n <> 0 then raise exception 'FALLO 10: un usuario normal ve las claves (%)', v_n; end if;
  begin
    insert into public.openai_claves (api_key_id, project_id) values ('k', 'p');
    raise exception 'FALLO 10: un usuario normal ha escrito claves';
  exception when insufficient_privilege then null;
  end;
  reset role;
end;
$$;

select 'openai_gasto_por_clave_test: OK' as resultado;
rollback;
