set client_encoding = 'UTF8';
-- 20261124120000_chatbot_precio_unidad_compra (11/11/2026)
-- Petición del dueño: «Añade a la IA de facturas que si te preguntan por un producto tipo vino, tercio
--   o alimento (si se compra por ejemplo 500 g) que te dé la info tal y como se compra; por ejemplo el
--   vino normalmente 75 cl, a no ser que sean magnum 1,5 l: que te dé la info del producto tal y como sale
--   en la factura, a no ser que te diga que quiere el precio por litro o por kilo».
-- Antes: historial_precios y grafico_precio pasaban a €/kg o €/l todo lo que se podía (la oreja de cerdo
--   de 500 g a 4,17 € la bolsa salía a 8,34 €/kg; un vino de 75 cl, en €/l), compras_producto mandaba
--   siempre precio_comparable y el modelo lo daba en €/l, y volumen_comprado solo tenía € por litro/kilo.
-- Ahora: parámetro p_base (true = como antes, lo que manda el panel) en compras_producto_agente,
--   historial_precios_agente, serie_precios_agente y variacion_precios_agente. chat-facturas manda
--   p_base = false salvo que se pida el kilo o el litro: precio tal como se compra (botella de 75 cl,
--   magnum, caja de 24 tercios, paquete de 500 g; al kilo o al litro si se compra a granel).
--   compras_producto solo trae precio_comparable si hay formatos distintos (para decir el más barato) y
--   variacion_precios solo convierte el producto que mezcla formatos. volumen_comprado_agente (misma
--   firma) añade precio_envase y el precio de cada formato facturado en «compra».
-- Parte de las definiciones vigentes en la demo (pg_get_functiondef, 11/11/2026). Se borran las firmas
-- anteriores: dos sobrecargas con DEFAULT darían «no se puede elegir la función» en PostgREST.
-- Aplicar ANTES de desplegar la Edge Function chat-facturas nueva (manda p_base). La versión anterior de
-- chat-facturas sigue funcionando igual con esta migración (p_base por defecto = true).
begin;

