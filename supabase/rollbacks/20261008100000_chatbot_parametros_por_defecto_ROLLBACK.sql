set client_encoding = 'UTF8';
-- ===========================================================================
-- ROLLBACK de supabase/migrations/20261008100000_chatbot_parametros_por_defecto.sql
-- ===========================================================================
-- No es una migración (ver supabase/rollbacks/README.md). Se ejecuta A MANO,
-- POR TERMINAL (no en el SQL Editor):
--   npx supabase db query --linked -f supabase/rollbacks/20261008100000_chatbot_parametros_por_defecto_ROLLBACK.sql
--
-- Devuelve las 6 RPC (compras_producto_agente, gasto_categorias_agente,
-- variacion_precios_agente, ranking_agente, estadisticas_globales_agente,
-- consulta_flexible_agente) a sus definiciones EXACTAS de antes (copiadas de
-- producción el 08/10/2026; md5 sin CR comprobado al final: si no cuadra,
-- aborta y no cambia nada). Mismas firmas y permisos. No toca tablas ni
-- datos. No hace falta revertir antes la chat-facturas: funciona con las dos
-- versiones (sin ultimo_dato ni una_compra, el modelo vuelve a necesitar otra
-- ronda). Se puede ejecutar dos veces.
-- Imprime «chatbot_parametros_por_defecto: revertida | funciones con la marca: 0».
-- ===========================================================================

begin;
set local lock_timeout = '5s';

-- ─── 1. compras_producto_agente (EXACTA de antes) ───────────────────────────
CREATE OR REPLACE FUNCTION public.compras_producto_agente(p_texto text, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_tipo text DEFAULT NULL::text, p_limite integer DEFAULT 10, p_orden text DEFAULT NULL::text, p_excluir text DEFAULT NULL::text, p_embedding vector DEFAULT NULL::vector)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  -- Relleno de la pregunta: no forma parte del producto («kilos de centollo»,
  -- «cajas de mayonesa»). Solo se quita del texto buscado, nunca del nombre.
  c_vacias constant text[] := array[
    'de', 'del', 'la', 'las', 'el', 'los', 'lo', 'y', 'e', 'o', 'con', 'para', 'en', 'al', 'a', 'por',
    'un', 'una', 'unos', 'unas', 'mi', 'mis'];
  c_relleno constant text[] := c_vacias || array[
    'kg', 'kgs', 'kilo', 'kilos', 'g', 'gr', 'grs', 'gramo', 'gramos', 'l', 'lt', 'lts', 'litro', 'litros',
    'ml', 'ud', 'uds', 'unidad', 'unidades', 'caja', 'cajas', 'bote', 'botes', 'botella', 'botellas',
    'cubo', 'cubos', 'paquete', 'paquetes', 'saco', 'sacos', 'bolsa', 'bolsas', 'lata', 'latas',
    'pieza', 'piezas'];
  c_max_variantes constant int := 15;
  v_lim    int := least(greatest(coalesce(p_limite, 10), 1), 50);
  v_orden  text := lower(coalesce(nullif(trim(p_orden), ''), 'importe'));
  v_tipo   text;
  v_todas  text[] := palabras_producto_agente(p_texto);
  v_pal    text[];
  v_rai    text[];
  v_excl   text[];
  v_frase  text;
  v_serv   boolean;
  v_ids    bigint[];
  v_aprox  boolean := false;
  v_sug    jsonb;
  v_sem    boolean;
  resultado jsonb;
