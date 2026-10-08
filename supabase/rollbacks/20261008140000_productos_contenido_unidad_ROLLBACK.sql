set client_encoding = 'UTF8';
-- ===========================================================================
-- ROLLBACK de supabase/migrations/20261008140000_productos_contenido_unidad.sql
-- ===========================================================================
-- No es una migración (ver supabase/rollbacks/README.md). Se ejecuta A MANO,
-- POR TERMINAL (no en el SQL Editor):
--   npx supabase db query --linked -f supabase/rollbacks/20261008140000_productos_contenido_unidad_ROLLBACK.sql
--
-- 1. Devuelve las 7 RPC (compras_producto_agente, historial_precios_agente,
--    variacion_precios_agente, ranking_agente, serie_precios_agente,
--    lineas_precio_agente y precio_referencia_agente, estas dos con su firma de
--    antes) a sus definiciones EXACTAS de la ronda 8 (copiadas de producción el
--    08/10/2026; md5 sin CR comprobado al final: si no cuadra, aborta).
-- 2. Borra lo nuevo: trigger y su función, extraer_contenido, base_linea_agente,
--    contenido_texto_agente, productos_contenido_guardar y las columnas contenido_* de productos_factura y
--    productos_catalogo (DATO PERDIDO: el contenido puesto a mano en el
--    catálogo; el de las líneas se vuelve a leer del texto al reaplicar).
-- ANTES: desplegar la chat-facturas anterior (la nueva habla de
-- precio_comparable / convertido_desde; sin la migración esas claves no llegan
-- y el prompt nuevo no se aplica, pero no da error de BD).
-- Se puede ejecutar dos veces. Imprime «productos_contenido_unidad: revertida |
-- funciones con la marca: 0».
-- ===========================================================================

begin;
set local lock_timeout = '5s';

drop trigger if exists trg_productos_factura_rellenar_contenido on public.productos_factura;
drop function if exists public.trg_productos_factura_rellenar_contenido();
drop function if exists public.lineas_precio_agente(bigint, bigint[], boolean);
drop function if exists public.precio_referencia_agente(bigint, text, date, bigint, boolean);

