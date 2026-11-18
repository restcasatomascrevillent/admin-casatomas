-- Vuelta atrás de 20261212600000_clasificar_productos_mas_margen (solo la función: no hay datos que deshacer).
-- Devuelve productos_aplicar_clasificacion_ia a la versión de 20261208100000 (4 s de tope y tandas de 150).
set lock_timeout = '5s';

create or replace function public.productos_aplicar_clasificacion_ia(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  it        jsonb;
  v_textos  text[];
  v_todos   text[] := '{}';
  v_dest    bigint;
  v_cat     bigint;
  v_nombre  text;
  v_creados integer := 0;
  v_alias   integer := 0;
  v_asig    jsonb;
  n         integer;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'p_items tiene que ser una lista' using errcode = '22023';
  end if;
  for it in select value from jsonb_array_elements(p_items) loop
    -- Todos los textos de la llamada (tengan ya alias o no): son los que se asignan al final.
    v_todos := v_todos || array(select distinct t from jsonb_array_elements_text(
                        case when jsonb_typeof(it->'textos') = 'array' then it->'textos' else '[]'::jsonb end) as t
                       where length(t) between 1 and 500);
    v_textos := array(select distinct t from jsonb_array_elements_text(
                        case when jsonb_typeof(it->'textos') = 'array' then it->'textos' else '[]'::jsonb end) as t
                       where length(t) between 1 and 500
                         and not exists (select 1 from public.productos_alias a where a.texto_normalizado = t));
    -- Textos que ya tienen alias: manda el alias (no se crea nada).
    continue when cardinality(v_textos) = 0;
    v_dest := null;
    if jsonb_typeof(it->'producto_id') = 'number' then
      select id into v_dest from public.productos_catalogo where id = (it->>'producto_id')::bigint;
    end if;
    if v_dest is null then
      v_nombre := btrim(regexp_replace(coalesce(it->>'nombre', ''), '\s+', ' ', 'g'));
      continue when length(v_nombre) not between 1 and 200;
      select id into v_dest from public.productos_catalogo where nombre_normalizado = public.normalizar_texto(v_nombre);
      if v_dest is null then
        v_cat := null;
        if jsonb_typeof(it->'categoria_id') = 'number' then
          select id into v_cat from public.categorias_producto where id = (it->>'categoria_id')::bigint and activa;
        end if;
        insert into public.productos_catalogo (nombre, categoria_id, unidad_habitual, origen)
        values (v_nombre, v_cat, nullif(left(btrim(coalesce(it->>'unidad', '')), 20), ''), 'ia')
        returning id into v_dest;
        v_creados := v_creados + 1;
      end if;
    end if;
    insert into public.productos_alias (texto_normalizado, producto_id, origen)
    select t, v_dest, 'ia' from unnest(v_textos) as t
    on conflict (texto_normalizado) do nothing;
    get diagnostics n = row_count;
    v_alias := v_alias + n;
  end loop;
  -- Antes: un UPDATE sin límite de TODAS las líneas con alias (se cortaba a los 8 s y se perdía
  -- todo lo anterior). Ahora: las de esta llamada, por tandas y con tope; el resto, el cron.
  if cardinality(v_todos) > 0 then
    v_asig := public.productos_asignar_por_alias(v_todos, 4000);
  end if;
  return jsonb_build_object(
    'productos_creados', v_creados,
    'alias_creados', v_alias,
    'lineas_asignadas', coalesce((v_asig->>'lineas_asignadas')::integer, 0),
    'lineas_pendientes', coalesce((v_asig->>'quedan')::boolean, false));
end;
$$;
revoke all on function public.productos_aplicar_clasificacion_ia(jsonb) from public, anon, authenticated;
grant execute on function public.productos_aplicar_clasificacion_ia(jsonb) to service_role;

select 'clasificar_productos_mas_margen: deshecha' as resultado;