begin
  -- ── Argumentos ──
  v_tipo := case
    when nullif(trim(coalesce(p_tipo, '')), '') is null or lower(trim(p_tipo)) in ('ambos', 'todos', 'todo') then null
    when lower(trim(p_tipo)) like 'factura%' then 'factura'
    when lower(trim(p_tipo)) like 'albar%' then 'albaran'
    else '?' end;
  if v_tipo = '?' then
    return json_build_object('error', 'tipo debe ser factura, albaran o null (ambos).');
  end if;
  if v_orden not in ('importe', 'cantidad', 'precio') then
    return json_build_object('error', 'orden debe ser importe, cantidad o precio.');
  end if;
  if p_desde is not null and p_hasta is not null and p_desde > p_hasta then
    return json_build_object('error', format('Rango invalido: desde (%s) es posterior a hasta (%s).', p_desde, p_hasta));
  end if;

  v_pal := array(select w from unnest(v_todas) w where not (w = any(c_relleno)));
  if cardinality(v_pal) = 0 then
    v_pal := v_todas;   -- «cajas» a secas: se busca tal cual
  end if;
  if cardinality(v_pal) = 0 then
    return json_build_object('error', 'Falta el nombre del producto.');
  end if;
  v_rai   := array(select distinct raiz_producto_agente(w) from unnest(v_pal) w);
  v_excl  := array(select distinct raiz_producto_agente(w)
                     from unnest(palabras_producto_agente(p_excluir)) w
                    where not (w = any(c_vacias)));   -- «caja» SÍ se puede excluir
  v_frase := array_to_string(v_pal, ' ');
  v_serv  := es_linea_servicio_agente(v_frase);

  -- ── 1-2. Exacta o por raíz (sobre TODAS las líneas: el periodo va luego) ──
  select array_agg(pf.id) into v_ids
    from productos_factura pf
   where raices_producto_agente(pf.nombre) @> v_rai
     and not (raices_producto_agente(pf.nombre) && v_excl)
     and (v_serv or not es_linea_servicio_agente(coalesce(pf.nombre_normalizado, pf.nombre)));

  -- ── 3. Aproximada (erratas), solo si 1-2 no dieron nada: cada palabra
  --    buscada de ≥ 4 letras casa con una palabra del nombre de longitud
  --    parecida (±2) y trigram similarity ≥ 0,4 (merlusa ~ merluza 0,45,
  --    centoya ~ centolla 0,42); las cortas, por raíz. La longitud evita
  --    que «salmon» caiga en «salmonete» o «pan» en «panceta».
  if v_ids is null then
    select array_agg(pf.id) into v_ids
      from productos_factura pf
     where not exists (
             select 1 from unnest(v_pal) qw
              where not exists (
                select 1 from unnest(palabras_producto_agente(pf.nombre)) nw
                 where raiz_producto_agente(nw) = raiz_producto_agente(qw)
                    or (length(qw) >= 4 and abs(length(nw) - length(qw)) <= 2
                        and extensions.similarity(qw, nw) >= 0.4)))
       and not (raices_producto_agente(pf.nombre) && v_excl)
       and (v_serv or not es_linea_servicio_agente(coalesce(pf.nombre_normalizado, pf.nombre)));
    v_aprox := v_ids is not null;
  end if;

  -- ── 4. Nada: sugerencias (semánticas si hay embedding, y por parecido) ──
  if v_ids is null then
    -- Agrupadas por sus palabras: «(B/2K)» y «(B/ 2K)» son la misma.
    select jsonb_agg(nombre order by pri, s desc), coalesce(bool_or(pri = 1), false)
      into v_sug, v_sem
      from (
        select min(nombre) as nombre, min(pri) as pri, max(s) as s
          from (
            select pf.nombre::text as nombre, 1 as pri, max(1 - (pf.embedding <=> p_embedding)) as s
              from productos_factura pf
             where p_embedding is not null and pf.embedding is not null
             group by pf.nombre
            having max(1 - (pf.embedding <=> p_embedding)) >= 0.3
            union all
            select pf.nombre::text, 2,
                   max(extensions.strict_word_similarity(v_frase, array_to_string(palabras_producto_agente(pf.nombre), ' ')))
              from productos_factura pf
             group by pf.nombre
            having max(extensions.strict_word_similarity(v_frase, array_to_string(palabras_producto_agente(pf.nombre), ' '))) >= 0.3
          ) x
         group by array_to_string(palabras_producto_agente(nombre), ' ')
         order by min(pri), max(s) desc
         limit 5
      ) y;

    return jsonb_strip_nulls(jsonb_build_object(
      'buscado',      p_texto,
      'coincidencia', case when v_sem then 'semantica' else 'ninguna' end,
      'sin_datos',    true,
      'sugerencias',  v_sug,
      'nota',         case when v_sug is not null then
                        'Ningun producto se llama asi; sugerencias = nombres parecidos, NO sumados: pregunta si es alguno.' end
    ))::json;
  end if;

  -- ── Agregación ──
  with base as (
    select pf.id, pf.nombre::text as nombre,
           coalesce(pf.nombre_normalizado::text, lower(pf.nombre)) as nom_n,
           pf.cantidad::numeric as cant,
           coalesce(nullif(pf.unidad::text, ''), 'ud') as unidad,
           coalesce(pf.total, round(pf.cantidad * pf.precio_unitario, 2))::numeric as imp,
           f.id as doc, f.tipo, f.fecha, f.proveedor,
           coalesce(nullif(f.proveedor_normalizado, ''), nullif(normalizar_proveedor(f.proveedor), ''), '?') as prov_n,
           fecha_dudosa_agente(f.alertas_validacion) as fd,
           palabras_producto_agente(pf.nombre) @> v_pal as exacta
      from productos_factura pf
      join facturas f on f.id = pf.factura_id
     where pf.id = any(v_ids)
  ),
  filtrada as (
    select * from base
     where (p_desde is null or fecha >= p_desde)
       and (p_hasta is null or fecha <= p_hasta)
       and (v_tipo is null or tipo = v_tipo)
  ),
  -- Albarán cuya línea ya está en una factura del mismo proveedor: no se cuenta.
  ya_facturados as (
    select a.id
      from filtrada a
     where a.tipo = 'albaran'
       and exists (
         select 1 from filtrada x
          where x.tipo = 'factura'
            and x.unidad = a.unidad
            and x.cant = a.cant
            and x.nom_n = a.nom_n
            and (x.prov_n = a.prov_n
                 or (length(x.prov_n) >= 4 and length(a.prov_n) >= 4
                     and (position(x.prov_n in a.prov_n) > 0 or position(a.prov_n in x.prov_n) > 0)))
            and x.fecha between a.fecha - 7 and a.fecha + 75)
  ),
  c as (
    select * from filtrada where id not in (select id from ya_facturados)
  ),
  por_unidad as (
    select unidad,
           sum(cant) as cant,
           sum(imp) as imp,
           sum(imp) filter (where imp > 0 and cant > 0)
             / nullif(sum(cant) filter (where imp > 0 and cant > 0), 0) as precio,
           count(*) as lineas,
           count(distinct doc) as compras,
           count(*) filter (where tipo = 'albaran') as lin_alb,
           sum(cant) filter (where tipo = 'albaran') as cant_alb,
           sum(imp) filter (where tipo = 'albaran') as imp_alb
      from c
     group by unidad
  ),
  por_prov as (
    select prov_n, unidad,
           (array_agg(proveedor order by fecha desc nulls last))[1] as proveedor,
           sum(cant) as cant,
           sum(imp) as imp,
           sum(imp) filter (where imp > 0 and cant > 0)
             / nullif(sum(cant) filter (where imp > 0 and cant > 0), 0) as precio,
           count(distinct doc) as compras,
           min(fecha) as primera,
           max(fecha) as ultima,
           case when bool_and(tipo = 'albaran') then 'albaran'
                when bool_or(tipo = 'albaran') then 'factura+albaran' end as tipo
      from c
     group by prov_n, unidad
  ),
  ordenada as (
    select p.*,
           row_number() over (
             order by u.imp desc nulls last, u.cant desc nulls last, p.unidad,
                      case when v_orden = 'cantidad' then p.cant end desc nulls last,
                      case when v_orden = 'precio' then p.precio end asc nulls last,
                      p.imp desc nulls last, p.cant desc nulls last, p.proveedor) as rn,
           count(*) over () as n
      from por_prov p
      join por_unidad u using (unidad)
  ),
  -- Variantes agrupadas por sus palabras («20% nata» = «20%nata»).
  variantes as (
    select mode() within group (order by nombre) as nombre,
           count(*) as lineas, bool_and(exacta) as exacta, max(fecha) as ultima
      from c
     group by array_to_string(palabras_producto_agente(nombre), ' ')
  ),
  marco as (
    select count(*) as lineas,
           count(distinct doc) as compras,
           count(distinct prov_n) as proveedores,
           count(distinct unidad) as unidades,
           sum(imp) as imp,
           count(*) filter (where imp is null or imp = 0) as sin_importe,
           count(*) filter (where cant is null or cant = 0) as sin_cantidad,
           count(distinct doc) filter (where fd) as fecha_dudosa,
           count(*) filter (where tipo = 'albaran') as lin_alb,
           coalesce(bool_and(exacta), false) as todas_exactas,
           coalesce(bool_or(exacta), false) as alguna_exacta
      from c
  )
  select jsonb_strip_nulls(jsonb_build_object(
    'buscado',  p_texto,
    'excluido', nullif(trim(coalesce(p_excluir, '')), ''),
    'periodo',  case when p_desde is not null or p_hasta is not null
                     then jsonb_build_object('desde', p_desde, 'hasta', p_hasta) end,
    'tipo',     v_tipo,
    'coincidencia', (
      select case when v_aprox then 'aproximada'
                  when m.lineas = 0 then null
                  when m.todas_exactas then 'exacta'
                  when m.alguna_exacta then 'exacta+raiz'
                  else 'raiz' end
        from marco m),
    'productos_coincidentes', (
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'nombre', v.nombre,
               'lineas', v.lineas,
               'coincidencia', case when not v_aprox and m.alguna_exacta and not m.todas_exactas and not v.exacta
                                    then 'raiz' end))
             order by v.lineas desc, v.ultima desc nulls last, v.nombre)
        from (select * from variantes order by lineas desc, ultima desc nulls last, nombre limit c_max_variantes) v
       cross join marco m),
    'variantes_total', (select case when count(*) > c_max_variantes then count(*) end from variantes),
    'total', (
      select case when m.lineas > 0 then jsonb_build_object(
               'importe',     trim_scale(round(m.imp, 2)),
               'lineas',      m.lineas,
               'compras',     m.compras,
               'proveedores', m.proveedores) end
        from marco m),
    'por_unidad', (
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'unidad',       u.unidad,
               'cantidad',     trim_scale(round(u.cant, 3)),
               'importe',      trim_scale(round(u.imp, 2)),
               'precio_medio', trim_scale(round(u.precio, case when u.precio < 1 then 4 else 2 end)),
               'lineas',       u.lineas,
               'compras',      u.compras,
               'de_albaranes', case when u.lin_alb > 0 then jsonb_build_object(
                                 'cantidad', trim_scale(round(u.cant_alb, 3)),
                                 'importe',  trim_scale(round(u.imp_alb, 2))) end))
             order by u.imp desc nulls last, u.cant desc nulls last, u.unidad)
        from por_unidad u),
    'por_proveedor', (
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'proveedor',    o.proveedor,
               'unidad',       o.unidad,
               'cantidad',     trim_scale(round(o.cant, 3)),
               'importe',      trim_scale(round(o.imp, 2)),
               'precio_medio', trim_scale(round(o.precio, case when o.precio < 1 then 4 else 2 end)),
               'compras',      o.compras,
               'primera',      o.primera,
               'ultima',       case when o.ultima <> o.primera then o.ultima end,
               'tipo',         o.tipo))
             order by o.rn)
        from ordenada o
       where o.rn <= v_lim),
    'truncado',    (select case when max(n) > v_lim then true end from ordenada),
    'filas_total', (select case when max(n) > v_lim then max(n) end from ordenada),
    'incluye_albaranes', (select case when m.lin_alb > 0 then true end from marco m),
    'criterio', (
      select case when m.lin_alb > 0 or exists (select 1 from ya_facturados) then
        'Suma facturas y albaranes (lo recibido); no cuenta el albaran cuya linea ya esta en una factura del proveedor.' end
        from marco m),
    'avisos', (
      select nullif(jsonb_strip_nulls(jsonb_build_object(
               'sin_importe',             nullif(m.sin_importe, 0),
               'sin_cantidad',            nullif(m.sin_cantidad, 0),
               'fecha_dudosa',            nullif(m.fecha_dudosa, 0),
               'unidades_mezcladas',      case when m.unidades > 1 then true end,
               'albaranes_ya_facturados', nullif((select count(*) from ya_facturados), 0))), '{}'::jsonb)
        from marco m),
    'sin_datos', (select case when m.lineas = 0 then true end from marco m),
    'fuera_del_filtro', (
      select case when m.lineas = 0 then (
               select jsonb_strip_nulls(jsonb_build_object(
                        'lineas',    count(*),
                        'primera',   min(b.fecha),
                        'ultima',    max(b.fecha),
                        'tipos',     string_agg(distinct b.tipo, ','),
                        'productos', (select jsonb_agg(distinct b2.nombre) from (select nombre from base limit 5) b2)))
                 from base b) end
        from marco m)
  )) into resultado;

  return resultado::json;
end;
$function$;

