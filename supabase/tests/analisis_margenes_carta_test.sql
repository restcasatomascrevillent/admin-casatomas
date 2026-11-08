set client_encoding = 'UTF8';
-- Test de 20261115200000_analisis_margenes_carta. BEGIN … ROLLBACK: no deja
-- nada escrito. Acaba en «analisis_margenes_carta_test: OK».
--   npx supabase db query --linked -f supabase/tests/analisis_margenes_carta_test.sql
--
--   T1 RLS activada en las 4 tablas con can_*_section ENVUELTO en select; RPC
--      SECURITY DEFINER sin EXECUTE para anon; la interna sin EXECUTE para nadie.
--   T2 coste por conjuntos (margenes_carta_costes, hoy = 30/06/2031): mediana
--      de 90 días en €/kg, sin albaranes facturados ni Touza; €/kg de hace 6
--      meses; vino en €/l → botella de 0,75 l.
--   T3 margenes_carta como usuario del panel con Facturas (si no hay sesiones,
--      se salta): plato de 100 g a 22 € con 100 g a 140 €/kg → venta 20 €,
--      coste 14 €, 70 % → coste_alto + sube_coste (100 → 140 €/kg); vino a
--      30 € con botella de 15 € → 2× → multiplicador_bajo; plato sin
--      escandallo → sin_mapear con su motivo; < 1 s.
--   T4 sin permiso: margenes_carta y margenes_guardar_escandallo dan 42501.
--   T6 «Por peso» (20261115410000): €/kg de carta con y sin IVA, compra €/kg,
--      multiplicador, última compra; los platos por «Unidad» no salen.
--   T5 edición (si el usuario puede editar Facturas): guardar el escandallo lo
--      deja en 'manual' y quita el motivo; revisado; vino sin mapear.
begin;

do $$
declare
  v_mar bigint; v_vin bigint;
  v_pc bigint; v_pv bigint; v_prov bigint;
  v_f bigint; v_f_old bigint; v_alb bigint; v_tz bigint;
  v_n int;
  r record;
  j jsonb; p jsonb; v jsonb;
  rec record; v_ok boolean := false; v_ed boolean := false;
  v_t timestamptz;