-- ─── 1. lineas_precio_agente y precio_referencia_agente (EXACTAS de antes) ──
CREATE OR REPLACE FUNCTION public.lineas_precio_agente(p_producto_id bigint DEFAULT NULL::bigint, p_ids bigint[] DEFAULT NULL::bigint[])
 RETURNS TABLE(id bigint, factura_id bigint, producto_id bigint, unidad text, cantidad numeric, precio numeric, fecha date, tipo text, numero text, proveedor text, prov_n text, created_at timestamp without time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- 20261008120000_chatbot_ronda8_cocinero: fuera el albarán ya facturado (facturado_en_id).
  with l as (
    select pf.id, pf.factura_id, pf.producto_id,
           coalesce(nullif(btrim(pf.unidad::text), ''), 'ud') as unidad,
           pf.cantidad,
           coalesce(pf.precio_unitario, round(pf.total / nullif(pf.cantidad, 0), 4)) as precio,
           f.fecha, f.tipo::text as tipo, f.numero_documento::text as numero, f.proveedor::text as proveedor,
           coalesce(nullif(f.proveedor_normalizado::text, ''), nullif(normalizar_proveedor(f.proveedor), ''), '?') as prov_n,
           pf.created_at
      from productos_factura pf
      join facturas f on f.id = pf.factura_id
     where pf.producto_id is not null
       and (p_producto_id is null or pf.producto_id = p_producto_id)
       and (p_ids is null or pf.id = any(p_ids))
       and not (f.tipo = 'albaran' and f.facturado_en_id is not null)
  )
  select l.* from l
   where l.precio > 0
     and not (l.tipo = 'albaran' and exists (
           select 1
             from productos_factura x
             join facturas fx on fx.id = x.factura_id
            where fx.tipo = 'factura'
              and x.producto_id = l.producto_id
              and coalesce(nullif(btrim(x.unidad::text), ''), 'ud') = l.unidad
              and x.cantidad = l.cantidad
              and fx.fecha between l.fecha - 7 and l.fecha + 75
              and mismo_proveedor_agente(
                    coalesce(nullif(fx.proveedor_normalizado::text, ''), nullif(normalizar_proveedor(fx.proveedor), ''), '?'),
                    l.prov_n)))
$function$;

CREATE OR REPLACE FUNCTION public.precio_referencia_agente(p_producto_id bigint, p_unidad text, p_fecha date, p_factura_id bigint)
 RETURNS TABLE(precio numeric, compras integer, desde date, hasta date, proveedor text, proveedores_n text[], metodo text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with ant as (
    select l.* from lineas_precio_agente(p_producto_id) l
     where l.unidad = p_unidad
       and l.factura_id <> p_factura_id
       and (l.fecha < p_fecha or (l.fecha = p_fecha and l.factura_id < p_factura_id))
  ),
  docs as (
    select a.factura_id, max(a.fecha) as fecha,
           row_number() over (order by max(a.fecha) desc, a.factura_id desc) as rn
      from ant a group by a.factura_id
  ),
  m as (
    select case when (select count(*) from docs where docs.fecha >= p_fecha - 90) >= 2
                then 'media_90_dias' else 'ultimas_compras' end as metodo
  ),
  ref as (
    select a.* from ant a join docs d using (factura_id) cross join m
     where case when m.metodo = 'media_90_dias' then d.fecha >= p_fecha - 90 else d.rn <= 3 end
  )
  select coalesce(sum(r.precio * r.cantidad) filter (where r.cantidad > 0)
                    / nullif(sum(r.cantidad) filter (where r.cantidad > 0), 0),
                  avg(r.precio)),
         count(distinct r.factura_id)::integer,
         min(r.fecha),
         max(r.fecha),
         (select r2.proveedor from ref r2 group by r2.proveedor
           order by sum(r2.precio * coalesce(nullif(r2.cantidad, 0), 1)) desc, r2.proveedor limit 1),
         array_agg(distinct r.prov_n),
         (select m.metodo from m)
    from ref r
  having count(*) > 0
$function$;

-- ─── 2. compras_producto_agente (EXACTA de antes) ───────────────────────────
CREATE OR REPLACE FUNCTION public.compras_producto_agente(p_texto text, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_tipo text DEFAULT NULL::text, p_limite integer DEFAULT 10, p_orden text DEFAULT NULL::text, p_excluir text DEFAULT NULL::text, p_embedding vector DEFAULT NULL::vector, p_unidad text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261008120000_chatbot_ronda8_cocinero: buscador único (lineas_producto_agente),
-- p_unidad, por_proveedor con ultima, ultimo_precio, precio_min y precio_max, sin
-- líneas a 0 €, sin albaranes facturados (facturado_en_id) y total con
-- en_facturas / en_albaranes_sin_factura.
declare
  c_max_variantes constant int := 15;
  v_lim    int := least(greatest(coalesce(p_limite, 10), 1), 50);
  v_orden  text := lower(coalesce(nullif(trim(p_orden), ''), 'importe'));
  v_uni    text := unidad_agente(p_unidad);
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
           unidad_agente(coalesce(nullif(btrim(pf.unidad::text), ''), 'ud')) as unidad,
           coalesce(pf.total, round(pf.cantidad * pf.precio_unitario, 2))::numeric as imp,
           f.id as doc, f.tipo, f.fecha,
           coalesce(pv.nombre, f.proveedor)::text as proveedor,   -- nombre canónico
           coalesce(nullif(f.proveedor_normalizado, ''), nullif(normalizar_proveedor(f.proveedor), ''), '?') as prov_n,
           fecha_dudosa_agente(f.alertas_validacion) as fd,
           palabras_producto_agente(pf.nombre) @> v_pal or palabras_producto_agente(pc.nombre) @> v_pal as exacta
      from productos_factura pf
      join facturas f on f.id = pf.factura_id
      left join proveedores pv on pv.id = f.proveedor_id
      left join productos_catalogo pc on pc.id = pf.producto_id
     where pf.id = any(v_ids)
       and coalesce(pf.total, round(pf.cantidad * pf.precio_unitario, 2)) is distinct from 0   -- líneas a 0 €: fuera
       and not (f.tipo = 'albaran' and f.facturado_en_id is not null)                         -- albarán ya facturado
  ),
  filtrada as (
    select * from base
     where (p_desde is null or fecha >= p_desde)
       and (p_hasta is null or fecha <= p_hasta)
       and (v_tipo is null or tipo = v_tipo)
       and (v_uni is null or unidad = v_uni)
  ),
  -- Albarán cuya línea ya está en una factura del mismo proveedor (sin
  -- vínculo guardado): tampoco se cuenta.
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
    select *, case when imp > 0 and cant > 0 then imp / cant end as pu
      from filtrada where id not in (select id from ya_facturados)
  ),
  por_unidad as (
    select unidad,
           sum(cant) as cant,
           sum(imp) as imp,
           sum(imp) filter (where pu is not null) / nullif(sum(cant) filter (where pu is not null), 0) as precio,
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
           (array_agg(pu order by fecha desc nulls last, doc desc) filter (where pu is not null))[1] as ult_precio,
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
           sum(imp) filter (where tipo = 'factura') as imp_fac,
           sum(imp) filter (where tipo = 'albaran') as imp_alb,
           count(*) filter (where imp is null) as sin_importe,
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
               'precio_medio', trim_scale(round(u.precio, case when u.precio < 1 then 4 else 2 end)),
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
               'precio_medio',  trim_scale(round(o.precio, case when o.precio < 1 then 4 else 2 end)),
               'ultimo_precio', trim_scale(round(o.ult_precio, case when o.ult_precio < 1 then 4 else 2 end)),
               'precio_min',    trim_scale(round(o.p_min, case when o.p_min < 1 then 4 else 2 end)),
               'precio_max',    trim_scale(round(o.p_max, case when o.p_max < 1 then 4 else 2 end)),
               'compras',       o.compras,
               'primera',       o.primera,
               'ultima',        o.ultima,
               'tipo',          o.tipo))
             order by o.rn)
        from ordenada o
       where o.rn <= v_lim),
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

  return resultado::json;
