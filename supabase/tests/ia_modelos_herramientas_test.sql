set client_encoding = 'UTF8';
-- Test de 20261107620000_ia_modelos_herramientas. BEGIN … ROLLBACK: no deja nada escrito.
-- Necesita la lista de modelos cargada (ia-modelos-openai «sincronizar») con
-- gpt-6.1-sol, gpt-6.1-terra y gpt-4.1-mini. Acaba en «ia_modelos_herramientas_test: OK».
--   supabase db query --linked -f supabase/tests/ia_modelos_herramientas_test.sql
--
--   1. Columnas nuevas; el panel (authenticated) no puede tocar usa_herramientas.
--   2. chat-facturas y chat-web usan herramientas; gpt-6.1-sol está marcado incompatible.
--   3. ia_modelo_funcion rechaza gpt-6.1-sol (modelo o respaldo) en chat-facturas y chat-web.
--   4. Sí lo acepta en una función sin herramientas; y un modelo compatible o sin
--      probar sigue valiendo en chat-facturas.
--   5. Un modelo que ya estaba puesto y luego se marca incompatible no bloquea
--      cambiar las notas (no se revalida lo que ya estaba).
--   6. ia_modelos_centro devuelve usa_herramientas y compatible_*.
begin;

do $$
declare
  v_r jsonb;
  v_err text;
  v_ok boolean;
begin
  -- 1
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ia_modelos_disponibles'
                  and column_name = 'compatible_herramientas')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ia_modelos_disponibles'
                  and column_name = 'compatible_motivo')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ia_modelo_funcion'
                  and column_name = 'usa_herramientas') then
    raise exception 'FALLO 1: faltan columnas';
  end if;
  if has_column_privilege('authenticated', 'public.ia_modelo_funcion', 'usa_herramientas', 'update')
     or has_column_privilege('authenticated', 'public.ia_modelos_disponibles', 'compatible_herramientas', 'update') then
    raise exception 'FALLO 1: el panel podría cambiar la compatibilidad';
  end if;

  -- 2
  if (select count(*) from public.ia_modelo_funcion where usa_herramientas) <> 2
     or not (select bool_and(usa_herramientas) from public.ia_modelo_funcion where funcion in ('chat-facturas', 'chat-web')) then
    raise exception 'FALLO 2: usa_herramientas debe ser true solo en chat-facturas y chat-web';
  end if;
  if (select compatible_herramientas from public.ia_modelos_disponibles where id = 'gpt-6.1-sol') is distinct from false then
    raise exception 'FALLO 2: gpt-6.1-sol no está marcado como incompatible';
  end if;

  -- 3
  foreach v_err in array array['chat-facturas:modelo', 'chat-facturas:respaldo', 'chat-web:modelo'] loop
    begin
      if split_part(v_err, ':', 2) = 'modelo' then
        update public.ia_modelo_funcion set modelo = 'gpt-6.1-sol' where funcion = split_part(v_err, ':', 1);
      else
        update public.ia_modelo_funcion set modelo_respaldo = 'gpt-6.1-sol' where funcion = split_part(v_err, ':', 1);
      end if;
      v_ok := true;
    exception when check_violation then
      v_ok := false;
      if sqlerrm not like '%no sirve para%' then
        raise exception 'FALLO 3: mensaje inesperado %', sqlerrm;
      end if;
    end;
    if v_ok then
      raise exception 'FALLO 3: % aceptó gpt-6.1-sol', v_err;
    end if;
  end loop;

  -- 4
  update public.ia_modelo_funcion set modelo = 'gpt-6.1-sol' where funcion = 'procesar-factura';
  if (select modelo from public.ia_modelo_funcion where funcion = 'procesar-factura') <> 'gpt-6.1-sol' then
    raise exception 'FALLO 4: una función sin herramientas debería aceptar gpt-6.1-sol';
  end if;
  update public.ia_modelos_disponibles set compatible_herramientas = true where id = 'gpt-6.1-terra';
  update public.ia_modelos_disponibles set compatible_herramientas = null where id = 'gpt-4.1-mini';
  update public.ia_modelo_funcion set modelo = 'gpt-6.1-terra', modelo_respaldo = 'gpt-4.1-mini' where funcion = 'chat-web';
  if (select modelo from public.ia_modelo_funcion where funcion = 'chat-web') <> 'gpt-6.1-terra' then
    raise exception 'FALLO 4: chat-web debería aceptar un modelo compatible';
  end if;

  -- 5
  update public.ia_modelos_disponibles set compatible_herramientas = false, compatible_motivo = 'test' where id = 'gpt-6.1-terra';
  update public.ia_modelo_funcion set notas = 'test 20261107620000' where funcion = 'chat-web';
  if (select notas from public.ia_modelo_funcion where funcion = 'chat-web') <> 'test 20261107620000' then
    raise exception 'FALLO 5: no deja cambiar las notas';
  end if;

  -- 6
  v_r := public.ia_modelos_centro(30);
  if not exists (select 1 from jsonb_array_elements(v_r -> 'funciones') f
                  where f ->> 'funcion' = 'chat-facturas' and (f ->> 'usa_herramientas')::boolean)
     or not exists (select 1 from jsonb_array_elements(v_r -> 'disponibles') d
                  where d ->> 'id' = 'gpt-6.1-sol' and (d ->> 'compatible_herramientas')::boolean = false
                    and d ->> 'compatible_motivo' like 'OpenAI 400%') then
    raise exception 'FALLO 6: ia_modelos_centro sin los campos nuevos: %', left(v_r::text, 300);
  end if;

  raise notice 'ia_modelos_herramientas_test: OK';
end;
$$;

rollback;
select 'ia_modelos_herramientas_test: OK' as resultado;