-- ─── 2. gasto_categorias_agente (EXACTA de antes) ───────────────────────────
CREATE OR REPLACE FUNCTION public.gasto_categorias_agente(p_categoria text DEFAULT NULL::text, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_tipo text DEFAULT NULL::text, p_agrupar text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  c_top        constant int := 8;
  c_max_cruce  constant int := 60;
  v_tipo   text;
  v_agr    text;
  v_cat    categorias_producto%rowtype;
  v_madre  text;
  resultado jsonb;
begin
  -- ── Argumentos ──
  v_tipo := case
    when nullif(trim(coalesce(p_tipo, '')), '') is null or lower(trim(p_tipo)) in ('ambos', 'todos', 'todo') then null
    when lower(trim(p_tipo)) like 'factura%' then 'factura'
    when lower(trim(p_tipo)) like 'albar%' then 'albaran'
    else '?' end;
  if v_tipo = '?' then
    return json_build_object('error', 'tipo debe ser factura, albaran o null (ambos).');
  end if;
  v_agr := case
    when nullif(trim(coalesce(p_agrupar, '')), '') is null then null
    when lower(trim(p_agrupar)) like 'mes%' then 'mes'
    when lower(trim(p_agrupar)) like 'proveedor%' then 'proveedor'
    else '?' end;
  if v_agr = '?' then
    return json_build_object('error', 'agrupar debe ser mes, proveedor o null.');
  end if;
  if p_desde is not null and p_hasta is not null and p_desde > p_hasta then
    return json_build_object('error', format('Rango invalido: desde (%s) es posterior a hasta (%s).', p_desde, p_hasta));
  end if;
  if nullif(trim(coalesce(p_categoria, '')), '') is not null then
    select * into v_cat from categorias_producto where id = categoria_agente(p_categoria);
    if v_cat.id is null then
      return json_build_object(
        'error', format('No hay ninguna categoria "%s".', p_categoria),
        'categorias', (select json_agg(c.nombre || coalesce(' (' || (
                          select string_agg(s.nombre, ', ' order by s.orden, s.nombre)
                            from categorias_producto s where s.padre_id = c.id and s.activa) || ')', '')
                          order by c.orden, c.nombre)
                         from categorias_producto c where c.padre_id is null and c.activa));
    end if;
    select nombre into v_madre from categorias_producto where id = v_cat.padre_id;
  end if;

  with base as (
    select pf.id, pf.producto_id,
           coalesce(pf.nombre_normalizado::text, lower(pf.nombre)) as nom_n,
           pf.cantidad::numeric as cant,
           coalesce(nullif(btrim(pf.unidad::text), ''), 'ud') as unidad,
           coalesce(pf.total, round(pf.cantidad * pf.precio_unitario, 2))::numeric as imp,
           f.id as doc, f.tipo::text as tipo, f.fecha, f.proveedor::text as proveedor,
           coalesce(nullif(f.proveedor_normalizado::text, ''), nullif(normalizar_proveedor(f.proveedor), ''), '?') as prov_n,
           p.nombre as producto,
           c.id as cat_id,
           coalesce(m.id, c.id) as madre_id,
           coalesce(m.nombre, c.nombre) as madre,
           c.nombre as cat,
           coalesce(m.orden, c.orden) as orden
      from productos_factura pf
      join facturas f on f.id = pf.factura_id
      left join productos_catalogo p   on p.id = pf.producto_id
      left join categorias_producto c  on c.id = p.categoria_id
      left join categorias_producto m  on m.id = c.padre_id
     where (p_desde is null or f.fecha >= p_desde)
       and (p_hasta is null or f.fecha <= p_hasta)
       and (v_tipo is null or f.tipo = v_tipo)
  ),
  -- Albarán cuya línea ya está en una factura del mismo proveedor: no se cuenta.
  ya_facturados as (
    select a.id from base a
     where a.tipo = 'albaran'
       and exists (select 1 from base x
                    where x.tipo = 'factura' and x.unidad = a.unidad and x.cant = a.cant and x.nom_n = a.nom_n
                      and mismo_proveedor_agente(x.prov_n, a.prov_n)
                      and x.fecha between a.fecha - 7 and a.fecha + 75)
  ),
  todo as (select * from base where id not in (select id from ya_facturados)),
  -- Lo que se pregunta: la categoría (con sus subcategorías) o todo.
  l as (
    select * from todo
     where v_cat.id is null or cat_id = v_cat.id or madre_id = v_cat.id
  ),
  -- Fila de reparto: categoría madre y subcategoría (o sin clasificar / sin categoría).
  g as (
    select case when producto_id is null then 'Sin clasificar'
                when cat_id is null then 'Sin categoria'
                else madre end as grupo,
           case when cat_id is not null and cat_id <> madre_id then cat end as sub,
           orden, imp, id, doc,
           -- Clave del cruce y su etiqueta (el proveedor, agrupado por su nombre normalizado).
           case when v_agr = 'mes' then to_char(fecha, 'YYYY-MM') else prov_n end as k,
           case when v_agr = 'mes' then to_char(fecha, 'YYYY-MM') else proveedor end as etq
      from l
  ),
  marco as (
    select count(*) as lineas, count(distinct doc) as docs, count(distinct producto_id) as productos,
           sum(imp) as imp,
           sum(imp) filter (where tipo = 'albaran') as imp_alb,
           count(*) filter (where imp is null) as sin_importe,
           count(*) filter (where tipo = 'albaran') as lin_alb
      from l
  ),
  total_periodo as (select sum(imp) as imp from todo),
  sin_clas as (
    select count(*) as lineas, sum(imp) as imp from todo where producto_id is null
  ),
  reparto as (
    select grupo, min(orden) as orden, sum(imp) as imp, count(*) as lineas,
           (select jsonb_agg(jsonb_build_object('categoria', s.sub, 'importe', trim_scale(round(s.imp, 2)), 'lineas', s.lineas)
                             order by s.imp desc nulls last, s.sub)
              from (select g2.sub, sum(g2.imp) as imp, count(*) as lineas
                      from g g2 where g2.grupo = g.grupo and g2.sub is not null group by g2.sub) s) as subs
      from g group by grupo
  ),
  top as (
    select producto, sum(imp) as imp,
           (select jsonb_object_agg(u.unidad, trim_scale(round(u.cant, 3)))
              from (select l2.unidad, sum(l2.cant) as cant from l l2 where l2.producto = l.producto group by l2.unidad) u) as cant,
           count(*) over () as n
      from l where producto is not null
     group by producto
  ),
  cruce as (
    select case when v_cat.id is null then grupo end as grupo,
           (array_agg(etq order by etq))[1] as clave,
           sum(imp) as imp, count(*) as lineas
      from g
     where v_agr is not null
     group by 1, k
  ),
  cruce_n as (
    select c.*, row_number() over (
             order by case when v_agr = 'mes' then c.clave end,
                      c.imp desc nulls last, c.grupo, c.clave) as rn,
           count(*) over () as n
      from cruce c
  )
  select jsonb_strip_nulls(jsonb_build_object(
    'categoria', case when v_cat.id is not null then v_cat.nombre end,
    'madre',     v_madre,
    'periodo',   case when p_desde is not null or p_hasta is not null
                      then jsonb_build_object('desde', p_desde, 'hasta', p_hasta) end,
    'tipo',      v_tipo,
    'total', (select case when m.lineas > 0 then jsonb_strip_nulls(jsonb_build_object(
                'importe',      trim_scale(round(m.imp, 2)),
                'lineas',       m.lineas,
                'documentos',   m.docs,
                'productos',    case when v_cat.id is not null then m.productos end,
                'pct_del_gasto', case when v_cat.id is not null and tp.imp > 0 then round(100 * m.imp / tp.imp, 1) end,
                'de_albaranes', case when m.lin_alb > 0 then trim_scale(round(m.imp_alb, 2)) end)) end
                from marco m cross join total_periodo tp),
    -- Sin categoría: madres con sus subcategorías. Con una madre: sus subcategorías.
    'categorias', case when v_cat.id is null then (
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                 'categoria', r.grupo,
                 'importe',   trim_scale(round(r.imp, 2)),
                 'pct',       case when tp.imp > 0 then round(100 * r.imp / tp.imp, 1) end,
                 'lineas',    r.lineas,
                 'sub',       r.subs))
               order by r.imp desc nulls last, r.orden, r.grupo)
          from reparto r cross join total_periodo tp
         where r.grupo not in ('Sin clasificar', 'Sin categoria')) end,
    'subcategorias', case when v_cat.id is not null and v_cat.padre_id is null then (
        select r.subs from reparto r limit 1) end,
    'sin_categoria', case when v_cat.id is null then (
        select jsonb_build_object('importe', trim_scale(round(r.imp, 2)), 'lineas', r.lineas)
          from reparto r where r.grupo = 'Sin categoria') end,
    'top_productos', case when v_cat.id is not null then (
        select jsonb_agg(jsonb_build_object('producto', t.producto, 'importe', trim_scale(round(t.imp, 2)), 'cantidad', t.cant)
                         order by t.imp desc nulls last, t.producto)
          from (select * from top order by imp desc nulls last, producto limit c_top) t) end,
    'productos_total', case when v_cat.id is not null then (select case when max(n) > c_top then max(n) end from top) end,
    'cruce', (
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                 'categoria', c.grupo,
                 v_agr,        c.clave,
                 'importe',   trim_scale(round(c.imp, 2)),
                 'lineas',    c.lineas))
               order by c.rn)
          from cruce_n c where c.rn <= c_max_cruce),
    'cruce_truncado', (select case when max(n) > c_max_cruce then true end from cruce_n),
    'sin_clasificar', (select case when s.lineas > 0 then jsonb_build_object(
                         'lineas', s.lineas, 'importe', trim_scale(round(s.imp, 2))) end from sin_clas s),
    'incluye_albaranes', (select case when m.lin_alb > 0 then true end from marco m),
    'criterio', (select case when m.lin_alb > 0 or exists (select 1 from ya_facturados) then
        'Suma facturas y albaranes (lo recibido); no cuenta el albaran cuya linea ya esta en una factura del proveedor.' end
        from marco m),
    'avisos', (select nullif(jsonb_strip_nulls(jsonb_build_object(
                 'sin_importe',             nullif(m.sin_importe, 0),
                 'albaranes_ya_facturados', nullif((select count(*) from ya_facturados), 0))), '{}'::jsonb)
                 from marco m),
    'nota', 'Importes de linea: base SIN IVA.',
    'sin_datos', (select case when m.lineas = 0 then true end from marco m),
    'ultima_compra', case when v_cat.id is not null and (select lineas from marco) = 0 then (
        select max(f.fecha)
          from productos_factura pf
          join facturas f on f.id = pf.factura_id
          join productos_catalogo p on p.id = pf.producto_id
          join categorias_producto c on c.id = p.categoria_id
         where c.id = v_cat.id or c.padre_id = v_cat.id) end
  )) into resultado;

  return resultado::json;
end;
$function$;