end;
$function$;

-- ─── 3. historial_precios_agente (EXACTA de antes) ──────────────────────────
CREATE OR REPLACE FUNCTION public.historial_precios_agente(p_producto text, p_limite integer DEFAULT 30)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261008120000_chatbot_ronda8_cocinero: buscador único, filas idénticas
-- agrupadas (mismo documento, producto, unidad y precio), proveedor canónico,
-- comparativa por proveedor Y unidad, sin albaranes facturados ni precio 0.
declare
  resultado json;
  v_limite  integer := least(greatest(coalesce(p_limite, 30), 1), 100);
  h record;
begin
  select * into h from lineas_producto_agente(p_producto);
  if coalesce(cardinality(h.palabras), 0) = 0 then
    return json_build_object('error', 'Falta el nombre del producto.', 'compras', '[]'::json);
  end if;
  if h.ids is null then
    return jsonb_strip_nulls(jsonb_build_object(
      'producto_consultado', p_producto,
      'compras_encontradas', 0,
      'compras', '[]'::jsonb,
      'subproductos', to_jsonb(h.subproductos),
      'nota', case when h.subproductos is not null then
                'Solo hay subproductos con ese nombre (espinas, recortes...), no el producto: dilo y pregunta si es eso.' end))::json;
  end if;

  with l as (
    select pf.id,
           coalesce(pc.nombre, pf.nombre::text) as producto,
           coalesce('c' || pf.producto_id, array_to_string(palabras_producto_agente(pf.nombre), ' ')) as var,
           coalesce(pv.nombre, f.proveedor)::text as proveedor,
           coalesce(f.proveedor_id::text, nullif(f.proveedor_normalizado::text, ''), f.proveedor::text, '?') as prov_k,
           f.tipo::text as tipo, f.numero_documento::text as numero, f.fecha,
           fecha_dudosa_agente(f.alertas_validacion) as fd,
           pf.cantidad,
           unidad_agente(coalesce(nullif(btrim(pf.unidad::text), ''), 'ud')) as unidad,
           round(coalesce(pf.precio_unitario, pf.total / nullif(pf.cantidad, 0))::numeric, 4) as precio,
           pf.total
      from productos_factura pf
      join facturas f on f.id = pf.factura_id
      left join proveedores pv on pv.id = f.proveedor_id
      left join productos_catalogo pc on pc.id = pf.producto_id
     where pf.id = any(h.ids)
       and not (f.tipo = 'albaran' and f.facturado_en_id is not null)
  ),
  g as (   -- filas idénticas en una sola
    select producto, var, proveedor, prov_k, tipo, numero, fecha, bool_or(fd) as fd, unidad, precio,
           sum(cantidad) as cantidad, round(sum(total)::numeric, 2) as importe, count(*) as veces, min(id) as id
      from l
     where precio > 0
     group by producto, var, proveedor, prov_k, tipo, numero, fecha, unidad, precio
  ),
  compras as (
    select g.*, count(*) over () as lineas_totales
      from g
     order by fecha desc nulls last, id desc
     limit v_limite
  ),
  marco as (
    select count(*)::int                     as n,
           coalesce(max(lineas_totales), 0)::int as lineas_totales,
           min(fecha)                        as f_min,
           max(fecha)                        as f_max,
           count(distinct fecha)::int        as fechas_distintas,
           count(distinct var)::int          as variantes,
           count(distinct prov_k)::int       as proveedores,
           count(distinct unidad)::int       as unidades
      from compras
  ),
  extremos as (
    select m.n, m.f_min, m.f_max, m.fechas_distintas, m.proveedores, m.unidades,
           round(avg(c.precio) filter (where c.fecha = m.f_min), 4) as precio_inicial,
           round(avg(c.precio) filter (where c.fecha = m.f_max), 4) as precio_actual
      from compras c cross join marco m
     group by m.n, m.f_min, m.f_max, m.fechas_distintas, m.proveedores, m.unidades
  ),
  -- Por proveedor y unidad: su propia evolución (primera frente a última fecha).
  prov as (
    select prov_k, unidad,
           max(proveedor)              as proveedor,
           count(*)                    as veces,
           round(min(precio), 2)       as precio_min,
           round(max(precio), 2)       as precio_max,
           round(avg(precio), 2)       as precio_medio,
           min(fecha)                  as primera_compra,
           max(fecha)                  as ultima_compra,
           count(distinct fecha)       as fechas
      from compras
     group by prov_k, unidad
  ),
  prov_var as (
    select p.*,
           case when p.fechas >= 2 then
             (select round(avg(c.precio), 4) from compras c
               where c.prov_k = p.prov_k and c.unidad = p.unidad and c.fecha = p.primera_compra) end as precio_primera,
           case when p.fechas >= 2 then
             (select round(avg(c.precio), 4) from compras c
               where c.prov_k = p.prov_k and c.unidad = p.unidad and c.fecha = p.ultima_compra) end as precio_ultima
      from prov p
  )
  select (jsonb_strip_nulls(jsonb_build_object(
    'producto_consultado', p_producto,
    'coincidencia',        case when h.metodo in ('derivada', 'aproximada') then 'aproximada' end,
    'compras_devueltas',   (select n from marco),
    'compras_encontradas', (select lineas_totales from marco),
    'truncado',            (select lineas_totales > n from marco),
    'aviso', (
      select case when m.lineas_totales > m.n then
        'RESULTADO PARCIAL: hay ' || m.lineas_totales || ' compras de este producto y solo se devuelven las '
        || m.n || ' MAS RECIENTES (desde ' || m.f_min || '). No es el historico completo.'
      end from marco m),
    'precios', 'precio unitario de linea, SIN IVA',
    'variantes_distintas', (select case when variantes > 1 then variantes end from marco),
    'nota_coincidencia', (
      select case when m.variantes > 1 then
        'Mezcla ' || m.variantes || ' articulos distintos: desglosa por articulo en vez de dar un unico precio medio.'
      end from marco m),
    'comparativa_entre_proveedores', (select case when proveedores > 1 then true end from marco),
    'unidades_mezcladas', (select case when unidades > 1 then true end from marco),
    'subproductos_excluidos', to_jsonb(h.subproductos),
    'por_proveedor', (
      select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'proveedor',      x.proveedor,
               'unidad',         x.unidad,
               'veces',          x.veces,
               'precio_min',     x.precio_min,
               'precio_max',     case when x.precio_max <> x.precio_min then x.precio_max end,
               'precio_medio',   case when x.veces > 1 then x.precio_medio end,
               'primera_compra', x.primera_compra,
               'ultima_compra',  case when x.ultima_compra <> x.primera_compra then x.ultima_compra end,
               'variacion_pct',  case when x.precio_primera is not null and x.precio_primera <> 0
                                      then round((x.precio_ultima - x.precio_primera) / x.precio_primera * 100, 2) end))
             order by x.unidad, x.precio_medio), '[]'::jsonb)
      from prov_var x),
    'nota_variacion', (
      select case
        when e.n < 2 then
          'Solo hay una compra: no hay evolucion de precio que medir.'
        when e.unidades > 1 then
          'Unidades distintas (caja, kg, ud...): no compares precios entre ellas; da el de cada proveedor en su unidad.'
        when e.proveedores > 1 then
          'Compras de ' || e.proveedores || ' proveedores: es una COMPARATIVA entre proveedores, NO una subida ni '
          || 'una bajada. La evolucion de cada uno esta en por_proveedor.variacion_pct.'
        when e.fechas_distintas < 2 then
          'Todas las compras son de la misma fecha (' || e.f_min || '): no hay evolucion de precio.'
      end from extremos e),
    'compras', (
      select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'producto',  producto,
               'proveedor', proveedor,
               'tipo',      tipo,
               'numero',    numero,
               'fecha',     fecha,
               'fecha_dudosa', case when fd then true end,
               'cantidad',  trim_scale(cantidad),
               'unidad',    unidad,
               'precio_unitario', trim_scale(precio),
               'importe',   importe,
               'veces',     case when veces > 1 then veces end))
             order by fecha asc, id asc), '[]'::jsonb)
      from compras)
  ))
  -- Variación global solo con UN proveedor y UNA unidad. Fuera del
  -- strip_nulls: "variacion": null tiene que verse.
  || jsonb_build_object(
    'variacion', (
      select case
        when e.n < 2 or e.fechas_distintas < 2 or e.proveedores > 1 or e.unidades > 1 then null
        else jsonb_build_object(
          'precio_inicial', e.precio_inicial,
          'fecha_inicial',  e.f_min,
          'precio_actual',  e.precio_actual,
          'fecha_actual',   e.f_max,
          'diferencia',     round(e.precio_actual - e.precio_inicial, 4),
          'variacion_pct',  case when e.precio_inicial is null or e.precio_inicial = 0 then null
                                 else round((e.precio_actual - e.precio_inicial) / e.precio_inicial * 100, 2) end)
        end
      from extremos e)
  ))::json into resultado;

  return coalesce(resultado, json_build_object('compras_encontradas', 0, 'compras', '[]'::json));
