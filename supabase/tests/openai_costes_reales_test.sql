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

  -- 5-7. (El reparto por proceso del gasto real cambió con 20261009100000_openai_gasto_por_clave:
  --       UN proyecto, reparto por clave y 5 procesos. Esos pasos se prueban ahora en
  --       supabase/tests/openai_gasto_por_clave_test.sql.)
  delete from public.openai_costes_diarios;
  delete from public.openai_proyectos;
  delete from public.tipo_cambio_usd_eur;

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
