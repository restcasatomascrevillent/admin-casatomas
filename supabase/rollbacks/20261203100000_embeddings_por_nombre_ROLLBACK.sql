set client_encoding = 'UTF8';
-- Deshace 20261203100000_embeddings_por_nombre.sql.
-- ANTES, si se aplicó 20261203110000_quitar_embedding_lineas.sql, aplicar su
-- rollback (vuelve a crear productos_factura.embedding y la rellena desde
-- productos_nombre_embedding): estas RPC vuelven a leer pf.embedding.
-- facturas.embedding vuelve a vector(1536) (los valores quedan con la
-- precisión de halfvec: diferencia despreciable). Se puede aplicar dos veces.
begin;
set local lock_timeout = '10s';

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'productos_factura' and column_name = 'embedding') then
    raise exception 'Falta productos_factura.embedding: aplica antes 20261203110000_quitar_embedding_lineas_ROLLBACK.sql';
  end if;
end;
$$;

select cron.unschedule('embeddings-nombres')
 where exists (select 1 from cron.job where jobname = 'embeddings-nombres');
drop function if exists public.embeddings_nombres_despachar();

drop trigger if exists trg_productos_nombre_embedding_ins on public.productos_factura;
drop trigger if exists trg_productos_nombre_embedding_upd on public.productos_factura;
drop function if exists public.productos_nombre_embedding_alta();

drop index if exists public.idx_facturas_embedding_hnsw;
alter table public.facturas alter column embedding type vector(1536) using embedding::vector(1536);
create index if not exists idx_facturas_embedding_hnsw
  on public.facturas using hnsw (embedding vector_cosine_ops);

-- RPC tal como estaban antes (definiciones vivas de la demo a 16/11/2026)
CREATE OR REPLACE FUNCTION public.buscar_contexto_chatbot(embedding_query vector)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$DECLARE
  resultado json;
BEGIN
  SELECT json_build_object(

    'facturas', (
      SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
      FROM (
        SELECT 
          id,
          tipo,
          proveedor,
          cif,
          numero_documento,
          fecha,
          subtotal,
          iva,
          total,
          observaciones,
          resumen,
          ROUND((1 - (embedding <=> embedding_query))::numeric, 3) as similitud
        FROM facturas
        WHERE embedding IS NOT NULL
          AND (1 - (embedding <=> embedding_query)) > 0.3
        ORDER BY embedding <=> embedding_query
        LIMIT 10
      ) t
    ),

    'productos', (
      SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
      FROM (
        SELECT 
          pf.id,
          pf.factura_id,
          pf.nombre,
          pf.cantidad,
          pf.unidad,
          pf.precio_unitario,
          pf.total,
          f.proveedor,
          f.numero_documento,
          f.fecha,
          f.tipo as tipo_documento,
          f.resumen as resumen_factura,
          ROUND((1 - (pf.embedding <=> embedding_query))::numeric, 3) as similitud
        FROM productos_factura pf
        JOIN facturas f ON f.id = pf.factura_id
        WHERE pf.embedding IS NOT NULL
          AND (1 - (pf.embedding <=> embedding_query)) > 0.3
        ORDER BY pf.embedding <=> embedding_query
        LIMIT 15
      ) t
    ),

    'estadisticas', (
      SELECT json_build_object(
        'total_facturas', (SELECT COUNT(*) FROM facturas WHERE tipo = 'factura'),
        'total_albaranes', (SELECT COUNT(*) FROM facturas WHERE tipo = 'albaran'),
        'total_productos', (SELECT COUNT(*) FROM productos_factura),
        'gasto_total', (SELECT COALESCE(SUM(total), 0) FROM facturas WHERE tipo = 'factura'),
        'fecha_primera_factura', (SELECT MIN(fecha) FROM facturas),
        'fecha_ultima_factura', (SELECT MAX(fecha) FROM facturas)
      )
    )

  ) INTO resultado;
  
  RETURN resultado;
END;$function$;