-- ─── 3. variacion_precios_agente (EXACTA de antes) ──────────────────────────
CREATE OR REPLACE FUNCTION public.variacion_precios_agente(p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_umbral_pct numeric DEFAULT 10, p_categoria text DEFAULT NULL::text, p_producto text DEFAULT NULL::text, p_limite integer DEFAULT 10, p_sentido text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  c_vacias constant text[] := array['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'o', 'en', 'kg', 'kilo', 'kilos',
                                    'precio', 'precios'];
  v_lim     int := least(greatest(coalesce(p_limite, 10), 1), 50);
  v_umbral  numeric := coalesce(p_umbral_pct, 10);
  v_sentido text := lower(coalesce(nullif(trim(p_sentido), ''), 'subidas'));
  v_cat     categorias_producto%rowtype;
  v_prods   bigint[];
  v_rai     text[];
  resultado jsonb;
begin
  v_sentido := case when v_sentido like 'sub%' then 'subidas' when v_sentido like 'baj%' then 'bajadas'
                    when v_sentido in ('ambas', 'ambos', 'todas', 'todo') then 'ambas' else '?' end;
  if v_sentido = '?' then
    return json_build_object('error', 'sentido debe ser subidas, bajadas o ambas.');
  end if;
  if v_umbral < 0 or v_umbral > 1000 then
    return json_build_object('error', 'umbral_pct debe estar entre 0 y 1000.');
  end if;
  if p_desde is not null and p_hasta is not null and p_desde > p_hasta then
    return json_build_object('error', format('Rango invalido: desde (%s) es posterior a hasta (%s).', p_desde, p_hasta));
  end if;
  if nullif(trim(coalesce(p_categoria, '')), '') is not null then
    select * into v_cat from categorias_producto where id = categoria_agente(p_categoria);
    if v_cat.id is null then
      return json_build_object('error', format('No hay ninguna categoria "%s".', p_categoria));
    end if;
  end if;
  if nullif(trim(coalesce(p_producto, '')), '') is not null then
    v_rai := array(select distinct raiz_producto_agente(w) from unnest(palabras_producto_agente(p_producto)) w
                    where not (w = any(c_vacias)));
    if cardinality(v_rai) = 0 then
      return json_build_object('error', 'Falta el nombre del producto.');
    end if;
    v_prods := array(
      select p.id from productos_catalogo p where raices_producto_agente(p.nombre) @> v_rai
      union
      select a.producto_id from productos_alias a where raices_producto_agente(a.texto_normalizado) @> v_rai);
    if cardinality(v_prods) = 0 then
      return jsonb_build_object('buscado', p_producto, 'sin_datos', true,
        'nota', 'Ningun producto del catalogo se llama asi: prueba compras_producto o historial_precios.')::json;
    end if;
  end if;

  with l as (
    select x.*, p.nombre as producto
      from lineas_precio_agente() x
      join productos_catalogo p on p.id = x.producto_id
      left join categorias_producto c on c.id = p.categoria_id
      left join categorias_producto m on m.id = c.padre_id
     where (v_prods is null or x.producto_id = any(v_prods))
       and (v_cat.id is null or c.id = v_cat.id or c.padre_id = v_cat.id)
       -- Servicios (portes, reparaciones…) fuera salvo que se pidan.
       and (v_cat.id is not null or v_prods is not null or coalesce(m.clave, c.clave, '') <> 'servicios')
  ),
  -- Última compra de cada producto y unidad dentro del periodo.
  ult_doc as (
    select distinct on (producto_id, unidad) producto_id, unidad, factura_id, fecha, tipo, proveedor, prov_n, producto
      from l
     where (p_desde is null or fecha >= p_desde) and (p_hasta is null or fecha <= p_hasta)
     order by producto_id, unidad, fecha desc, factura_id desc
  ),
  ult as (
    select u.*,
           (select coalesce(sum(l.precio * l.cantidad) filter (where l.cantidad > 0)
                              / nullif(sum(l.cantidad) filter (where l.cantidad > 0), 0), avg(l.precio))
              from l where l.factura_id = u.factura_id and l.producto_id = u.producto_id and l.unidad = u.unidad) as precio
      from ult_doc u
  ),
  cmp as (
    select u.*, r.precio as ref_precio, r.compras as ref_compras, r.desde as ref_desde, r.hasta as ref_hasta,
           r.proveedor as ref_proveedor, r.metodo,
           case when r.precio > 0 then round((u.precio / r.precio - 1) * 100, 1) end as var,
           r.precio is not null and not (u.prov_n = any(r.proveedores_n)) as cambio
      from ult u
      left join lateral precio_referencia_agente(u.producto_id, u.unidad, u.fecha, u.factura_id) r on true
  ),
  sel as (
    select c.*, row_number() over (
             order by case when v_sentido = 'bajadas' then c.var end asc nulls last,
                      case when v_sentido = 'ambas' then abs(c.var) end desc nulls last,
                      c.var desc nulls last, c.producto) as rn,
           count(*) over () as n
      from cmp c
     where c.var is not null
       and (v_prods is not null
            or (v_sentido = 'subidas' and c.var >= v_umbral)
            or (v_sentido = 'bajadas' and c.var <= -v_umbral)
            or (v_sentido = 'ambas' and abs(c.var) >= v_umbral))
  )
  select jsonb_strip_nulls(jsonb_build_object(
    'criterio', 'Por producto y unidad: precio de la ultima compra frente a la media ponderada de las compras de los '
                || '90 dias anteriores (o de las 3 ultimas compras anteriores si en 90 dias hay menos de 2). '
                || 'Precios de linea SIN IVA.'
                || case when v_prods is not null then ' Producto pedido: todas sus unidades, sin umbral.' else '' end,
    'buscado',   p_producto,
    'categoria', v_cat.nombre,
    'periodo',   case when p_desde is not null or p_hasta is not null
                      then jsonb_build_object('desde', p_desde, 'hasta', p_hasta) end,
    'sentido',   case when v_prods is null then v_sentido end,
    'umbral_pct', case when v_prods is null then trim_scale(v_umbral) end,
    'productos', coalesce((
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                 'producto',       s.producto,
                 'unidad',         s.unidad,
                 'precio',         trim_scale(round(s.precio, 4)),
                 'fecha',          s.fecha,
                 'proveedor',      s.proveedor,
                 'tipo',           case when s.tipo = 'albaran' then 'albaran' end,
                 'variacion_pct',  s.var,
                 'ref_precio',     trim_scale(round(s.ref_precio, 4)),
                 'ref_compras',    s.ref_compras,
                 'ref_desde',      s.ref_desde,
                 'ref_hasta',      case when s.ref_hasta <> s.ref_desde then s.ref_hasta end,
                 'ref_proveedor',  case when s.cambio or s.ref_proveedor is distinct from s.proveedor then s.ref_proveedor end,
                 'cambio_proveedor', case when s.cambio then true end,
                 'pocas_compras',  case when s.ref_compras = 1 then true end,
                 'ref_antigua',    case when s.metodo = 'ultimas_compras' and s.ref_hasta < s.fecha - 90 then true end))
               order by s.rn)
          from sel s where s.rn <= v_lim), '[]'::jsonb),
    'total_productos', (select coalesce(max(n), 0) from sel),
    'truncado',  (select case when max(n) > v_lim then true end from sel),
    'comparados', (select count(*) from cmp where var is not null),
    'avisos', nullif(jsonb_strip_nulls(jsonb_build_object(
        'sin_referencia', nullif((select count(*) from cmp where var is null), 0),
        'pocas_compras',  nullif((select count(*) from sel where ref_compras = 1 and rn <= v_lim), 0),
        'cambio_proveedor', nullif((select count(*) from sel where cambio and rn <= v_lim), 0),
        'sin_clasificar', nullif((select count(*) from productos_factura pf join facturas f on f.id = pf.factura_id
                                   where pf.producto_id is null
                                     and (p_desde is null or f.fecha >= p_desde)
                                     and (p_hasta is null or f.fecha <= p_hasta)), 0))), '{}'::jsonb),
    'sin_datos', (select case when count(*) = 0 then true end from cmp)
  )) into resultado;

  return resultado::json;
end;
$function$;

