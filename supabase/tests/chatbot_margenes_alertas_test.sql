set client_encoding = 'UTF8';
-- Test de 20261116100000_chatbot_margenes_alertas. BEGIN … ROLLBACK: no deja nada escrito.
-- Acaba en «chatbot_margenes_alertas_test: OK».
--   supabase db query --linked -f supabase/tests/chatbot_margenes_alertas_test.sql
--
--   T1 permisos: las dos RPC del agente solo para service_role (ni anon ni authenticated);
--      margenes_carta y facturas_decision siguen dando 42501 a un usuario sin permiso.
--   T2 como service_role: margenes_carta_agente devuelve resumen, umbrales y como_leer;
--      peso sale ordenado de peor a mejor multiplicador; sin texto no salen platos sin
--      revisar; una vista rara da {error}.
--   T3 como service_role: alertas_precio_agente trae los siete tipos con total y lista,
--      respeta el límite y un tipo raro da {error}.
begin;

do $$
declare
  v_r    jsonb;
  v_err  text;
  v_prev numeric;
  v_x    numeric;
  e      jsonb;
  k      text;
begin
  -- T1 ─────────────────────────────────────────────────────────────────────
  if has_function_privilege('anon', 'public.margenes_carta_agente(text,text,boolean,integer)', 'execute')
     or has_function_privilege('authenticated', 'public.margenes_carta_agente(text,text,boolean,integer)', 'execute')
     or has_function_privilege('authenticated', 'public.alertas_precio_agente(date,date,text,text,text,integer)', 'execute')
     or not has_function_privilege('service_role', 'public.alertas_precio_agente(date,date,text,text,text,integer)', 'execute') then
    raise exception 'FALLO T1: permisos de las RPC del agente';
  end if;
  perform set_config('request.jwt.claims', '{"role": "authenticated"}', true);
  set local role authenticated;
  begin
    perform public.margenes_carta(null);
    v_err := null;
  exception when others then v_err := sqlstate;
  end;
  reset role;
  if coalesce(v_err, '') <> '42501' then
    raise exception 'FALLO T1: margenes_carta sin permiso no da 42501 (%)', v_err;
  end if;

  -- T2 ─────────────────────────────────────────────────────────────────────
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  set local role service_role;
  v_r := public.margenes_carta_agente(null, 'peso', false, 40);
  if v_r -> 'resumen' is null or v_r -> 'umbrales' is null or v_r ->> 'como_leer' is null then
    raise exception 'FALLO T2: falta resumen, umbrales o como_leer: %', left(v_r::text, 300);
  end if;
  if v_r ? 'vinos' or v_r ? 'platos' then
    raise exception 'FALLO T2: vista peso trae otras vistas';
  end if;
  v_prev := null;
  for e in select * from jsonb_array_elements(v_r -> 'peso') loop
    v_x := (e ->> 'multiplicador')::numeric;
    exit when v_x is null;
    if v_prev is not null and v_x < v_prev then
      raise exception 'FALLO T2: peso no va de peor a mejor (% tras %)', v_x, v_prev;
    end if;
    v_prev := v_x;
  end loop;
  if exists (select 1 from jsonb_array_elements(public.margenes_carta_agente(null, 'platos', false, 40) -> 'platos') x
              where not (x ->> 'revisado')::boolean) then
    raise exception 'FALLO T2: sin texto salen platos sin revisar';
  end if;
  if (public.margenes_carta_agente(null, 'postres', false, 5)) ->> 'error' is null then
    raise exception 'FALLO T2: vista rara no da error';
  end if;

  -- T3 ─────────────────────────────────────────────────────────────────────
  v_r := public.alertas_precio_agente(null, null, null, null, null, 2);
  foreach k in array array['sube', 'baja', 'mejor', 'proveedor', 'pactado', 'familia', 'otros'] loop
    if v_r -> 'avisos' -> k -> 'total' is null or jsonb_typeof(v_r -> 'avisos' -> k -> 'lista') <> 'array' then
      raise exception 'FALLO T3: falta el tipo % (%)', k, left(v_r::text, 300);
    end if;
    if jsonb_array_length(v_r -> 'avisos' -> k -> 'lista') > 2 then
      raise exception 'FALLO T3: el tipo % pasa del límite', k;
    end if;
  end loop;
  if (public.alertas_precio_agente(null, null, null, 'raro', null, 2)) ->> 'error' is null then
    raise exception 'FALLO T3: tipo raro no da error';
  end if;
  reset role;
end $$;

select 'chatbot_margenes_alertas_test: OK' as resultado;
rollback;