-- ─── compras_producto_agente ───
drop function if exists public.compras_producto_agente(text, date, date, text, integer, text, text, vector, text, text);
CREATE OR REPLACE FUNCTION public.compras_producto_agente(p_texto text, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_tipo text DEFAULT NULL::text, p_limite integer DEFAULT 10, p_orden text DEFAULT NULL::text, p_excluir text DEFAULT NULL::text, p_embedding vector DEFAULT NULL::vector, p_unidad text DEFAULT NULL::text, p_proveedor text DEFAULT NULL::text, p_base boolean DEFAULT true)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261106140000_chatbot_gasto_como_el_panel: importe de línea = solo pf.total.
-- 20261124120000_chatbot_precio_unidad_compra: p_base = false (chat-facturas) → precio tal como se compra; precio_comparable
-- (€/kg, €/l) solo si mezcla formatos (unidades o contenidos distintos) para poder decir el más barato.
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
           f.id as doc, f.tipo, f.fecha,
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
           (array_agg(pu order by fecha desc nulls last, doc desc) filter (where pu is not null))[1] as ult_precio,
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
           exists (select 1 from prov_multi pm where pm.prov_n = p.prov_n and pm.unidad = p.unidad) as multi,
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
           (array_agg(pu / factor order by fecha desc nulls last, doc desc))[1] as ult_precio,
           min(pu / factor) as p_min,
           max(pu / factor) as p_max,
           count(distinct doc) as compras,
           max(fecha) as ultima,
           string_agg(distinct ctxt, ' / ') filter (where conv) as desde,
           row_number() over (order by sum(imp) / nullif(sum(cant * factor), 0), (array_agg(proveedor))[1]) as rn
      from c
     where pu is not null
     group by prov_n
  )
  select jsonb_strip_nulls(jsonb_build_object(
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

  return resultado::json;
end;
$function$;
revoke all on function public.compras_producto_agente(text, date, date, text, integer, text, text, vector, text, text, boolean) from public, anon;
grant execute on function public.compras_producto_agente(text, date, date, text, integer, text, text, vector, text, text, boolean) to authenticated, service_role;

-- ─── historial_precios_agente ───
drop function if exists public.historial_precios_agente(text, integer);
CREATE OR REPLACE FUNCTION public.historial_precios_agente(p_producto text, p_limite integer DEFAULT 30, p_base boolean DEFAULT true)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261010170000_chatbot_ronda9 (cuerpo vigente) + 20261124120000_chatbot_precio_unidad_compra: con p_base = false (chat-facturas)
-- no se convierte a €/kg, €/l: precio y unidad tal como se compraron.
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

  with l0 as (
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
           pf.total,
           bl.unidad_base, bl.factor, bl.convertida as conv,
           contenido_texto_agente(pf.unidad, k.cc, k.cu) as ctxt
      from productos_factura pf
      join facturas f on f.id = pf.factura_id
      left join proveedores pv on pv.id = f.proveedor_id
      left join productos_catalogo pc on pc.id = pf.producto_id
      cross join lateral (select coalesce(pf.contenido_cantidad, pc.contenido_cantidad) as cc,
                                 case when pf.contenido_cantidad is not null then pf.contenido_unidad else pc.contenido_unidad end as cu) k
      cross join lateral base_linea_agente(pf.unidad, k.cc, k.cu) bl
     where pf.id = any(h.ids)
       and not (f.tipo = 'albaran' and f.id in (select albaran_id from albaranes_facturados_agente()))
  ),
  l1 as (
    select l0.*,
           coalesce(bool_and(l0.unidad_base is not null) filter (where l0.precio > 0) over ()
                    and min(l0.unidad_base) filter (where l0.precio > 0) over () = max(l0.unidad_base) filter (where l0.precio > 0) over ()
                    and bool_or(l0.conv) filter (where l0.precio > 0) over ()
                    and p_base, false) as ok
      from l0
  ),
  l as (
    select l1.id, l1.producto, l1.var, l1.proveedor, l1.prov_k, l1.tipo, l1.numero, l1.fecha, l1.fd,
           case when l1.ok then l1.cantidad * l1.factor else l1.cantidad end as cantidad,
           case when l1.ok then l1.unidad_base else l1.unidad end as unidad,
           case when l1.ok then round(l1.precio / l1.factor, 4) else l1.precio end as precio,
           l1.total,
           case when l1.ok and l1.conv then l1.ctxt end as desde
      from l1
  ),
  g as (   -- filas idénticas en una sola
    select producto, var, proveedor, prov_k, tipo, numero, fecha, bool_or(fd) as fd, unidad, precio,
           sum(cantidad) as cantidad, round(sum(total)::numeric, 2) as importe, count(*) as veces, min(id) as id,
           max(desde) as desde
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
  ),
  var_g as (   -- cada artículo con su precio (si mezcla varios)
    select var, min(producto) as producto, unidad, count(*) as veces,
           round(min(precio), 2) as precio_min, round(max(precio), 2) as precio_max,
           (array_agg(precio order by fecha desc nulls last, id desc))[1] as ultimo_precio,
           max(fecha) as ultima_compra
      from compras
     group by var, unidad
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
    'convertido_a', (select max(unidad) from compras where desde is not null),
    'variantes_distintas', (select case when variantes > 1 then variantes end from marco),
    'por_variante', (
      select case when m.variantes > 1 then (
               select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                        'producto', x.producto, 'unidad', x.unidad, 'veces', x.veces,
                        'precio_min', x.precio_min,
                        'precio_max', case when x.precio_max <> x.precio_min then x.precio_max end,
                        'ultimo_precio', trim_scale(x.ultimo_precio), 'ultima_compra', x.ultima_compra))
                      order by x.veces desc, x.producto)
               from (select * from var_g order by veces desc, producto limit 8) x) end
        from marco m),
    'nota_coincidencia', (
      select case when m.variantes > 1 then
        'Mezcla ' || m.variantes || ' articulos distintos: da cada uno con su precio (por_variante), no un unico precio medio.'
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
               'convertido_desde', desde,
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
revoke all on function public.historial_precios_agente(text, integer, boolean) from public, anon;
grant execute on function public.historial_precios_agente(text, integer, boolean) to authenticated, service_role;

-- ─── serie_precios_agente ───
drop function if exists public.serie_precios_agente(text, date, date, text);
CREATE OR REPLACE FUNCTION public.serie_precios_agente(p_texto text, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_unidad text DEFAULT NULL::text, p_base boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261124120000_chatbot_precio_unidad_compra: con p_base = false (chat-facturas, salvo que pidan el kilo o el
-- litro) no se convierte: la gráfica va en la unidad en que se compra. El panel no lo manda (true).
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

  with l0 as (
    select f.fecha,
           unidad_agente(coalesce(nullif(btrim(pf.unidad::text), ''), 'ud')) as unidad,
           pf.cantidad as cant,
           coalesce(pf.precio_unitario, pf.total / nullif(pf.cantidad, 0)) as precio,
           coalesce(pv.nombre, f.proveedor)::text as prov,
           coalesce(pc.nombre, pf.nombre::text) as nom,
           coalesce('c' || pf.producto_id, array_to_string(palabras_producto_agente(pf.nombre), ' ')) as var,
           bl.unidad_base, bl.factor, bl.convertida as conv,
           contenido_texto_agente(pf.unidad, k.cc, k.cu) as ctxt
      from productos_factura pf
      join facturas f on f.id = pf.factura_id
      left join proveedores pv on pv.id = f.proveedor_id
      left join productos_catalogo pc on pc.id = pf.producto_id
      cross join lateral (select coalesce(pf.contenido_cantidad, pc.contenido_cantidad) as cc,
                                 case when pf.contenido_cantidad is not null then pf.contenido_unidad else pc.contenido_unidad end as cu) k
      cross join lateral base_linea_agente(pf.unidad, k.cc, k.cu) bl
     where pf.id = any(h.ids)
       and f.fecha is not null
       and not (f.tipo = 'albaran' and f.id in (select albaran_id from albaranes_facturados_agente()))
       and (p_desde is null or f.fecha >= p_desde)
       and (p_hasta is null or f.fecha <= p_hasta)
       and coalesce(pf.precio_unitario, pf.total / nullif(pf.cantidad, 0)) > 0
  ),
  l1 as (
    select l0.*,
           coalesce(bool_and(l0.unidad_base is not null) over ()
                    and min(l0.unidad_base) over () = max(l0.unidad_base) over ()
                    and bool_or(l0.conv) over ()
                    and (p_unidad is null or unidad_agente(p_unidad) = min(l0.unidad_base) over ())
                    and p_base, false) as ok
      from l0
  ),
  l as (
    select l1.fecha,
           case when l1.ok then l1.unidad_base else l1.unidad end as unidad,
           case when l1.ok then l1.cant * l1.factor else l1.cant end as cant,
           case when l1.ok then l1.precio / l1.factor else l1.precio end as precio,
           l1.prov, l1.nom, l1.var,
           case when l1.ok and l1.conv then l1.ctxt end as desde
      from l1
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
                        from orden))
         || coalesce((select jsonb_build_object('convertido_desde', z.d)
                        from (select string_agg(distinct l.desde, ' / ') as d
                                from l join u on l.unidad = u.uni) z
                       where z.d is not null), '{}'::jsonb) end
    into resultado;

  return coalesce(resultado, jsonb_build_object('sin_datos', true, 'buscado', p_texto));
end;
$function$;
revoke all on function public.serie_precios_agente(text, date, date, text, boolean) from public, anon;
grant execute on function public.serie_precios_agente(text, date, date, text, boolean) to authenticated, service_role;

-- ─── variacion_precios_agente ───
drop function if exists public.variacion_precios_agente(date, date, numeric, text, text, integer, text);
CREATE OR REPLACE FUNCTION public.variacion_precios_agente(p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_umbral_pct numeric DEFAULT 10, p_categoria text DEFAULT NULL::text, p_producto text DEFAULT NULL::text, p_limite integer DEFAULT 10, p_sentido text DEFAULT NULL::text, p_base boolean DEFAULT true)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261107200000_variacion_precios_rapida: por conjuntos (una pasada), mismos resultados.
-- 20261124120000_chatbot_precio_unidad_compra: con p_base = false (chat-facturas) solo se convierte el producto que
-- mezcla formatos (si no, no habría con qué comparar); el resto, en la unidad en que se compra.
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

  with
  -- Albaranes ya facturados (vínculo facturado_en_id, misma regla de fechas que
  -- albaranes_facturados_agente).
  fact as materialized (
    select a.id
      from facturas a
      join facturas fx on fx.id = a.facturado_en_id and fx.tipo = 'factura'
     where a.tipo = 'albaran'
       and (a.facturado_origen = 'manual' or a.fecha is null or fx.fecha is null or a.fecha <= fx.fecha)
  ),
  -- Productos que entran (categoría / producto pedido / sin servicios).
  prod as materialized (
    select p.id, p.nombre, p.contenido_cantidad, p.contenido_unidad
      from productos_catalogo p
      left join categorias_producto c on c.id = p.categoria_id
      left join categorias_producto m on m.id = c.padre_id
     where (v_prods is null or p.id = any(v_prods))
       and (v_cat.id is null or c.id = v_cat.id or c.padre_id = v_cat.id)
       and (v_cat.id is not null or v_prods is not null or coalesce(m.clave, c.clave, '') <> 'servicios')
  ),
  -- unidad_agente una vez por unidad escrita distinta (no por línea).
  um as materialized (
    select d.u, unidad_agente(d.u) as ua
      from (select distinct coalesce(nullif(btrim(pf.unidad::text), ''), 'ud') as u from productos_factura pf) d
  ),
  -- Líneas como lineas_precio_agente(null, null, true), solo de esos productos.
  l0 as materialized (
    select pf.id, pf.factura_id, pf.producto_id, pr.nombre as producto,
           um.u as unidad, um.ua,
           pf.cantidad,
           coalesce(pf.precio_unitario, round(pf.total / nullif(pf.cantidad, 0), 4)) as precio,
           f.fecha, f.tipo::text as tipo, f.proveedor::text as proveedor,
           coalesce(nullif(f.proveedor_normalizado::text, ''), nullif(normalizar_proveedor(f.proveedor), ''), '?') as prov_n,
           coalesce(pf.contenido_cantidad, pr.contenido_cantidad) as cc,
           case when pf.contenido_cantidad is not null then pf.contenido_unidad else pr.contenido_unidad end as cu
      from productos_factura pf
      join prod pr on pr.id = pf.producto_id
      join facturas f on f.id = pf.factura_id
      join um on um.u = coalesce(nullif(btrim(pf.unidad::text), ''), 'ud')
     where not (f.tipo = 'albaran' and f.id in (select id from fact))
  ),
  -- base_linea_agente / contenido_texto_agente escritas en línea.
  lb as (
    select l0.*,
           case when l0.ua in ('kg', 'l') then l0.ua
                when l0.ua <> 'm' and l0.cc > 0 and l0.cu in ('kg', 'l', 'ud') then l0.cu end as unidad_base,
           case when l0.ua in ('kg', 'l') then 1::numeric
                when l0.ua <> 'm' and l0.cc > 0 and l0.cu in ('kg', 'l', 'ud') then l0.cc end as factor,
           l0.ua not in ('kg', 'l', 'm') and l0.cc > 0 and l0.cu in ('kg', 'l', 'ud') as conv,
           case when l0.cc > 0 and l0.cu is not null then
                  case when l0.ua = 'caja' then 'caja' else 'envase' end
                  || ' de ' || trim_scale(l0.cc)::text || ' ' || l0.cu end as ctxt
      from l0
     where l0.precio > 0
       -- Albarán repetido en una factura (mismo producto, unidad y cantidad, del
       -- mismo proveedor, de 7 días antes a 75 después): cuenta la factura.
       and not (l0.tipo = 'albaran' and exists (
             select 1
               from productos_factura x
               join facturas fx on fx.id = x.factura_id
              where fx.tipo = 'factura'
                and x.producto_id = l0.producto_id
                and coalesce(nullif(btrim(x.unidad::text), ''), 'ud') = l0.unidad
                and x.cantidad = l0.cantidad
                and fx.fecha between l0.fecha - 7 and l0.fecha + 75
                and mismo_proveedor_agente(
                      coalesce(nullif(fx.proveedor_normalizado::text, ''), nullif(normalizar_proveedor(fx.proveedor), ''), '?'),
                      l0.prov_n)))
  ),
  -- Con base: si TODAS las líneas del producto pasan a la misma unidad base y
  -- alguna es un envase, precio y cantidad van en esa unidad.
  lk as (
    select lb.*,
           coalesce(bool_and(lb.unidad_base is not null) over w
                    and min(lb.unidad_base) over w = max(lb.unidad_base) over w
                    and bool_or(lb.conv) over w
                    and (p_base or min(lb.ua) over w <> max(lb.ua) over w or min(lb.factor) over w <> max(lb.factor) over w), false) as ok
      from lb
    window w as (partition by lb.producto_id)
  ),
  l as materialized (
    select lk.id, lk.factura_id, lk.producto_id, lk.producto,
           case when lk.ok then lk.unidad_base else lk.unidad end as unidad,
           case when lk.ok then lk.cantidad * lk.factor else lk.cantidad end as cantidad,
           case when lk.ok then round(lk.precio / lk.factor, 4) else lk.precio end as precio,
           lk.fecha, lk.tipo, lk.proveedor, lk.prov_n,
           case when lk.ok and lk.conv then lk.ctxt end as convertido_desde
      from lk
  ),
  -- Todo por ventanas sobre l, sin cruzar CTE entre sí (sobre un CTE el
  -- planificador estima 1 fila y repite bucles anidados: 4-60 s).
  -- a) Última compra de cada producto y unidad dentro del periodo (= DISTINCT ON
  --    producto, unidad ORDER BY fecha DESC, factura_id DESC de antes).
  ua as (
    select l.*,
           first_value(l.factura_id) over wu as u_fid,
           first_value(l.fecha) over wu as u_fecha,
           bool_or(l.en_periodo) over (partition by l.producto_id, l.unidad) as hay
      from (select l.*, coalesce((p_desde is null or l.fecha >= p_desde) and (p_hasta is null or l.fecha <= p_hasta), false) as en_periodo
              from l) l
    window wu as (partition by l.producto_id, l.unidad order by l.en_periodo desc, l.fecha desc, l.factura_id desc)
  ),
  -- b) Compras anteriores en otro documento (= precio_referencia_agente: misma
  --    unidad, fecha anterior o mismo día con id menor).
  ub as (
    select ua.*,
           ua.factura_id = ua.u_fid as es_ult,
           coalesce(ua.factura_id <> ua.u_fid
                    and (ua.fecha < ua.u_fecha or (ua.fecha = ua.u_fecha and ua.factura_id < ua.u_fid)), false) as es_ant
      from ua
     where ua.hay
  ),
  -- c) Documentos anteriores: orden (el más reciente = 1) y cuántos en 90 días.
  uc as (
    select ub.*,
           dense_rank() over (partition by ub.producto_id, ub.unidad
                              order by ub.es_ant desc, ub.fecha desc, ub.factura_id desc) as rn_doc,
           row_number() over (partition by ub.producto_id, ub.unidad, ub.factura_id order by ub.id) = 1 as pri_doc
      from ub
  ),
  ud as (
    select uc.*,
           count(*) filter (where uc.es_ant and uc.pri_doc and uc.fecha >= uc.u_fecha - 90)
             over (partition by uc.producto_id, uc.unidad) as n90
      from uc
  ),
  -- d) Líneas de la referencia: media de 90 días si hay ≥ 2 documentos, si no
  --    las 3 últimas compras.
  ue as (
    select ud.*,
           ud.es_ant and case when ud.n90 >= 2 then ud.fecha >= ud.u_fecha - 90 else ud.rn_doc <= 3 end as es_ref,
           case when ud.n90 >= 2 then 'media_90_dias' else 'ultimas_compras' end as metodo
      from ud
  ),
  -- e) Proveedor de la referencia: el de más importe (empate: por nombre).
  uf as (
    select ue.*,
           first_value(ue.proveedor) over (partition by ue.producto_id, ue.unidad
                                           order by ue.es_ref desc, ue.peso desc nulls last, ue.proveedor) as ref_prov
      from (select ue.*,
                   sum(ue.precio * coalesce(nullif(ue.cantidad, 0), 1)) filter (where ue.es_ref)
                     over (partition by ue.producto_id, ue.unidad, ue.proveedor) as peso
              from ue) ue
  ),
  ult as (
    select uf.producto_id, uf.unidad, uf.producto,
           min(uf.u_fid) as factura_id,
           min(uf.u_fecha) as fecha,
           (array_agg(uf.tipo) filter (where uf.es_ult))[1] as tipo,
           (array_agg(uf.proveedor) filter (where uf.es_ult))[1] as proveedor,
           (array_agg(uf.prov_n) filter (where uf.es_ult))[1] as prov_n,
           coalesce(sum(uf.precio * uf.cantidad) filter (where uf.es_ult and uf.cantidad > 0)
                      / nullif(sum(uf.cantidad) filter (where uf.es_ult and uf.cantidad > 0), 0),
                    avg(uf.precio) filter (where uf.es_ult)) as precio,
           coalesce(sum(uf.precio * uf.cantidad) filter (where uf.es_ref and uf.cantidad > 0)
                      / nullif(sum(uf.cantidad) filter (where uf.es_ref and uf.cantidad > 0), 0),
                    avg(uf.precio) filter (where uf.es_ref)) as ref_precio,
           nullif(count(distinct uf.factura_id) filter (where uf.es_ref), 0)::integer as ref_compras,
           min(uf.fecha) filter (where uf.es_ref) as ref_desde,
           max(uf.fecha) filter (where uf.es_ref) as ref_hasta,
           (array_agg(uf.ref_prov) filter (where uf.es_ref))[1] as ref_proveedor,
           array_agg(distinct uf.prov_n) filter (where uf.es_ref) as proveedores_n,
           (array_agg(uf.metodo) filter (where uf.es_ref))[1] as metodo
      from uf
     group by uf.producto_id, uf.unidad, uf.producto
  ),
  cmp as materialized (
    select u.*,
           case when u.ref_precio > 0 then round((u.precio / u.ref_precio - 1) * 100, 1) end as var,
           u.ref_precio is not null and not (u.prov_n = any(u.proveedores_n)) as cambio
      from ult u
  ),
  sel as materialized (
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
                 'convertido_desde', (select string_agg(distinct x.convertido_desde, ' / ') from l x
                                       where x.producto_id = s.producto_id and x.unidad = s.unidad),
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
                                     and not (f.tipo = 'albaran' and f.id in (select id from fact))
                                     and (p_desde is null or f.fecha >= p_desde)
                                     and (p_hasta is null or f.fecha <= p_hasta)), 0))), '{}'::jsonb),
    'sin_datos', (select case when count(*) = 0 then true end from cmp)
  )) into resultado;

  return resultado::json;
