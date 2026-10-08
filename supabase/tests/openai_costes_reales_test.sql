set client_encoding = 'UTF8';
-- Test de 20261008150000_openai_costes_reales. BEGIN … ROLLBACK: no deja nada
-- escrito (borra y reinserta datos de prueba DENTRO de la transacción). Acaba
-- en «openai_costes_reales_test: OK».
--   npx supabase db query --linked -f supabase/tests/openai_costes_reales_test.sql
begin;

do $$
declare
  v_admin   uuid := (select user_id from public.super_admins limit 1);
  v_hoy     date := (now() at time zone 'utc')::date;
  v_ayer    date := (now() at time zone 'utc')::date - 1;
  v_anteayer date := (now() at time zone 'utc')::date - 2;
  v_est_antes jsonb;
  v_est_desp  jsonb;
  r record;
  v_n integer;
begin
  -- 1. Objetos, RLS y privilegios
  if to_regclass('public.openai_costes_diarios') is null or to_regclass('public.openai_proyectos') is null
     or to_regclass('public.tipo_cambio_usd_eur') is null then
    raise exception 'FALLO 1: faltan tablas';
  end if;
  if exists (select 1 from pg_class where oid in ('public.openai_costes_diarios'::regclass,
       'public.openai_proyectos'::regclass, 'public.tipo_cambio_usd_eur'::regclass) and not relrowsecurity) then
    raise exception 'FALLO 1: una tabla sin RLS';
  end if;
  if has_table_privilege('anon', 'public.openai_costes_diarios', 'select')
     or has_table_privilege('authenticated', 'public.openai_costes_diarios', 'insert')
     or has_table_privilege('authenticated', 'public.openai_proyectos', 'update')
     or has_table_privilege('authenticated', 'public.tipo_cambio_usd_eur', 'delete') then
    raise exception 'FALLO 1: privilegios de tabla demasiado amplios';
  end if;
  if not has_table_privilege('service_role', 'public.openai_costes_diarios', 'insert') then
    raise exception 'FALLO 1: service_role no puede escribir';
  end if;
  if not exists (select 1 from pg_proc where oid = 'public.gasto_ia_real_resumen(integer)'::regprocedure
                  and prosecdef and proconfig::text like '%search_path=public%') then
    raise exception 'FALLO 1: gasto_ia_real_resumen sin SECURITY DEFINER o sin search_path';
  end if;
  if has_function_privilege('anon', 'public.gasto_ia_real_resumen(integer)', 'execute')
     or has_function_privilege('anon', 'public.tipo_cambio_usd_eur_actual()', 'execute')
     or has_function_privilege('authenticated', 'public.openai_despachar_sincronizacion_costes()', 'execute') then
    raise exception 'FALLO 1: EXECUTE demasiado amplio';
  end if;
  if not has_function_privilege('authenticated', 'public.gasto_ia_real_resumen(integer)', 'execute') then
    raise exception 'FALLO 1: authenticated no puede ejecutar gasto_ia_real_resumen';
  end if;

  -- 2. Cron
  select count(*) into v_n from cron.job where jobname = 'sincronizar-costes-openai' and schedule = '7 */6 * * *';
  if v_n <> 1 then raise exception 'FALLO 2: cron sincronizar-costes-openai ausente o con otra frecuencia'; end if;

  -- 3. Mapeo de funciones de ia_uso a proceso
  if public.ia_proceso_de_funcion('procesar-factura') <> 'ocr' or public.ia_proceso_de_funcion('ocr-trabajo') <> 'ocr'
     or public.ia_proceso_de_funcion('clasificar-productos') <> 'ocr' or public.ia_proceso_de_funcion('chat-facturas') <> 'chat'
     or public.ia_proceso_de_funcion('chat-web') <> 'otros' or public.ia_proceso_de_funcion(null) <> 'otros' then
    raise exception 'FALLO 3: ia_proceso_de_funcion';
  end if;

  -- 4. Sin permiso de Facturas: 42501 en las dos RPC
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated')::text, true);
  begin
    perform * from public.gasto_ia_real_resumen(30);
    raise exception 'FALLO 4: un usuario sin permiso ha leído el resumen';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.tipo_cambio_usd_eur_actual();
    raise exception 'FALLO 4: un usuario sin permiso ha leído el tipo de cambio';
  exception when insufficient_privilege then null;
  end;

  if v_admin is null then
    raise notice 'sin super admin: se saltan los pasos 5 a 8';
    return;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);

  -- 5. Sin datos reales: ultimo_dia_real NULL, los tres procesos con 0 real
  delete from public.openai_costes_diarios;
  delete from public.openai_proyectos;
  delete from public.tipo_cambio_usd_eur;
  select jsonb_object_agg(proceso, usd_estimado_hoy) into v_est_antes from public.gasto_ia_real_resumen(30);
  for r in select * from public.gasto_ia_real_resumen(30) loop
    if r.ultimo_dia_real is not null or r.usd_real <> 0 then
      raise exception 'FALLO 5: sin datos reales debería ser NULL/0 (%)', r.proceso;
    end if;
  end loop;
  select count(*) into v_n from public.gasto_ia_real_resumen(30);
  if v_n <> 3 then raise exception 'FALLO 5: se esperaban 3 procesos, hay %', v_n; end if;

  -- 6. Con datos reales: mapeo por proyecto, día cerrado, proyecto sin proceso
  insert into public.openai_proyectos (project_id, proceso, nombre) values
    ('proj_ocr', 'ocr', 'OCR'), ('proj_chat', 'chat', 'Chat'), ('proj_otros', 'otros', 'Resto'), ('proj_sin', null, null);
  begin
    insert into public.openai_proyectos (project_id, proceso) values ('proj_mal', 'inventado');
    raise exception 'FALLO 6: se aceptó un proceso inválido';
  exception when check_violation then null;
  end;
  insert into public.openai_costes_diarios (fecha, project_id, line_item, usd) values
    (v_ayer,     'proj_ocr',   'gpt-5.6-luna, input',  1.50),
    (v_ayer,     'proj_ocr',   'gpt-5.6-luna, output', 0.50),
    (v_ayer,     'proj_chat',  'gpt-4.1-mini, input',  1.00),
    (v_ayer,     'proj_otros', 'gpt-4.1-mini, input',  0.25),
    (v_ayer,     'proj_sin',   'x',                    0.10),
    (v_ayer,     '',           '',                     0.05),
    (v_anteayer, 'proj_ocr',   'gpt-5.6-luna, input',  1.00),
    (v_hoy,      'proj_ocr',   'gpt-5.6-luna, input', 99.00),      -- día en curso: parcial, se ignora
    (v_ayer - 40, 'proj_ocr',  'gpt-5.6-luna, input',  7.00);      -- fuera de la ventana de 30 días

  select jsonb_object_agg(proceso, usd_estimado_hoy) into v_est_antes from public.gasto_ia_real_resumen(30);
  for r in select * from public.gasto_ia_real_resumen(30) loop
    if r.ultimo_dia_real <> v_ayer then raise exception 'FALLO 6: ultimo_dia_real % (se esperaba %)', r.ultimo_dia_real, v_ayer; end if;
    if r.proceso = 'ocr'          and r.usd_real <> 3.00 then raise exception 'FALLO 6: ocr % (3.00)', r.usd_real; end if;
    if r.proceso = 'chat'         and r.usd_real <> 1.00 then raise exception 'FALLO 6: chat % (1.00)', r.usd_real; end if;
    if r.proceso = 'otros'        and r.usd_real <> 0.25 then raise exception 'FALLO 6: otros % (0.25)', r.usd_real; end if;
    if r.proceso = 'sin_asignar'  and r.usd_real <> 0.15 then raise exception 'FALLO 6: sin_asignar % (0.15)', r.usd_real; end if;
  end loop;
  select count(*) into v_n from public.gasto_ia_real_resumen(30);
  if v_n <> 4 then raise exception 'FALLO 6: se esperaban 4 filas (ocr, chat, otros, sin_asignar), hay %', v_n; end if;
  if (select usd_real from public.gasto_ia_real_resumen(1) where proceso = 'ocr') <> 2.00 then
    raise exception 'FALLO 6: con p_dias = 1 solo cuenta el último día cerrado';
  end if;

  -- 7. Estimación de lo que OpenAI aún no ha publicado: ia_uso de hoy (UTC)
  insert into public.ia_uso (funcion, modelo, coste_usd, created_at) values
    ('procesar-factura', 'gpt-5.6-luna', 0.500, now()),
    ('chat-facturas',    'gpt-4.1-mini', 0.250, now()),
    ('chat-web',         'gpt-4.1-mini', 0.125, now()),
    ('ocr-trabajo',      'gpt-5.6-luna', 3.000, ((v_ayer)::timestamp at time zone 'utc'));  -- ayer: ya es «real», no se cuenta
  select jsonb_object_agg(proceso, usd_estimado_hoy) into v_est_desp from public.gasto_ia_real_resumen(30);
  if (v_est_desp ->> 'ocr')::numeric - (v_est_antes ->> 'ocr')::numeric <> 0.5
     or (v_est_desp ->> 'chat')::numeric - (v_est_antes ->> 'chat')::numeric <> 0.25
     or (v_est_desp ->> 'otros')::numeric - (v_est_antes ->> 'otros')::numeric <> 0.125 then
    raise exception 'FALLO 7: estimado % -> %', v_est_antes, v_est_desp;
  end if;

  -- 8. Tipo de cambio
  select * into r from public.tipo_cambio_usd_eur_actual();
  if r.eur_por_usd <> 0.92 or r.fuente <> 'por_defecto' then raise exception 'FALLO 8: sin filas debe dar 0,92 por_defecto'; end if;
  insert into public.tipo_cambio_usd_eur (fecha, eur_por_usd, fuente) values (v_anteayer, 0.91, 'bce'), (v_ayer, 0.89, 'bce');
  select * into r from public.tipo_cambio_usd_eur_actual();
  if r.eur_por_usd <> 0.89 or r.fecha <> v_ayer then raise exception 'FALLO 8: debe dar el último (0,89)'; end if;
  begin
    insert into public.tipo_cambio_usd_eur (fecha, eur_por_usd) values (v_hoy, 0);
    raise exception 'FALLO 8: se aceptó un tipo de cambio 0';
  exception when check_violation then null;
  end;

  -- 9. RLS real: un usuario normal no lee ni escribe las tablas
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.openai_costes_diarios;
  if v_n <> 0 then raise exception 'FALLO 9: un usuario normal ve costes (%)', v_n; end if;
  begin
    insert into public.openai_costes_diarios (fecha, usd) values (v_hoy, 1);
    raise exception 'FALLO 9: un usuario normal ha escrito costes';
  exception when insufficient_privilege then null;
  end;
  reset role;
end;
$$;

select 'openai_costes_reales_test: OK' as resultado;
rollback;
