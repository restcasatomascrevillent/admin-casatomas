set client_encoding = 'UTF8';
-- Test de 20261207150000_coste_carta_vinos contra la base de verdad (con volumen_linea,
-- unidad_agente, envase_texto y pg_trgm reales). Solo LEE: comprueba que lo que devuelve
-- cuadra consigo mismo y con margenes_carta_datos. Acaba en «coste_carta_vinos_test: OK».
--   npx supabase db query --remote=sfonaclosuafvlhutkon -f supabase/tests/coste_carta_vinos_test.sql
-- (La lógica, caso a caso, en PGlite: npm run test:coste-carta-vinos:db.)
--
--   T1 permisos: la función interna no es del panel; anon no entra en ninguna.
--   T2 una fila por vino de margenes_carta_datos, y el resumen suma el total.
--   T3 coste efectivo: con botellas sin cargo es menor que el de la factura y vale
--      total pagado ÷ (pagadas + sin cargo); sin ellas, es el de la factura.
--   T4 estado: «revisar» (otro formato) no trae multiplicador; «bajo» está por debajo
--      del mínimo y trae precio sugerido mayor que el de carta; «bien» no.
--   T5 el chat (margenes_carta_agente) da el mismo coste y la misma cuenta.
--   T6 con 12 meses hay al menos tantas facturas por vino como con la última.
begin;

do $$
declare
  d jsonb; m jsonb; d12 jsonb; a jsonb; r record; v_min numeric; n int;
