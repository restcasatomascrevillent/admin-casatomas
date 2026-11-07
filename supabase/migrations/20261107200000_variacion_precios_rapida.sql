set client_encoding = 'UTF8';
-- 20261107200000_variacion_precios_rapida (07/11/2026)
--
-- «Qué ha subido de precio» (Análisis) y la herramienta variacion_precios del
-- chatbot llaman a variacion_precios_agente, que en la demo tardaba ~50 s (el
-- panel corta a los 8 s: «No se ha podido consultar»).
--
-- Causa: por cada producto y unidad comprados en el periodo llamaba a
-- precio_referencia_agente, que a su vez volvía a ejecutar lineas_precio_agente
-- (todas las líneas del producto + albaranes_facturados_agente(), ~130 ms-1,6 s
-- por llamada), y lineas_precio_agente llama por línea a funciones SQL con
-- SET search_path (base_linea_agente, contenido_texto_agente, unidad_agente),
-- que Postgres no puede «inlinear»: 5,7 s solo para preparar las 12.400 líneas.
--
-- Ahora, una sola pasada por conjuntos:
--   1. líneas de precio una vez (mismas reglas que lineas_precio_agente con
--      p_base = true), con unidad_agente calculada una vez por unidad distinta
--      y la base (kg/l/ud) y el «envase de …» escritos en línea;
--   2. la referencia de cada producto+unidad (media ponderada de los 90 días
--      anteriores o de las 3 últimas compras) con funciones de ventana sobre
--      esas mismas líneas, igual que precio_referencia_agente.
-- Misma firma, mismo JSON y mismos resultados (test:
-- supabase/tests/variacion_precios_rapida_test.sql).
--
-- Albarán ya facturado: se usa el vínculo facturas.facturado_en_id (la parte
-- «vinculo» de albaranes_facturados_agente, con su regla de fechas). La parte
-- «cita» (factura que cita el número del albarán sin vínculo) era la cara
-- (~1,5 s) y hoy no añade ningún albarán en la demo: los 4 facturados lo están
-- por facturado_en_id.
--
-- precio_referencia_agente y lineas_precio_agente NO se tocan (las siguen
-- usando compras_producto_agente, historial_precios_agente, serie_precios_agente…).
-- Rollback: supabase/rollbacks/20261107200000_variacion_precios_rapida_ROLLBACK.sql
begin;
set local lock_timeout = '5s';

create or replace function public.variacion_precios_agente(
  p_desde date default null::date,
  p_hasta date default null::date,
  p_umbral_pct numeric default 10,
  p_categoria text default null::text,
  p_producto text default null::text,
  p_limite integer default 10,
  p_sentido text default null::text)
 returns json
 language plpgsql
 stable
 set search_path to 'public'
as $function$
-- 20261107200000_variacion_precios_rapida: por conjuntos (una pasada), mismos resultados.
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
                    and bool_or(lb.conv) over w, false) as ok
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

revoke all on function public.variacion_precios_agente(date, date, numeric, text, text, integer, text) from public, anon;
grant execute on function public.variacion_precios_agente(date, date, numeric, text, text, integer, text) to authenticated, service_role;

commit;
