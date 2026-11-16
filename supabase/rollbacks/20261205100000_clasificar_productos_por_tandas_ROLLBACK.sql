-- Vuelta atrás de 20261205100000_clasificar_productos_por_tandas (solo funciones: no hay datos que deshacer).
-- Devuelve productos_aplicar_clasificacion_ia a la versión de 20261007160000 (UPDATE sin límite al final)
-- y productos_despachar_clasificacion a la de 20261106200000, y quita productos_asignar_por_alias.
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
  v_dest    bigint;
  v_cat     bigint;
  v_nombre  text;
  v_creados integer := 0;
  v_alias   integer := 0;
  v_lineas  integer := 0;
  n         integer;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'p_items tiene que ser una lista' using errcode = '22023';
  end if;
  for it in select value from jsonb_array_elements(p_items) loop
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
  update public.productos_factura pf
     set producto_id = a.producto_id
    from public.productos_alias a
   where pf.producto_id is null and a.texto_normalizado = pf.nombre_normalizado;
  get diagnostics v_lineas = row_count;
  return jsonb_build_object('productos_creados', v_creados, 'alias_creados', v_alias, 'lineas_asignadas', v_lineas);
end;
$$;
revoke all on function public.productos_aplicar_clasificacion_ia(jsonb) from public, anon, authenticated;
grant execute on function public.productos_aplicar_clasificacion_ia(jsonb) to service_role;

create or replace function public.productos_despachar_clasificacion()
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $function$
-- 20261106200000: la URL sale de Vault («project_url»).
declare
  v_url     text;
  v_secreto text;
begin
  if not exists (select 1 from public.productos_factura
                  where producto_id is null
                    and created_at > now() - interval '7 days'
                    and created_at < now() - interval '1 minute') then
    return 0;
  end if;
  v_url := public.url_funcion_edge('clasificar-productos');
  select s.decrypted_secret into v_secreto
    from vault.decrypted_secrets s where s.name = 'ocr_trabajos_secret' limit 1;
  if v_url is null or v_secreto is null or v_secreto = '' then
    return 0;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-ocr-secret', v_secreto),
    body := jsonb_build_object('modo', 'cron'),
    timeout_milliseconds := 10000);
  return 1;
end;
$function$;
revoke all on function public.productos_despachar_clasificacion() from public, anon, authenticated;
grant execute on function public.productos_despachar_clasificacion() to service_role;

drop function if exists public.productos_asignar_por_alias(text[], integer, integer);

select 'clasificar_productos_por_tandas: deshecha' as resultado;
