set client_encoding = 'UTF8';
-- Test de 20261106310000_compras_meses_incompletos. BEGIN … ROLLBACK: no deja nada escrito.
-- Acaba en «compras_meses_incompletos_test: OK».
--   supabase db query --linked -f supabase/tests/compras_meses_incompletos_test.sql
--
--   T1 permisos y versiones: anon no ejecuta meses_compras_incompletos; SECURITY INVOKER;
--      tablero, explorador y lista son los de esta migración.
--   T2 datos reales: cada mes marcado tiene < 40 % de su referencia y es «reciente» o «inicio»;
--      un mes con ≥ 40 % nunca sale.
--   T3 datos de prueba (abr-2030 … mar-2031, 10 documentos al mes): marzo-2031 con 2 es
--      incompleto (de los 3 últimos); noviembre-2030 con 3 NO (está en medio).
--   T4 tablero_compras: meses[i].incompleto, meses_incompletos, aviso en la variación y
--      retención IRPF del periodo (sin cambiar el gasto).
--   T5 explorar_compras: puntos incompletos por mes y trimestre, variacion_aviso, medida
--      retencion_irpf (y su error por líneas).
--   T6 documentos_lista: meses_incompletos y docs[i][20] = retencion_irpf.
--   T7 RLS: sin permiso de Facturas no se ve ningún mes.
begin;

do $$
declare
  v_p   bigint;
  v_r   bigint;
  v_m   date;
  v_n   int;
  t     jsonb;
  v_x   jsonb;