CREATE OR REPLACE FUNCTION public.buscar_facturas_agente(embedding_query vector, limite integer DEFAULT 8, umbral double precision DEFAULT 0.25, p_tipo text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  resultado json;
  v_tipo    text := nullif(lower(trim(coalesce(p_tipo, ''))), '');
begin
  if v_tipo in ('albaran', 'albarán', 'albaranes', 'albaranés') then
    v_tipo := 'albaran';
  elsif v_tipo in ('factura', 'facturas', 'invoice') then
    v_tipo := 'factura';
  else
    v_tipo := null;
  end if;

  select coalesce(json_agg(t.fila order by t.distancia), '[]'::json) into resultado
  from (
    select
      documento_compacto_agente(f)
        || jsonb_strip_nulls(jsonb_build_object(
             'resumen',   left(f.resumen, 200),
             'similitud', round((1 - (f.embedding <=> embedding_query))::numeric, 3))) as fila,
      f.embedding <=> embedding_query                                                 as distancia
    from facturas f
    where f.embedding is not null
      and (v_tipo is null or f.tipo = v_tipo)
      and (1 - (f.embedding <=> embedding_query)) > umbral
    order by f.embedding <=> embedding_query   -- <- casa con idx_facturas_embedding_hnsw
    limit limite
  ) t;

  return coalesce(resultado, '[]'::json);
end;
$function$;

CREATE OR REPLACE FUNCTION public.buscar_productos_agente(embedding_query vector, limite integer DEFAULT 12, umbral double precision DEFAULT 0.25)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  resultado json;
begin
  select coalesce(json_agg(t.fila order by t.distancia), '[]'::json) into resultado
  from (
    select
      jsonb_strip_nulls(jsonb_build_object(
        'producto',   pf.nombre,
        'cantidad',   pf.cantidad,
        'unidad',     pf.unidad,
        'precio',     round(pf.precio_unitario::numeric, case when abs(pf.precio_unitario) < 1 then 4 else 2 end),
        'importe',    round(pf.total::numeric, 2),
        'servicio',   case when es_linea_servicio_agente(coalesce(pf.nombre_normalizado, pf.nombre)) then true end,
        'proveedor',  f.proveedor,
        'numero',     f.numero_documento,
        'fecha',      f.fecha,
        'tipo',       f.tipo,
        'fecha_dudosa', case when fecha_dudosa_agente(f.alertas_validacion) then true end,
        'alertas_doc', alertas_resumen_agente(f.alertas_validacion),
        'similitud',  round((1 - (pf.embedding <=> embedding_query))::numeric, 3))) as fila,
      pf.embedding <=> embedding_query                                            as distancia
    from productos_factura pf
    join facturas f on f.id = pf.factura_id
    where pf.embedding is not null
      and (1 - (pf.embedding <=> embedding_query)) > umbral
    order by pf.embedding <=> embedding_query
    limit limite
  ) t;

  return coalesce(resultado, '[]'::json);
end;
$function$;

CREATE OR REPLACE FUNCTION public.buscar_productos_similares(query_embedding vector, limite integer DEFAULT 10)
 RETURNS TABLE(id bigint, nombre character varying, cantidad numeric, precio_unitario numeric, proveedor character varying, fecha date, similitud double precision)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    p.id,
    p.nombre,
    p.cantidad,
    p.precio_unitario,
    f.proveedor,
    f.fecha,
    1 - (p.embedding <=> query_embedding) AS similitud
  FROM productos_factura p
  JOIN facturas f ON p.factura_id = f.id
  WHERE p.embedding IS NOT NULL
  ORDER BY p.embedding <=> query_embedding
  LIMIT limite;
END;
$function$;

CREATE OR REPLACE FUNCTION public.compras_producto_agente(p_texto text, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_tipo text DEFAULT NULL::text, p_limite integer DEFAULT 10, p_orden text DEFAULT NULL::text, p_excluir text DEFAULT NULL::text, p_embedding vector DEFAULT NULL::vector, p_unidad text DEFAULT NULL::text, p_proveedor text DEFAULT NULL::text, p_base boolean DEFAULT true)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261106140000_chatbot_gasto_como_el_panel: importe de línea = solo pf.total.
-- 20261124120000_chatbot_precio_unidad_compra: p_base = false (chat-facturas) → precio tal como se compra; precio_comparable
-- (€/kg, €/l) solo si mezcla formatos (unidades o contenidos distintos) para poder decir el más barato.
-- 20261128150000_chatbot_ultima_factura: primero la ÚLTIMA factura (ultima_factura, con su número para el
-- enlace) y como_leer; por unidad y por proveedor, el precio de su última factura (ultimo_precio, numero);
-- «más barato» (orden precio y precio_comparable) por el precio de la última factura, no por la media.
-- 20261130180000_chatbot_ultima_factura_varias_lineas: si la última factura trae varias líneas del producto
-- (misma unidad) a precios distintos, ultima_factura.misma_factura las resume (precios, precio_medio); a
-- igualdad de factura, el «último precio» de cada proveedor es el de la línea más nueva (id), como ultima_factura.
declare
  c_max_variantes constant int := 15;
  c_sim_semantica constant float8 := 0.5;   -- sugerencias por embedding: parecido mínimo
  c_sim_texto     constant float8 := 0.5;   -- sugerencias por texto: frase y primera palabra
  c_dif_variantes constant numeric := 1.15; -- precios de variantes «distintos»: más de un 15 %
  v_lim    int := least(greatest(coalesce(p_limite, 10), 1), 50);
  v_orden  text := lower(coalesce(nullif(trim(p_orden), ''), 'importe'));
  v_uni    text := unidad_agente(p_unidad);
  -- Palabras distintivas del proveedor pedido (sin «grupo», «distribuciones», «sl»…): todas deben
  -- estar en su nombre. Sin proveedor, vacío = no filtra.
  v_provw  text[] := coalesce((
    select array_agg(w) from regexp_split_to_table(lower(coalesce(p_proveedor, '')), '[^a-z0-9áéíóúñü]+') w
     where length(w) >= 3
       and w <> all (array['grupo','distribuciones','distribuidora','hermanos','sociedad','limitada','srl','slu','del','los','las'])
  ), '{}');
  v_tipo   text;
  v_pal    text[];
  v_frase  text;
  v_ids    bigint[];
  v_met    text;
  v_subs   text[];
  v_aprox  boolean;
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

  select h.ids, h.metodo, h.subproductos, h.palabras
    into v_ids, v_met, v_subs, v_pal
    from lineas_producto_agente(p_texto, p_excluir) h;
  if coalesce(cardinality(v_pal), 0) = 0 then
    return json_build_object('error', 'Falta el nombre del producto.');
  end if;
  v_frase := array_to_string(v_pal, ' ');
  v_aprox := coalesce(v_met in ('derivada', 'aproximada'), false);

  -- ── Nada: solo subproductos, o sugerencias (semánticas si hay embedding) ──
  if v_ids is null then
    if v_subs is not null then
      return jsonb_build_object(
        'buscado',      p_texto,
        'coincidencia', 'solo_subproductos',
        'sin_datos',    true,
        'subproductos', to_jsonb(v_subs),
        'nota', 'Solo hay subproductos con ese nombre (espinas, recortes...), no el producto: dilo y pregunta si es eso.')::json;
    end if;
    select jsonb_agg(nombre order by pri, s desc), coalesce(bool_or(pri = 1), false)
      into v_sug, v_sem
      from (
        select min(nombre) as nombre, min(pri) as pri, max(s) as s
          from (
            select pf.nombre::text as nombre, 1 as pri, max(1 - (pf.embedding <=> p_embedding)) as s
              from productos_factura pf
             where p_embedding is not null and pf.embedding is not null
             group by pf.nombre
            having max(1 - (pf.embedding <=> p_embedding)) >= c_sim_semantica
            union all
            select pf.nombre::text, 2,
                   max(extensions.strict_word_similarity(v_frase, array_to_string(palabras_producto_agente(pf.nombre), ' ')))
              from productos_factura pf
             group by pf.nombre
            having max(extensions.strict_word_similarity(v_frase, array_to_string(palabras_producto_agente(pf.nombre), ' '))) >= c_sim_texto
               and max(extensions.strict_word_similarity(v_pal[1], array_to_string(palabras_producto_agente(pf.nombre), ' '))) >= c_sim_texto
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
                        'Ningun producto se llama asi; sugerencias = nombres parecidos, NO sumados: pregunta si es alguno.'
                      else 'No hay compras de ese producto ni nada parecido: dilo asi, sin sugerir otros productos.' end
    ))::json;
  end if;

  -- ── Agregación ──
  with base0 as (
    select pf.id, pf.nombre::text as nombre,
           coalesce(pf.nombre_normalizado::text, lower(pf.nombre)) as nom_n,
           pf.cantidad::numeric as cant,
           unidad_agente(coalesce(nullif(btrim(pf.unidad::text), ''), 'ud')) as unidad,
           pf.total::numeric as imp,   -- solo el importe leído: sin importe = sin_importe, sin precio
           f.id as doc, f.tipo, f.fecha, f.numero_documento::text as numero,
           coalesce(pv.nombre, f.proveedor)::text as proveedor,   -- nombre canónico
           coalesce(nullif(f.proveedor_normalizado, ''), nullif(normalizar_proveedor(f.proveedor), ''), '?') as prov_n,
           fecha_dudosa_agente(f.alertas_validacion) as fd,
           palabras_producto_agente(pf.nombre) @> v_pal or palabras_producto_agente(pc.nombre) @> v_pal as exacta,
           bl.unidad_base, bl.factor, bl.convertida as conv,
           contenido_texto_agente(pf.unidad, k.cc, k.cu) as ctxt,
           (f.tipo = 'albaran' and f.id in (select albaran_id from albaranes_facturados_agente())) as fact
      from productos_factura pf
      join facturas f on f.id = pf.factura_id
      left join proveedores pv on pv.id = f.proveedor_id
      left join productos_catalogo pc on pc.id = pf.producto_id
      cross join lateral (select coalesce(pf.contenido_cantidad, pc.contenido_cantidad) as cc,
                                 case when pf.contenido_cantidad is not null then pf.contenido_unidad else pc.contenido_unidad end as cu) k
      cross join lateral base_linea_agente(pf.unidad, k.cc, k.cu) bl
     where pf.id = any(v_ids)
       and pf.total is distinct from 0   -- líneas a 0 €: fuera
  ),
  -- Albarán ya facturado (vínculo guardado o factura del proveedor que cita su número): fuera,
  -- salvo que se pidan solo albaranes.
  base as (
    select * from base0 where not fact or v_tipo = 'albaran'
  ),
  filtrada as (
    select * from base
     where (p_desde is null or fecha >= p_desde)
       and (p_hasta is null or fecha <= p_hasta)
       and (v_tipo is null or tipo = v_tipo)
       and (v_uni is null or unidad = v_uni)
       and not exists (select 1 from unnest(v_provw) w where position(w in lower(proveedor)) = 0)
  ),
  -- Albaranes ya facturados que se han dejado fuera (solo para el aviso).
  ya_facturados as (
    select b.id from base0 b
     where b.fact and v_tipo is null
       and (p_desde is null or b.fecha >= p_desde)
       and (p_hasta is null or b.fecha <= p_hasta)
       and (v_uni is null or b.unidad = v_uni)
  ),
  c as (
    select *, case when imp > 0 and cant > 0 then imp / cant end as pu
      from filtrada
  ),
  -- Variantes con su propio precio (por unidad). «Distintas» = dos variantes de la misma
  -- unidad con más de un 15 % de diferencia: entonces no se da una media global.
  var_u as (
    select mode() within group (order by nombre) as nombre, unidad,
           sum(cant) as cant, sum(imp) as imp,
           sum(imp) filter (where pu is not null) / nullif(sum(cant) filter (where pu is not null), 0) as precio,
           (array_agg(pu order by fecha desc nulls last, doc desc, id desc) filter (where pu is not null))[1] as ult_precio,
           count(distinct doc) as compras, max(fecha) as ultima,
           (array_agg(proveedor order by fecha desc nulls last))[1] as proveedor
      from c
     group by array_to_string(palabras_producto_agente(nombre), ' '), unidad
  ),
  var_dist as (
    select exists (select 1 from var_u a join var_u b on a.unidad = b.unidad
                    and b.precio > 0 and a.precio > b.precio * c_dif_variantes) as ok
  ),
  var_pu as (
    select prov_n, unidad, array_to_string(palabras_producto_agente(nombre), ' ') as k,
           sum(imp) filter (where pu is not null) / nullif(sum(cant) filter (where pu is not null), 0) as precio
      from c group by 1, 2, 3
  ),
  prov_multi as (
    select a.prov_n, a.unidad from var_pu a join var_pu b
      on a.prov_n = b.prov_n and a.unidad = b.unidad and b.precio > 0 and a.precio > b.precio * c_dif_variantes
     group by 1, 2
  ),
  por_unidad as (
    select unidad,
           sum(cant) as cant,
           sum(imp) as imp,
           sum(imp) filter (where pu is not null) / nullif(sum(cant) filter (where pu is not null), 0) as precio,
           (array_agg(pu order by fecha desc nulls last, doc desc, id desc) filter (where pu is not null))[1] as ult_precio,
           (array_agg(proveedor order by fecha desc nulls last, doc desc, id desc) filter (where pu is not null))[1] as ult_prov,
           max(fecha) filter (where pu is not null) as ultima,
           count(*) as lineas,
           count(distinct doc) as compras
      from c
     group by unidad
  ),
  por_prov as (
    select prov_n, unidad,
           (array_agg(proveedor order by fecha desc nulls last))[1] as proveedor,
           sum(cant) as cant,
           sum(imp) as imp,
           sum(imp) filter (where pu is not null) / nullif(sum(cant) filter (where pu is not null), 0) as precio,
           (array_agg(pu order by fecha desc nulls last, doc desc, id desc) filter (where pu is not null))[1] as ult_precio,
           (array_agg(numero order by fecha desc nulls last, doc desc, id desc) filter (where pu is not null))[1] as ult_numero,
           min(pu) as p_min,
           max(pu) as p_max,
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
           exists (select 1 from prov_multi pm where pm.prov_n = p.prov_n and pm.unidad = p.unidad) as multi,
           row_number() over (
             order by u.imp desc nulls last, u.cant desc nulls last, p.unidad,
                      case when v_orden = 'cantidad' then p.cant end desc nulls last,
                      case when v_orden = 'precio' then coalesce(p.ult_precio, p.precio) end asc nulls last,
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
           sum(imp) filter (where tipo = 'factura') as imp_fac,
           sum(imp) filter (where tipo = 'albaran') as imp_alb,
           count(*) filter (where imp is null) as sin_importe,
           count(*) filter (where cant is null or cant = 0) as sin_cantidad,
           count(distinct doc) filter (where fd) as fecha_dudosa,
           count(*) filter (where tipo = 'albaran') as lin_alb,
           coalesce(bool_and(exacta), false) as todas_exactas,
           coalesce(bool_or(exacta), false) as alguna_exacta
      from c
  ),
  -- Precio comparable: solo si TODAS las líneas con precio se pueden pasar a la
  -- misma unidad base (kg, l, ud) y alguna es un envase (caja, cubo, bote...).
  -- Con p_base = false, además, solo si hay formatos distintos que comparar.
  cmp_marco as (
    select min(unidad_base) as ub,
           coalesce(bool_and(unidad_base is not null) and min(unidad_base) = max(unidad_base) and bool_or(conv)
                    and (p_base or count(distinct unidad) > 1 or min(factor) <> max(factor)), false) as ok
      from c
     where pu is not null
  ),
  cmp_prov as (
    select prov_n,
           (array_agg(proveedor order by fecha desc nulls last))[1] as proveedor,
           sum(imp) / nullif(sum(cant * factor), 0) as precio,
           (array_agg(pu / factor order by fecha desc nulls last, doc desc, id desc))[1] as ult_precio,
           min(pu / factor) as p_min,
           max(pu / factor) as p_max,
           count(distinct doc) as compras,
           max(fecha) as ultima,
           string_agg(distinct ctxt, ' / ') filter (where conv) as desde,
           row_number() over (order by (array_agg(pu / factor order by fecha desc nulls last, doc desc, id desc))[1],
                                       sum(imp) / nullif(sum(cant * factor), 0), (array_agg(proveedor))[1]) as rn
      from c
     where pu is not null
     group by prov_n
  )
  select jsonb_strip_nulls(jsonb_build_object(
    -- 20261128150000: la última factura (la más nueva con precio) y cómo leer el resultado.
    'ultima_factura', (
      select jsonb_strip_nulls(jsonb_build_object(
               'fecha', x.fecha, 'proveedor', x.proveedor, 'numero', x.numero, 'documento_id', x.doc,
               'tipo', x.tipo, 'producto', x.nombre, 'cantidad', trim_scale(round(x.cant, 3)), 'unidad', x.unidad,
               'precio_unitario', trim_scale(round(x.pu, case when x.pu < 1 then 4 else 2 end)),
               'fecha_dudosa', case when x.fd then true end,
               'misma_factura', (
                 select case when count(*) > 1 and min(y.pu) <> max(y.pu) then jsonb_build_object(
                          'lineas', count(*),
                          'precios', jsonb_agg(trim_scale(round(y.pu, case when y.pu < 1 then 4 else 2 end)) order by y.pu),
                          'precio_medio', trim_scale(round(sum(y.pu * y.cant) / nullif(sum(y.cant), 0), 2)),
                          'nota', 'Esta ultima factura trae varias lineas de este producto a precios distintos (p. ej. dos calibres): da los precios de todas (precios) o el precio_medio de la factura, no solo uno.') end
                   from c y
                  where y.doc = x.doc and y.unidad is not distinct from x.unidad and y.pu is not null and y.cant > 0)))
        from c x
       where x.pu is not null
       order by x.fecha desc nulls last, x.doc desc, x.id desc
       limit 1),
    'como_leer', (
      select case when m.lineas > 0 then
        'PRECIO DE REFERENCIA = ultima_factura (fecha, proveedor, numero: citalo para el enlace; precio_unitario por su unidad). '
        || 'por_proveedor.ultimo_precio y numero = la ultima factura de cada proveedor; precio_medio, min y max solo despues, '
        || 'como contexto. Mas barato = por ultimo_precio.' end
        from marco m),
    'buscado',  p_texto,
    'excluido', nullif(trim(coalesce(p_excluir, '')), ''),
    'proveedor_pedido', nullif(trim(coalesce(p_proveedor, '')), ''),
    'unidad',   v_uni,
    'periodo',  case when p_desde is not null or p_hasta is not null
                     then jsonb_build_object('desde', p_desde, 'hasta', p_hasta)
                     else to_jsonb('todo el historico'::text) end,
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
    'por_variante', (
      select case when (select ok from var_dist) then (
               select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                        'nombre',        v.nombre,
                        'unidad',        v.unidad,
                        'cantidad',      trim_scale(round(v.cant, 3)),
                        'importe',       trim_scale(round(v.imp, 2)),
                        'precio_medio',  trim_scale(round(v.precio, case when v.precio < 1 then 4 else 2 end)),
                        'ultimo_precio', trim_scale(round(v.ult_precio, case when v.ult_precio < 1 then 4 else 2 end)),
                        'compras',       v.compras,
                        'ultima',        v.ultima,
                        'proveedor',     v.proveedor))
                      order by v.imp desc nulls last, v.nombre)
                 from (select * from var_u order by imp desc nulls last, nombre limit 8) v) end),
    'nota_variantes', (
      select case when ok then 'Variantes con precios distintos: da CADA variante con su precio (por_variante), no una media.' end from var_dist),
    'subproductos_excluidos', to_jsonb(v_subs),
    'total', (
      select case when m.lineas > 0 then jsonb_strip_nulls(jsonb_build_object(
               'importe',     trim_scale(round(m.imp, 2)),
               'en_facturas', case when m.lin_alb > 0 then trim_scale(round(coalesce(m.imp_fac, 0), 2)) end,
               'en_albaranes_sin_factura', case when m.lin_alb > 0 then trim_scale(round(coalesce(m.imp_alb, 0), 2)) end,
               'lineas',      m.lineas,
               'compras',     m.compras,
               'proveedores', m.proveedores)) end
        from marco m),
    'por_unidad', (
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'unidad',       u.unidad,
               'cantidad',     trim_scale(round(u.cant, 3)),
               'importe',      trim_scale(round(u.imp, 2)),
               'precio_medio', case when (select ok from var_dist) then null
                                    else trim_scale(round(u.precio, case when u.precio < 1 then 4 else 2 end)) end,
               'ultimo_precio', case when (select ok from var_dist) then null
                                     else trim_scale(round(u.ult_precio, case when u.ult_precio < 1 then 4 else 2 end)) end,
               'ultima',       u.ultima,
               'ultimo_proveedor', u.ult_prov,
               'lineas',       u.lineas,
               'compras',      u.compras))
             order by u.imp desc nulls last, u.cant desc nulls last, u.unidad)
        from por_unidad u),
    'por_proveedor', (
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'proveedor',     o.proveedor,
               'unidad',        o.unidad,
               'cantidad',      trim_scale(round(o.cant, 3)),
               'importe',       trim_scale(round(o.imp, 2)),
               'precio_medio',  case when o.multi then null else trim_scale(round(o.precio, case when o.precio < 1 then 4 else 2 end)) end,
               'ultimo_precio', case when o.multi then null else trim_scale(round(o.ult_precio, case when o.ult_precio < 1 then 4 else 2 end)) end,
               'precio_min',    case when o.multi then null else trim_scale(round(o.p_min, case when o.p_min < 1 then 4 else 2 end)) end,
               'precio_max',    case when o.multi then null else trim_scale(round(o.p_max, case when o.p_max < 1 then 4 else 2 end)) end,
               'varias_variantes', case when o.multi then true end,
               'compras',       o.compras,
               'primera',       o.primera,
               'ultima',        o.ultima,
               'numero',        o.ult_numero,
               'tipo',          o.tipo))
             order by o.rn)
        from ordenada o
       where o.rn <= v_lim),
    'precio_comparable', (
      select case when cm.ok and not (select ok from var_dist) then jsonb_build_object(
               'unidad_base', cm.ub,
               'criterio', case when p_base then
                             'Todo convertido a €/' || cm.ub || ' dividiendo el precio del envase por su contenido (convertido_desde). '
                             || 'Compara con ESTOS precios y di de donde viene la conversion.'
                           else 'Formatos distintos pasados a €/' || cm.ub || ' (convertido_desde) SOLO para decir cual sale mas barato; '
                             || 'el precio de cada proveedor dalo en su formato (por_proveedor).' end,
               'por_proveedor', (
                 select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                          'proveedor',      p.proveedor,
                          'precio_medio',   trim_scale(round(p.precio, case when p.precio < 1 then 4 else 2 end)),
                          'ultimo_precio',  trim_scale(round(p.ult_precio, case when p.ult_precio < 1 then 4 else 2 end)),
                          'precio_min',     trim_scale(round(p.p_min, case when p.p_min < 1 then 4 else 2 end)),
                          'precio_max',     trim_scale(round(p.p_max, case when p.p_max < 1 then 4 else 2 end)),
                          'compras',        p.compras,
                          'ultima',         p.ultima,
                          'convertido_desde', p.desde))
                        order by p.rn)
                   from cmp_prov p
                  where p.rn <= v_lim)) end
        from cmp_marco cm),
    'una_compra',  (select case when m.compras = 1 then true end from marco m),
    'truncado',    (select case when max(n) > v_lim then true end from ordenada),
    'filas_total', (select case when max(n) > v_lim then max(n) end from ordenada),
    'criterio', (
      select case when m.lin_alb > 0 or exists (select 1 from ya_facturados) then
        'Facturas + albaranes sin factura (lo recibido); el albaran ya facturado no cuenta. Precios SIN IVA.' end
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
                        'unidades',  string_agg(distinct b.unidad, ','),
                        'productos', (select jsonb_agg(distinct b2.nombre) from (select nombre from base limit 5) b2)))
                 from base b) end
        from marco m),
    -- Periodo/tipo/unidad sin nada pero sí hay histórico: la última compra.
    'ultimo_dato', (
      select case when m.lineas = 0 then (
               select jsonb_strip_nulls(jsonb_build_object(
                        'fecha',     u.fecha,
                        'producto',  u.nombre,
                        'cantidad',  trim_scale(round(u.cant, 3)),
                        'unidad',    u.unidad,
                        'proveedor', u.proveedor,
                        'importe',   trim_scale(round(u.imp, 2)),
                        'tipo',      u.tipo))
                 from (select b.fecha, b.unidad, b.tipo, max(b.proveedor) as proveedor, min(b.nombre) as nombre,
                              sum(b.cant) as cant, sum(b.imp) as imp
                         from base b
                        where b.doc = (select b2.doc from base b2 order by b2.fecha desc nulls last, b2.doc desc limit 1)
                        group by b.fecha, b.unidad, b.tipo
                        order by sum(b.imp) desc nulls last, sum(b.cant) desc nulls last
                        limit 1) u) end
        from marco m)
  )) into resultado;

  -- 20261128150000: la última factura y como_leer, lo primero del resultado (lo lee antes el modelo
  -- y no se pierde si el resultado se recorta).
  return json_delante_agente(
    jsonb_strip_nulls(jsonb_build_object('como_leer', resultado -> 'como_leer', 'ultima_factura', resultado -> 'ultima_factura')),
    resultado);