end;
$function$;

-- ─── 4. variacion_precios_agente (EXACTA de antes) ──────────────────────────
CREATE OR REPLACE FUNCTION public.variacion_precios_agente(p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_umbral_pct numeric DEFAULT 10, p_categoria text DEFAULT NULL::text, p_producto text DEFAULT NULL::text, p_limite integer DEFAULT 10, p_sentido text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261008120000_chatbot_ronda8_cocinero: el producto se busca con lineas_producto_agente
-- (mismo buscador que compras e historial); lineas_precio_agente ya no cuenta albaranes facturados.
declare
  v_lim     int := least(greatest(coalesce(p_limite, 10), 1), 50);
  v_umbral  numeric := coalesce(p_umbral_pct, 10);
  v_sentido text := lower(coalesce(nullif(trim(p_sentido), ''), 'subidas'));
  v_cat     categorias_producto%rowtype;
  v_prods   bigint[];
  v_ids     bigint[];
  v_subs    text[];
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
    select h.ids, h.subproductos into v_ids, v_subs from lineas_producto_agente(p_producto) h;
    v_prods := array(select distinct pf.producto_id from productos_factura pf
                      where pf.id = any(v_ids) and pf.producto_id is not null);
    if cardinality(v_prods) = 0 then
      return jsonb_strip_nulls(jsonb_build_object('buscado', p_producto, 'sin_datos', true,
        'subproductos', to_jsonb(v_subs),
        'nota', case when v_subs is not null
                     then 'Solo hay subproductos con ese nombre (espinas, recortes...), no el producto.'
                     else 'Ningun producto del catalogo se llama asi: prueba compras_producto o historial_precios.' end))::json;
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
                      then jsonb_build_object('desde', p_desde, 'hasta', p_hasta)
                      else to_jsonb('todo el historico'::text) end,
    'sentido',   case when v_prods is null then v_sentido end,
    'umbral_pct', case when v_prods is null then trim_scale(v_umbral) end,
    'productos', coalesce((
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                 'producto',       s.producto,
                 'unidad',         s.unidad,
                 'precio',         trim_scale(round(s.precio, 4)),
                 'fecha',          s.fecha,
                 'proveedor',      coalesce((select pv.nombre from facturas f join proveedores pv on pv.id = f.proveedor_id
                                              where f.id = s.factura_id), s.proveedor),
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
    -- Producto pedido sin precio anterior con que comparar: su última compra
    -- (una_compra = solo hay una: no hay subida ni bajada posible).
    'sin_comparar', case when v_prods is not null then (
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                 'producto',   c.producto,
                 'unidad',     c.unidad,
                 'precio',     trim_scale(round(c.precio, 4)),
                 'fecha',      c.fecha,
                 'proveedor',  coalesce((select pv.nombre from facturas f join proveedores pv on pv.id = f.proveedor_id
                                          where f.id = c.factura_id), c.proveedor),
                 'una_compra', case when (select count(distinct l2.factura_id) from l l2
                                           where l2.producto_id = c.producto_id and l2.unidad = c.unidad) = 1 then true end))
               order by c.fecha desc, c.producto)
          from (select * from cmp where var is null order by fecha desc, producto limit v_lim) c) end,
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

