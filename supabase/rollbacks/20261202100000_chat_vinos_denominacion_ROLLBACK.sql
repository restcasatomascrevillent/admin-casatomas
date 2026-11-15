set client_encoding = 'UTF8';
-- Vuelta atrás de 20261202100000_chat_vinos_denominacion: vuelven las firmas anteriores de
-- volumen_comprado_agente y gasto_categorias_agente (definiciones de producción del 15/11/2026), fuera
-- triggers y ayudantes de denominación y fuera las columnas de productos_catalogo (se pierden las D.O.
-- guardadas, también las 'manual' e 'ia'). Desplegar antes la chat-facturas anterior.
begin;
set local lock_timeout = '5s';

drop trigger if exists trg_vino_producto_denominacion on public.vino_producto;
drop trigger if exists trg_vinos_denominacion on public."Vinos";
drop function if exists public.trg_vino_producto_denominacion();
drop function if exists public.trg_vinos_denominacion();
drop function if exists public.vino_denominacion_sincronizar(bigint[]);

drop function if exists public.volumen_comprado_agente(text, text, date, date, text, text, integer, text, text, text, text);
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
$function$
;
revoke all on function public.volumen_comprado_agente(text, text, date, date, text, text, integer, text) from public, anon;
grant execute on function public.volumen_comprado_agente(text, text, date, date, text, text, integer, text) to authenticated, service_role;

drop function if exists public.gasto_categorias_agente(text, date, date, text, text, text, text, text);
CREATE OR REPLACE FUNCTION public.gasto_categorias_agente(p_categoria text DEFAULT NULL::text, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_tipo text DEFAULT NULL::text, p_agrupar text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261106140000_chatbot_gasto_como_el_panel: importe de línea = solo pf.total (cuadra con Productos y Análisis).
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
           pf.total::numeric as imp,   -- solo el importe leído (como Productos y el tablero)
           f.id as doc, f.tipo::text as tipo, f.fecha, coalesce(pv.nombre, f.proveedor)::text as proveedor,
           coalesce(nullif(f.proveedor_normalizado::text, ''), nullif(normalizar_proveedor(f.proveedor), ''), '?') as prov_n,
           p.nombre as producto,
           c.id as cat_id,
           coalesce(m.id, c.id) as madre_id,
           coalesce(m.nombre, c.nombre) as madre,
           c.nombre as cat,
           coalesce(m.orden, c.orden) as orden,
           (f.tipo = 'albaran' and f.id in (select albaran_id from albaranes_facturados_agente())) as fact
      from productos_factura pf
      join facturas f on f.id = pf.factura_id
      left join proveedores pv         on pv.id = f.proveedor_id
      left join productos_catalogo p   on p.id = pf.producto_id
      left join categorias_producto c  on c.id = p.categoria_id
      left join categorias_producto m  on m.id = c.padre_id
     where (p_desde is null or f.fecha >= p_desde)
       and (p_hasta is null or f.fecha <= p_hasta)
       and (v_tipo is null or f.tipo = v_tipo)
  ),
  -- Albarán ya facturado (vínculo o factura que cita su número): fuera, salvo que se pidan solo albaranes.
  ya_facturados as (select id from base where fact and v_tipo is null),
  todo as (select * from base where not fact or v_tipo = 'albaran'),
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
           sum(imp) filter (where tipo = 'factura') as imp_fac,
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
                      then jsonb_build_object('desde', p_desde, 'hasta', p_hasta)
                      else to_jsonb('todo el historico'::text) end,
    'tipo',      v_tipo,
    'total', (select case when m.lineas > 0 then jsonb_strip_nulls(jsonb_build_object(
                'importe',      trim_scale(round(m.imp, 2)),
                'en_facturas',  case when m.lin_alb > 0 then trim_scale(round(coalesce(m.imp_fac, 0), 2)) end,
                'en_albaranes_sin_factura', case when m.lin_alb > 0 then trim_scale(round(coalesce(m.imp_alb, 0), 2)) end,
                'lineas',       m.lineas,
                'documentos',   m.docs,
                'productos',    case when v_cat.id is not null then m.productos end,
                'pct_del_gasto', case when v_cat.id is not null and tp.imp > 0 then round(100 * m.imp / tp.imp, 1) end)) end
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
    'criterio', (select case when m.lin_alb > 0 or exists (select 1 from ya_facturados) then
        'Facturas + albaranes sin factura (lo recibido); el albaran ya facturado no cuenta.' end
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
$function$
;
revoke all on function public.gasto_categorias_agente(text, date, date, text, text) from public, anon;
grant execute on function public.gasto_categorias_agente(text, date, date, text, text) to authenticated, service_role;

drop function if exists public.vino_coincide(text[], text, text, text);
drop function if exists public.vino_terminos(text);
drop function if exists public.vino_pais_de(text, text);
drop function if exists public.vino_region_de(text, text, text);
drop function if exists public.vino_denominacion_canonica(text);
drop function if exists public.vino_texto_normalizado(text);

alter table public.productos_catalogo
  drop constraint if exists productos_catalogo_denominacion_origen_origen_check,
  drop column if exists denominacion_origen_origen,
  drop column if exists pais_vino,
  drop column if exists region_vino,
  drop column if exists denominacion_origen;

notify pgrst, 'reload schema';

commit;
