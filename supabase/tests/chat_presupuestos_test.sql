set client_encoding = 'UTF8';
-- Test de 20261204100000_chat_presupuestos. BEGIN … ROLLBACK: no deja nada escrito.
-- Acaba en «chat_presupuestos_test: OK».
--   supabase db query --linked -f supabase/tests/chat_presupuestos_test.sql
--   T1 permisos: ni anon ni authenticated ejecutan; la tabla no es legible por ellos.
--   T2 emparejar: un producto que se compra casa por texto; uno inventado no casa.
--   T3 comparar con 5 % de descuento: tres referencias, veredicto y resumen; sin_descuento y errores.
begin;
do $$
declare
  f text; v_id uuid; v_l jsonb; r jsonb; m jsonb; n int;
begin
  foreach f in array array['public.emparejar_presupuesto_agente(jsonb)',
                           'public.referencias_precio_agente(bigint,text,text,date)',
                           'public.comparar_presupuesto_agente(uuid,numeric,numeric)'] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
      raise exception 'FALLO T1: un cliente puede ejecutar %', f;
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.chat_presupuestos', 'select') then
    raise exception 'FALLO T1: authenticated lee chat_presupuestos';
  end if;

  v_l := jsonb_build_array(
    jsonb_build_object('producto', 'Berberecho', 'unidad', 'kg', 'precio', 20, 'cantidad', 10),
    jsonb_build_object('producto', 'Pechuga de pollo', 'unidad', 'kg', 'precio', 9, 'cantidad', 20),
    jsonb_build_object('producto', 'Zzqxw inexistente raro', 'unidad', 'ud', 'precio', 3));
  m := emparejar_presupuesto_agente(v_l);
  if jsonb_array_length(m) <> 3 then raise exception 'FALLO T2: %', m; end if;
  if (m->0->>'producto_id') is null then raise exception 'FALLO T2: Berberecho no casa: %', m; end if;
  if (m->2->>'producto_id') is not null then raise exception 'FALLO T2: el inventado casa: %', m; end if;

  select jsonb_agg(a.l || b.l order by a.ord) into v_l
    from jsonb_array_elements(v_l) with ordinality a(l, ord)
    join jsonb_array_elements(m) with ordinality b(l, ord) using (ord);
  insert into chat_presupuestos (session_id, proveedor, nombre_archivo, lineas)
    values ('test-presupuestos', 'Proveedor de prueba', 'p.pdf', v_l) returning id into v_id;

  r := comparar_presupuesto_agente(v_id, 5, null);
  if (r->'descuento'->>'pct')::numeric <> 5 then raise exception 'FALLO T3 descuento: %', r; end if;
  if jsonb_array_length(r->'lineas') < 1 then raise exception 'FALLO T3 sin lineas: %', r; end if;
  if r->'lineas'->0->'ultimo'->>'precio' is null or r->'lineas'->0->'media_12m'->>'precio' is null
     or r->'lineas'->0->'mejor_actual'->>'precio' is null then
    raise exception 'FALLO T3 faltan referencias: %', r->'lineas'->0;
  end if;
  if jsonb_array_length(r->'no_los_compras') <> 1 then raise exception 'FALLO T3 no_los_compras: %', r; end if;
  -- oferta = precio * 0,95
  if abs((r->'lineas'->0->>'oferta')::numeric - 19) > 0.01 then raise exception 'FALLO T3 oferta: %', r->'lineas'->0; end if;

  r := comparar_presupuesto_agente(v_id, null, 100);
  if (r->'descuento'->>'tipo') <> 'importe' then raise exception 'FALLO T3 importe: %', r; end if;
  r := comparar_presupuesto_agente(v_id, 5, 10);
  if r->>'error' is null then raise exception 'FALLO T3: acepta pct e importe a la vez'; end if;
  r := comparar_presupuesto_agente(v_id, 120, null);
  if r->>'error' is null then raise exception 'FALLO T3: acepta 120 %%'; end if;
  r := comparar_presupuesto_agente(gen_random_uuid(), null, null);
  if r->>'error' is null then raise exception 'FALLO T3: presupuesto inexistente'; end if;
  raise notice 'chat_presupuestos_test: OK';
end $$;
rollback;