-- ─── 5. ranking_agente (EXACTA de antes) ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ranking_agente(p_criterio text, p_tipo text DEFAULT NULL::text, p_limite integer DEFAULT 10, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_orden text DEFAULT 'desc'::text, p_incluir_servicios boolean DEFAULT false, p_unidad text DEFAULT NULL::text, p_categoria text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261008120000_chatbot_ronda8_cocinero: p_unidad y p_categoria (criterios de
-- líneas) y sin albaranes facturados (facturado_en_id).
declare
  c_criterios constant text[] := array['precio_unitario', 'importe_linea', 'cantidad', 'veces', 'gasto_proveedor', 'importe_documento'];
  v_crit  text := lower(trim(coalesce(p_criterio, '')));
  v_tipo  text := lower(trim(coalesce(p_tipo, '')));
  v_ord   text := lower(trim(coalesce(nullif(p_orden, ''), 'desc')));
  v_lim   int  := least(greatest(coalesce(p_limite, 10), 1), 50);
  v_serv  boolean := coalesce(p_incluir_servicios, false);
  v_uni   text := unidad_agente(p_unidad);
  v_cat   bigint;
  v_catn  text;
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
  if nullif(trim(coalesce(p_categoria, '')), '') is not null then
    v_cat := categoria_agente(p_categoria);
    if v_cat is null then
      return json_build_object('error', format('No hay ninguna categoria "%s".', p_categoria));
    end if;
    select nombre into v_catn from categorias_producto where id = v_cat;
    v_serv := true;   -- la categoría manda (también «servicios»)
  end if;
  v_asc := v_ord = 'asc';

  if v_crit in ('precio_unitario', 'importe_linea') then
    with l as (
      select pf.id, pf.nombre, coalesce(pf.nombre_normalizado, lower(pf.nombre)) as clave,
             pf.cantidad, unidad_agente(coalesce(nullif(btrim(pf.unidad::text), ''), 'ud')) as unidad,
             pf.precio_unitario, pf.total,
             f.tipo, coalesce((select pv.nombre from proveedores pv where pv.id = f.proveedor_id), f.proveedor) as proveedor,
             f.numero_documento, f.fecha,
             case when v_crit = 'precio_unitario' then pf.precio_unitario else pf.total end as valor,
             es_linea_servicio_agente(coalesce(pf.nombre_normalizado, pf.nombre))           as servicio
        from productos_factura pf
        join facturas f on f.id = pf.factura_id
        left join productos_catalogo pc on pc.id = pf.producto_id
        left join categorias_producto c on c.id = pc.categoria_id
       where (v_tipo is null or f.tipo = v_tipo)
         and (p_desde is null or f.fecha >= p_desde)
         and (p_hasta is null or f.fecha <= p_hasta)
         and not (f.tipo = 'albaran' and f.facturado_en_id is not null)
         and (v_cat is null or c.id = v_cat or c.padre_id = v_cat)
    ),
    validas as (select * from l where valor is not null and valor > 0 and (v_uni is null or unidad = v_uni)),
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
             || case when v_cat is not null then '' when v_serv then '; incluye servicios' else '; excluye servicios (portes, trabajos, mano de obra, gestion...)' end;

  elsif v_crit in ('cantidad', 'veces') then
    with l as (
      select pf.id, pf.nombre, coalesce(pf.nombre_normalizado, lower(pf.nombre)) as clave,
             pf.cantidad, unidad_agente(coalesce(nullif(btrim(pf.unidad::text), ''), 'ud')) as unidad, pf.total,
             es_linea_servicio_agente(coalesce(pf.nombre_normalizado, pf.nombre)) as servicio
        from productos_factura pf
        join facturas f on f.id = pf.factura_id
        left join productos_catalogo pc on pc.id = pf.producto_id
        left join categorias_producto c on c.id = pc.categoria_id
       where (v_tipo is null or f.tipo = v_tipo)
         and (p_desde is null or f.fecha >= p_desde)
         and (p_hasta is null or f.fecha <= p_hasta)
         and not (f.tipo = 'albaran' and f.facturado_en_id is not null)
         and (v_cat is null or c.id = v_cat or c.padre_id = v_cat)
         and (v_uni is null or unidad_agente(coalesce(nullif(btrim(pf.unidad::text), ''), 'ud')) = v_uni)
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
      -- cantidad: el primero de CADA unidad (kg, ud, caja…), porque 172,7 kg y
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
             || case when v_cat is not null then '' when v_serv then '; incluye servicios' else '; excluye servicios (portes, trabajos, mano de obra, gestion...)' end;

  elsif v_crit = 'gasto_proveedor' then
    v_tipo := coalesce(v_tipo, 'factura');
    with g as (
      select coalesce(max((select pv.nombre from proveedores pv where pv.id = facturas.proveedor_id)),
                      max(proveedor), proveedor_normalizado)               as proveedor,
             count(*)                                                     as documentos,
             round(coalesce(sum(total), 0)::numeric, 2)                   as importe,
             nullif(count(*) filter (where total is null), 0)             as sin_total,
             nullif(count(*) filter (where total_origen = 'deducido'), 0) as deducidos,
             coalesce(sum(total), 0)                                      as valor
        from facturas
       where tipo = v_tipo
         and (p_desde is null or fecha >= p_desde)
         and (p_hasta is null or fecha <= p_hasta)
         and not (tipo = 'albaran' and facturado_en_id is not null)
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
                  else 'Valor de albaranes sin factura por proveedor (IVA incluido; NO es gasto facturado)' end
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
         and not (f.tipo = 'albaran' and f.facturado_en_id is not null)
    )
    select
      (select coalesce(max(total_filas), 0) from o),
      (select coalesce(json_agg(documento_compacto_agente(f) order by o.n), '[]'::json)
         from o join facturas f on f.id = o.id where o.n <= v_lim)
    into v_total, v_filas;
    v_sint := docs_sin_total_agente(v_tipo, p_desde, p_hasta);
    v_ded  := docs_deducidos_agente(v_tipo, p_desde, p_hasta);
    v_txt := 'Documentos por total (IVA incluido)'
             || case when v_tipo is null then ', facturas y albaranes sin factura mezclados (mira "tipo")' else '' end
             || '; los documentos sin total no entran';
  end if;

  if v_crit in ('gasto_proveedor', 'importe_documento') and (v_uni is not null or v_cat is not null) then
    v_txt := v_txt || '; unidad y categoria no aplican a documentos';
  else
    if v_uni is not null then v_txt := v_txt || '; solo unidad ' || v_uni; end if;
    if v_cat is not null then v_txt := v_txt || '; categoria ' || v_catn; end if;
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

-- ─── 6. serie_precios_agente (EXACTA de antes) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.serie_precios_agente(p_texto text, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_unidad text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
-- 20261008120000_chatbot_ronda8_cocinero: serie de precios de UN producto para
-- la gráfica del chat. Contrato (no cambiar sin la UI):
--   {producto, unidad, proveedores:[text], puntos:[['YYYY-MM-DD', precio, idx]],
--    n, min, max, ultimo, variacion_pct}   o   {sin_datos:true, buscado}
--   · idx = posición (desde 0) del proveedor en «proveedores».
--   · Un punto por fecha y proveedor: precio medio ponderado por cantidad, SIN IVA.
--   · Una sola unidad: p_unidad o la más comprada. Máx. 60 puntos (los más
--     recientes), en orden de fecha. Sin albaranes facturados ni precios a 0.
--   · producto = el artículo si es uno solo; si casan varios, el texto buscado.
--   · variacion_pct (primer punto → último) solo con un proveedor y un artículo.
declare
  h      record;
  resultado jsonb;
begin
  if p_desde is not null and p_hasta is not null and p_desde > p_hasta then
    return jsonb_build_object('sin_datos', true, 'buscado', p_texto);
  end if;
  select * into h from lineas_producto_agente(p_texto);
  if h.ids is null then
    return jsonb_build_object('sin_datos', true, 'buscado', p_texto);
  end if;

  with l as (
    select f.fecha,
           unidad_agente(coalesce(nullif(btrim(pf.unidad::text), ''), 'ud')) as unidad,
           pf.cantidad as cant,
           coalesce(pf.precio_unitario, pf.total / nullif(pf.cantidad, 0)) as precio,
           coalesce(pv.nombre, f.proveedor)::text as prov,
           coalesce(pc.nombre, pf.nombre::text) as nom,
           coalesce('c' || pf.producto_id, array_to_string(palabras_producto_agente(pf.nombre), ' ')) as var
      from productos_factura pf
      join facturas f on f.id = pf.factura_id
      left join proveedores pv on pv.id = f.proveedor_id
      left join productos_catalogo pc on pc.id = pf.producto_id
     where pf.id = any(h.ids)
       and f.fecha is not null
       and not (f.tipo = 'albaran' and f.facturado_en_id is not null)
       and (p_desde is null or f.fecha >= p_desde)
       and (p_hasta is null or f.fecha <= p_hasta)
       and coalesce(pf.precio_unitario, pf.total / nullif(pf.cantidad, 0)) > 0
  ),
  u as (
    select coalesce(unidad_agente(p_unidad),
                    (select l.unidad from l group by l.unidad order by count(*) desc, l.unidad limit 1)) as uni
  ),
  pt as (
    select l.fecha, l.prov,
           coalesce(sum(l.precio * l.cant) filter (where l.cant > 0) / nullif(sum(l.cant) filter (where l.cant > 0), 0),
                    avg(l.precio)) as precio
      from l join u on l.unidad = u.uni
     group by l.fecha, l.prov
  ),
  ult as (
    select * from pt order by fecha desc, prov limit 60
  ),
  provs as (
    select prov, row_number() over (order by min(fecha), prov) - 1 as idx
      from ult group by prov
  ),
  orden as (
    select ult.fecha, ult.prov, round(ult.precio, 4) as precio, p.idx,
           row_number() over (order by ult.fecha, ult.prov) as rn,
           count(*) over () as n
      from ult join provs p using (prov)
  )
  select case when (select count(*) from orden) = 0 then null else jsonb_build_object(
    'producto',      (select case when count(distinct l.var) = 1 then min(l.nom) else p_texto end
                        from l join u on l.unidad = u.uni),
    'unidad',        (select uni from u),
    'proveedores',   (select jsonb_agg(prov order by idx) from provs),
    'puntos',        (select jsonb_agg(jsonb_build_array(to_char(fecha, 'YYYY-MM-DD'), trim_scale(precio), idx) order by rn) from orden),
    'n',             (select max(n) from orden),
    'min',           (select trim_scale(min(precio)) from orden),
    'max',           (select trim_scale(max(precio)) from orden),
    'ultimo',        (select trim_scale(precio) from orden order by rn desc limit 1),
    -- Solo con UN proveedor y UN artículo: entre proveedores o artículos es una comparativa.
    'variacion_pct', (select case when max(n) >= 2 and (array_agg(precio order by rn))[1] > 0
                                   and (select count(*) from provs) = 1
                                   and (select count(distinct l.var) from l join u on l.unidad = u.uni) = 1
                                  then round(((array_agg(precio order by rn desc))[1] / (array_agg(precio order by rn))[1] - 1) * 100, 1) end
                        from orden)) end
    into resultado;

  return coalesce(resultado, jsonb_build_object('sin_datos', true, 'buscado', p_texto));
end;
$function$;

-- ─── 7. Permisos (los de antes) ─────────────────────────────────────────────
revoke all on function public.lineas_precio_agente(bigint, bigint[]) from public, anon;
grant execute on function public.lineas_precio_agente(bigint, bigint[]) to authenticated, service_role;
revoke all on function public.precio_referencia_agente(bigint, text, date, bigint) from public, anon;
grant execute on function public.precio_referencia_agente(bigint, text, date, bigint) to authenticated, service_role;

-- ─── 8. Lo nuevo ────────────────────────────────────────────────────────────
drop function if exists public.extraer_contenido(text);
drop function if exists public.base_linea_agente(text, numeric, text);
drop function if exists public.contenido_texto_agente(text, numeric, text);
drop function if exists public.productos_contenido_guardar(bigint, numeric, text);
alter table public.productos_factura drop constraint if exists productos_factura_contenido_chk;
alter table public.productos_factura
  drop column if exists contenido_cantidad,
  drop column if exists contenido_unidad,
  drop column if exists contenido_origen;
alter table public.productos_catalogo drop constraint if exists productos_catalogo_contenido_chk;
alter table public.productos_catalogo
  drop column if exists contenido_cantidad,
  drop column if exists contenido_unidad;

-- ─── Comprobación: las 7 definiciones son las de antes ──────────────────────
do $$
declare
  r record;
  v_def text;
begin
  for r in select * from (values
    ('compras_producto_agente(text, date, date, text, integer, text, text, vector, text)', '59d5f3c57471a940b573360fceaf29d9'),
    ('historial_precios_agente(text, integer)', 'be734bc40cf848940528297e4efe491b'),
    ('variacion_precios_agente(date, date, numeric, text, text, integer, text)', '76795d29374a36232ed9ee20857e0a20'),
    ('ranking_agente(text, text, integer, date, date, text, boolean, text, text)', 'ce9f8c64de2a726eab12c53017cb5942'),
    ('serie_precios_agente(text, date, date, text)', '3e3401d7556ea3ad6ea9eb4a6290072e'),
    ('lineas_precio_agente(bigint, bigint[])', 'b3a5c2cac5db67659ecbd4dd52d3d288'),
    ('precio_referencia_agente(bigint, text, date, bigint)', 'a44aa23910c03f1a8cbcfeadb0ca9319')
  ) t(fn, md5) loop
    v_def := replace(pg_get_functiondef(to_regprocedure('public.' || r.fn)), chr(13), '');
    if v_def is null or md5(v_def) <> r.md5 then
      raise exception 'productos_contenido_unidad ROLLBACK: % no ha quedado como antes (md5 %). No se ha cambiado nada.', r.fn, md5(v_def);
    end if;
  end loop;
end;
$$;

notify pgrst, 'reload schema';

commit;

select 'productos_contenido_unidad: revertida | funciones con la marca: '
       || (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
            and position('20261008140000_productos_contenido_unidad'
                         in case when p.prokind = 'f' then pg_get_functiondef(p.oid) else '' end) > 0) as resultado;