begin
  -- T1 ─────────────────────────────────────────────────────────────────────
  if has_function_privilege('anon', 'public.meses_compras_incompletos(text)', 'execute') then
    raise exception 'FALLO T1: anon puede ejecutar meses_compras_incompletos';
  end if;
  if not has_function_privilege('authenticated', 'public.meses_compras_incompletos(text)', 'execute')
     or not has_function_privilege('service_role', 'public.meses_compras_incompletos(text)', 'execute') then
    raise exception 'FALLO T1: authenticated o service_role no ejecutan meses_compras_incompletos';
  end if;
  if (select prosecdef from pg_proc where oid = 'public.meses_compras_incompletos(text)'::regprocedure) then
    raise exception 'FALLO T1: meses_compras_incompletos no es SECURITY INVOKER';
  end if;
  if position('20261106310000' in pg_get_functiondef('public.tablero_compras(date,date,text)'::regprocedure)) = 0
     or position('20261106310000' in pg_get_functiondef('public.explorar_compras(date,date,text,text,text,jsonb,integer)'::regprocedure)) = 0
     or position('20261106310000' in pg_get_functiondef('public.explorar_compras_hechos(date,date,text,text,text,jsonb)'::regprocedure)) = 0
     or position('20261106310000' in pg_get_functiondef('public.documentos_lista()'::regprocedure)) = 0
     or position('20261105150500' in pg_get_functiondef('public.tablero_compras(date,date,text)'::regprocedure)) = 0 then
    raise exception 'FALLO T1: alguna función no es la de 20261106310000';
  end if;

  -- T2 ─────────────────────────────────────────────────────────────────────
  if exists (select 1 from meses_compras_incompletos(null) i
              where i.documentos >= 0.4 * i.referencia or i.motivo not in ('reciente', 'inicio')) then
    raise exception 'FALLO T2: un mes marcado no cumple la regla';
  end if;

  -- T3 datos ───────────────────────────────────────────────────────────────
  if exists (select 1 from facturas where fecha between '2030-04-01' and '2031-12-31') then
    raise exception 'FALLO datos: ya hay documentos en 2030-04 … 2031; el test necesita ese periodo vacío';
  end if;
  insert into proveedores (nombre, cif) values ('PRUEBA MESES MAYORISTA', 'B00000311') returning id into v_p;
  insert into proveedores (nombre, cif) values ('PRUEBA MESES ALQUILER', 'B00000312') returning id into v_r;
  for v_m in select generate_series('2030-04-01'::date, '2031-03-01'::date, interval '1 month')::date loop
    v_n := case v_m when '2031-03-01' then 2 when '2030-11-01' then 3 else 10 end;
    insert into facturas (tipo, proveedor, cif, proveedor_id, numero_documento, fecha, total, local)
    select 'factura', 'PRUEBA MESES MAYORISTA', 'B00000311', v_p, 'MES-' || to_char(v_m, 'YYYYMM') || '-' || g, v_m + 4, 100, 'casa_tomas'
      from generate_series(1, v_n) g;
  end loop;
  -- Un alquiler con retención en febrero (es uno de los 10 de ese mes: se cambia uno).
  update facturas set proveedor = 'PRUEBA MESES ALQUILER', cif = 'B00000312', proveedor_id = v_r,
                      subtotal = 750, iva = 157.5, total = 765, retencion_irpf = 142.5, retencion_irpf_pct = 19
   where numero_documento = 'MES-203102-1';

  if not exists (select 1 from meses_compras_incompletos(null) where mes = '2031-03-01' and documentos = 2 and motivo = 'reciente') then
    raise exception 'FALLO T3: marzo-2031 (2 documentos de 10) no sale incompleto: %',
      (select json_agg(i) from meses_compras_incompletos(null) i);
  end if;
  if exists (select 1 from meses_compras_incompletos(null) where mes in ('2030-11-01', '2031-02-01', '2031-01-01')) then
    raise exception 'FALLO T3: sale incompleto un mes que no es de los 3 últimos ni del principio';
  end if;
  if exists (select 1 from meses_compras_incompletos('touza') where mes >= '2030-04-01') then
    raise exception 'FALLO T3: Touza no tiene documentos de prueba';
  end if;

  -- T4 ─────────────────────────────────────────────────────────────────────
  t := tablero_compras('2031-03-01', '2031-03-31')::jsonb;
  if (t -> 'meses' -> 0 ->> 'incompleto')::boolean is distinct from true
     or jsonb_array_length(t -> 'meses_incompletos') <> 1 or t -> 'meses_incompletos' -> 0 ->> 'mes' <> '2031-03'
     or (t -> 'indicadores' ->> 'meses_incompletos')::int <> 1 then
    raise exception 'FALLO T4: marzo-2031 no sale incompleto en el tablero: % / %', t -> 'meses', t -> 'meses_incompletos';
  end if;
  if t -> 'indicadores' ->> 'variacion_pct' is null or position('03/2031' in t -> 'indicadores' ->> 'variacion_aviso') = 0 then
    raise exception 'FALLO T4: la variación con un mes incompleto no avisa: %', t -> 'indicadores';
  end if;
  t := tablero_compras('2031-02-01', '2031-02-28')::jsonb;
  if (t -> 'meses' -> 0 ->> 'incompleto')::boolean or t -> 'indicadores' ->> 'variacion_aviso' is not null
     or jsonb_array_length(t -> 'meses_incompletos') <> 0 then
    raise exception 'FALLO T4: febrero-2031 sale incompleto o con aviso: %', t -> 'indicadores';
  end if;
  if (t -> 'indicadores' ->> 'retencion_irpf')::numeric <> 142.5
     or (t -> 'indicadores' ->> 'retencion_irpf_documentos')::int <> 1
     or (t -> 'indicadores' ->> 'gasto')::numeric <> 9 * 100 + 765
     or (t -> 'indicadores' ->> 'gasto_mas_retencion')::numeric <> 9 * 100 + 765 + 142.5 then
    raise exception 'FALLO T4: retención o gasto de febrero-2031: %', t -> 'indicadores';
  end if;
  t := tablero_compras('2031-01-01', '2031-01-31')::jsonb;
  if (t -> 'indicadores' ->> 'retencion_irpf')::numeric <> 0 then
    raise exception 'FALLO T4: enero-2031 no tiene retención: %', t -> 'indicadores';
  end if;

  -- T5 ─────────────────────────────────────────────────────────────────────
  t := explorar_compras('2031-01-01', '2031-03-31', 'gasto', 'mes')::jsonb;
  select p into v_x from jsonb_array_elements(t -> 'puntos') p where p ->> 'clave' = '2031-03';
  if (v_x ->> 'incompleto')::boolean is distinct from true
     or exists (select 1 from jsonb_array_elements(t -> 'puntos') p where p ->> 'clave' <> '2031-03' and (p ->> 'incompleto')::boolean)
     or t -> 'meses_incompletos' <> '["2031-03"]'::jsonb then
    raise exception 'FALLO T5: puntos incompletos por mes: %', t -> 'puntos';
  end if;
  t := explorar_compras('2031-01-01', '2031-03-31', 'gasto', 'trimestre')::jsonb;
  if (t -> 'puntos' -> 0 ->> 'incompleto')::boolean is distinct from true then
    raise exception 'FALLO T5: el trimestre con marzo-2031 no sale incompleto: %', t -> 'puntos';
  end if;
  t := explorar_compras('2031-03-01', '2031-03-31', 'gasto', 'proveedor')::jsonb;
  if t -> 'total' ->> 'variacion_aviso' is null then
    raise exception 'FALLO T5: la variación del explorador con marzo-2031 no avisa: %', t -> 'total';
  end if;
  if (t -> 'puntos' -> 0) ? 'incompleto' and t -> 'puntos' -> 0 -> 'incompleto' <> 'null'::jsonb then
    raise exception 'FALLO T5: agrupando por proveedor no hay incompleto';
  end if;
  t := explorar_compras('2031-02-01', '2031-02-28', 'retencion_irpf', 'proveedor')::jsonb;
  if (t -> 'total' ->> 'valor')::numeric <> 142.5 or (t -> 'total' ->> 'documentos')::int <> 1
     or jsonb_array_length(t -> 'puntos') <> 1 then
    raise exception 'FALLO T5: medida retencion_irpf: %', t;
  end if;
  if explorar_compras('2031-02-01', '2031-02-28', 'retencion_irpf', 'familia')::jsonb ->> 'error' is null then
    raise exception 'FALLO T5: retencion_irpf por familia debe dar error';
  end if;

  -- T6 ─────────────────────────────────────────────────────────────────────
  t := documentos_lista()::jsonb;
  if not exists (select 1 from jsonb_array_elements(t -> 'meses_incompletos') m where m ->> 'mes' = '2031-03') then
    raise exception 'FALLO T6: documentos_lista sin marzo-2031 en meses_incompletos';
  end if;
  select d into v_x from jsonb_array_elements(t -> 'docs') d where d ->> 2 = 'MES-203102-1';
  if (v_x ->> 20)::numeric is distinct from 142.5 then
    raise exception 'FALLO T6: docs[i][20] no es la retención: %', v_x;
  end if;
  select d into v_x from jsonb_array_elements(t -> 'docs') d where d ->> 2 = 'MES-203102-2';
  if v_x -> 20 <> 'null'::jsonb then
    raise exception 'FALLO T6: un documento sin retención debe traer null: %', v_x;
  end if;

  -- T7 RLS ─────────────────────────────────────────────────────────────────
  perform set_config('request.jwt.claims', '{"role": "authenticated"}', true);
  set local role authenticated;
  select count(*) into v_n from meses_compras_incompletos(null);
  reset role;
  if v_n <> 0 then
    raise exception 'FALLO T7: un usuario sin permiso ve % mes(es) incompletos', v_n;
  end if;
end;
$$;

rollback;

select 'compras_meses_incompletos_test: OK' as resultado;