-- ─── 4. ranking_agente (EXACTA de antes) ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ranking_agente(p_criterio text, p_tipo text DEFAULT NULL::text, p_limite integer DEFAULT 10, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_orden text DEFAULT 'desc'::text, p_incluir_servicios boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  c_criterios constant text[] := array['precio_unitario', 'importe_linea', 'cantidad', 'veces', 'gasto_proveedor', 'importe_documento'];
  v_crit  text := lower(trim(coalesce(p_criterio, '')));
  v_tipo  text := lower(trim(coalesce(p_tipo, '')));
  v_ord   text := lower(trim(coalesce(nullif(p_orden, ''), 'desc')));
  v_lim   int  := least(greatest(coalesce(p_limite, 10), 1), 50);
  v_serv  boolean := coalesce(p_incluir_servicios, false);
  v_asc   boolean;
  v_filas json;
  v_total int;
  v_excl  json;
  v_sint  jsonb;
  v_ded   jsonb;
  v_txt   text;
  v_unid  json;
begin
  if not v_crit = any(c_criterios) then
    return json_build_object('error', format('Criterio "%s" no valido.', p_criterio), 'permitidos', to_json(c_criterios));
  end if;
  v_tipo := case when v_tipo like 'albar%' then 'albaran'
                 when v_tipo like 'factura%' then 'factura'
                 when v_tipo in ('', 'ambos', 'todos') then null
                 else '#' end;
  if v_tipo = '#' then
    return json_build_object('error', format('Tipo "%s" no valido.', p_tipo), 'permitidos', json_build_array('factura', 'albaran', null));
  end if;
  if v_ord not in ('asc', 'desc') then
    return json_build_object('error', format('Orden "%s" no valido.', p_orden), 'permitidos', json_build_array('asc', 'desc'));
  end if;
  if p_desde is not null and p_hasta is not null and p_desde > p_hasta then
    return json_build_object('error', format('El rango es invalido: desde (%s) es posterior a hasta (%s).', p_desde, p_hasta));
  end if;
  v_asc := v_ord = 'asc';

  if v_crit in ('precio_unitario', 'importe_linea') then
    with l as (
      select pf.id, pf.nombre, coalesce(pf.nombre_normalizado, lower(pf.nombre)) as clave,
             pf.cantidad, pf.unidad, pf.precio_unitario, pf.total,
             f.tipo, f.proveedor, f.numero_documento, f.fecha,
             case when v_crit = 'precio_unitario' then pf.precio_unitario else pf.total end as valor,
             es_linea_servicio_agente(coalesce(pf.nombre_normalizado, pf.nombre))           as servicio
        from productos_factura pf
        join facturas f on f.id = pf.factura_id
       where (v_tipo is null or f.tipo = v_tipo)
         and (p_desde is null or f.fecha >= p_desde)
         and (p_hasta is null or f.fecha <= p_hasta)
    ),
    validas as (select * from l where valor is not null and valor > 0),
    uno as (  -- una fila por producto: su línea más cara (o más barata)
      select distinct on (clave) *
        from validas
       where v_serv or not servicio
       order by clave,
                case when v_asc then valor end asc,
                case when not v_asc then valor end desc,
                fecha desc, id
    ),
    o as (
      select *, row_number() over (order by case when v_asc then valor end asc,
                                            case when not v_asc then valor end desc,
                                            fecha desc, id) as n,
             count(*) over () as total_filas
        from uno
    )
    select
      (select coalesce(max(total_filas), 0) from o),
      (select coalesce(json_agg(jsonb_strip_nulls(jsonb_build_object(
                 'producto',        nombre,
                 'precio_unitario', round(precio_unitario::numeric, case when abs(precio_unitario) < 1 then 4 else 2 end),
                 'cantidad',        cantidad,
                 'unidad',          unidad,
                 'importe',         round(total::numeric, 2),
                 'proveedor',       proveedor,
                 'numero',          numero_documento,
                 'fecha',           fecha,
                 'tipo',            tipo)) order by n), '[]'::json)
         from o where n <= v_lim),
      (select case when count(*) > 0 and not v_serv then
                json_build_object('n', count(*),
                  'mayores', (select json_agg(json_build_object('producto', s.nombre, 'valor', round(s.valor::numeric, 2)) order by s.valor desc)
                                from (select nombre, valor from validas where servicio order by valor desc limit 3) s))
              end
         from validas where servicio)
    into v_total, v_filas, v_excl;

    v_txt := case when v_crit = 'precio_unitario'
                  then 'Precio unitario de linea SIN IVA'
                  else 'Importe de linea (cantidad x precio) SIN IVA' end
             || '; una fila por producto con su valor mas ' || case when v_asc then 'bajo' else 'alto' end
             || '; sin valores vacios ni a 0'
             || case when v_serv then '; incluye servicios' else '; excluye servicios (portes, trabajos, mano de obra, gestion...)' end;

  elsif v_crit in ('cantidad', 'veces') then
    with l as (
      select pf.id, pf.nombre, coalesce(pf.nombre_normalizado, lower(pf.nombre)) as clave,
             pf.cantidad, pf.unidad, pf.total,
             es_linea_servicio_agente(coalesce(pf.nombre_normalizado, pf.nombre)) as servicio
        from productos_factura pf
        join facturas f on f.id = pf.factura_id
       where (v_tipo is null or f.tipo = v_tipo)
         and (p_desde is null or f.fecha >= p_desde)
         and (p_hasta is null or f.fecha <= p_hasta)
    ),
    g as (
      -- cantidad: se agrupa por producto Y unidad (no se suman kg con unidades)
      select max(nombre)                                                  as producto,
             max(unidad)                                                  as unidad,
             count(*)                                                     as veces,
             case when v_crit = 'cantidad' or count(distinct unidad) <= 1
                  then round(sum(cantidad)::numeric, 2) end              as cantidad,
             round(sum(total)::numeric, 2)                                as importe,
             case when v_crit = 'cantidad' then sum(cantidad) else count(*)::numeric end as valor
        from l
       where (v_serv or not servicio)
         and (v_crit = 'veces' or (cantidad is not null and cantidad > 0))
       group by clave, case when v_crit = 'cantidad' then unidad end
    ),
    o as (
      select *, row_number() over (order by case when v_asc then valor end asc,
                                            case when not v_asc then valor end desc,
                                            importe desc nulls last, producto) as n,
             count(*) over () as total_filas
        from g
    )
    select
      (select coalesce(max(total_filas), 0) from o),
      (select coalesce(json_agg(jsonb_strip_nulls(jsonb_build_object(
                 'producto', producto, 'cantidad', cantidad, 'unidad', unidad,
                 'veces', veces, 'importe', importe)) order by n), '[]'::json)
         from o where n <= v_lim),
      (select case when count(*) > 0 and not v_serv then
                json_build_object('n', count(*),
                  'nombres', (select json_agg(distinct s.nombre) from (select nombre from l where servicio limit 10) s))
              end
         from l where servicio),
      -- cantidad: el primero de CADA unidad (kg, ud, l…), porque 172,7 kg y
      -- 156 ud no se pueden comparar entre si.
      (select case when v_crit = 'cantidad' and count(*) > 1 then
                json_agg(json_build_object('unidad', u.unidad, 'producto', u.producto, 'cantidad', u.cantidad) order by u.n)
              end
         from (select distinct on (coalesce(unidad, '?')) unidad, producto, cantidad, n
                 from o order by coalesce(unidad, '?'), n) u)
    into v_total, v_filas, v_excl, v_unid;

    v_txt := case when v_crit = 'cantidad'
                  then 'Cantidad total comprada de cada producto, en su unidad (kg con kg, ud con ud: unidades distintas no se comparan)'
                  else 'Numero de compras (lineas) de cada producto' end
             || case when v_serv then '; incluye servicios' else '; excluye servicios (portes, trabajos, mano de obra, gestion...)' end;

  elsif v_crit = 'gasto_proveedor' then
    v_tipo := coalesce(v_tipo, 'factura');
    with g as (
      select coalesce(max(proveedor), proveedor_normalizado)              as proveedor,
             count(*)                                                     as documentos,
             round(coalesce(sum(total), 0)::numeric, 2)                   as importe,
             nullif(count(*) filter (where total is null), 0)             as sin_total,
             nullif(count(*) filter (where total_origen = 'deducido'), 0) as deducidos,
             coalesce(sum(total), 0)                                      as valor
        from facturas
       where tipo = v_tipo
         and (p_desde is null or fecha >= p_desde)
         and (p_hasta is null or fecha <= p_hasta)
       group by proveedor_normalizado
    ),
    o as (
      select *, row_number() over (order by case when v_asc then valor end asc,
                                            case when not v_asc then valor end desc,
                                            documentos desc, proveedor) as n,
             count(*) over () as total_filas
        from g
    )
    select
      (select coalesce(max(total_filas), 0) from o),
      (select coalesce(json_agg(jsonb_strip_nulls(jsonb_build_object(
                 'proveedor', proveedor, 'documentos', documentos, 'importe', importe, 'sin_total', sin_total,
                 'deducidos', deducidos)) order by n), '[]'::json)
         from o where n <= v_lim)
    into v_total, v_filas;
    v_sint := docs_sin_total_agente(v_tipo, p_desde, p_hasta);
    v_ded  := docs_deducidos_agente(v_tipo, p_desde, p_hasta);
    v_txt := case when v_tipo = 'factura'
                  then 'Gasto por proveedor: suma del total (IVA incluido) de sus facturas'
                  else 'Valor de albaranes por proveedor (IVA incluido; NO es gasto facturado)' end
             || '; los documentos sin total no suman';

  else  -- importe_documento
    with o as (
      select f.id, f.total,
             row_number() over (order by case when v_asc then f.total end asc,
                                         case when not v_asc then f.total end desc,
                                         f.fecha desc, f.id) as n,
             count(*) over () as total_filas
        from facturas f
       where f.total is not null
         and (v_tipo is null or f.tipo = v_tipo)
         and (p_desde is null or f.fecha >= p_desde)
         and (p_hasta is null or f.fecha <= p_hasta)
    )
    select
      (select coalesce(max(total_filas), 0) from o),
      (select coalesce(json_agg(documento_compacto_agente(f) order by o.n), '[]'::json)
         from o join facturas f on f.id = o.id where o.n <= v_lim)
    into v_total, v_filas;
    v_sint := docs_sin_total_agente(v_tipo, p_desde, p_hasta);
    v_ded  := docs_deducidos_agente(v_tipo, p_desde, p_hasta);
    v_txt := 'Documentos por total (IVA incluido)'
             || case when v_tipo is null then ', facturas y albaranes mezclados (mira "tipo")' else '' end
             || '; los documentos sin total no entran';
  end if;

  -- Un total deducido no se leyó del documento: el «IVA incluido» del
  -- criterio no vale para él si iva_conocido = false (prueba del 06/10, q03).
  if v_ded is not null then
    v_txt := v_txt || '; documentos_deducidos: total calculado desde las lineas (sin IVA si iva_conocido=false)';
  end if;
  if p_desde is not null or p_hasta is not null then
    v_txt := v_txt || format('; fechas %s a %s', coalesce(p_desde::text, 'inicio'), coalesce(p_hasta::text, 'hoy'));
  end if;

  return (jsonb_build_object(
            'criterio',    v_txt,
            'orden',       v_ord,
            'filas',       v_filas,
            'total_filas', v_total,
            'truncado',    v_total > v_lim)
          || case when v_excl is not null then jsonb_build_object('servicios_excluidos', v_excl) else '{}'::jsonb end
          || case when v_unid is not null then jsonb_build_object('primero_por_unidad', v_unid) else '{}'::jsonb end
          || case when v_sint is not null then jsonb_build_object('documentos_sin_total', v_sint) else '{}'::jsonb end
          || case when v_ded is not null then jsonb_build_object('documentos_deducidos', v_ded) else '{}'::jsonb end
         )::json;
end;
$function$;

-- ─── 5. estadisticas_globales_agente (EXACTA de antes) ──────────────────────
CREATE OR REPLACE FUNCTION public.estadisticas_globales_agente()
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_docs  int := (select count(*) from facturas);
  v_prov  int := (select count(distinct proveedor_normalizado) from facturas);
  v_meses int := (select count(distinct to_char(fecha, 'YYYY-MM')) from facturas);
begin
  if v_docs = 0 then
    return json_build_object(
      'sin_datos', true,
      'aviso', 'No hay ningun documento cargado: 0 significa "sin datos", nunca "no se gasto nada".');
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    -- Los avisos de importe van aparte del conteo (si_das_importes): en una
    -- pregunta de «cuántas» el modelo los colaba en la respuesta.
    'facturas', (select jsonb_build_object(
                   'n',     count(*),
                   'gasto', round(coalesce(sum(total), 0)::numeric, 2),
                   'base',  round(coalesce(sum(subtotal), 0)::numeric, 2),
                   'iva',   round(coalesce(sum(iva), 0)::numeric, 2),
                   'si_das_importes', nullif(jsonb_strip_nulls(jsonb_build_object(
                                        'sin_total', docs_sin_total_agente('factura', null, null),
                                        'deducidos', docs_deducidos_agente('factura', null, null),
                                        'sin_iva',   docs_sin_iva_agente('factura', null, null))), '{}'::jsonb))
                   from facturas where tipo = 'factura'),
    'albaranes', (select jsonb_build_object(
                   'n',     count(*),
                   'valor', round(coalesce(sum(total), 0)::numeric, 2),
                   'si_das_importes', nullif(jsonb_strip_nulls(jsonb_build_object(
                                        'sin_total', docs_sin_total_agente('albaran', null, null),
                                        'deducidos', docs_deducidos_agente('albaran', null, null))), '{}'::jsonb))
                   from facturas where tipo = 'albaran'),
    'primera_fecha', (select min(fecha) from facturas),
    'ultima_fecha',  (select max(fecha) from facturas),
    'sin_verificar', (select count(*) from facturas where not coalesce(verificada, false)),
    'con_alertas', (select jsonb_agg(jsonb_build_object('id', f.id, 'numero', f.numero_documento, 'proveedor', f.proveedor,
                                                        'alertas', alertas_resumen_agente(f.alertas_validacion))
                                     order by f.fecha, f.id)
                      from facturas f where alertas_resumen_agente(f.alertas_validacion) is not null),
    -- Todos los meses CON documentos (nunca meses vacíos), con año, del más
    -- antiguo al más reciente. Cuenta también los documentos sin total.
    'meses', (select jsonb_agg(to_jsonb(m) order by m.mes)
                from (select to_char(fecha, 'YYYY-MM')                                                   as mes,
                             count(*) filter (where tipo = 'factura')                                    as facturas,
                             round(coalesce(sum(total) filter (where tipo = 'factura'), 0)::numeric, 2)  as gasto,
                             nullif(count(*) filter (where tipo = 'factura' and total is null), 0)       as sin_total,
                             nullif(count(*) filter (where tipo = 'factura' and total_origen = 'deducido'), 0) as deducidos,
                             nullif(count(*) filter (where tipo = 'albaran'), 0)                         as albaranes,
                             nullif(count(*) filter (where fecha_dudosa_agente(alertas_validacion)), 0)  as fecha_dudosa
                        from facturas
                       group by 1
                       order by 1 desc
                       limit 24) m),
    'meses_truncado', case when v_meses > 24 then true end,
    'top_proveedores', (select jsonb_agg(to_jsonb(x) order by x.gasto desc nulls last, x.facturas desc nulls last, x.proveedor)
                          from (select coalesce(max(proveedor), proveedor_normalizado)                                as proveedor,
                                       nullif(count(*) filter (where tipo = 'factura'), 0)                          as facturas,
                                       round((sum(total) filter (where tipo = 'factura'))::numeric, 2)              as gasto,
                                       nullif(count(*) filter (where tipo = 'factura' and total is null), 0)        as sin_total,
                                       nullif(count(*) filter (where tipo = 'factura' and total_origen = 'deducido'), 0) as deducidos,
                                       nullif(count(*) filter (where tipo = 'albaran'), 0)                          as albaranes,
                                       round((sum(total) filter (where tipo = 'albaran'))::numeric, 2)              as valor_albaranes
                                  from facturas
                                 group by proveedor_normalizado
                                 order by 3 desc nulls last, 2 desc nulls last, 1
                                 limit 8) x),
    'total_proveedores', v_prov,
    'top_proveedores_truncado', case when v_prov > 8 then true end,
    'ultimos', (select jsonb_agg(documento_compacto_agente(f) order by f.fecha desc, f.id desc)
                  from (select id from facturas order by fecha desc, id desc limit 3) u
                  join facturas f on f.id = u.id)
  ))::json;
