set client_encoding = 'UTF8';
-- ============================================================================
-- 20261205100000_clasificar_productos_por_tandas — «clasificar-productos» ya
-- no se corta por tiempo (CAS-7, 16/11/2026)
-- ----------------------------------------------------------------------------
-- QUÉ PASABA
--   El 15/11/2026, con la importación de 973 facturas históricas, la función
--   clasificar-productos falló 58 veces con «productos_aplicar_clasificacion_ia:
--   canceling statement due to statement timeout».
--   La RPC terminaba con un UPDATE sin límite de TODAS las líneas sin producto
--   que tuvieran alias. Cada línea que se asigna cuesta unos 5 ms (auditoría
--   por fila, 9 índices): 2.000 líneas son 9,5 s y PostgREST corta a los 8 s.
--   Al cortarse se deshacía TODO, también los productos y los alias que la IA
--   acababa de proponer: la llamada a la IA se había pagado para nada y la
--   pasada siguiente (cada 5 min) repetía lo mismo.
--
-- QUÉ HACE (idempotente)
--   1. productos_asignar_por_alias(textos, max_ms, lote): asigna producto a
--      las líneas sin producto cuyo texto ya tiene alias, por TANDAS (150
--      líneas) y con un TOPE DE TIEMPO. Lo que no cabe se queda para la
--      siguiente llamada y lo dice («quedan»). Nunca pisa una línea que ya
--      tiene producto. Solo service_role.
--   2. productos_aplicar_clasificacion_ia(items): igual que antes (crea los
--      productos y los alias que propone la IA; un alias que ya existe
--      manda), pero al final solo asigna las líneas DE LOS TEXTOS DE ESTA
--      LLAMADA y con 4 s de tope. Devuelve además «lineas_pendientes».
--   3. productos_despachar_clasificacion() (pg_cron, cada 5 min): antes de
--      llamar a la función asigna, sin IA, lo que ya tiene alias (hasta 15 s).
--      Si con eso no queda nada pendiente, NO llama a la función: no se gasta
--      IA en textos que ya se conocen.
--
-- No cambia datos: solo funciones.
--
-- APLICAR (una a una, nunca `db push`): demo primero (sfonaclosuafvlhutkon);
-- producción (haqmmdfdzzatdnrrcgez) solo tras aceptar el PR de la release y
-- con el «sí» del dueño:
--   supabase db query --linked -f supabase/migrations/20261205100000_clasificar_productos_por_tandas.sql
-- Tiene que terminar en «clasificar_productos_por_tandas: aplicada».
-- No hay que desplegar ninguna función (clasificar-productos no cambia).
-- Deshacer: supabase/rollbacks/20261205100000_clasificar_productos_por_tandas_ROLLBACK.sql
-- Pruebas: npm run test:clasificar-productos:db (PGlite, sin tocar Supabase).
-- ============================================================================

do $$
declare
  v_faltan text[] := '{}';
begin
  if to_regclass('public.productos_factura') is null then v_faltan := v_faltan || 'public.productos_factura'::text; end if;
  if to_regclass('public.productos_alias') is null then v_faltan := v_faltan || 'public.productos_alias (20261007160000)'::text; end if;
  if to_regclass('public.productos_catalogo') is null then v_faltan := v_faltan || 'public.productos_catalogo (20261007160000)'::text; end if;
  if to_regprocedure('public.url_funcion_edge(text)') is null then v_faltan := v_faltan || 'public.url_funcion_edge(text) (20261106200000)'::text; end if;
  if cardinality(v_faltan) > 0 then
    raise exception 'clasificar_productos_por_tandas: faltan %', array_to_string(v_faltan, ', ');
  end if;
end $$;

-- ─── 1. Asignar por alias, por tandas y con tope de tiempo ──────────────────
create or replace function public.productos_asignar_por_alias(
  p_textos text[] default null,
  p_max_ms integer default 4000,
  p_lote   integer default 150
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inicio timestamptz := clock_timestamp();
  v_lote   integer := greatest(1, least(coalesce(p_lote, 150), 1000));
  v_max_ms integer := greatest(0, least(coalesce(p_max_ms, 4000), 60000));
  v_total  integer := 0;
  v_n      integer;
  v_quedan boolean;
begin
  loop
    with objetivo as (
      select pf.id, a.producto_id
        from public.productos_factura pf
        join public.productos_alias a on a.texto_normalizado = pf.nombre_normalizado
       where pf.producto_id is null
         and (p_textos is null or pf.nombre_normalizado = any (p_textos))
       order by pf.id
       limit v_lote
         for update of pf skip locked
    )
    update public.productos_factura pf
       set producto_id = o.producto_id
      from objetivo o
     where pf.id = o.id;
    get diagnostics v_n = row_count;
    v_total := v_total + v_n;
    -- Tanda incompleta: no queda nada (o lo que queda lo tiene bloqueado otro).
    exit when v_n < v_lote;
    exit when extract(epoch from clock_timestamp() - v_inicio) * 1000 >= v_max_ms;
  end loop;
  select exists (
    select 1
      from public.productos_factura pf
      join public.productos_alias a on a.texto_normalizado = pf.nombre_normalizado
     where pf.producto_id is null
       and (p_textos is null or pf.nombre_normalizado = any (p_textos))
  ) into v_quedan;
  return jsonb_build_object('lineas_asignadas', v_total, 'quedan', v_quedan);
end;
$$;
comment on function public.productos_asignar_por_alias(text[], integer, integer) is
  'Asigna producto a las líneas sin producto cuyo texto ya tiene alias, por tandas (p_lote) y hasta p_max_ms. '
  'p_textos limita a esos textos normalizados (null = todos). Devuelve {lineas_asignadas, quedan}. Solo service_role.';
revoke all on function public.productos_asignar_por_alias(text[], integer, integer) from public, anon, authenticated;
grant execute on function public.productos_asignar_por_alias(text[], integer, integer) to service_role;

-- ─── 2. La RPC de la IA: solo las líneas de sus textos, con tope ────────────
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

-- ─── 3. El cron: primero lo que ya tiene alias (sin IA) ─────────────────────
create or replace function public.productos_despachar_clasificacion()
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $function$
-- 20261106200000: la URL sale de Vault («project_url»).
-- 20261205100000: antes de llamar a la función, lo que ya tiene alias se asigna aquí (sin IA).
declare
  v_url     text;
  v_secreto text;
begin
  perform public.productos_asignar_por_alias(null, 15000);
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

select 'clasificar_productos_por_tandas: aplicada' as resultado;
