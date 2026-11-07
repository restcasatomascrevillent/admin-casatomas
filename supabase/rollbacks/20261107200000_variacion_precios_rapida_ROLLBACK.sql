set client_encoding = 'UTF8';
-- Rollback de 20261107200000_variacion_precios_rapida.sql: vuelve
-- variacion_precios_agente tal y como estaba en la demo el 2026-11-06
-- (pg_get_functiondef; la de 20261106140000_chatbot_gasto_como_el_panel, la
-- que llama a precio_referencia_agente por producto: ~50 s con todo 2026).
-- No toca datos. Se puede ejecutar dos veces.
begin;
set local lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.variacion_precios_agente(p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_umbral_pct numeric DEFAULT 10, p_categoria text DEFAULT NULL::text, p_producto text DEFAULT NULL::text, p_limite integer DEFAULT 10, p_sentido text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261106140000_chatbot_gasto_como_el_panel: sin_clasificar sin los albaranes ya facturados.
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
      from lineas_precio_agente(null, null, true) x
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
      left join lateral precio_referencia_agente(u.producto_id, u.unidad, u.fecha, u.factura_id, true) r on true
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
                                     and not (f.tipo = 'albaran' and f.id in (select albaran_id from albaranes_facturados_agente()))
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
select 'variacion_precios_rapida: deshecha' as resultado;
