set client_encoding = 'UTF8';
-- Test de 20261008110000_ia_funciones_ocr_instrumentado. BEGIN … ROLLBACK: no
-- deja nada escrito. Acaba en «ia_funciones_ocr_instrumentado_test: OK».
--   npx supabase db query --linked -f supabase/tests/ia_funciones_ocr_instrumentado_test.sql
begin;

do $$
declare
  v_admin uuid := (select user_id from public.super_admins limit 1);
  v_antes record;
  v_despues record;
  v_chat_antes bigint;
  v_chat_despues bigint;
  v_err text;
begin
  -- 1. Catálogo
  if not exists (select 1 from public.ia_funciones where funcion = 'procesar-factura' and instrumentada) then
    raise exception 'FALLO 1: procesar-factura no está instrumentada';
  end if;
  if not exists (select 1 from public.ia_funciones where funcion = 'ocr-trabajo' and instrumentada and unidad = 'documento') then
    raise exception 'FALLO 1: falta ocr-trabajo';
  end if;

  -- 2. Privilegios: SECURITY DEFINER, search_path fijo, anon sin EXECUTE
  if not exists (select 1 from pg_proc where oid = 'public.gasto_ia_resumen(text[],integer)'::regprocedure
                  and prosecdef and proconfig::text like '%search_path=public%') then
    raise exception 'FALLO 2: gasto_ia_resumen sin SECURITY DEFINER o sin search_path';
  end if;
  if has_function_privilege('anon', 'public.gasto_ia_resumen(text[],integer)', 'execute') then
    raise exception 'FALLO 2: anon puede ejecutar gasto_ia_resumen';
  end if;
  if not has_function_privilege('authenticated', 'public.gasto_ia_resumen(text[],integer)', 'execute') then
    raise exception 'FALLO 2: authenticated no puede ejecutar gasto_ia_resumen';
  end if;

  -- 3. Sin permiso de Facturas: 42501
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated')::text, true);
  begin
    perform * from public.gasto_ia_resumen(null, 30);
    raise exception 'FALLO 3: un usuario sin permiso ha leído el resumen';
  exception when insufficient_privilege then
    get stacked diagnostics v_err = message_text;
  end;

  -- 4. Agregados: 2 documentos OCR (uno en dos funciones) y 1 pregunta
  if v_admin is null then
    raise notice 'sin super admin: se salta el paso 4';
    return;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  select coalesce(max(documentos_ocr), 0) as d into v_antes from public.gasto_ia_resumen(null, 30);
  select coalesce(sum(unidades), 0) into v_chat_antes from public.gasto_ia_resumen(array['chat-facturas'], 30);

  perform public.ia_registrar_uso('ocr-trabajo', 'gpt-5.6-luna', 1000, 200, 0, 0, 0, 1, 'vision', 'ok', 'trabajo:test-ia-ocr-1#lectura', 10);
  perform public.ia_registrar_uso('ocr-trabajo', 'gpt-5.6-luna', 1000, 200, 0, 0, 0, 1, 'vision', 'ok', 'trabajo:test-ia-ocr-1#pie', 10);
  perform public.ia_registrar_uso('ocr-trabajo', 'text-embedding-3-small', 50, 0, 0, 0, 0, 1, 'embedding', 'ok', 'trabajo:test-ia-ocr-1#embeddings', 10);
  perform public.ia_registrar_uso('procesar-factura', 'text-embedding-3-small', 50, 0, 0, 0, 0, 1, 'embedding', 'ok', 'trabajo:test-ia-ocr-1#embeddings', 10);
  perform public.ia_registrar_uso('procesar-factura', 'gpt-5.6-luna', 1000, 200, 0, 0, 0, 1, 'vision', 'ok', 'subida:test-ia-ocr-2#lectura', 10);
  perform public.ia_registrar_uso('chat-facturas', 'gpt-4.1-mini', 1000, 200, 0, 0, 0, 2, 'chat', 'ok', 'test-ia-ocr', 10);
  perform public.ia_registrar_uso('chat-facturas', 'text-embedding-3-small', 50, 0, 0, 0, 0, 1, 'embedding', 'ok', 'test-ia-ocr', 10);

  select coalesce(max(documentos_ocr), 0) as d into v_despues from public.gasto_ia_resumen(null, 30);
  if v_despues.d - v_antes.d <> 2 then
    raise exception 'FALLO 4: documentos OCR % -> % (se esperaban +2)', v_antes.d, v_despues.d;
  end if;
  select coalesce(sum(unidades), 0) into v_chat_despues from public.gasto_ia_resumen(array['chat-facturas'], 30);
  if v_chat_despues - v_chat_antes <> 1 then
    raise exception 'FALLO 4: preguntas % -> % (se esperaba +1)', v_chat_antes, v_chat_despues;
  end if;
  if exists (select 1 from public.gasto_ia_resumen(array['chat-web'], 30)) then
    raise exception 'FALLO 4: devuelve funciones fuera de Facturas';
  end if;
end;
$$;

select 'ia_funciones_ocr_instrumentado_test: OK' as resultado;
rollback;