begin
  -- T1 ────────────────────────────────────────────────────────────────
  if has_function_privilege('authenticated', 'public.vinos_coste_carta_datos(date,integer,jsonb)', 'execute')
     or has_function_privilege('anon', 'public.vinos_coste_carta(date,integer)', 'execute')
     or has_function_privilege('anon', 'public.vinos_coste_candidatos(text,integer)', 'execute')
     or has_function_privilege('authenticated', 'public.margenes_carta_agente(text,text,boolean,integer)', 'execute') then
    raise exception 'FALLO T1: permisos de más';
  end if;
  if not has_function_privilege('authenticated', 'public.vinos_coste_carta(date,integer)', 'execute') then
    raise exception 'FALLO T1: el panel no puede llamar a vinos_coste_carta';
  end if;

  m := public.margenes_carta_datos(current_date);
  d := public.vinos_coste_carta_datos(current_date, null, m);
  v_min := (d #>> '{config,multiplicador_min_vino}')::numeric;

  -- T2 ────────────────────────────────────────────────────────────────
  if jsonb_array_length(d -> 'vinos') <> jsonb_array_length(m -> 'vinos') then
    raise exception 'FALLO T2: % vinos frente a % en margenes_carta_datos', jsonb_array_length(d -> 'vinos'), jsonb_array_length(m -> 'vinos');
  end if;
  if (d #>> '{resumen,total}')::int <> (d #>> '{resumen,con_coste}')::int + (d #>> '{resumen,sin_coste}')::int
       + (d #>> '{resumen,dudosos}')::int + (d #>> '{resumen,revisar}')::int then
    raise exception 'FALLO T2: el resumen no suma el total: %', d -> 'resumen';
  end if;
  if (d #>> '{resumen,sin_coste}')::int <> (d #>> '{resumen,sin_enlazar}')::int + (d #>> '{resumen,sin_compra}')::int + (d #>> '{resumen,sin_precio}')::int then
    raise exception 'FALLO T2: sin_coste no cuadra: %', d -> 'resumen';
  end if;

  -- T3 y T4 ───────────────────────────────────────────────────────────
  for r in
    select e ->> 'nombre' as nombre, e ->> 'estado' as estado, (e ->> 'precio')::numeric as precio,
           (e ->> 'coste_factura')::numeric as cf, (e ->> 'coste_efectivo')::numeric as ce,
           (e ->> 'botellas_pagadas')::numeric as pag, coalesce((e ->> 'botellas_sin_cargo')::numeric, 0) as gratis,
           (e ->> 'importe_pagado')::numeric as importe, (e ->> 'litros')::numeric as litros,
           coalesce((e ->> 'litros_producto')::numeric, 0.75) as litros_p,
           (e ->> 'multiplicador')::numeric as mult, (e ->> 'precio_sugerido')::numeric as sugerido,
           (e ->> 'venta')::numeric as venta
      from jsonb_array_elements(d -> 'vinos') e
  loop
    if r.gratis > 0 and r.pag > 0 then
      if not (r.ce < r.cf) then
        raise exception 'FALLO T3: «%» tiene % botellas sin cargo y el efectivo (%) no baja del de factura (%)', r.nombre, r.gratis, r.ce, r.cf;
      end if;
      if abs(r.ce - r.importe / (r.pag + r.gratis) * r.litros / r.litros_p) > 0.001 then
        raise exception 'FALLO T3: «%»: % no es % ÷ (% + %)', r.nombre, r.ce, r.importe, r.pag, r.gratis;
      end if;
    elsif r.cf is not null and r.ce is distinct from r.cf then
      raise exception 'FALLO T3: «%» sin botellas sin cargo y efectivo (%) ≠ factura (%)', r.nombre, r.ce, r.cf;
    end if;
    if r.estado = 'revisar' and r.mult is not null then
      raise exception 'FALLO T4: «%» es de otro formato y trae multiplicador', r.nombre;
    end if;
    if r.estado = 'bajo' and not (r.mult < v_min and r.sugerido > r.precio and r.venta / r.ce < v_min) then
      raise exception 'FALLO T4: «%» por debajo sin cuadrar: × %, sugerido %, carta %', r.nombre, r.mult, r.sugerido, r.precio;
    end if;
    if r.estado = 'bien' and not (r.mult >= v_min and r.sugerido is null) then
      raise exception 'FALLO T4: «%» bien sin cuadrar: × %', r.nombre, r.mult;
    end if;
    if r.estado in ('sin_enlazar', 'sin_compra', 'sin_precio') and (r.ce is not null or r.mult is not null) then
      raise exception 'FALLO T4: «%» (%) trae coste', r.nombre, r.estado;
    end if;
  end loop;

  -- T5 ────────────────────────────────────────────────────────────────
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  a := public.margenes_carta_agente(null, 'vinos', false, 40);
  if (a #>> '{resumen,vinos,con_coste}')::int <> (d #>> '{resumen,con_coste}')::int
     or (a #>> '{resumen,vinos,por_debajo}')::int <> (d #>> '{resumen,por_debajo}')::int
     or (a #>> '{resumen,vinos,mediana}')::numeric is distinct from (d #>> '{resumen,multiplicador_mediana}')::numeric then
    raise exception 'FALLO T5: el resumen del chat no es el de la pantalla: % / %', a #> '{resumen,vinos}', d -> 'resumen';
  end if;
  select count(*) into n
    from jsonb_array_elements(a -> 'vinos') x
    join jsonb_array_elements(d -> 'vinos') e on e ->> 'nombre' = x ->> 'nombre' and e -> 'precio' = x -> 'precio_carta'
   where (x ->> 'coste_botella')::numeric is distinct from (e ->> 'coste_efectivo')::numeric;
  if n > 0 then
    raise exception 'FALLO T5: % vinos del chat con un coste distinto al de la pantalla', n;
  end if;
  if exists (select 1 from jsonb_array_elements(a -> 'vinos') x where x ->> 'estado' not in ('bien', 'bajo')) then
    raise exception 'FALLO T5: el chat lista sin texto vinos dudosos o de otro formato';
  end if;

  -- T6 ────────────────────────────────────────────────────────────────
  d12 := public.vinos_coste_carta_datos(current_date, 12, m);
  if (d12 ->> 'meses')::int <> 12 then
    raise exception 'FALLO T6: no devuelve el periodo';
  end if;
  select count(*) into n
    from jsonb_array_elements(d -> 'vinos') e
    join jsonb_array_elements(d12 -> 'vinos') f on f ->> 'id' = e ->> 'id'
   where (f ->> 'facturas')::int < (e ->> 'facturas')::int
      or ((e ->> 'coste_factura') is not null and (f ->> 'coste_factura') is distinct from (e ->> 'coste_factura'));
  if n > 0 then
    raise exception 'FALLO T6: % vinos con menos facturas en 12 meses o con otro precio de factura', n;
  end if;
end;
$$;

rollback;
select 'coste_carta_vinos_test: OK' as resultado;
