set client_encoding = 'UTF8';
-- Test de 20261115300000_facturas_decision_periodo_largo. BEGIN … ROLLBACK: no deja nada escrito.
-- Acaba en «facturas_decision_periodo_largo_test: OK».
--   supabase db query --linked -f supabase/tests/facturas_decision_periodo_largo_test.sql
--
--   T1 sigue SECURITY DEFINER, sin anon, y sin permiso de Facturas da 42501.
--   T2 (con un usuario del panel con permiso, si hay sesión; con los datos de la demo):
--      · un mes con meses completos anteriores: modo «anteriores», compara el mes entero;
--      · el año de los datos sin meses completos anteriores: modo «ultimo_mes», compara
--        su último mes completo con la media de los anteriores del propio año, y alguna
--        familia trae referencia (antes salían todas sin comparar);
--      · «Todo» (sin desde): periodo.desde = el primer documento, no el mes en curso.
begin;

do $$
declare
  v_r    jsonb;
  v_ok   boolean := false;
  v_err  text;
  v_min  date;
  v_ini  date;
  v_mes  date;
  rec    record;
begin
  -- T1 ─────────────────────────────────────────────────────────────────────
  if has_function_privilege('anon', 'public.facturas_decision(date,date,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.facturas_decision(date,date,text)', 'execute')
     or not (select prosecdef from pg_proc where oid = 'public.facturas_decision(date,date,text)'::regprocedure) then
    raise exception 'FALLO T1: permisos o SECURITY DEFINER de facturas_decision';
  end if;
  perform set_config('request.jwt.claims', '{"role": "authenticated"}', true);
  set local role authenticated;
  begin
    perform public.facturas_decision(null, null, null);
    v_err := null;
  exception when others then
    v_err := sqlstate;
  end;
  reset role;
  if coalesce(v_err, '') <> '42501' then
    raise exception 'FALLO T1: sin permiso de Facturas no da 42501 (%)', v_err;
  end if;

  -- T2 ─────────────────────────────────────────────────────────────────────
  for rec in select s.user_id, s.id from auth.sessions s order by s.updated_at desc nulls last limit 30 loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', rec.user_id, 'session_id', rec.id, 'role', 'authenticated')::text, true);
    set local role authenticated;
    v_ok := public.can_read_section('facturas');
    reset role;
    if v_ok then exit; end if;
  end loop;
  if not v_ok then
    raise notice 'T2 sin sesión con permiso de Facturas: se salta';
  else
    select min(fecha) into v_min from facturas;
    -- El primer año con meses completos sin nada completo antes: el del primer mes no incompleto.
    select min(date_trunc('month', f.fecha))::date into v_mes
      from facturas f
     where not (date_trunc('month', f.fecha)::date = any(select mes from public.meses_compras_incompletos(null)));
    v_ini := date_trunc('year', v_mes)::date;

    set local role authenticated;
    -- «Todo»
    v_r := public.facturas_decision(null, null, null);
    if (v_r -> 'periodo' ->> 'desde')::date <> v_min then
      raise exception 'FALLO T2: «Todo» empieza el % (esperado el primer documento, %)', v_r -> 'periodo' ->> 'desde', v_min;
    end if;
    -- Año del primer mes completo (en la demo, 2026)
    v_r := public.facturas_decision(v_ini, (v_ini + interval '1 year - 1 day')::date, null);
    reset role;
    if v_r -> 'periodo' -> 'comparado' ->> 'modo' is distinct from 'ultimo_mes' then
      raise exception 'FALLO T2: el año % no compara su último mes completo: %', v_ini, v_r -> 'periodo' -> 'comparado';
    end if;
    if jsonb_array_length(v_r -> 'referencia' -> 'meses') = 0
       or not exists (select 1 from jsonb_array_elements(v_r -> 'familias') x where x ->> 'referencia' is not null) then
      raise exception 'FALLO T2: el año % sigue sin referencia: % / %', v_ini, v_r -> 'referencia', v_r -> 'familias' -> 0;
    end if;
    if (v_r -> 'referencia' ->> 'hasta')::date >= (v_r -> 'periodo' -> 'comparado' ->> 'desde')::date then
      raise exception 'FALLO T2: la referencia se solapa con el mes comparado: % / %', v_r -> 'referencia', v_r -> 'periodo' -> 'comparado';
    end if;
    -- Un mes con meses completos antes: como siempre.
    v_mes := (v_r -> 'periodo' -> 'comparado' ->> 'desde')::date;
    set local role authenticated;
    v_r := public.facturas_decision(v_mes, (v_mes + interval '1 month - 1 day')::date, null);
    reset role;
    if v_r -> 'periodo' -> 'comparado' ->> 'modo' <> 'anteriores'
       or (v_r -> 'periodo' -> 'comparado' ->> 'desde')::date <> v_mes
       or jsonb_array_length(v_r -> 'referencia' -> 'meses') = 0 then
      raise exception 'FALLO T2: el mes % no compara con sus meses anteriores: %', v_mes, v_r -> 'periodo';
    end if;
  end if;

  raise notice 'facturas_decision_periodo_largo_test: OK';
end;
$$;

rollback;
select 'facturas_decision_periodo_largo_test: OK' as resultado;
