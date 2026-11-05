set client_encoding = 'UTF8';
-- Test de 20261105190000_analisis_rapido. BEGIN … ROLLBACK: no deja nada escrito.
-- Acaba en «analisis_rapido_test: OK». Pasar también tablero_compras_test y
-- explorar_compras_test (las cifras no cambian).
--   supabase db query --linked -f supabase/tests/analisis_rapido_test.sql
--
--   R1 permisos: anon no lee la caché; la función del trigger no se puede
--      llamar desde la API; las RPC usan la caché (marca 20261105190000).
--   R2 la caché cubre todas las líneas y dice lo mismo que la función.
--   R3 el trigger apunta los nombres nuevos (al insertar y al renombrar).
--   R4 rapidez: tablero_compras del año y explorar_compras por familia en
--      menos de 1 s cada una (en la demo: ~0,2-0,3 s).
--   R5 RLS: un usuario sin permiso de Facturas no ve la caché.
begin;

do $$
declare
  v_n   bigint;
  v_doc bigint;
  t0    timestamptz;
  ms    numeric;
  x     json;
begin
  -- R1 ─────────────────────────────────────────────────────────────────────
  if has_table_privilege('anon', 'public.nombres_linea_no_producto', 'select') then
    raise exception 'FALLO R1: anon puede leer la caché';
  end if;
  if has_function_privilege('authenticated', 'public.productos_factura_no_producto_cache()', 'execute')
     or has_function_privilege('anon', 'public.productos_factura_no_producto_cache()', 'execute') then
    raise exception 'FALLO R1: la función del trigger se puede ejecutar desde la API';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.nombres_linea_no_producto'::regclass) then
    raise exception 'FALLO R1: la caché no tiene RLS';
  end if;
  if position('20261105190000' in pg_get_functiondef('public.tablero_compras(date,date,text)'::regprocedure)) = 0
     or position('nombres_linea_no_producto' in pg_get_functiondef('public.explorar_compras_hechos(date,date,text,text,text,jsonb)'::regprocedure)) = 0 then
    raise exception 'FALLO R1: las RPC no usan la caché';
  end if;

  -- R2 ─────────────────────────────────────────────────────────────────────
  select count(*) into v_n
    from productos_factura pf
    left join nombres_linea_no_producto c
      on c.nombre_n = coalesce(nullif(pf.nombre_normalizado::text, ''), lower(pf.nombre::text))
     and c.unidad_k = lower(btrim(coalesce(pf.unidad::text, '')))
   where pf.nombre is not null and c.nombre_n is null;
  if v_n > 0 then
    raise exception 'FALLO R2: % líneas sin entrada en la caché', v_n;
  end if;
  select count(*) into v_n from nombres_linea_no_producto c
   where c.no_producto is distinct from es_linea_no_producto_tablero(c.nombre_n, c.unidad_k);
  if v_n > 0 then
    raise exception 'FALLO R2: % entradas de la caché no coinciden con la función', v_n;
  end if;

  -- R3 ─────────────────────────────────────────────────────────────────────
  select id into v_doc from facturas order by id limit 1;
  insert into productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total)
  values (v_doc, 'PORTES PRUEBA CACHE ANALISIS', 1, 'ud', 5, 5),
         (v_doc, 'TOMATE PRUEBA CACHE ANALISIS', 1, 'kg', 2, 2);
  if not exists (select 1 from nombres_linea_no_producto where nombre_n like 'portes prueba cache analisis%' and no_producto)
     or not exists (select 1 from nombres_linea_no_producto where nombre_n like 'tomate prueba cache analisis%' and not no_producto) then
    raise exception 'FALLO R3: el trigger no apunta los nombres nuevos';
  end if;
  update productos_factura set nombre = 'ENVASE PRUEBA CACHE ANALISIS' where nombre = 'TOMATE PRUEBA CACHE ANALISIS';
  if not exists (select 1 from nombres_linea_no_producto where nombre_n like 'envase prueba cache analisis%' and no_producto) then
    raise exception 'FALLO R3: el trigger no apunta los nombres renombrados';
  end if;

  -- R4 ─────────────────────────────────────────────────────────────────────
  x := tablero_compras('2026-01-01', '2026-12-31', null);  -- calienta
  t0 := clock_timestamp();
  x := tablero_compras('2026-01-01', '2026-12-31', null);
  ms := extract(epoch from clock_timestamp() - t0) * 1000;
  if ms > 1000 then
    raise exception 'FALLO R4: tablero_compras del año tarda % ms', round(ms);
  end if;
  t0 := clock_timestamp();
  x := explorar_compras('2026-01-01', '2026-12-31', 'base', 'familia');
  ms := extract(epoch from clock_timestamp() - t0) * 1000;
  if ms > 1000 then
    raise exception 'FALLO R4: explorar_compras por familia tarda % ms', round(ms);
  end if;

  -- R5 RLS ─────────────────────────────────────────────────────────────────
  perform set_config('request.jwt.claims', '{"role": "authenticated"}', true);
  set local role authenticated;
  select count(*) into v_n from nombres_linea_no_producto;
  reset role;
  if v_n <> 0 then
    raise exception 'FALLO R5: un usuario sin permiso ve % entradas de la caché', v_n;
  end if;
end;
$$;

rollback;

select 'analisis_rapido_test: OK' as resultado;
