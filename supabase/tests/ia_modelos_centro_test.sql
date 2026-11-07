set client_encoding = 'UTF8';
-- Test de 20261107500000_ia_modelos_centro. BEGIN … ROLLBACK: no deja nada escrito.
-- Necesita que la lista de modelos se haya cargado al menos una vez (Edge
-- Function ia-modelos-openai). Acaba en «ia_modelos_centro_test: OK».
--   npx supabase db query --linked -f supabase/tests/ia_modelos_centro_test.sql
begin;

do $$
declare
  v_lista jsonb;
  v_r jsonb;
  v_n int;
  v_err text;
  v_en_uso text;
  v_otro uuid;
begin
  -- 1. Objetos, RLS y privilegios
  if to_regclass('public.ia_modelo_funcion') is null or to_regclass('public.ia_modelos_disponibles') is null
     or to_regclass('public.ia_modelo_funcion_historial') is null then
    raise exception 'FALLO 1: faltan tablas';
  end if;
  if exists (select 1 from pg_class where oid in ('public.ia_modelo_funcion'::regclass, 'public.ia_modelos_disponibles'::regclass,
                                                  'public.ia_modelo_funcion_historial'::regclass) and not relrowsecurity) then
    raise exception 'FALLO 1: tabla sin RLS';
  end if;
  if has_table_privilege('anon', 'public.ia_modelo_funcion', 'select')
     or has_table_privilege('authenticated', 'public.ia_modelos_disponibles', 'insert')
     or has_table_privilege('authenticated', 'public.ia_modelo_funcion', 'insert')
     or has_table_privilege('authenticated', 'public.ia_modelo_funcion', 'delete')
     or has_column_privilege('authenticated', 'public.ia_modelo_funcion', 'centralizado', 'update')
     or has_function_privilege('authenticated', 'public.ia_modelos_registrar(jsonb)', 'execute')
     or has_function_privilege('anon', 'public.ia_modelos_centro(integer)', 'execute') then
    raise exception 'FALLO 1: privilegios de más';
  end if;
  if not has_column_privilege('authenticated', 'public.ia_modelo_funcion', 'modelo', 'update') then
    raise exception 'FALLO 1: authenticated (super admin vía RLS) no puede cambiar el modelo';
  end if;
  if not exists (select 1 from pg_policies where tablename = 'notificaciones_dashboard'
                  and policyname = 'notificaciones_ia_modelos_solo_super_admin' and permissive = 'RESTRICTIVE') then
    raise exception 'FALLO 1: falta la política restrictiva de avisos de modelos';
  end if;
  if (select count(*) from cron.job where jobname = 'ia-modelos-openai') <> 1 then
    raise exception 'FALLO 1: el cron ia-modelos-openai no está una vez';
  end if;

  -- 2. Semilla: chat-facturas centralizada, instagram-ia no
  if not exists (select 1 from public.ia_modelo_funcion where funcion = 'chat-facturas' and centralizado)
     or exists (select 1 from public.ia_modelo_funcion where funcion = 'instagram-ia' and centralizado) then
    raise exception 'FALLO 2: semilla de ia_modelo_funcion';
  end if;
  if (select count(*) from public.ia_modelos_disponibles) = 0 then
    raise exception 'FALLO 2: no hay lista de modelos cargada (ejecuta ia-modelos-openai antes)';
  end if;

  -- 3. El trigger valida el modelo
  begin
    update public.ia_modelo_funcion set modelo = 'gpt-no-existe-zz' where funcion = 'clasificar-productos';
    raise exception 'FALLO 3: aceptó un modelo que no está en la cuenta';
  exception when check_violation then null;
  end;
  begin
    update public.ia_modelo_funcion set modelo = 'gpt-4.1-mini' where funcion = 'instagram-ia';
    raise exception 'FALLO 3: aceptó un modelo en una función no centralizada';
  exception when check_violation then null;
  end;
  select count(*) into v_n from public.ia_modelo_funcion_historial where funcion = 'clasificar-productos';
  perform set_config('ia_modelos.cambiado_por', 'test', true);
  update public.ia_modelo_funcion set modelo = (select id from public.ia_modelos_disponibles where retirado_en is null and id like 'gpt-%' order by id limit 1)
   where funcion = 'clasificar-productos';
  if (select count(*) from public.ia_modelo_funcion_historial where funcion = 'clasificar-productos') <> v_n + 1 then
    raise exception 'FALLO 3: el cambio no quedó en el historial';
  end if;
  if (select cambiado_por_email from public.ia_modelo_funcion where funcion = 'clasificar-productos') <> 'test' then
    raise exception 'FALLO 3: no apunta quién lo cambió';
  end if;
  update public.ia_modelo_funcion set notas = 'solo notas' where funcion = 'clasificar-productos';
  if (select count(*) from public.ia_modelo_funcion_historial where funcion = 'clasificar-productos') <> v_n + 1 then
    raise exception 'FALLO 3: cambiar solo las notas no debe historiar';
  end if;

  -- 4. Registrar: lista vacía rechazada
  begin
    perform public.ia_modelos_registrar('[]'::jsonb);
    raise exception 'FALLO 4: aceptó una lista vacía';
  exception when invalid_parameter_value then null;
  end;

  -- 5. Registrar: nuevo modelo, modelo en uso que desaparece, en uso sin precio
  v_en_uso := (select modelo from public.ia_modelo_funcion where funcion = 'clasificar-productos');
  delete from public.ia_precios where modelo = v_en_uso;
  delete from public.notificaciones_dashboard where tipo like 'ia\_modelo%';
  select jsonb_agg(jsonb_build_object('id', id, 'owned_by', owned_by, 'created', extract(epoch from creado_openai)::bigint))
    into v_lista from public.ia_modelos_disponibles where retirado_en is null and id <> v_en_uso;
  v_lista := v_lista || '[{"id":"gpt-99-prueba-test","owned_by":"system","created":1790000000},{"id":"tts-99-prueba","owned_by":"system"}]'::jsonb;
  v_r := public.ia_modelos_registrar(v_lista);
  if not (v_r -> 'nuevos') ? 'gpt-99-prueba-test' or not (v_r -> 'retirados') ? v_en_uso
     or not (v_r -> 'en_uso_no_disponibles') ? v_en_uso or (v_r ->> 'primera_carga')::boolean then
    raise exception 'FALLO 5: resumen inesperado %', v_r;
  end if;
  if not exists (select 1 from public.notificaciones_dashboard where tipo = 'ia_modelo_nuevo' and mensaje like '%gpt-99-prueba-test%' and mensaje not like '%tts-99%') then
    raise exception 'FALLO 5: falta el aviso de modelo nuevo (solo familias de interés)';
  end if;
  if not exists (select 1 from public.notificaciones_dashboard where tipo = 'ia_modelo_retirado' and prioridad = 'alta'
                  and titulo like '%' || v_en_uso and mensaje like '%clasificar-productos%') then
    raise exception 'FALLO 5: falta el aviso de alta prioridad del modelo en uso retirado';
  end if;
  if (select retirado_en from public.ia_modelos_disponibles where id = v_en_uso) is null then
    raise exception 'FALLO 5: no marcó el modelo como retirado';
  end if;
  -- Otra vez igual: no duplica avisos sin leer
  select count(*) into v_n from public.notificaciones_dashboard where tipo like 'ia\_modelo%';
  v_r := public.ia_modelos_registrar(v_lista);
  if (select count(*) from public.notificaciones_dashboard where tipo like 'ia\_modelo%') <> v_n then
    raise exception 'FALLO 5: duplicó avisos';
  end if;
  -- Vuelve: deja de estar retirado y avisa de que no tiene precio
  v_r := public.ia_modelos_registrar(v_lista || jsonb_build_array(jsonb_build_object('id', v_en_uso)));
  if not (v_r -> 'vuelven') ? v_en_uso or not (v_r -> 'en_uso_sin_precio') ? v_en_uso then
    raise exception 'FALLO 5: modelo que vuelve / sin precio: %', v_r;
  end if;
  if not exists (select 1 from public.notificaciones_dashboard where tipo = 'ia_modelo_sin_precio' and titulo like '%' || v_en_uso) then
    raise exception 'FALLO 5: falta el aviso de sin precio';
  end if;

  -- 6. Un usuario que no es super admin no ve nada (ni avisos de modelos)
  v_otro := (select u.id from auth.users u where not exists (select 1 from public.super_admins s where s.user_id = u.id) limit 1);
  if v_otro is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_otro, 'role', 'authenticated')::text, true);
    set local role authenticated;
    if exists (select 1 from public.ia_modelo_funcion) or exists (select 1 from public.ia_modelos_disponibles)
       or exists (select 1 from public.notificaciones_dashboard where tipo like 'ia\_modelo%') then
      raise exception 'FALLO 6: un usuario normal ve datos de modelos';
    end if;
    begin
      update public.ia_modelo_funcion set modelo = null where funcion = 'chat-facturas';
      get diagnostics v_n = row_count;
      if v_n > 0 then raise exception 'FALLO 6: un usuario normal cambió un modelo'; end if;
    exception when insufficient_privilege then null;
    end;
    reset role;
  end if;

  -- 7. Lo que pinta el panel
  v_r := public.ia_modelos_centro(30);
  if jsonb_typeof(v_r -> 'funciones') <> 'array' or jsonb_typeof(v_r -> 'disponibles') <> 'array'
     or jsonb_typeof(v_r -> 'historial') <> 'array' or jsonb_array_length(v_r -> 'funciones') < 5 then
    raise exception 'FALLO 7: ia_modelos_centro %', left(v_r::text, 300);
  end if;
  if not exists (select 1 from jsonb_array_elements(v_r -> 'disponibles') d where d ->> 'id' = 'gpt-99-prueba-test' and (d ->> 'nuevo')::boolean) then
    raise exception 'FALLO 7: el modelo nuevo no sale marcado como nuevo';
  end if;

  raise notice 'ia_modelos_centro_test: OK';
end;
$$;

rollback;