end;
$function$;

CREATE OR REPLACE FUNCTION public.ocr_anadir_pagina(p_factura_id bigint, p_trabajo_id uuid, p_usuario uuid, p_pagina integer, p_paginas_total integer, p_cabecera jsonb, p_lineas jsonb, p_esperado jsonb, p_archivo_path text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
-- 20261106300000_facturas_retencion_irpf: la retención IRPF sigue al pie impreso, como el total.
declare
  fa public.facturas%rowtype;
  t  public.ocr_trabajos%rowtype;
  v_lineas_antes integer;
  v_orden integer;
  v_insertadas integer;
  v_sust_id bigint;
  v_total numeric := (p_cabecera->>'total')::numeric;
  v_origen text := nullif(p_cabecera->>'total_origen', '');
  v_impreso boolean;
  v_existente_impreso boolean;
  v_usar_nuevo boolean;
  v_sumar boolean;
  fb public.facturas%rowtype;
begin
  if p_pagina is null or p_paginas_total is null or p_paginas_total < 2 or p_paginas_total > 20
     or p_pagina < 1 or p_pagina > p_paginas_total then
    raise exception 'AÑADIDO ABORTADO: página % de % no válida', p_pagina, p_paginas_total;
  end if;
  select * into t from public.ocr_trabajos where id = p_trabajo_id for update;
  if not found then raise exception 'AÑADIDO ABORTADO: no existe el trabajo %', p_trabajo_id; end if;
  if t.estado <> 'duplicado' then
    raise exception 'AÑADIDO ABORTADO: ese documento ya no está pendiente (está «%»).', t.estado;
  end if;

  select * into fa from public.facturas where id = p_factura_id for update;
  if not found then raise exception 'AÑADIDO ABORTADO: no existe la factura %', p_factura_id; end if;
  if exists (select 1 from public.ocr_trabajos tx
              where tx.id = fa.ocr_trabajo_id and tx.estado not in ('completado', 'duplicado', 'fallido', 'cancelado')) then
    raise exception 'AÑADIDO ABORTADO: la factura % aún se está leyendo o guardando. Espera a que termine, revisa y confirma de nuevo.', p_factura_id;
  end if;

  select count(*), coalesce(max(orden), -1) into v_lineas_antes, v_orden
    from public.productos_factura where factura_id = p_factura_id;
  if p_esperado ? 'lineas' and (p_esperado->>'lineas')::int <> v_lineas_antes then
    raise exception 'AÑADIDO ABORTADO: la factura % ha cambiado desde que la viste (ahora tiene % líneas; tú viste %). Revisa y confirma de nuevo.',
      p_factura_id, v_lineas_antes, p_esperado->>'lineas';
  end if;
  if p_esperado ? 'updated_at' and p_esperado->>'updated_at' is not null
     and fa.updated_at is distinct from (p_esperado->>'updated_at')::timestamp then
    raise exception 'AÑADIDO ABORTADO: la factura % ha cambiado desde que la viste. Revisa y confirma de nuevo.', p_factura_id;
  end if;
  if jsonb_typeof(p_lineas) <> 'array' then
    raise exception 'AÑADIDO ABORTADO: p_lineas no es una lista';
  end if;

  -- 1. Copia de auditoría (las líneas de antes no se tocan, pero la cabecera sí).
  insert into public.facturas_sustituciones
    (factura_id, trabajo_id, sustituida_por, factura_antes, productos_antes, historial_antes, resumen_antes)
  values (
    p_factura_id, p_trabajo_id, p_usuario,
    to_jsonb(fa) - 'embedding' - 'embedding_observaciones',
    coalesce((select jsonb_agg(to_jsonb(p) - 'embedding' order by p.id)
                from public.productos_factura p where p.factura_id = p_factura_id), '[]'::jsonb),
    '[]'::jsonb,
    jsonb_build_object('operacion', 'anadir_pagina', 'pagina', p_pagina, 'paginas_total', p_paginas_total,
                       'total', fa.total, 'total_origen', fa.total_origen, 'lineas', v_lineas_antes,
                       'alertas', fa.alertas_validacion, 'esperado', p_esperado, 'archivo_pagina', p_archivo_path))
  returning id into v_sust_id;

  -- 2. Cabecera. El pie IMPRESO manda: el de la página nueva si la existente
  --    no lo tiene o si la nueva es la última; dos totales deducidos se suman
  --    (cada uno es la suma de sus líneas); sin total en la existente, el nuevo.
  v_impreso := v_total is not null and coalesce(v_origen, '') <> 'deducido';
  v_existente_impreso := fa.total is not null and coalesce(fa.total_origen, '') <> 'deducido';
  v_usar_nuevo := v_total is not null
                  and (fa.total is null or (v_impreso and (not v_existente_impreso or p_pagina = p_paginas_total)));
  v_sumar := not v_usar_nuevo and v_total is not null and not v_impreso and not v_existente_impreso;
  update public.facturas
     set subtotal = case when v_usar_nuevo then (p_cabecera->>'subtotal')::numeric
                         when v_sumar and (subtotal is not null or p_cabecera->>'subtotal' is not null)
                           then coalesce(subtotal, 0) + coalesce((p_cabecera->>'subtotal')::numeric, 0)
                         else subtotal end,
         iva = case when v_usar_nuevo then (p_cabecera->>'iva')::numeric
                    when v_sumar and (iva is not null or p_cabecera->>'iva' is not null)
                      then coalesce(iva, 0) + coalesce((p_cabecera->>'iva')::numeric, 0)
                    else iva end,
         total = case when v_usar_nuevo then v_total when v_sumar then total + v_total else total end,
         total_origen = case when v_usar_nuevo then v_origen when v_sumar then 'deducido' else total_origen end,
         retencion_irpf = case when v_usar_nuevo and p_cabecera ? 'retencion_irpf'
                                 then nullif((p_cabecera->>'retencion_irpf')::numeric, 0)
                               else coalesce(retencion_irpf, nullif((p_cabecera->>'retencion_irpf')::numeric, 0)) end,
         retencion_irpf_pct = case when v_usar_nuevo and p_cabecera ? 'retencion_irpf'
                                     then case when nullif((p_cabecera->>'retencion_irpf')::numeric, 0) is not null
                                               then (p_cabecera->>'retencion_irpf_pct')::numeric end
                                   when retencion_irpf is not null then retencion_irpf_pct
                                   when nullif((p_cabecera->>'retencion_irpf')::numeric, 0) is not null
                                     then (p_cabecera->>'retencion_irpf_pct')::numeric
                                   else retencion_irpf_pct end,
         fecha = coalesce(fecha, (p_cabecera->>'fecha')::date),
         cif = coalesce(nullif(cif, ''), p_cabecera->>'cif'),
         proveedor = coalesce(nullif(proveedor, ''), p_cabecera->>'proveedor'),
         paginas = greatest(coalesce(paginas, 1), p_paginas_total)::smallint,
         archivo_path = coalesce(archivo_path, p_archivo_path),
         verificada = false,
         procesado_en = now()
   where id = p_factura_id;

  -- 3. Líneas de la página, a continuación de las que ya hay.
  insert into public.productos_factura
    (factura_id, nombre, cantidad, unidad, precio_unitario, total, embedding, pagina, orden, albaran_ref, bultos, iva_pct)
  select p_factura_id,
         l->>'nombre',
         coalesce((l->>'cantidad')::numeric, 1),
         coalesce(l->>'unidad', 'unidades'),
         (l->>'precio_unitario')::numeric,
         (l->>'total')::numeric,
         case when l->>'embedding' is not null then (l->>'embedding')::vector end,
         p_pagina::smallint,
         v_orden + ord::int,
         nullif(left(l->>'albaran_ref', 100), ''),
         (l->>'bultos')::numeric,
         (l->>'iva_pct')::numeric
    from jsonb_array_elements(p_lineas) with ordinality as x(l, ord);
  get diagnostics v_insertadas = row_count;

  -- 4. Trabajo cerrado: su documento ya está dentro de la factura.
  update public.ocr_trabajos
     set estado = 'completado', factura_id = p_factura_id, terminado_at = now(), documento_pendiente = null
   where id = p_trabajo_id;

  select * into fb from public.facturas where id = p_factura_id;
  update public.facturas_sustituciones
     set resumen_despues = jsonb_build_object('total', fb.total, 'total_origen', fb.total_origen,
                                              'lineas', v_lineas_antes + v_insertadas, 'lineas_anadidas', v_insertadas)
   where id = v_sust_id;

  return jsonb_build_object(
    'factura_id', p_factura_id, 'sustitucion_id', v_sust_id,
    'lineas_antes', v_lineas_antes, 'lineas_anadidas', v_insertadas, 'lineas', v_lineas_antes + v_insertadas,
    'total', fb.total, 'total_origen', fb.total_origen, 'paginas', fb.paginas,
    'paginas_lineas', coalesce((select jsonb_agg(distinct p.pagina order by p.pagina)
                                  from public.productos_factura p
                                 where p.factura_id = p_factura_id and p.pagina is not null), '[]'::jsonb),
    'alertas_antes', case when jsonb_typeof(fa.alertas_validacion) = 'array' then fa.alertas_validacion else '[]'::jsonb end);
end;
$function$;

CREATE OR REPLACE FUNCTION public.ocr_sustituir_factura(p_factura_id bigint, p_trabajo_id uuid, p_usuario uuid, p_cabecera jsonb, p_lineas jsonb, p_esperado jsonb, p_archivo_path text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
-- 20261106300000_facturas_retencion_irpf: guarda retencion_irpf y retencion_irpf_pct de la cabecera.
declare
  fa public.facturas%rowtype;
  t  public.ocr_trabajos%rowtype;
  v_lineas_antes integer;
  v_hist_borrado integer;
  v_hist_creado integer;
  v_insertadas integer;
  v_sust_id bigint;
begin
  select * into t from public.ocr_trabajos where id = p_trabajo_id for update;
  if not found then raise exception 'SUSTITUCIÓN ABORTADA: no existe el trabajo %', p_trabajo_id; end if;
  if t.estado <> 'duplicado' then
    raise exception 'SUSTITUCIÓN ABORTADA: el trabajo % está «%», no «duplicado».', p_trabajo_id, t.estado;
  end if;
  if jsonb_typeof(t.documento_pendiente->'pagina') = 'object' then
    raise exception 'SUSTITUCIÓN ABORTADA: el documento nuevo es la página % de % de la factura %: se añade como página, no se sustituye.',
      t.documento_pendiente->'pagina'->>'actual', t.documento_pendiente->'pagina'->>'total', p_factura_id;
  end if;

  select * into fa from public.facturas where id = p_factura_id for update;
  if not found then raise exception 'SUSTITUCIÓN ABORTADA: no existe la factura %', p_factura_id; end if;
  if exists (select 1 from public.ocr_trabajos tx
              where tx.id = fa.ocr_trabajo_id and tx.estado not in ('completado', 'duplicado', 'fallido', 'cancelado')) then
    raise exception 'SUSTITUCIÓN ABORTADA: la factura % aún se está leyendo o guardando. Espera a que termine, revisa y confirma de nuevo.', p_factura_id;
  end if;

  select count(*) into v_lineas_antes from public.productos_factura where factura_id = p_factura_id;
  if v_lineas_antes = 0 then
    raise exception 'SUSTITUCIÓN ABORTADA: la factura % no tiene líneas (puede que aún se esté guardando). Revisa y confirma de nuevo.', p_factura_id;
  end if;
  if p_esperado ? 'lineas' and (p_esperado->>'lineas')::int <> v_lineas_antes then
    raise exception 'SUSTITUCIÓN ABORTADA: la factura % ha cambiado desde que la viste (ahora tiene % líneas; tú viste %). Revisa y confirma de nuevo.',
      p_factura_id, v_lineas_antes, p_esperado->>'lineas';
  end if;
  if p_esperado ? 'updated_at' and p_esperado->>'updated_at' is not null
     and fa.updated_at is distinct from (p_esperado->>'updated_at')::timestamp then
    raise exception 'SUSTITUCIÓN ABORTADA: la factura % ha cambiado desde que la viste. Revisa y confirma de nuevo.', p_factura_id;
  end if;
  if jsonb_typeof(p_lineas) <> 'array' then
    raise exception 'SUSTITUCIÓN ABORTADA: p_lineas no es una lista';
  end if;
  if coalesce(p_cabecera->>'numero_documento', '') = '' then
    raise exception 'SUSTITUCIÓN ABORTADA: la cabecera nueva no trae número de documento';
  end if;

  -- 1. Copia de auditoría (sin embeddings: pesan y se regeneran).
  insert into public.facturas_sustituciones
    (factura_id, trabajo_id, sustituida_por, factura_antes, productos_antes, historial_antes, resumen_antes)
  values (
    p_factura_id, p_trabajo_id, p_usuario,
    to_jsonb(fa) - 'embedding' - 'embedding_observaciones',
    coalesce((select jsonb_agg(to_jsonb(p) - 'embedding' order by p.id)
                from public.productos_factura p where p.factura_id = p_factura_id), '[]'::jsonb),
    coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at, h.id)
                from public.historial_precios h where h.factura_id = p_factura_id), '[]'::jsonb),
    jsonb_build_object('total', fa.total, 'lineas', v_lineas_antes, 'alertas', fa.alertas_validacion,
                       'esperado', p_esperado))
  returning id into v_sust_id;

  -- 2. Historial y líneas viejas.
  delete from public.historial_precios where factura_id = p_factura_id;
  get diagnostics v_hist_borrado = row_count;
  delete from public.productos_factura where factura_id = p_factura_id;

  -- 3. Cabecera nueva, mismo id. (Antes que las líneas: el trigger del
  --    historial lee proveedor y fecha de facturas.)
  update public.facturas
     set tipo = p_cabecera->>'tipo',
         proveedor = p_cabecera->>'proveedor',
         cif = p_cabecera->>'cif',
         numero_documento = p_cabecera->>'numero_documento',
         fecha = (p_cabecera->>'fecha')::date,
         subtotal = (p_cabecera->>'subtotal')::numeric,
         iva = (p_cabecera->>'iva')::numeric,
         total = (p_cabecera->>'total')::numeric,
         total_origen = p_cabecera->>'total_origen',
         retencion_irpf = nullif((p_cabecera->>'retencion_irpf')::numeric, 0),
         retencion_irpf_pct = case when nullif((p_cabecera->>'retencion_irpf')::numeric, 0) is not null
                                   then (p_cabecera->>'retencion_irpf_pct')::numeric end,
         observaciones = p_cabecera->>'observaciones',
         resumen = p_cabecera->>'resumen',
         embedding = case when p_cabecera ? 'embedding' and p_cabecera->>'embedding' is not null
                          then (p_cabecera->>'embedding')::vector else null end,
         alertas_validacion = null,
         verificada = false,
         procesado_en = now(),
         paginas = coalesce((p_cabecera->>'paginas')::smallint, 1),
         ocr_trabajo_id = p_trabajo_id,
         archivo_path = coalesce(p_archivo_path, archivo_path),
         drive_url = case when p_archivo_path is not null then null else drive_url end
   where id = p_factura_id;

  -- 4. Líneas nuevas.
  insert into public.productos_factura
    (factura_id, nombre, cantidad, unidad, precio_unitario, total, embedding, pagina, orden, albaran_ref,
     bultos,                                                     -- 20261005150000
     iva_pct)                                                    -- 20261006105000
  select p_factura_id,
         l->>'nombre',
         coalesce((l->>'cantidad')::numeric, 1),
         coalesce(l->>'unidad', 'unidades'),
         (l->>'precio_unitario')::numeric,
         (l->>'total')::numeric,
         case when l->>'embedding' is not null then (l->>'embedding')::vector end,
         coalesce((l->>'pagina')::smallint, 1),
         coalesce((l->>'orden')::int, (ord - 1)::int),
         nullif(left(l->>'albaran_ref', 100), ''),
         (l->>'bultos')::numeric,                                -- 20261005150000
         (l->>'iva_pct')::numeric                                -- 20261006105000
    from jsonb_array_elements(p_lineas) with ordinality as x(l, ord);
  get diagnostics v_insertadas = row_count;
  select count(*) into v_hist_creado from public.historial_precios where factura_id = p_factura_id;

  -- 5. Trabajo cerrado.
  update public.ocr_trabajos
     set estado = 'completado', factura_id = p_factura_id, terminado_at = now(), documento_pendiente = null
   where id = p_trabajo_id;

  update public.facturas_sustituciones
     set resumen_despues = jsonb_build_object('total', p_cabecera->'total', 'lineas', v_insertadas,
                                              'historial_borrado', v_hist_borrado, 'historial_creado', v_hist_creado)
   where id = v_sust_id;

  return jsonb_build_object('factura_id', p_factura_id, 'sustitucion_id', v_sust_id,
                            'lineas_antes', v_lineas_antes, 'lineas', v_insertadas,
                            'historial_borrado', v_hist_borrado, 'historial_creado', v_hist_creado);
end;
$function$;

drop table if exists public.productos_nombre_embedding;

do $$
begin
  raise notice 'embeddings_por_nombre: rollback aplicado';
end;
$$;
commit;