end;
$function$;
revoke all on function public.variacion_precios_agente(date, date, numeric, text, text, integer, text, boolean) from public, anon;
grant execute on function public.variacion_precios_agente(date, date, numeric, text, text, integer, text, boolean) to authenticated, service_role;

-- ─── volumen_comprado_agente (misma firma) ───
CREATE OR REPLACE FUNCTION public.volumen_comprado_agente(p_texto text DEFAULT NULL::text, p_categoria text DEFAULT NULL::text, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_local text DEFAULT NULL::text, p_medida text DEFAULT NULL::text, p_limite integer DEFAULT NULL::integer, p_orden text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261106400000_facturas_volumenes: «¿cuántos litros de cerveza?», «¿cuántos
-- barriles?», «kilos de gamba». Cuenta facturas + albaranes sin factura.
-- 20261113100000_chat_facturas_bebidas: formato con nombre, botellas y cajas por
-- producto, proveedor principal, p_limite (1-40) y p_orden ('envases' | litros).
-- 20261107100000_chat_facturas_asociacion: el texto se asocia (familia, producto,
-- formato pedido) y hay precio por litro/kilo (importe base ÷ litros de las
-- líneas convertidas) con mínimo y máximo por compra, por proveedor, producto,
-- formato, mes, proveedor×formato y productos de 2+ proveedores.
-- 20261124120000_chatbot_precio_unidad_compra: precio tal como se compra: precio_envase (€ por botella, tercio,
-- barril, paquete) y, en compra, el precio de cada formato facturado («380 caja de 24 a 41.85 €»).
declare
  v_txt    text := nullif(btrim(coalesce(p_texto, '')), '');
  v_cattxt text := nullif(btrim(coalesce(p_categoria, '')), '');
  v_cat    bigint;
  v_catnom text;
  v_ids    bigint[];
  v_met    text;
  v_subs   text[];
  v_fmt    text;
  a        json;
  v_med    text := case lower(btrim(coalesce(p_medida, '')))
                     when 'l' then 'l' when 'litros' then 'l' when 'kg' then 'kg' when 'kilos' then 'kg' end;
  v_loc    text := case when p_local in ('casa_tomas', 'touza') then p_local end;
  v_lim    integer := least(greatest(coalesce(p_limite, 12), 1), 40);
  v_ord    text := case when lower(btrim(coalesce(p_orden, ''))) in ('envases', 'botellas', 'unidades') then 'envases' else 'total' end;
  r        json;
begin
  if p_desde is not null and p_hasta is not null and p_desde > p_hasta then
    return json_build_object('error', format('Rango inválido: desde (%s) es posterior a hasta (%s).', p_desde, p_hasta));
  end if;
  -- Asociación: «cerveza» escrita como producto es la familia; «cerveza de
  -- barril» / «cruzcampo barril» llevan formato (se filtra por tipo de envase).
  if v_cattxt is not null then
    a := asociar_termino_agente(v_cattxt);
    v_fmt := a->>'formato';
  end if;
  if v_txt is not null then
    a := asociar_termino_agente(v_txt);
    v_fmt := coalesce(v_fmt, a->>'formato');
    if v_cattxt is null and a->>'tipo' = 'familia' then
      v_cattxt := a->>'categoria';
      v_txt := null;
    elsif a->>'tipo' = 'formato' then
      v_txt := null;
    elsif a->>'formato' is not null then
      v_txt := coalesce(a->>'texto', v_txt);
    end if;
  end if;
  -- Barril, tercio, lata, magnum… son envases de bebida: litros.
  if v_fmt is not null then v_med := coalesce(v_med, 'l'); end if;
  if v_cattxt is not null then
    v_cat := categoria_agente(v_cattxt);
    if v_cat is null then
      return json_build_object('error', format('No conozco la categoría «%s».', left(v_cattxt, 60)));
    end if;
    select nombre into v_catnom from categorias_producto where id = v_cat;
  end if;
  if v_txt is not null then
    select l.ids, l.metodo, l.subproductos into v_ids, v_met, v_subs from lineas_producto_agente(v_txt, null) l;
    if v_ids is null then
      return json_build_object('sin_datos', true, 'producto', v_txt, 'categoria', v_catnom,
                               'nota', 'Ninguna línea de compra coincide con ese producto.');
    end if;
  end if;
  if v_cat is null and v_ids is null then
    return json_build_object('error', 'Falta producto o categoria (cerveza, vino, agua, aceite, gamba…).');
  end if;

  with
  base as materialized (
    select v.*, pc.envase_origen
      from volumen_lineas v
      left join productos_catalogo pc on pc.id = v.producto_id
     where (p_desde is null or v.fecha >= p_desde)
       and (p_hasta is null or v.fecha <= p_hasta)
       and (v_loc is null or v.loc = v_loc)
       and (v_cat is null or v.categoria_id = v_cat
            or exists (select 1 from categorias_producto c where c.id = v.categoria_id and c.padre_id = v_cat))
  ),
  sel as materialized (
    select * from base b where v_ids is null or b.linea_id = any(v_ids)
  ),
  med as (
    select coalesce(v_med,
                    (select s.medida from sel s where s.medida is not null
                      group by s.medida order by count(*) desc, s.medida limit 1), 'l') as m
  ),
  -- Líneas convertidas con su envase: el del catálogo o, si no lo tiene, el que
  -- sale de la propia línea (litros / envases). pl = precio por litro/kilo de la línea.
  ok0 as materialized (
    select s.*, e.env_n, e.env_c, e.env_u,
           volumen_tipo_envase(e.env_c, e.env_u, s.categoria,
                               coalesce(s.producto, '') || ' ' || coalesce(s.nombre_linea, '') || ' ' || coalesce(s.unidad, '')) as tipo,
           case when s.cantidad <> 0 and e.env_n is not null and s.metodo in ('caja', 'precio')
                then round(e.env_n / s.cantidad) end as n_por,
           case when s.cantidad_base > 0 and s.importe > 0 then s.importe / s.cantidad_base end as pl,
           case when s.importe is not null then s.cantidad_base end as base_con_importe,
           case when s.importe > 0 and e.env_n > 0 then s.importe end as imp_env,
           case when s.importe > 0 and e.env_n > 0 then e.env_n end as env_con_importe
      from sel s
      cross join med
      cross join lateral (
        select coalesce(s.envases, case when s.metodo = 'envase' then s.cantidad end) as env_n,
               coalesce(s.envase_cantidad,
                        case when coalesce(s.envases, 0) > 0 then round(s.cantidad_base / s.envases, 3) end) as env_c,
               case when s.envase_cantidad is not null then s.envase_unidad
                    when coalesce(s.envases, 0) > 0 then s.medida end as env_u
      ) e
     where s.medida = med.m
  ),
  ok as materialized (
    select * from ok0 o
     where v_fmt is null
        or (v_fmt = 'botellin' and o.tipo ~ '^(tercio|quinto|botellín)')
        or (v_fmt <> 'botellin' and o.tipo like v_fmt || ' %')
  ),
  no as (select s.* from sel s where s.medida is null),
  pu as (
    select coalesce(o.producto, o.nombre_linea) as producto, coalesce(nullif(lower(o.unidad), ''), 'ud') as uni, o.n_por,
           sum(o.cantidad) as cant, sum(o.cantidad_base) as total, sum(o.env_n) as envases,
           max(o.env_c) as env_c, max(o.env_u) as env_u,
           sum(o.importe) filter (where o.importe > 0 and o.cantidad > 0) as imp,
           sum(o.cantidad) filter (where o.importe > 0 and o.cantidad > 0) as cant_imp
      from ok o group by 1, 2, 3
  ),
  por_prod as (
    select p.producto, round(sum(p.total), 2) as total, round(sum(p.envases)) as envases,
           volumen_formato(max(p.env_c), max(p.env_u)) as envase,
           string_agg(trim_scale(p.cant)::text || ' ' || p.uni
                      || case when p.n_por > 1 then ' de ' || trim_scale(p.n_por)::text else '' end
                      || coalesce(' a ' || trim_scale(round(p.imp / nullif(p.cant_imp, 0), 2))::text || ' €', ''),
                      ', ' order by p.total desc) filter (where p.cant <> 0) as compra
      from pu p group by 1
  ),
  pprecio as (
    select coalesce(o.producto, o.nombre_linea) as producto,
           round(sum(o.importe) / nullif(sum(o.base_con_importe), 0), 2) as precio,
           round(min(o.pl), 2) as pmin, round(max(o.pl), 2) as pmax,
           round(sum(o.imp_env) / nullif(sum(o.env_con_importe), 0), 2) as penv
      from ok o group by 1
  ),
  ptipo as (
    select coalesce(o.producto, o.nombre_linea) as producto, string_agg(distinct o.tipo, ', ') as formato
      from ok o group by 1
  ),
  pprov as (
    select z.producto, z.proveedor, z.n
      from (select coalesce(o.producto, o.nombre_linea) as producto, max(o.proveedor_txt) as proveedor,
                   row_number() over (partition by coalesce(o.producto, o.nombre_linea)
                                      order by sum(o.cantidad_base) desc, max(o.proveedor_txt)) as rn,
                   count(*) over (partition by coalesce(o.producto, o.nombre_linea)) as n
              from ok o group by 1, o.prov_k) z
     where z.rn = 1
  ),
  prod_rk as (
    select pp.*, t.formato, pr.precio, pr.pmin, pr.pmax, pr.penv,
           pv.proveedor || case when pv.n > 1 then format(' (+%s)', pv.n - 1) else '' end as proveedor,
           row_number() over (order by case when v_ord = 'envases' then pp.envases else pp.total end desc nulls last,
                                       pp.total desc, pp.producto) as rk
      from por_prod pp
      left join ptipo t on t.producto = pp.producto
      left join pprov pv on pv.producto = pp.producto
      left join pprecio pr on pr.producto = pp.producto
  ),
  por_fmt as (
    select max(volumen_formato(o.env_c, o.env_u)) as envase, o.tipo as formato,
           round(sum(o.env_n)) as envases, round(sum(o.cantidad_base), 2) as total,
           round(sum(o.importe) / nullif(sum(o.base_con_importe), 0), 2) as precio,
           round(min(o.pl), 2) as pmin, round(max(o.pl), 2) as pmax,
           round(sum(o.imp_env) / nullif(sum(o.env_con_importe), 0), 2) as penv
      from ok o where o.tipo is not null group by o.tipo
  ),
  por_prov as (
    select max(o.proveedor_txt) as proveedor, round(sum(o.cantidad_base), 2) as total,
           round(sum(o.env_n)) as envases, count(distinct coalesce(o.producto, o.nombre_linea)) as productos,
           round(sum(o.importe), 2) as importe,
           round(sum(o.importe) / nullif(sum(o.base_con_importe), 0), 2) as precio,
           round(min(o.pl), 2) as pmin, round(max(o.pl), 2) as pmax
      from ok o group by o.prov_k
  ),
  prov_fmt as (
    select max(o.proveedor_txt) as proveedor, o.tipo as formato, round(sum(o.cantidad_base), 2) as total,
           round(sum(o.importe) / nullif(sum(o.base_con_importe), 0), 2) as precio,
           round(min(o.pl), 2) as pmin, round(max(o.pl), 2) as pmax,
           round(sum(o.imp_env) / nullif(sum(o.env_con_importe), 0), 2) as penv
      from ok o where o.tipo is not null group by o.prov_k, o.tipo
  ),
  comp as (
    -- Productos comprados a 2+ proveedores: el precio de cada uno.
    -- Como mucho los 6 proveedores con más volumen de cada producto (n = todos).
    select x.producto, sum(x.total) as total, max(x.n) as n,
           json_agg(json_strip_nulls(json_build_object('proveedor', x.proveedor, 'precio', x.precio,
                                                      'precio_envase', x.penv, 'total', x.total))
                    order by x.precio nulls last) filter (where x.rv <= 6) as proveedores
      from (select coalesce(o.producto, o.nombre_linea) as producto, max(o.proveedor_txt) as proveedor,
                   round(sum(o.cantidad_base), 2) as total,
                   round(sum(o.importe) / nullif(sum(o.base_con_importe), 0), 2) as precio,
                   round(sum(o.imp_env) / nullif(sum(o.env_con_importe), 0), 2) as penv,
                   count(*) over (partition by coalesce(o.producto, o.nombre_linea)) as n,
                   row_number() over (partition by coalesce(o.producto, o.nombre_linea)
                                      order by sum(o.cantidad_base) desc, max(o.proveedor_txt)) as rv
              from ok o group by 1, o.prov_k) x
     where x.n > 1
     group by x.producto
  ),
  incomp as (
    select to_char(i.mes, 'YYYY-MM') as mes from meses_compras_incompletos(v_loc) i
  ),
  por_mes as (
    select to_char(o.fecha, 'YYYY-MM') as mes, round(sum(o.cantidad_base), 2) as total,
           round(sum(o.importe), 2) as importe,
           round(sum(o.importe) / nullif(sum(o.base_con_importe), 0), 2) as precio
      from ok o group by 1
  ),
  otra as (
    select s.medida, round(sum(s.cantidad_base), 2) as total, count(*) as lineas
      from sel s, med where s.medida is not null and s.medida <> med.m group by s.medida
  )
  select json_build_object(
    'periodo', json_build_object('desde', coalesce(p_desde, (select min(fecha) from sel)), 'hasta', coalesce(p_hasta, (select max(fecha) from sel))),
    'categoria', v_catnom, 'producto', v_txt, 'coincidencia', v_met, 'formato_pedido', v_fmt, 'local', v_loc,
    'derivados_excluidos', to_jsonb(v_subs),
    'unidad', (select m from med),
    'total', (select round(coalesce(sum(o.cantidad_base), 0), 2) from ok o),
    'envases', (select round(sum(o.env_n)) from ok o),
    'cajas', (select round(sum(o.cantidad)) from ok o where o.n_por > 1),
    'importe_base', (select round(sum(o.importe), 2) from ok o),
    'precio', (select round(sum(o.importe) / nullif(sum(o.base_con_importe), 0), 2) from ok o),
    'precio_min', (select round(min(o.pl), 2) from ok o),
    'precio_max', (select round(max(o.pl), 2) from ok o),
    'proveedores', (select count(*) from por_prov),
    'lineas_convertidas', (select count(*) from ok),
    'lineas_sin_convertir', (select count(*) from no),
    'sin_datos', not exists (select 1 from sel),
    'envase_supuesto_lineas', (select nullif(count(*), 0) from ok o where o.envase_origen = 'por_defecto'),
    'orden', case v_ord when 'envases' then 'envases' else 'total' end,
    'por_producto', (select json_agg(json_strip_nulls(json_build_object(
                                       'producto', x.producto, 'total', x.total, 'envases', x.envases,
                                       'envase', x.envase, 'formato', x.formato, 'compra', x.compra,
                                       'proveedor', x.proveedor, 'precio', x.precio, 'precio_envase', x.penv,
                                       'precio_min', case when x.pmin <> x.pmax then x.pmin end,
                                       'precio_max', case when x.pmin <> x.pmax then x.pmax end))
                                      order by x.rk)
                       from prod_rk x where x.rk <= v_lim),
    'productos', (select count(*) from por_prod),
    'productos_truncado', (select count(*) > v_lim from por_prod),
    'por_envase', (select json_agg(json_build_object('formato', f.formato, 'envase', f.envase, 'envases', f.envases, 'total', f.total,
                                                     'precio', f.precio, 'precio_envase', f.penv, 'precio_min', f.pmin, 'precio_max', f.pmax)
                                   order by f.total desc)
                     from (select * from por_fmt order by total desc limit 10) f),
    'por_proveedor', (select json_agg(json_build_object('proveedor', p.proveedor, 'total', p.total, 'envases', p.envases,
                                                         'productos', p.productos, 'importe', p.importe, 'precio', p.precio,
                                                         'precio_min', p.pmin, 'precio_max', p.pmax) order by p.total desc)
                        from (select * from por_prov order by total desc limit 8) p),
    'por_proveedor_formato', (select json_agg(json_build_object('proveedor', q.proveedor, 'formato', q.formato, 'total', q.total,
                                                                 'precio', q.precio, 'precio_envase', q.penv, 'precio_min', q.pmin, 'precio_max', q.pmax)
                                              order by q.formato, q.precio)
                                from (select * from prov_fmt order by total desc limit 14) q
                               where (select count(*) from por_prov) > 1),
    'comparables', (select json_agg(json_build_object('producto', c.producto, 'n_proveedores', c.n, 'proveedores', c.proveedores) order by c.total desc)
                      from (select * from comp order by total desc limit 6) c),
    'por_mes', (select json_agg(json_strip_nulls(json_build_object(
                                  'mes', m.mes, 'total', m.total, 'importe', m.importe, 'precio', m.precio,
                                  'incompleto', case when exists (select 1 from incomp i where i.mes = m.mes) then true end))
                                order by m.mes) from por_mes m),
    'otra_unidad', (select json_agg(json_build_object('unidad', o.medida, 'total', o.total, 'lineas', o.lineas)) from otra o),
    'sin_convertir', case when exists (select 1 from no) then json_build_object(
        'importe_base', (select round(sum(n.importe), 2) from no n),
        'motivos', (select json_object_agg(z.metodo, z.n) from (select n.metodo, count(*) as n from no n group by 1) z),
        'ejemplos', (select json_agg(json_build_object('linea', z.nombre_linea, 'unidad', z.unidad, 'cantidad', z.cant,
                                                        'lineas', z.n, 'motivo', z.metodo))
                       from (select n.nombre_linea, n.unidad, n.metodo, trim_scale(sum(n.cantidad)) as cant, count(*) as n
                               from no n group by 1, 2, 3 order by count(*) desc, 1 limit 5) z)) end,
    'resto_categoria', case when v_cat is not null and v_ids is not null then
        (select json_build_object('total', round(sum(b.cantidad_base), 2), 'lineas', count(*))
           from base b, med where b.medida = med.m and not (b.linea_id = any(v_ids))) end,
    'nota', 'total = cantidad x lo que lleva cada unidad facturada (caja 24 x 33 cl = 7,92 l; barril 50 l). '
            || 'envases = botellas, latas o barriles con las cajas ya abiertas (caja de 6 = 6). '
            || 'compra = como se facturo («99 caja de 6» = 99 cajas de 6 botellas). formato = tipo de envase. '
            || 'precio = € por litro/kilo SIN IVA (importe base / litros de las lineas convertidas); precio_min/max = la compra mas barata/cara. '
            || 'precio_envase = € por envase (botella, tercio, barril, paquete) SIN IVA y compra = precio de cada formato facturado, '
            || 'ambos de las lineas con importe (lo regalado no baja el precio). '
            || 'Sin convertir = no se sabe cuanto lleva: no suma. Sin Servicios (envases retornables).'
  ) into r;
  return r;
end;
$function$;
commit;
