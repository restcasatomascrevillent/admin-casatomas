set client_encoding = 'UTF8';
-- ============================================================================
-- 20261212600000_clasificar_productos_mas_margen — «clasificar-productos» deja
-- de ir justa de tiempo (CAS-7 reabierta, 18/11/2026)
-- ----------------------------------------------------------------------------
-- QUÉ PASABA
--   El 18/11/2026 a las 13:00 (Madrid) se subieron 22 albaranes en 6 minutos y
--   la base de datos de producción fue a tope unos 3 minutos: se cortó todo lo
--   que pasaba de los 8 s de PostgREST, también productos_aplicar_clasificacion_ia.
--   Esta RPC, en un día normal, ya tardaba de media 3,4 s y hasta 7,5 s
--   (pg_stat_statements desde el 15/11): la parte de asignar líneas tenía 4 s de
--   tope y el resto (crear productos y alias para hasta 120 textos) no tenía
--   ninguno. No se perdió nada (el cron lo terminó), pero no tenía margen.
--
-- QUÉ HACE (idempotente; solo la función, ni tablas ni datos)
--   productos_aplicar_clasificacion_ia: igual que en 20261208100000, pero asigna
--   las líneas de sus textos con 1,5 s de tope (antes 4 s) y en tandas de 50
--   (antes 150), así el tope se comprueba más a menudo. Lo que no quepa lo dice
--   («lineas_pendientes») y lo asigna el cron «clasificar-productos» (cada 5 min,
--   productos_asignar_por_alias(null, 15000), sin el límite de 8 s).
--   La otra mitad del arreglo va en la Edge Function clasificar-productos: manda
--   los productos a esta RPC en tandas de 30 (antes, los 120 de golpe) y, si una
--   tanda se corta por tiempo, la reintenta.
--
-- APLICAR (una a una, nunca `db push`): demo primero (sfonaclosuafvlhutkon);
-- producción (haqmmdfdzzatdnrrcgez) solo tras aceptar el PR de la release y
-- con el «sí» del dueño:
--   supabase db query --linked -f supabase/migrations/20261212600000_clasificar_productos_mas_margen.sql
-- Tiene que terminar en «clasificar_productos_mas_margen: aplicada».
-- Desplegar también la función clasificar-productos (mismo PR). El orden da igual:
-- cada mitad funciona sola.
-- Deshacer: supabase/rollbacks/20261212600000_clasificar_productos_mas_margen_ROLLBACK.sql
-- Pruebas: npm run test:clasificar-productos:db (PGlite, sin tocar Supabase).
-- ============================================================================
set lock_timeout = '5s';

do $$
begin
  if to_regprocedure('public.productos_asignar_por_alias(text[],integer,integer)') is null then
    raise exception 'clasificar_productos_mas_margen: falta public.productos_asignar_por_alias (20261208100000)';
  end if;
end $$;

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
  -- 20261208100000: solo las líneas de esta llamada, por tandas y con tope; el resto, el cron.
  -- 20261212600000: tope de 1,5 s (antes 4 s) y tandas de 50 líneas (antes 150), para que la
  -- llamada entera quede lejos de los 8 s de PostgREST aunque la base vaya cargada. Lo que no
  -- quepa lo asigna el cron «clasificar-productos» (cada 5 min, sin ese límite).
  if cardinality(v_todos) > 0 then
    v_asig := public.productos_asignar_por_alias(v_todos, 1500, 50);
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

select 'clasificar_productos_mas_margen: aplicada' as resultado;