end;
$function$;

-- ─── 6. consulta_flexible_agente (EXACTA de antes) ──────────────────────────
CREATE OR REPLACE FUNCTION public.consulta_flexible_agente(p jsonb)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  c_claves   constant text[] := array['fuente', 'metricas', 'agrupar', 'filtros', 'orden_por', 'orden_dir', 'limite'];
  c_filtros  constant text[] := array['desde', 'hasta', 'proveedor', 'tipo', 'numero', 'producto', 'con_total',
                                      'verificada', 'con_alertas', 'excluir_servicios', 'importe_min', 'importe_max'];
  c_agrupar  constant text[] := array['proveedor', 'mes', 'anio', 'tipo', 'producto', 'unidad', 'verificada', 'alerta', 'dia_semana'];
  c_met_doc  constant text[] := array['count_documentos', 'count_con_total',
                                      'sum_total', 'avg_total', 'min_total', 'max_total',
                                      'sum_subtotal', 'avg_subtotal', 'min_subtotal', 'max_subtotal',
                                      'sum_iva', 'avg_iva', 'min_iva', 'max_iva'];
  c_met_lin  constant text[] := array['count_lineas', 'count_documentos',
                                      'sum_cantidad', 'avg_cantidad', 'min_cantidad', 'max_cantidad',
                                      'sum_precio_unitario', 'avg_precio_unitario', 'min_precio_unitario', 'max_precio_unitario',
                                      'sum_total_linea', 'avg_total_linea', 'min_total_linea', 'max_total_linea'];
  v_fuente   text;
  v_f        jsonb;
  v_lim      int := 10;
  v_dir      text;
  v_orden    text;
  v_metricas text[] := '{}';
  v_agrupar  text[] := '{}';
  v_sel      text[] := '{}';
  v_grp      text[] := '{}';
  v_where    text[] := array['true'];
  v_from     text;
  v_alerta   boolean := false;
  k          text;
  v_val      jsonb;
  v_expr     text;
  v_func     text;
  v_col      text;
  v_sql      text;
  v_filas    json;
  v_total    int;
  v_sint     json;
  v_lsin     int;
  v_import   boolean := false;
  v_lin_nul  text[] := '{}';
  v_ncon     text[] := '{}';
  v_fdud     json;
  v_iva      boolean := false;
  v_ded      json;
  v_siva     json;
  v_fila     text := 'to_jsonb(g)';
  f_desde date; f_hasta date; f_prov text; f_tipo text; f_num text; f_prod text;
  f_con_total boolean; f_verif boolean; f_alertas boolean; f_excl boolean; f_min numeric; f_max numeric;