begin
  -- T1 ─────────────────────────────────────────────────────────────────────
  select count(*) into v_n from pg_class
   where relnamespace = 'public'::regnamespace and relrowsecurity
     and relname in ('margenes_carta_config', 'escandallo_platos', 'vino_producto', 'margenes_carta_revision');
  if v_n <> 4 then raise exception 'FALLO T1: RLS activada en % de 4 tablas', v_n; end if;
  if exists (select 1 from pg_policies
              where tablename in ('margenes_carta_config', 'escandallo_platos', 'vino_producto', 'margenes_carta_revision')
                and coalesce(qual, with_check) ~* 'can_(read|edit)_section'
                and coalesce(qual, with_check) !~* '\(\s*select\s+can_(read|edit)_section') then
    raise exception 'FALLO T1: hay una política con can_*_section sin envolver en select';
  end if;
  for r in select unnest(array['margenes_carta(date)', 'margenes_guardar_escandallo(text,jsonb)',
                               'margenes_guardar_vino(text,bigint,text)', 'margenes_marcar_revisado(text,text,boolean)',
                               'margenes_guardar_config(jsonb)', 'margenes_buscar_productos(text,integer)',
                               'margenes_compras_producto(bigint,integer)']) as f loop
    if not (select prosecdef from pg_proc where oid = ('public.' || r.f)::regprocedure) then
      raise exception 'FALLO T1: % debería ser SECURITY DEFINER', r.f;
    end if;
    if has_function_privilege('anon', 'public.' || r.f, 'execute') then
      raise exception 'FALLO T1: anon puede ejecutar %', r.f;
    end if;
    if not has_function_privilege('authenticated', 'public.' || r.f, 'execute') then
      raise exception 'FALLO T1: authenticated no puede ejecutar %', r.f;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'public.margenes_carta_costes(bigint[],date,integer)', 'execute') then
    raise exception 'FALLO T1: authenticated puede ejecutar la función interna de costes';
  end if;

  -- Datos ──────────────────────────────────────────────────────────────────
  select id into v_mar from categorias_producto where clave = 'pescado_marisco.marisco';
  select id into v_vin from categorias_producto where clave = 'bebidas.vinos';
  insert into productos_catalogo (nombre, categoria_id, origen) values ('Pruebamarg Percebe', v_mar, 'manual') returning id into v_pc;
  insert into productos_catalogo (nombre, categoria_id, origen) values ('Pruebamarg Tinto 75 cl', v_vin, 'manual') returning id into v_pv;
  insert into proveedores (nombre, cif) values ('PRUEBA MARGENES SL', 'B00000611') returning id into v_prov;
  -- Compra de hace 7 meses: 100 €/kg.
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total)
  values ('factura', 'PRUEBA MARGENES SL', 'B00000611', v_prov, 'MARG-0', '2030-11-20', 220) returning id into v_f_old;
  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, producto_id)
  values (v_f_old, 'PERCEBE GALLEGO', 2, 'kg', 100, 200, v_pc);
  -- Compras de junio de 2031: 130 y 150 €/kg (mediana 140) + vino a 15 €/botella.
  -- (Con el albarán facturado o Touza, a 1000 €/kg, la mediana sería 150.)
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total)
  values ('factura', 'PRUEBA MARGENES SL', 'B00000611', v_prov, 'MARG-1', '2031-06-10', 600) returning id into v_f;
  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, producto_id) values
    (v_f, 'PERCEBE GALLEGO', 2, 'kg', 130, 260, v_pc),
    (v_f, 'PERCEBE GALLEGO', 1, 'kg', 150, 150, v_pc),
    (v_f, 'PRUEBAMARG TINTO 75 CL', 6, 'botella', 15, 90, v_pv);
  -- Albarán ya facturado (no cuenta) y compra de Touza (no cuenta), las dos a 1000 €/kg.
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total)
  values ('albaran', 'PRUEBA MARGENES SL', 'B00000611', v_prov, 'MARG-ALB', '2031-06-12', 1000) returning id into v_alb;
  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, producto_id)
  values (v_alb, 'PERCEBE GALLEGO', 1, 'kg', 1000, 1000, v_pc);
  update facturas set facturado_en_id = v_f, facturado_origen = 'manual' where id = v_alb;
  insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
  values ('factura', 'PRUEBA MARGENES SL', 'B00000611', v_prov, 'MARG-TZ', '2031-06-14', 1000, 'touza') returning id into v_tz;
  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, producto_id)
  values (v_tz, 'PERCEBE GALLEGO', 1, 'kg', 1000, 1000, v_pc);

  -- T2 ─────────────────────────────────────────────────────────────────────
  select * into r from margenes_carta_costes(array[v_pc], '2031-06-30', 90);
  if r.eur_base is distinct from 140 or r.medida is distinct from 'kg' then
    raise exception 'FALLO T2: percebe a % €/% (esperaba 140 €/kg sin albarán facturado ni Touza)', r.eur_base, r.medida;
  end if;
  if r.eur_base_6m is distinct from 100 then
    raise exception 'FALLO T2: hace 6 meses % €/kg (esperaba 100)', r.eur_base_6m;
  end if;
  select * into r from margenes_carta_costes(array[v_pv], '2031-06-30', 90);
  if r.medida is distinct from 'l' or round(r.eur_base * 0.75, 2) <> 15 then
    raise exception 'FALLO T2: vino a % €/% (esperaba 20 €/l = 15 €/botella)', r.eur_base, r.medida;
  end if;

  -- Carta de prueba (ids propios; fuera del restaurante de verdad no hay nada que tocar).
  insert into "Platos" (id, nombre, categoria, precio_eur, unidad, activado, restaurante)
  values ('prueba-margenes-percebe', 'PRUEBA Percebes', 'MARISCOS', 22, '100 g', true, true),
         ('prueba-margenes-vacio', 'PRUEBA Sin escandallo', 'MARISCOS', 10, 'Unidad', true, true);
  insert into "Vinos" (id, nombre, categoria, precio_eur, activado, restaurante, ubicacion_pais, ubicacion_region)
  values ('prueba-margenes-vino', 'PRUEBA Tinto', 'VINOS TINTOS — PRUEBA', 30, true, true, 'España', 'Rioja');
  insert into escandallo_platos (plato_id, producto_id, cantidad, unidad, origen)
  values ('prueba-margenes-percebe', v_pc, 100, 'g', 'estimado');
  insert into vino_producto (vino_id, producto_id, origen) values ('prueba-margenes-vino', v_pv, 'estimado');
  insert into margenes_carta_revision (tipo, articulo_id, sin_mapear_motivo)
  values ('plato', 'prueba-margenes-vacio', 'No hay compras de prueba');

  -- T4 sin permiso ─────────────────────────────────────────────────────────
  perform set_config('request.jwt.claims', '{"role": "authenticated"}', true);
  set local role authenticated;
  begin
    perform public.margenes_carta('2031-06-30');
    raise exception 'FALLO T4: margenes_carta responde sin permiso';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.margenes_guardar_escandallo('prueba-margenes-percebe', '[]'::jsonb);
    raise exception 'FALLO T4: margenes_guardar_escandallo deja guardar sin permiso';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- T3 como usuario del panel ─────────────────────────────────────────────
  for rec in select s.user_id, s.id from auth.sessions s order by s.updated_at desc nulls last limit 30 loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', rec.user_id, 'session_id', rec.id, 'role', 'authenticated')::text, true);
    set local role authenticated;
    v_ok := public.can_read_section('facturas');
    v_ed := public.can_edit_section('facturas');
    reset role;
    exit when v_ok;
  end loop;
  if not v_ok then
    raise notice 'T3/T5: no hay ninguna sesión de un usuario con permiso de Facturas; parte de usuario saltada';
  else
    set local role authenticated;
    v_t := clock_timestamp();
    j := public.margenes_carta('2031-06-30');
    if clock_timestamp() - v_t > interval '1 second' then
      raise exception 'FALLO T3: margenes_carta tarda %', clock_timestamp() - v_t;
    end if;
    reset role;
    select x into p from jsonb_array_elements(j->'platos') x where x->>'id' = 'prueba-margenes-percebe';
    if p is null then raise exception 'FALLO T3: no sale el plato de prueba'; end if;
    if (p->>'venta')::numeric <> 20 or (p->>'coste')::numeric <> 14 or (p->>'pct')::numeric <> 70
       or (p->>'margen')::numeric <> 6 or (p->>'gramos_venta')::numeric <> 100 then
      raise exception 'FALLO T3: plato venta % coste % pct % margen % (esperaba 20 / 14 / 70 / 6)',
        p->>'venta', p->>'coste', p->>'pct', p->>'margen';
    end if;
    if not (p->'banderas' ? 'coste_alto') or not (p->'banderas' ? 'sube_coste') or (p->>'variacion_pct')::numeric <> 40 then
      raise exception 'FALLO T3: banderas del plato %, variación %', p->'banderas', p->>'variacion_pct';
    end if;
    if p->>'principal' <> 'Pruebamarg Percebe' or p->>'origen' <> 'estimado' then
      raise exception 'FALLO T3: principal % origen %', p->>'principal', p->>'origen';
    end if;
    select x into p from jsonb_array_elements(j->'platos') x where x->>'id' = 'prueba-margenes-vacio';
    if not (p->'banderas' ? 'sin_mapear') or p->>'motivo' <> 'No hay compras de prueba' then
      raise exception 'FALLO T3: plato sin escandallo %', p;
    end if;
    select x into v from jsonb_array_elements(j->'vinos') x where x->>'id' = 'prueba-margenes-vino';
    if (v->>'coste')::numeric <> 15 or (v->>'multiplicador')::numeric <> 2 or not (v->'banderas' ? 'multiplicador_bajo') then
      raise exception 'FALLO T3: vino coste % multiplicador % banderas %', v->>'coste', v->>'multiplicador', v->'banderas';
    end if;

    -- T6 «Por peso» (20261115410000): 22 €/100 g = 220 €/kg en carta, 200 sin IVA;
    -- compra 140 €/kg → ×1,43 < ×2 (por defecto) → multiplicador_bajo; 70 % de coste;
    -- última compra la factura de junio (no el albarán facturado ni Touza).
    if (j->'config'->>'multiplicador_min_peso') is null then
      raise exception 'FALLO T6: config sin multiplicador_min_peso';
    end if;
    select x into p from jsonb_array_elements(j->'peso') x where x->>'id' = 'prueba-margenes-percebe';
    if p is null then raise exception 'FALLO T6: el plato de 100 g no sale en peso'; end if;
    if (p->>'venta_kg_iva')::numeric <> 220 or (p->>'venta_kg')::numeric <> 200 or (p->>'compra_kg')::numeric <> 140
       or (p->>'multiplicador')::numeric <> 1.43 or (p->>'pct')::numeric <> 70 then
      raise exception 'FALLO T6: peso %', p;
    end if;
    if p->>'ultimo_proveedor' <> 'PRUEBA MARGENES SL' or p->>'ultima_fecha' <> '2031-06-10'
       or ((j->'config'->>'multiplicador_min_peso')::numeric = 2 and not (p->'banderas' ? 'multiplicador_bajo')) then
      raise exception 'FALLO T6: última compra % % banderas %', p->>'ultimo_proveedor', p->>'ultima_fecha', p->'banderas';
    end if;
    if exists (select 1 from jsonb_array_elements(j->'peso') x where x->>'id' = 'prueba-margenes-vacio') then
      raise exception 'FALLO T6: un plato por «Unidad» sale en peso';
    end if;

    -- Las compras que forman el coste: sin el albarán facturado ni Touza.
    set local role authenticated;
    j := public.margenes_compras_producto(v_pc, 20);
    reset role;
    if jsonb_array_length(j->'filas') <> 3 or exists (select 1 from jsonb_array_elements(j->'filas') f where (f->>'id')::bigint in (v_alb, v_tz)) then
      raise exception 'FALLO T3: compras del producto %', j->'filas';
    end if;

    -- T5 edición ──────────────────────────────────────────────────────────
    if v_ed then
      set local role authenticated;
      perform public.margenes_guardar_escandallo('prueba-margenes-vacio',
        jsonb_build_array(jsonb_build_object('producto_id', v_pc, 'cantidad', 50, 'unidad', 'g', 'nota', 'media ración')));
      perform public.margenes_marcar_revisado('plato', 'prueba-margenes-vacio', true);
      perform public.margenes_guardar_vino('prueba-margenes-vino', null);
      begin
        perform public.margenes_guardar_escandallo('prueba-margenes-vacio',
          jsonb_build_array(jsonb_build_object('producto_id', v_pc, 'cantidad', 50, 'unidad', 'kg')));
        raise exception 'FALLO T5: acepta la unidad kg';
      exception when invalid_parameter_value then null;
      end;
      j := public.margenes_carta('2031-06-30');
      reset role;
      select x into p from jsonb_array_elements(j->'platos') x where x->>'id' = 'prueba-margenes-vacio';
      if p->>'origen' <> 'manual' or (p->>'coste')::numeric <> 7 or p->>'motivo' is not null or not (p->>'revisado')::boolean then
        raise exception 'FALLO T5: tras editar, origen % coste % motivo % revisado %', p->>'origen', p->>'coste', p->>'motivo', p->>'revisado';
      end if;
      select x into v from jsonb_array_elements(j->'vinos') x where x->>'id' = 'prueba-margenes-vino';
      if not (v->'banderas' ? 'sin_mapear') then
        raise exception 'FALLO T5: el vino sigue mapeado';
      end if;
    else
      raise notice 'T5: el usuario no puede editar Facturas; edición saltada';
    end if;
  end if;
  perform set_config('request.jwt.claims', null, true);
end $$;

select 'analisis_margenes_carta_test: OK' as resultado;
rollback;
