set client_encoding = 'UTF8';
-- Test de 20261009110000_tope_gasto_ia. BEGIN … ROLLBACK: no deja nada escrito.
-- Acaba en «tope_gasto_ia_test: OK».
--   npx supabase db query --linked -f supabase/tests/tope_gasto_ia_test.sql
begin;

do $$
declare
  v_admin uuid := (select user_id from public.super_admins limit 1);
  v_devuelto numeric;
  v_ok boolean;
begin
  -- 1. Columna y fila única
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'configuracion_facturas'
                    and column_name = 'tope_ia_mes_eur') then
    raise exception 'FALLO 1: falta la columna tope_ia_mes_eur';
  end if;
  if not exists (select 1 from public.configuracion_facturas where id) then
    insert into public.configuracion_facturas (id) values (true);
  end if;
  -- 2. Privilegios: lectura sí, UPDATE directo de la columna no
  if not has_column_privilege('authenticated', 'public.configuracion_facturas', 'tope_ia_mes_eur', 'select') then
    raise exception 'FALLO 2: authenticated no puede leer el tope';
  end if;
  if has_column_privilege('authenticated', 'public.configuracion_facturas', 'tope_ia_mes_eur', 'update') then
    raise exception 'FALLO 2: authenticated puede escribir el tope sin pasar por la RPC';
  end if;
  -- 3. RPC: SECURITY DEFINER con search_path; anon no ejecuta
  if exists (select 1 from pg_proc where oid in ('public.fijar_tope_ia_mes(numeric)'::regprocedure,
                                                  'public.openai_sincronizar_ahora()'::regprocedure)
              and not (prosecdef and proconfig::text like '%search_path=public%')) then
    raise exception 'FALLO 3: RPC sin SECURITY DEFINER o sin search_path';
  end if;
  if has_function_privilege('anon', 'public.fijar_tope_ia_mes(numeric)', 'execute')
     or has_function_privilege('anon', 'public.openai_sincronizar_ahora()', 'execute') then
    raise exception 'FALLO 3: anon puede ejecutar las RPC';
  end if;
  -- 4. Sin sesión de super admin las dos RPC se niegan (42501)
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  v_ok := false;
  begin
    perform public.fijar_tope_ia_mes(7);
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'FALLO 4: fijar_tope_ia_mes aceptó a un no super admin'; end if;
  v_ok := false;
  begin
    perform public.openai_sincronizar_ahora();
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'FALLO 4: openai_sincronizar_ahora aceptó a un no super admin'; end if;
  -- 5. Super admin: fija, valida rangos y redondea
  if v_admin is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    v_devuelto := public.fijar_tope_ia_mes(12.345);
    if v_devuelto not in (12.34, 12.35) then
      raise exception 'FALLO 5: el tope no se redondea a 2 decimales (%)', v_devuelto;
    end if;
    if (select tope_ia_mes_eur from public.configuracion_facturas where id) <> v_devuelto then
      raise exception 'FALLO 5: el tope no se ha guardado';
    end if;
    v_ok := false;
    begin
      perform public.fijar_tope_ia_mes(0);
    exception when invalid_parameter_value then v_ok := true;
    end;
    if not v_ok then raise exception 'FALLO 5: aceptó un tope de 0'; end if;
    v_ok := false;
    begin
      perform public.fijar_tope_ia_mes(null);
    exception when invalid_parameter_value then v_ok := true;
    end;
    if not v_ok then raise exception 'FALLO 5: aceptó un tope nulo'; end if;
  end if;
  -- 6. La columna rechaza valores fuera de rango
  v_ok := false;
  begin
    update public.configuracion_facturas set tope_ia_mes_eur = -1 where id;
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'FALLO 6: la columna acepta un tope negativo'; end if;
end;
$$;

rollback;

select 'tope_gasto_ia_test: OK' as resultado;
