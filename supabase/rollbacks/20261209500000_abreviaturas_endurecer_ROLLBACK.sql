-- Vuelta atrás de 20261209500000_abreviaturas_endurecer.
-- Quita la lista de exclusión y las funciones nuevas y deja abreviaturas_observar_linea y
-- abreviaturas_proponer como estaban en 20261209300000 / 20261209310000.
set lock_timeout = '5s';
create or replace function public.abreviaturas_observar_linea(
  p_texto        text,
  p_proveedor_id bigint,
  p_producto_id  bigint,
  p_veces        integer default 1
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_toks     text[];
  v_n        integer;
  v_i        integer := 1;
  v_t        text;
  v_rest     text[];
  v_fuente   record;
  v_ws       text[];
  v_j        integer;
  v_ini      text;
  v_part     text;
  v_part_n   text;
  v_exp      text;
  v_resto    text[];
  v_w        text;
  v_bebida   boolean;
  v_particulas constant text[] := array['de','del','la','el','los','las','y','e','i','the','le','les','du','des','da','do','di','von','van','of'];
begin
  if p_texto is null or p_proveedor_id is null or p_producto_id is null then return false; end if;
  v_toks := array(select x from regexp_split_to_table(public.normalizar_texto(p_texto), '[^a-z0-9]+') x where x <> '');
  v_n := coalesce(cardinality(v_toks), 0);
  -- Salta los tokens de envase/familia del principio («bot», «c/6b», «cha»…).
  while v_i <= v_n and public.abreviaturas_token_generico(v_toks[v_i]) loop v_i := v_i + 1; end loop;
  if v_i >= v_n then return false; end if;            -- sin token candidato o sin nada detrás
  v_t := v_toks[v_i];
  if v_t !~ '^[a-z]{2,6}$' then return false; end if;  -- una marca entera (tanqueray) no es abreviatura
  v_rest := v_toks[v_i + 1 : v_n];
  -- El comienzo truncado («coca» por «Coca-Cola») solo se aprende en bebidas: en alimentación
  -- sería «alcac» por «alcachofa», una palabra corriente y no una marca.
  select exists (
    select 1 from public.productos_catalogo c
      join public.categorias_producto k on k.id = c.categoria_id
      left join public.categorias_producto kp on kp.id = k.padre_id
     where c.id = p_producto_id and (k.nombre = 'Bebidas' or kp.nombre = 'Bebidas')) into v_bebida;

  -- Fuentes de la expansión: el nombre del producto y, si no basta, sus alias.
  for v_fuente in
    select c.nombre as txt, true as es_nombre, 0 as orden
      from public.productos_catalogo c where c.id = p_producto_id
    union all
    (select initcap(a.texto_normalizado), false, 1
       from public.productos_alias a
      where a.producto_id = p_producto_id and a.texto_normalizado <> public.normalizar_texto(p_texto)
      order by length(a.texto_normalizado) limit 6)
    order by orden
  loop
    v_ws := regexp_split_to_array(btrim(v_fuente.txt), '\s+');
    v_ini := '';
    for v_j in 1 .. least(cardinality(v_ws), 4) loop
      for v_part in select x from regexp_split_to_table(v_ws[v_j], '-') x loop
        v_part_n := public.normalizar_texto(regexp_replace(v_part, '[^[:alpha:]]', '', 'g'));
        if length(v_part_n) >= 2 and not (v_part_n = any (v_particulas)) then
          -- Una marca no lleva palabras de familia o envase («Whisky Macallan» no es una marca).
          if public.abreviaturas_token_generico(v_part_n) then v_ini := null; exit; end if;
          v_ini := v_ini || left(v_part_n, 1);
        end if;
      end loop;
      exit when v_ini is null;
      exit when length(v_ini) > length(v_t);
      -- Una palabra que es partícula no cierra la marca («Marqués de» no vale).
      continue when public.normalizar_texto(v_ws[v_j]) = any (v_particulas);
      if length(v_t) between 2 and 4 and v_ini = v_t then
        v_exp := array_to_string(v_ws[1 : v_j], ' ');
        v_resto := array(select x from regexp_split_to_table(
                           public.normalizar_texto(coalesce(array_to_string(v_ws[v_j + 1 : cardinality(v_ws)], ' '), '')), '[^a-z0-9]+') x
                         where length(x) >= 3 and x ~ '^[a-z]+$' and not public.abreviaturas_token_generico(x));
        if exists (select 1 from unnest(v_resto) w where w = any (v_rest)) then
          insert into public.abreviaturas_proveedor (proveedor_id, abreviatura, expansion, origen, veces, en_nombre)
          values (p_proveedor_id, v_t, left(v_exp, 80), 'aprendida', greatest(1, coalesce(p_veces, 1)), true)
          on conflict (proveedor_id, abreviatura, expansion_clave) do update
            set veces = public.abreviaturas_proveedor.veces + excluded.veces,
                en_nombre = true,
                expansion = case when v_fuente.es_nombre then excluded.expansion else public.abreviaturas_proveedor.expansion end,
                ultima_vez = now();
          return true;
        end if;
      end if;
    end loop;
    -- Comienzo truncado de la primera palabra («baro» por «Barón»): solo cuenta si se repite.
    v_w := public.normalizar_texto(regexp_replace(v_ws[1], '[^[:alpha:]]', '', 'g'));
    if v_bebida and length(v_t) between 3 and 6 and length(v_w) >= 6 and length(v_t) <= length(v_w) - 2
       and left(v_w, length(v_t)) = v_t and not (v_w = any (v_particulas)) then
      v_resto := array(select x from regexp_split_to_table(
                         public.normalizar_texto(coalesce(array_to_string(v_ws[2 : cardinality(v_ws)], ' '), '')), '[^a-z0-9]+') x
                       where length(x) >= 3 and x ~ '^[a-z]+$' and not public.abreviaturas_token_generico(x));
      if exists (select 1 from unnest(v_resto) w where w = any (v_rest)) then
        insert into public.abreviaturas_proveedor (proveedor_id, abreviatura, expansion, origen, veces, en_nombre)
        values (p_proveedor_id, v_t, left(v_ws[1], 80), 'aprendida', greatest(1, coalesce(p_veces, 1)), false)
        on conflict (proveedor_id, abreviatura, expansion_clave) do update
          set veces = public.abreviaturas_proveedor.veces + excluded.veces, ultima_vez = now();
        return true;
      end if;
    end if;
  end loop;
  return false;
end;
$$;
revoke all on function public.abreviaturas_observar_linea(text, bigint, bigint, integer) from public, anon, authenticated;
grant execute on function public.abreviaturas_observar_linea(text, bigint, bigint, integer) to service_role;

create or replace function public.abreviaturas_proponer(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  it        jsonb;
  v_prov    bigint;
  v_ab      text;
  v_prop    text;
  v_texto   text;
  v_prod    bigint;
  v_fact    bigint;
  v_id      uuid;
  v_notif   uuid;
  v_nprov   text;
  v_creados integer := 0;
  v_ign     integer := 0;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'p_items tiene que ser una lista' using errcode = '22023';
  end if;
  for it in select value from jsonb_array_elements(p_items) loop
    v_prov := case when jsonb_typeof(it->'proveedor_id') = 'number' then (it->>'proveedor_id')::bigint end;
    v_ab := lower(btrim(coalesce(it->>'abreviatura', '')));
    v_prop := btrim(regexp_replace(coalesce(it->>'propuesta', ''), '\s+', ' ', 'g'));
    v_texto := left(it->>'texto', 500);
    if v_prov is null or v_ab !~ '^[a-z]{2,6}$' or public.abreviaturas_token_generico(v_ab)
       or length(v_prop) not between 3 and 80 or not public.abreviaturas_es_plausible(v_ab, v_prop)
       or not exists (select 1 from public.proveedores where id = v_prov)
       or exists (select 1 from public.abreviaturas_proveedor a where a.proveedor_id = v_prov and a.abreviatura = v_ab)
       or exists (select 1 from public.abreviaturas_avisos x where x.proveedor_id = v_prov and x.abreviatura = v_ab) then
      v_ign := v_ign + 1;
      continue;
    end if;
    select a.producto_id into v_prod from public.productos_alias a where a.texto_normalizado = v_texto;
    select pf.factura_id into v_fact
      from public.productos_factura pf join public.facturas f on f.id = pf.factura_id
     where f.proveedor_id = v_prov and pf.nombre_normalizado = v_texto
     order by pf.id desc limit 1;
    insert into public.abreviaturas_avisos (proveedor_id, abreviatura, propuesta, texto_linea, factura_id, producto_id)
    values (v_prov, v_ab, v_prop, v_texto, v_fact, v_prod)
    on conflict (proveedor_id, abreviatura) do nothing
    returning id into v_id;
    if v_id is null then v_ign := v_ign + 1; continue; end if;
    v_creados := v_creados + 1;
    begin
      select nombre into v_nprov from public.proveedores where id = v_prov;
      insert into public.notificaciones_dashboard (tipo, titulo, mensaje, referencia_id, referencia_tipo, prioridad, clave, datos)
      values (
        'facturas_abreviatura',
        left('«' || upper(v_ab) || '» parece ' || v_prop || '. ¿Confirmar?', 200),
        left(coalesce(v_nprov, 'Proveedor') || ' · línea «' || coalesce(v_texto, '') || '». Confírmala o corrígela en Facturas › Cargar.', 300),
        v_id, 'facturas_cargar', 'normal', 'abreviatura:' || v_prov || ':' || v_ab,
        jsonb_build_object('enlace', '/facturas?tab=cargar', 'aviso_id', v_id, 'proveedor_id', v_prov, 'abreviatura', v_ab, 'propuesta', v_prop)
      ) returning id into v_notif;
      update public.abreviaturas_avisos set notificacion_id = v_notif where id = v_id;
    exception when others then
      raise warning 'abreviaturas_proponer: aviso en la campana no creado (%)', sqlerrm;
    end;
    v_id := null;
  end loop;
  return jsonb_build_object('avisos_creados', v_creados, 'ignoradas', v_ign);
end;
$$;
revoke all on function public.abreviaturas_proponer(jsonb) from public, anon, authenticated;
grant execute on function public.abreviaturas_proponer(jsonb) to service_role;

drop function if exists public.abreviaturas_quitar(bigint);
drop function if exists public.abreviaturas_listar();
drop function if exists public.abreviaturas_excluida(bigint, text, text);
drop function if exists public.abreviaturas_expansion_valida(text);
drop function if exists public.abreviaturas_clave(text);
drop table if exists public.abreviaturas_excluidas;