begin
  -- Estructura y claves ----------------------------------------------------
  if p is null or jsonb_typeof(p) <> 'object' then
    return json_build_object('error', 'La consulta tiene que ser un objeto JSON.', 'permitidos', to_json(c_claves));
  end if;
  for k in select jsonb_object_keys(p) loop
    if not k = any(c_claves) then
      return json_build_object('error', format('Clave "%s" no permitida.', k), 'permitidos', to_json(c_claves));
    end if;
  end loop;

  v_fuente := lower(coalesce(nullif(p ->> 'fuente', ''), 'documentos'));
  if v_fuente not in ('documentos', 'lineas') then
    return json_build_object('error', format('Fuente "%s" no permitida.', p ->> 'fuente'), 'permitidos', json_build_array('documentos', 'lineas'));
  end if;

  -- Métricas ----------------------------------------------------------------
  v_val := p -> 'metricas';
  if v_val is not null and jsonb_typeof(v_val) not in ('array', 'null') then
    return json_build_object('error', 'metricas tiene que ser una lista.');
  end if;
  if jsonb_typeof(v_val) = 'array' then
    for k in select jsonb_array_elements_text(v_val) loop
      k := lower(trim(k));
      if not k = any(case when v_fuente = 'documentos' then c_met_doc else c_met_lin end) then
        return json_build_object('error', format('Metrica "%s" no permitida con fuente %s.', k, v_fuente),
                                 'permitidos', to_json(case when v_fuente = 'documentos' then c_met_doc else c_met_lin end));
      end if;
      if not k = any(v_metricas) then v_metricas := v_metricas || k; end if;
    end loop;
  end if;
  if cardinality(v_metricas) = 0 then
    v_metricas := array[case when v_fuente = 'documentos' then 'count_documentos' else 'count_lineas' end];
  end if;
  if cardinality(v_metricas) > 4 then
    return json_build_object('error', 'Como maximo 4 metricas.');
  end if;

  -- Agrupaciones ------------------------------------------------------------
  v_val := p -> 'agrupar';
  if v_val is not null and jsonb_typeof(v_val) not in ('array', 'null') then
    return json_build_object('error', 'agrupar tiene que ser una lista.');
  end if;
  if jsonb_typeof(v_val) = 'array' then
    for k in select jsonb_array_elements_text(v_val) loop
      k := lower(trim(k));
      if not k = any(c_agrupar) then
        return json_build_object('error', format('Agrupacion "%s" no permitida.', k), 'permitidos', to_json(c_agrupar));
      end if;
      if k in ('producto', 'unidad') and v_fuente <> 'lineas' then
        return json_build_object('error', format('Agrupar por "%s" solo con fuente lineas.', k));
      end if;
      if k = any(v_agrupar) then
        return json_build_object('error', format('Agrupacion "%s" repetida.', k));
      end if;
      if k = any(v_metricas) then
        return json_build_object('error', 'Una agrupacion no puede llamarse igual que una metrica.');
      end if;
      v_agrupar := v_agrupar || k;
    end loop;
  end if;
  if cardinality(v_agrupar) > 3 then
    return json_build_object('error', 'Como maximo 3 agrupaciones.');
  end if;

  -- Filtros (valores tipados; solo se usan como parámetros) -----------------
  v_f := coalesce(p -> 'filtros', '{}'::jsonb);
  if jsonb_typeof(v_f) = 'null' then v_f := '{}'::jsonb; end if;
  if jsonb_typeof(v_f) <> 'object' then
    return json_build_object('error', 'filtros tiene que ser un objeto.', 'permitidos', to_json(c_filtros));
  end if;
  for k, v_val in select key, value from jsonb_each(v_f) loop
    if not k = any(c_filtros) then
      return json_build_object('error', format('Filtro "%s" no permitido.', k), 'permitidos', to_json(c_filtros));
    end if;
    continue when jsonb_typeof(v_val) = 'null';

    if k in ('desde', 'hasta') then
      if jsonb_typeof(v_val) <> 'string' or (v_val #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then
        return json_build_object('error', format('Filtro "%s": fecha AAAA-MM-DD.', k));
      end if;
      begin
        if k = 'desde' then f_desde := (v_val #>> '{}')::date; else f_hasta := (v_val #>> '{}')::date; end if;
      exception when others then
        return json_build_object('error', format('Filtro "%s": "%s" no es una fecha real.', k, v_val #>> '{}'));
      end;
    elsif k in ('proveedor', 'numero', 'producto', 'tipo') then
      if jsonb_typeof(v_val) <> 'string' or length(trim(v_val #>> '{}')) = 0 or length(v_val #>> '{}') > 100 then
        return json_build_object('error', format('Filtro "%s": texto de 1 a 100 caracteres.', k));
      end if;
      case k
        when 'proveedor' then f_prov := trim(v_val #>> '{}');
        when 'numero'    then f_num  := trim(v_val #>> '{}');
        when 'producto'  then f_prod := trim(v_val #>> '{}');
        else
          f_tipo := case when lower(v_val #>> '{}') like 'albar%' then 'albaran'
                         when lower(v_val #>> '{}') like 'factura%' then 'factura' end;
          if f_tipo is null then
            return json_build_object('error', 'Filtro "tipo": factura o albaran.');
          end if;
      end case;
    elsif k in ('con_total', 'verificada', 'con_alertas', 'excluir_servicios') then
      if jsonb_typeof(v_val) <> 'boolean' then
        return json_build_object('error', format('Filtro "%s": true o false.', k));
      end if;
      case k
        when 'con_total'   then f_con_total := (v_val #>> '{}')::boolean;
        when 'verificada'  then f_verif     := (v_val #>> '{}')::boolean;
        when 'con_alertas' then f_alertas   := (v_val #>> '{}')::boolean;
        else                    f_excl      := (v_val #>> '{}')::boolean;
      end case;
    else  -- importe_min / importe_max
      if jsonb_typeof(v_val) <> 'number' then
        return json_build_object('error', format('Filtro "%s": numero.', k));
      end if;
      if k = 'importe_min' then f_min := (v_val #>> '{}')::numeric; else f_max := (v_val #>> '{}')::numeric; end if;
    end if;
  end loop;

  if v_fuente = 'documentos' and (f_prod is not null or f_excl is not null) then
    return json_build_object('error', 'Los filtros producto y excluir_servicios solo valen con fuente lineas.');
  end if;
  if f_desde is not null and f_hasta is not null and f_desde > f_hasta then
    return json_build_object('error', format('El rango es invalido: desde (%s) es posterior a hasta (%s).', f_desde, f_hasta));
  end if;

  -- Orden y límite ----------------------------------------------------------
  v_orden := nullif(lower(trim(coalesce(p ->> 'orden_por', ''))), '');
  if v_orden is null then
    v_orden := v_metricas[1];
  elsif not (v_orden = any(v_metricas) or v_orden = any(v_agrupar)) then
    return json_build_object('error', format('orden_por "%s" tiene que ser una de las metricas o agrupaciones pedidas.', p ->> 'orden_por'),
                             'permitidos', to_json(v_metricas || v_agrupar));
  end if;
  v_dir := lower(coalesce(nullif(p ->> 'orden_dir', ''), 'desc'));
  if v_dir not in ('asc', 'desc') then
    return json_build_object('error', 'orden_dir: asc o desc.');
  end if;
  if p ? 'limite' and jsonb_typeof(p -> 'limite') <> 'null' then
    if jsonb_typeof(p -> 'limite') <> 'number' then
      return json_build_object('error', 'limite tiene que ser un numero.');
    end if;
    v_lim := least(greatest(floor((p ->> 'limite')::numeric)::int, 1), 50);
  end if;

  -- Construcción (solo fragmentos constantes) -------------------------------
  v_from := case when v_fuente = 'documentos'
                 then 'facturas f'
                 else 'productos_factura l join facturas f on f.id = l.factura_id' end;
  if 'alerta' = any(v_agrupar) then
    v_alerta := true;
    v_from := v_from || ' left join lateral jsonb_array_elements(case when jsonb_typeof(f.alertas_validacion) = ''array'''
                     || ' then f.alertas_validacion else ''[]''::jsonb end) a(el) on true';
  end if;

  foreach k in array v_agrupar loop
    case k
      when 'proveedor'  then v_grp := v_grp || 'f.proveedor_normalizado'::text;
                             v_sel := v_sel || format('coalesce(max(f.proveedor), f.proveedor_normalizado) as %I', k);
      when 'mes'        then v_grp := v_grp || 'to_char(f.fecha, ''YYYY-MM'')'::text;
                             v_sel := v_sel || format('to_char(f.fecha, ''YYYY-MM'') as %I', k);
      when 'anio'       then v_grp := v_grp || 'extract(year from f.fecha)::int'::text;
                             v_sel := v_sel || format('extract(year from f.fecha)::int as %I', k);
      when 'tipo'       then v_grp := v_grp || 'f.tipo'::text;
                             v_sel := v_sel || format('f.tipo as %I', k);
      when 'producto'   then v_grp := v_grp || 'coalesce(l.nombre_normalizado, lower(l.nombre))'::text;
                             v_sel := v_sel || format('max(l.nombre) as %I', k);
      when 'unidad'     then v_grp := v_grp || 'l.unidad'::text;
                             v_sel := v_sel || format('l.unidad as %I', k);
      when 'verificada' then v_grp := v_grp || 'coalesce(f.verificada, false)'::text;
                             v_sel := v_sel || format('coalesce(f.verificada, false) as %I', k);
      when 'alerta'     then v_grp := v_grp || 'coalesce(a.el ->> ''codigo'', ''sin_alertas'')'::text;
                             v_sel := v_sel || format('coalesce(a.el ->> ''codigo'', ''sin_alertas'') as %I', k);
      when 'dia_semana' then v_grp := v_grp || '(array[''lunes'',''martes'',''miercoles'',''jueves'',''viernes'',''sabado'',''domingo''])[extract(isodow from f.fecha)::int]'::text;
                             v_sel := v_sel || format('(array[''lunes'',''martes'',''miercoles'',''jueves'',''viernes'',''sabado'',''domingo''])[extract(isodow from f.fecha)::int] as %I', k);
    end case;
  end loop;

  foreach k in array v_metricas loop
    if k = 'count_documentos' then
      v_expr := 'count(distinct f.id)';
    elsif k = 'count_con_total' then
      v_expr := 'count(distinct f.id) filter (where f.total is not null)';
    elsif k = 'count_lineas' then
      v_expr := 'count(l.id)';
    else
      v_func := case split_part(k, '_', 1) when 'sum' then 'sum' when 'avg' then 'avg' when 'min' then 'min' when 'max' then 'max' end;
      v_col := case substr(k, length(split_part(k, '_', 1)) + 2)
                 when 'total'           then 'f.total'
                 when 'subtotal'        then 'f.subtotal'
                 when 'iva'             then 'f.iva'
                 when 'cantidad'        then 'l.cantidad'
                 when 'precio_unitario' then 'l.precio_unitario'
                 when 'total_linea'     then 'l.total'
               end;
      if v_func is null or v_col is null then
        return json_build_object('error', format('Metrica "%s" no permitida.', k));
      end if;
      v_expr := format('round(%s(%s)::numeric, 2)', v_func, v_col);
      if v_col like 'f.%' then v_import := true; end if;
      if v_col = 'f.iva' then v_iva := true; end if;
      if v_col like 'l.%' and not v_col = any(v_lin_nul) then v_lin_nul := v_lin_nul || v_col; end if;
      -- Toda media lleva al lado cuantas filas entran en ella (n_con_total…):
      -- el modelo dividia por su cuenta entre TODOS los documentos.
      if v_func = 'avg' and not ('n_con_' || substr(k, 5)) = any(v_ncon) then
        v_ncon := v_ncon || ('n_con_' || substr(k, 5));
        v_sel := v_sel || format('count(%s) as %I', v_col, 'n_con_' || substr(k, 5));
      end if;
    end if;
    v_sel := v_sel || format('%s as %I', v_expr, k);
  end loop;

  -- Importes de documentos: cada fila dice cuantos de sus documentos no
  -- tienen total o lo tienen deducido (solo si > 0). Prueba del 06/10, n1: la
  -- fila de Garre llegaba con sum_total null y el modelo la omitia.
  if v_fuente = 'documentos' and v_import then
    v_sel := v_sel || 'nullif(count(distinct f.id) filter (where f.total is null), 0) as sin_total'::text
                   || 'nullif(count(distinct f.id) filter (where f.total_origen = ''deducido''), 0) as deducidos'::text;
    v_fila := '(to_jsonb(g) - array_remove(array[case when g.sin_total is null then ''sin_total'' end,'
              || ' case when g.deducidos is null then ''deducidos'' end], null::text))';
  end if;

  if f_desde is not null     then v_where := v_where || 'f.fecha >= $1'::text; end if;
  if f_hasta is not null     then v_where := v_where || 'f.fecha <= $2'::text; end if;
  if f_prov is not null      then v_where := v_where ||
       '(coalesce(f.proveedor_normalizado, '''') like ''%'' || coalesce(normalizar_proveedor($3), '''') || ''%'' or f.proveedor ilike ''%'' || $3 || ''%'')'::text; end if;
  if f_tipo is not null      then v_where := v_where || 'f.tipo = $4'::text; end if;
  if f_num is not null       then v_where := v_where ||
       ('(f.numero_documento ilike ''%'' || $5 || ''%'' or (length(regexp_replace(regexp_replace(lower($5), ''[^a-z0-9]'', '''', ''g''), ''^0+'', '''')) > 0'
        || ' and regexp_replace(regexp_replace(lower(coalesce(f.numero_documento, '''')), ''[^a-z0-9]'', '''', ''g''), ''^0+'', '''')'
        || ' like ''%'' || regexp_replace(regexp_replace(lower($5), ''[^a-z0-9]'', '''', ''g''), ''^0+'', '''') || ''%''))')::text; end if;
  if f_prod is not null      then v_where := v_where ||
       'coalesce(l.nombre_normalizado, lower(l.nombre)) like ''%'' || coalesce(normalizar_nombre_producto($6), '''') || ''%'''::text; end if;
  if f_con_total is not null then v_where := v_where || '((f.total is not null) = $7)'::text; end if;
  if f_verif is not null     then v_where := v_where || '(coalesce(f.verificada, false) = $8)'::text; end if;
  if f_alertas is not null   then v_where := v_where || '((alertas_resumen_agente(f.alertas_validacion) is not null) = $9)'::text; end if;
  if f_excl                  then v_where := v_where || 'not es_linea_servicio_agente(coalesce(l.nombre_normalizado, l.nombre))'::text; end if;
  if f_min is not null       then v_where := v_where || (case when v_fuente = 'documentos' then 'f.total >= $11' else 'l.total >= $11' end)::text; end if;
  if f_max is not null       then v_where := v_where || (case when v_fuente = 'documentos' then 'f.total <= $12' else 'l.total <= $12' end)::text; end if;

  v_sql := format(
    'select coalesce(json_agg(t.fila order by t.ord), ''[]''::json), coalesce(max(t.n), 0)::int'
    || ' from (select %8$s as fila, row_number() over (order by g.%1$I %2$s nulls last) as ord, count(*) over () as n'
    || ' from (select %3$s from %4$s where %5$s %6$s) g) t'
    || ' where t.ord <= %7$s',
    v_orden,
    case when v_dir = 'asc' then 'asc' else 'desc' end,
    array_to_string(v_sel, ', '),
    v_from,
    array_to_string(v_where, ' and '),
    case when cardinality(v_grp) > 0 then 'group by ' || array_to_string(v_grp, ', ') else '' end,
    v_lim,
    v_fila);

  begin
    execute v_sql into v_filas, v_total
      using f_desde, f_hasta, f_prov, f_tipo, f_num, f_prod, f_con_total, f_verif, f_alertas, f_excl, f_min, f_max;

    -- Avisos de cifras parciales en el mismo ámbito filtrado (solo con
    -- importes: un conteo no lleva ninguno).
    if v_fuente = 'documentos' and v_import then
      execute format(
        'select json_build_object(''n'', count(*), ''docs'', json_agg(json_build_object(''id'', f.id, ''tipo'', f.tipo,'
        || ' ''numero'', f.numero_documento, ''proveedor'', f.proveedor, ''fecha'', f.fecha) order by f.fecha, f.id))'
        || ' from facturas f where %s and f.total is null having count(*) > 0',
        array_to_string(v_where, ' and '))
        into v_sint
        using f_desde, f_hasta, f_prov, f_tipo, f_num, f_prod, f_con_total, f_verif, f_alertas, f_excl, f_min, f_max;
      -- Totales deducidos (calculados desde las lineas, no leidos).
      execute format(
        'select json_build_object(''n'', count(*), ''docs'', json_agg(json_build_object(''id'', f.id, ''tipo'', f.tipo,'
        || ' ''numero'', f.numero_documento, ''proveedor'', f.proveedor, ''fecha'', f.fecha, ''iva_conocido'', f.iva is not null)'
        || ' order by f.fecha, f.id))'
        || ' from facturas f where %s and f.total_origen = ''deducido'' and f.total is not null having count(*) > 0',
        array_to_string(v_where, ' and '))
        into v_ded
        using f_desde, f_hasta, f_prov, f_tipo, f_num, f_prod, f_con_total, f_verif, f_alertas, f_excl, f_min, f_max;
      -- Con IVA: documentos con total pero sin IVA (no entran en la suma de IVA).
      if v_iva then
        execute format(
          'select json_build_object(''n'', count(*), ''docs'', json_agg(json_build_object(''id'', f.id, ''tipo'', f.tipo,'
          || ' ''numero'', f.numero_documento, ''proveedor'', f.proveedor, ''fecha'', f.fecha) order by f.fecha, f.id))'
          || ' from facturas f where %s and f.iva is null and f.total is not null having count(*) > 0',
          array_to_string(v_where, ' and '))
          into v_siva
          using f_desde, f_hasta, f_prov, f_tipo, f_num, f_prod, f_con_total, f_verif, f_alertas, f_excl, f_min, f_max;
      end if;
    elsif v_fuente = 'lineas' and cardinality(v_lin_nul) > 0 then
      execute format(
        'select count(*)::int from productos_factura l join facturas f on f.id = l.factura_id where %s and (%s)',
        array_to_string(v_where, ' and '),
        array_to_string(array(select c || ' is null' from unnest(v_lin_nul) c), ' or '))
        into v_lsin
        using f_desde, f_hasta, f_prov, f_tipo, f_num, f_prod, f_con_total, f_verif, f_alertas, f_excl, f_min, f_max;
    end if;

    -- Agrupar por fecha (mes, año, dia de la semana) con documentos cuya
    -- fecha es la de subida (alerta fecha_ausente): se dicen cuales.
    if v_agrupar && array['mes', 'anio', 'dia_semana'] then
      execute format(
        'select json_build_object(''n'', count(*), ''docs'', json_agg(json_build_object(''id'', d.id, ''numero'', d.numero_documento,'
        || ' ''proveedor'', d.proveedor, ''fecha'', d.fecha) order by d.fecha, d.id))'
        || ' from (select distinct f.id, f.numero_documento, f.proveedor, f.fecha from %s where %s'
        || ' and fecha_dudosa_agente(f.alertas_validacion)) d having count(*) > 0',
        case when v_fuente = 'documentos' then 'facturas f' else 'productos_factura l join facturas f on f.id = l.factura_id' end,
        array_to_string(v_where, ' and '))
        into v_fdud
        using f_desde, f_hasta, f_prov, f_tipo, f_num, f_prod, f_con_total, f_verif, f_alertas, f_excl, f_min, f_max;
    end if;
  exception
    when query_canceled then
      return json_build_object('error', 'La consulta ha tardado demasiado. Acotala (fechas, proveedor) o usa una herramienta especifica.');
    when others then
      return json_build_object('error', 'No se ha podido ejecutar la consulta: ' || sqlerrm);
  end;

  return (jsonb_build_object(
            'criterio', format('%s de %s%s; filtros %s; orden %s %s',
                               array_to_string(v_metricas, ', '), v_fuente,
                               case when cardinality(v_agrupar) > 0 then ' por ' || array_to_string(v_agrupar, ', ') else '' end,
                               jsonb_strip_nulls(v_f)::text, v_orden, v_dir)
                        || case when v_fuente = 'lineas' and cardinality(v_lin_nul) > 0
                                then '; precios e importes de linea SIN IVA'
                                when v_import and v_ded is not null
                                then '; total con IVA salvo documentos_deducidos sin IVA conocido, subtotal sin IVA'
                                when v_import then '; total con IVA, subtotal sin IVA' else '' end
                        || case when v_alerta then '; un documento con varias alertas cuenta en cada una' else '' end
                        || case when cardinality(v_ncon) > 0 then '; cada media se calcula solo sobre n_con_*' else '' end,
            'filas',       v_filas,
            'total_filas', v_total,
            'truncado',    v_total > v_lim)
          || case when v_sint is not null then jsonb_build_object('documentos_sin_total', v_sint) else '{}'::jsonb end
          || case when v_ded is not null then jsonb_build_object('documentos_deducidos', v_ded) else '{}'::jsonb end
          || case when v_siva is not null then jsonb_build_object('documentos_sin_iva', v_siva) else '{}'::jsonb end
          || case when coalesce(v_lsin, 0) > 0 then jsonb_build_object('lineas_sin_dato', v_lsin) else '{}'::jsonb end
          || case when v_fdud is not null then jsonb_build_object('fechas_dudosas', v_fdud) else '{}'::jsonb end
         )::json;
end;
$function$;

revoke all on function public.compras_producto_agente(text, date, date, text, integer, text, text, vector) from public, anon;
grant execute on function public.compras_producto_agente(text, date, date, text, integer, text, text, vector) to authenticated, service_role;
revoke all on function public.gasto_categorias_agente(text, date, date, text, text) from public, anon;
grant execute on function public.gasto_categorias_agente(text, date, date, text, text) to authenticated, service_role;
revoke all on function public.variacion_precios_agente(date, date, numeric, text, text, integer, text) from public, anon;
grant execute on function public.variacion_precios_agente(date, date, numeric, text, text, integer, text) to authenticated, service_role;
revoke all on function public.ranking_agente(text, text, integer, date, date, text, boolean) from public, anon;
grant execute on function public.ranking_agente(text, text, integer, date, date, text, boolean) to authenticated, service_role;
revoke all on function public.estadisticas_globales_agente() from public, anon;
grant execute on function public.estadisticas_globales_agente() to authenticated, service_role;
revoke all on function public.consulta_flexible_agente(jsonb) from public, anon;
grant execute on function public.consulta_flexible_agente(jsonb) to authenticated, service_role;

-- Comprobación: las 6 vuelven a ser EXACTAMENTE las de antes (md5 sin CR).
do $$
declare
  r record;
  v text;
begin
  for r in select * from (values
    ('compras_producto_agente(text, date, date, text, integer, text, text, vector)', '9ecd04dcd190d719314ddc8c77f721b9'),
    ('gasto_categorias_agente(text, date, date, text, text)', '819b379ec41ec5c7d2207e645a492c45'),
    ('variacion_precios_agente(date, date, numeric, text, text, integer, text)', '4a31279b9a37bdcd49eab6bacb118ba4'),
    ('ranking_agente(text, text, integer, date, date, text, boolean)', '1a1f04c3a56f438f42cf6ae1be569045'),
    ('estadisticas_globales_agente()', '25d8f9ad4ef2f7d355690c043242c811'),
    ('consulta_flexible_agente(jsonb)', '5d8e855a2433b4afd4c047b97f2794b5')
  ) t(fn, md5) loop
    v := md5(replace(pg_get_functiondef(to_regprocedure('public.' || r.fn)), chr(13), ''));
    if v <> r.md5 then
      raise exception 'ROLLBACK ABORTADO: % no ha quedado como la original (md5 %). No se ha cambiado nada.', r.fn, v;
    end if;
  end loop;
end;
$$;

notify pgrst, 'reload schema';

commit;

select 'chatbot_parametros_por_defecto: revertida | funciones con la marca: '
       || (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
            and p.proname in ('compras_producto_agente', 'gasto_categorias_agente', 'variacion_precios_agente',
                              'ranking_agente', 'estadisticas_globales_agente', 'consulta_flexible_agente')
            and position('20261008100000_chatbot_parametros_por_defecto' in pg_get_functiondef(p.oid)) > 0) as resultado;
