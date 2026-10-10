set client_encoding = 'UTF8';
-- Test de 20261010110000_albaranes_factura_cotejo. BEGIN … ROLLBACK: no deja
-- nada escrito. Acaba en «albaranes_factura_cotejo_test: OK».
--   npx supabase db query --linked -f supabase/tests/albaranes_factura_cotejo_test.sql
--
--   T1 esquema: columna + check, funciones SECURITY INVOKER (la de vínculo
--      automático DEFINER y con la marca), anon sin EXECUTE.
--   T2 vínculo automático por albaran_ref (origen 'auto').
--   T3 candidatos: sin texto (mismo proveedor, sin factura) y con texto.
--   T4 vincular a mano (origen 'manual'), proveedor distinto sin/con forzar,
--      tipos equivocados.
--   T5 cotejo: resumen, estados por producto, no subidos, modo por albarán.
--   T6 desvincular a mano: el automático no lo vuelve a vincular.
--   T7 sin permiso de escritura: 42501.
begin;

do $$
declare
  v_fn text;
  v_pa bigint;
  v_pb bigint;
  v_f bigint;
  a1 bigint; a2 bigint; a3 bigint; a4 bigint;
  v_j jsonb;
  v_p jsonb;
  v_ok boolean;
  v_n int;
begin
  -- T1 ─────────────────────────────────────────────────────────────────────
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'facturas' and column_name = 'facturado_origen') then
    raise exception 'FALLO T1: falta facturas.facturado_origen';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.facturas'::regclass
                    and conname = 'facturas_facturado_origen_check') then
    raise exception 'FALLO T1: falta el check de facturado_origen';
  end if;
  foreach v_fn in array array['vincular_albaran_factura(bigint, bigint, boolean)', 'desvincular_albaran(bigint)',
                               'albaranes_candidatos(bigint, text)', 'facturas_candidatas(bigint)',
                               'cotejo_factura_albaranes(bigint, bigint)'] loop
    if to_regprocedure('public.' || v_fn) is null then
      raise exception 'FALLO T1: falta %', v_fn;
    end if;
    if (select prosecdef from pg_proc where oid = to_regprocedure('public.' || v_fn)) then
      raise exception 'FALLO T1: % debería ser SECURITY INVOKER', v_fn;
    end if;
    if has_function_privilege('anon', 'public.' || v_fn, 'execute') then
      raise exception 'FALLO T1: anon puede ejecutar %', v_fn;
    end if;
    if not has_function_privilege('authenticated', 'public.' || v_fn, 'execute') then
      raise exception 'FALLO T1: authenticated no puede ejecutar %', v_fn;
    end if;
  end loop;
  if position('20261010110000_albaranes_factura_cotejo' in pg_get_functiondef('public.vincular_albaranes_proveedor(bigint)'::regprocedure)) = 0 then
    raise exception 'FALLO T1: vincular_albaranes_proveedor sin la marca de la migración';
  end if;
  if has_function_privilege('authenticated', 'public.vincular_albaranes_proveedor(bigint)', 'execute') then
    raise exception 'FALLO T1: authenticated puede ejecutar vincular_albaranes_proveedor';
  end if;

  -- T2 ─────────────────────────────────────────────────────────────────────
  v_pa := public.proveedor_resolver('ZZ PRUEBA COTEJO A, S.L.', 'ZZ0000001', true);
  v_pb := public.proveedor_resolver('ZZ PRUEBA COTEJO B, S.L.', 'ZZ0000002', true);
  if v_pa is null or v_pb is null or v_pa = v_pb then
    raise exception 'FALLO T2: no se pudieron crear los proveedores de prueba (% / %)', v_pa, v_pb;
  end if;

  -- Albaranes primero (como llegan en la vida real), luego la factura.
  insert into public.facturas (tipo, numero_documento, fecha, proveedor, cif, proveedor_id)
  values ('albaran', '9001001', '2026-03-10', 'ZZ PRUEBA COTEJO A, S.L.', 'ZZ0000001', v_pa) returning id into a1;
  insert into public.productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total) values
    (a1, 'ZZ ACEITE COTEJO', 10, 'kg', 5, 50),
    (a1, 'ZZ HARINA COTEJO', 4, 'ud', 2, 8);
  insert into public.facturas (tipo, numero_documento, fecha, proveedor, cif, proveedor_id)
  values ('albaran', '9001.002', '2026-03-20', 'ZZ PRUEBA COTEJO A, S.L.', 'ZZ0000001', v_pa) returning id into a2;
  insert into public.productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total) values
    (a2, 'ZZ ACEITE COTEJO', 5, 'kg', 5, 25);
  insert into public.facturas (tipo, numero_documento, fecha, proveedor, cif, proveedor_id)
  values ('albaran', 'ZZ-OTRO-77', '2026-03-25', 'ZZ PRUEBA COTEJO A, S.L.', 'ZZ0000001', v_pa) returning id into a3;
  insert into public.productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total) values
    (a3, 'ZZ HARINA COTEJO', 1, 'ud', 2, 2);
  insert into public.facturas (tipo, numero_documento, fecha, proveedor, cif, proveedor_id)
  values ('albaran', 'ZZ-B-9001004', '2026-03-26', 'ZZ PRUEBA COTEJO B, S.L.', 'ZZ0000002', v_pb) returning id into a4;

  insert into public.facturas (tipo, numero_documento, fecha, proveedor, cif, proveedor_id, subtotal, iva, total)
  values ('factura', 'ZZ-F-1', '2026-03-31', 'ZZ PRUEBA COTEJO A, S.L.', 'ZZ0000001', v_pa, 90.50, 9.05, 99.55)
  returning id into v_f;
  insert into public.productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total, albaran_ref) values
    (v_f, 'ZZ ACEITE COTEJO', 10, 'kg', 5, 50, 'V/ 9001.001'),
    (v_f, 'ZZ HARINA COTEJO', 4, 'ud', 2, 8, 'V/ 9001.001'),
    (v_f, 'ZZ ACEITE COTEJO', 5, 'kg', 5.5, 27.5, '9001.002'),
    (v_f, 'ZZ SAL COTEJO', 2, 'ud', 1, 2, '9001.003'),
    (v_f, 'ZZ PORTES COTEJO', 1, 'ud', 3, 3, null);

  if (select count(*) from public.facturas
       where id in (a1, a2) and facturado_en_id = v_f and facturado_origen = 'auto') <> 2 then
    raise exception 'FALLO T2: el vínculo automático no ha recogido los dos albaranes citados';
  end if;
  if (select facturado_en_id from public.facturas where id = a3) is not null then
    raise exception 'FALLO T2: ha vinculado un albarán no citado';
  end if;

  -- T3 ─────────────────────────────────────────────────────────────────────
  select array_agg(c.id order by c.id) = array[a3] into v_ok from public.albaranes_candidatos(v_f) c;
  if not coalesce(v_ok, false) then
    raise exception 'FALLO T3: candidatos sin texto: %', (select array_agg(c.id) from public.albaranes_candidatos(v_f) c);
  end if;
  if not exists (select 1 from public.albaranes_candidatos(v_f, 'zz-b-9001') c where c.id = a4 and not c.mismo_proveedor) then
    raise exception 'FALLO T3: el buscador no encuentra el albarán de otro proveedor';
  end if;
  if not exists (select 1 from public.facturas_candidatas(a3) c where c.id = v_f) then
    raise exception 'FALLO T3: facturas_candidatas no propone la factura del mismo proveedor';
  end if;

  -- T4 ─────────────────────────────────────────────────────────────────────
  v_j := public.vincular_albaran_factura(a3, v_f);
  if not (v_j ->> 'ok')::boolean
     or (select facturado_origen from public.facturas where id = a3) <> 'manual'
     or (select facturado_en_id from public.facturas where id = a3) <> v_f then
    raise exception 'FALLO T4: vincular a mano: %', v_j;
  end if;
  v_ok := false;
  begin
    perform public.vincular_albaran_factura(a4, v_f);
  exception when invalid_parameter_value then v_ok := true;
  end;
  if not v_ok then raise exception 'FALLO T4: vinculó un albarán de otro proveedor sin forzar'; end if;
  perform public.vincular_albaran_factura(a4, v_f, true);
  if (select facturado_en_id from public.facturas where id = a4) is distinct from v_f then
    raise exception 'FALLO T4: no vinculó forzando';
  end if;
  perform public.desvincular_albaran(a4);
  v_ok := false;
  begin
    perform public.vincular_albaran_factura(v_f, v_f);
  exception when invalid_parameter_value then v_ok := true;
  end;
  if not v_ok then raise exception 'FALLO T4: aceptó una factura como albarán'; end if;
  v_ok := false;
  begin
    perform public.vincular_albaran_factura(a1, a2);
  exception when invalid_parameter_value then v_ok := true;
  end;
  if not v_ok then raise exception 'FALLO T4: aceptó un albarán como factura'; end if;

  -- T5 ─────────────────────────────────────────────────────────────────────
  v_j := public.cotejo_factura_albaranes(v_f);
  if jsonb_array_length(v_j -> 'albaranes') <> 3 then
    raise exception 'FALLO T5: albaranes vinculados: %', v_j -> 'albaranes';
  end if;
  if (v_j #>> '{resumen,suma_albaranes}')::numeric <> 85
     or (v_j #>> '{resumen,total_factura_base}')::numeric <> 90.5
     or (v_j #>> '{resumen,diferencia}')::numeric <> 5.5
     or (v_j #>> '{resumen,base_citada_sin_albaran}')::numeric <> 2
     or (v_j #>> '{resumen,diferencia_sin_explicar}')::numeric <> 3.5 then
    raise exception 'FALLO T5: resumen: %', v_j -> 'resumen';
  end if;
  if (v_j -> 'albaranes_no_subidos') <> '[{"numero": "9001.003", "lineas": 1, "importe": 2.00}]'::jsonb then
    raise exception 'FALLO T5: no subidos: %', v_j -> 'albaranes_no_subidos';
  end if;
  select jsonb_object_agg(p ->> 'producto', p ->> 'estado') into v_p from jsonb_array_elements(v_j -> 'productos') p;
  if v_p ->> 'ZZ HARINA COTEJO' is distinct from 'cantidad_distinta'
     or v_p ->> 'ZZ ACEITE COTEJO' is distinct from 'precio_distinto'
     or v_p ->> 'ZZ PORTES COTEJO' is distinct from 'solo_factura'
     or v_p ? 'ZZ SAL COTEJO' then
    raise exception 'FALLO T5: estados por producto: %', v_p;
  end if;
  if (v_j -> 'productos' -> 0 ->> 'estado') <> 'cantidad_distinta' then
    raise exception 'FALLO T5: las discrepancias no van primero';
  end if;
  if ((v_j -> 'albaranes') -> 2 ->> 'citado_en_factura')::boolean then
    raise exception 'FALLO T5: el albarán vinculado a mano sale como citado';
  end if;
  -- Un albarán solo: contra las líneas de la factura que lo citan.
  v_j := public.cotejo_factura_albaranes(v_f, a2);
  if v_j ->> 'modo' <> 'por_referencia' or jsonb_array_length(v_j -> 'productos') <> 1
     or (v_j -> 'productos' -> 0 ->> 'estado') <> 'precio_distinto'
     or (v_j -> 'productos' -> 0 ->> 'diferencia_precio_pct')::numeric <> 10 then
    raise exception 'FALLO T5: cotejo de un albarán: %', v_j;
  end if;
  v_j := public.cotejo_factura_albaranes(v_f, a3);
  if v_j ->> 'modo' <> 'por_producto' or jsonb_array_length(v_j -> 'productos') <> 1 then
    raise exception 'FALLO T5: cotejo de un albarán no citado: %', v_j;
  end if;
  if not (public.cotejo_factura_albaranes(v_f, a4) ? 'error') then
    raise exception 'FALLO T5: coteja un albarán no vinculado';
  end if;

  -- T6 ─────────────────────────────────────────────────────────────────────
  perform public.desvincular_albaran(a1);
  update public.productos_factura set albaran_ref = '9001001' where factura_id = v_f and albaran_ref = 'V/ 9001.001';
  perform public.vincular_albaranes_proveedor(v_pa);
  if (select facturado_en_id from public.facturas where id = a1) is not null
     or (select facturado_origen from public.facturas where id = a1) <> 'manual' then
    raise exception 'FALLO T6: el automático ha vuelto a vincular un albarán desvinculado a mano';
  end if;
  if (select facturado_en_id from public.facturas where id = a3) is distinct from v_f then
    raise exception 'FALLO T6: el automático ha quitado un vínculo manual';
  end if;
  if (select facturado_origen from public.facturas where id = a2) <> 'auto' then
    raise exception 'FALLO T6: el automático ha perdido el vínculo auto';
  end if;
end;
$$;

-- T7 sin permiso de escritura ───────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000c07e","role":"authenticated"}';
do $$
declare
  v_ok boolean := false;
begin
  begin
    perform public.vincular_albaran_factura(1, 1);
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'FALLO T7: vincular sin permiso no da 42501'; end if;
  v_ok := false;
  begin
    perform public.desvincular_albaran(1);
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'FALLO T7: desvincular sin permiso no da 42501'; end if;
end;
$$;
reset role;

rollback;

select 'albaranes_factura_cotejo_test: OK' as resultado;
