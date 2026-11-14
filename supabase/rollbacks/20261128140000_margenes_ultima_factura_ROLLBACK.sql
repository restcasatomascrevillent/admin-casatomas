set client_encoding = 'UTF8';
-- ROLLBACK de 20261128140000_margenes_ultima_factura: margenes_carta_datos vuelve a
-- 20261125100000_margenes_sin_iva_tienda (coste = MEDIANA de los últimos días de
-- referencia; sin la factura usada ni los campos *_mediana), margenes_generar_avisos a
-- 20261125110000_avisos_margen_bajo (texto de siempre del aviso de plato), se borra
-- margenes_carta_ultima y el estado de los avisos se pone al día SIN avisar (los costes
-- vuelven a cambiar de golpe).
-- Aplicar DESPUÉS del rollback de 20261128150000_chatbot_ultima_factura (si está
-- aplicada) y con el panel ya revertido o sin revertir: el panel aguanta sin los campos
-- nuevos (dice «sin factura» y no enseña la mediana aparte).
set lock_timeout = '5s';

create or replace function public.margenes_carta_datos(p_hoy date default null)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
-- 20261125100000_margenes_sin_iva_tienda (base: margenes_carta de producción,
-- 20261115410000_margenes_por_peso / 20261116100000_chatbot_margenes_alertas).
declare
  v_hoy date := coalesce(p_hoy, current_date);
  c public.margenes_carta_config%rowtype;
  v_ids bigint[];
  v_iva numeric;
  v_iva_t numeric;
  v_t_activa boolean;
  v_t_desc numeric;
  v_t_excl text[];
  v_res jsonb;
begin
  select * into c from public.margenes_carta_config where id;
  if not found then
    c.coste_max_plato_pct := 35; c.multiplicador_min_vino := 2.3; c.subida_coste_pct := 10;
    c.iva_pct := 10; c.dias_referencia := 90; c.multiplicador_min_peso := 2;
    c.iva_tienda_pct := 21; c.multiplicador_min_tienda := 1.5;
  end if;
  v_iva := 1 + c.iva_pct / 100;
  v_iva_t := 1 + coalesce(c.iva_tienda_pct, 21) / 100;
  select t.activa, t.descuento_pct, t.vinos_excluidos into v_t_activa, v_t_desc, v_t_excl
    from public.configuracion_tienda t where t.id;
  v_t_activa := coalesce(v_t_activa, false);
  v_t_desc := coalesce(v_t_desc, 30);
  v_t_excl := coalesce(v_t_excl, '{}');

  select coalesce(array_agg(distinct x.producto_id), '{}') into v_ids
    from (select e.producto_id from escandallo_platos e union select vp.producto_id from vino_producto vp) x;

  with k as materialized (
    select k0.*, ki.iva_pct, ki.iva_origen
      from margenes_carta_costes(v_ids, v_hoy, c.dias_referencia) k0
      left join margenes_carta_iva(v_ids, v_hoy, c.dias_referencia) ki on ki.producto_id = k0.producto_id
  ),
  ajustes as (
    select distinct h.tipo_carta, e->>'id' as id
      from historial_ajustes_precios h
      cross join lateral jsonb_array_elements(case when jsonb_typeof(h.snapshot) = 'array' then h.snapshot else '[]'::jsonb end) e
     where h.fecha > v_hoy - interval '6 months'
  ),
  rev as (
    select * from margenes_carta_revision
  ),
  -- PLATOS ------------------------------------------------------------------
  pl as (
    select p.id, p.nombre, p.categoria, p.precio_eur::numeric as precio, p.unidad, p.orden,
           margenes_gramos_venta(p.unidad) as gramos_venta
      from "Platos" p
     where p.activado and p.restaurante
  ),
  ing as (
    select e.plato_id, e.id, e.producto_id, pc.nombre as producto, e.cantidad, e.unidad, e.origen, e.nota, e.orden,
           k.medida, k.unidad_compra, k.lineas, k.ultima, k.iva_pct, k.iva_origen,
           case when e.unidad = 'ud' then k.eur_ud else k.eur_base end as eur,
           case when e.unidad = 'ud' then k.eur_ud_6m else k.eur_base_6m end as eur_6m
      from escandallo_platos e
      join pl on pl.id = e.plato_id
      join productos_catalogo pc on pc.id = e.producto_id
      left join k on k.producto_id = e.producto_id
  ),
  ing2 as (
    select ing.*,
           round(case when unidad = 'ud' then cantidad * eur else cantidad / 1000 * eur end, 4) as coste,
           round(case when unidad = 'ud' then cantidad * eur_6m else cantidad / 1000 * eur_6m end, 4) as coste_6m
      from ing
  ),
  pp as (
    select plato_id,
           sum(coste) as coste, sum(coste_6m) as coste_6m,
           round(sum(coste * (1 + coalesce(iva_pct, 10) / 100)), 4) as coste_iva,
           bool_or(coste is not null and coalesce(iva_origen, 'supuesto') <> 'linea') as iva_supuesto,
           count(*) as n, count(coste) as n_con, count(coste_6m) as n_6m,
           bool_or(origen = 'manual') as manual,
           (array_agg(producto order by coste desc nulls last))[1] as principal,
           (array_agg(coste order by coste desc nulls last))[1] as principal_coste,
           jsonb_agg(jsonb_build_object(
             'id', id, 'producto_id', producto_id, 'producto', producto,
             'cantidad', cantidad, 'unidad', unidad, 'origen', origen, 'nota', nota,
             'medida', medida, 'unidad_compra', unidad_compra, 'eur', eur, 'eur_6m', eur_6m,
             'coste', coste, 'coste_6m', coste_6m, 'lineas', lineas, 'ultima', ultima,
             'iva_pct', iva_pct, 'iva_origen', iva_origen,
             'eur_iva', round(eur * (1 + coalesce(iva_pct, 10) / 100), 4),
             'coste_iva', round(coste * (1 + coalesce(iva_pct, 10) / 100), 4)
           ) order by orden, id) as ingredientes
      from ing2
     group by plato_id
  ),
  pc1 as (
    select pl.*, pp.coste, pp.coste_6m, pp.coste_iva, pp.iva_supuesto, pp.n, pp.n_con, pp.n_6m, pp.manual,
           pp.principal, pp.principal_coste, pp.ingredientes,
           case when pl.precio > 0 then round(pl.precio / v_iva, 4) end as venta,
           r.revisado, r.sin_mapear_motivo
      from pl
      left join pp on pp.plato_id = pl.id
      left join rev r on r.tipo = 'plato' and r.articulo_id = pl.id
  ),
  pc2 as (
    select pc1.*,
           case when venta > 0 and n_con > 0 then round(coste / venta * 100, 2) end as pct,
           case when venta > 0 and n_con > 0 then round(venta - coste, 2) end as margen,
           case when n_6m = n and n > 0 and coste_6m > 0 and coste_6m <> coste then round((coste / coste_6m - 1) * 100, 2) end as variacion_pct,
           exists (select 1 from ajustes a where a.tipo_carta = 'platos' and a.id = pc1.id) as precio_ajustado
      from pc1
  ),
  pc3 as (
    select pc2.*,
           array_remove(array[
             case when n is null then 'sin_mapear' end,
             case when n > 0 and n_con = 0 then 'sin_datos' end,
             case when n_con > 0 and n_con < n then 'incompleto' end,
             case when venta is null then 'sin_precio' end,
             case when pct > c.coste_max_plato_pct then 'coste_alto' end,
             case when variacion_pct > c.subida_coste_pct and not precio_ajustado then 'sube_coste' end
           ], null) as banderas
      from pc2
  ),
  -- VINOS -------------------------------------------------------------------
  vi as (
    select v.id, v.nombre, v.categoria, v.precio_eur::numeric as precio, v.precio_copa_eur::numeric as precio_copa, v.orden,
           vp.producto_id, pc.nombre as producto, vp.origen, vp.nota,
           -- Formato de la CARTA (nombre del vino: «Magnum» = 1,5 l); si no se lee, el del
           -- producto comprado, salvo que sea mayor de 75 cl (una carta que no dice
           -- «Magnum» no es un magnum: San Vicente 2022 se compra en magnum y se vende en
           -- botella); en último caso 0,75 l.
           coalesce(lc.volumen, case when lp.litros > 0.75 then 0.75 else lp.litros end, 0.75) as litros,
           lp.litros as litros_producto,
           lc.volumen as litros_carta,
           k.eur_base, k.eur_ud, k.eur_base_6m, k.eur_ud_6m, k.lineas, k.ultima, k.unidad_compra,
           k.iva_pct, k.iva_origen,
           r.revisado, r.sin_mapear_motivo,
           -- A la venta en la tienda (20261103150000): activado, restaurante IS TRUE, precio > 0, no excluido.
           (v.precio_eur > 0 and not (v.id = any(v_t_excl))) as en_tienda
      from "Vinos" v
      left join vino_producto vp on vp.vino_id = v.id
      left join productos_catalogo pc on pc.id = vp.producto_id
      left join lateral (
        select coalesce(case when pc.envase_unidad = 'l' and pc.envase_cantidad > 0 then pc.envase_cantidad end,
                        (select et.volumen from envase_texto(pc.nombre::text) et
                          where et.unidad = 'l' and et.volumen > 0 limit 1)) as litros
      ) lp on true
      left join lateral (
        select et.volumen from envase_texto(v.nombre::text) et where et.unidad = 'l' and et.volumen > 0 limit 1
      ) lc on true
      left join k on k.producto_id = vp.producto_id
      left join rev r on r.tipo = 'vino' and r.articulo_id = v.id
     where v.activado and v.restaurante and v.precio_eur is not null
  ),
  vi1 as (
    select vi.*,
           -- La carta y la compra son formatos distintos (magnum frente a 75 cl…): coste estimado.
           coalesce(litros_producto is not null and abs(litros - litros_producto) > 0.01, false) as formato_distinto,
           -- Solo €/ud: se escala por litros de la carta ÷ litros del producto.
           case when litros_producto > 0 then litros / litros_producto else 1 end as escala_ud
      from vi
  ),
  vi2 as (
    select vi1.*,
           round(coalesce(eur_base * litros, eur_ud * escala_ud), 4) as coste,
           round(coalesce(eur_base_6m * litros, eur_ud_6m * escala_ud), 4) as coste_6m,
           case when precio > 0 then round(precio / v_iva, 4) end as venta,
           case when en_tienda then tienda_precio_venta(precio, v_t_desc) end as precio_tienda
      from vi1
  ),
  vi3 as (
    select vi2.*,
           round(coste * (1 + coalesce(iva_pct, 10) / 100), 4) as coste_iva,
           case when precio_tienda > 0 then round(precio_tienda / v_iva_t, 4) end as venta_tienda,
           -- Multiplicador SIN IVA ÷ SIN IVA: «me cuesta 10 y la vendo a 30 (27,27 sin IVA)» = 2,73×.
           case when venta > 0 and coste > 0 then round(venta / coste, 2) end as multiplicador,
           case when venta > 0 and coste > 0 then round(coste / venta * 100, 2) end as pct,
           case when venta > 0 and coste > 0 then round(venta - coste, 2) end as margen,
           case when coste_6m > 0 and coste > 0 and coste_6m <> coste then round((coste / coste_6m - 1) * 100, 2) end as variacion_pct,
           exists (select 1 from ajustes a where a.tipo_carta = 'vinos' and a.id = vi2.id) as precio_ajustado
      from vi2
  ),
  vi3b as (
    select vi3.*,
           case when venta_tienda > 0 and coste > 0 then round(venta_tienda / coste, 2) end as multiplicador_tienda,
           case when venta_tienda > 0 and coste > 0 then round(coste / venta_tienda * 100, 2) end as pct_tienda,
           case when venta_tienda > 0 and coste > 0 then round(venta_tienda - coste, 2) end as margen_tienda
      from vi3
  ),
  vi4 as (
    select vi3b.*,
           array_remove(array[
             case when producto_id is null then 'sin_mapear' end,
             case when producto_id is not null and coste is null then 'sin_datos' end,
             case when venta is null then 'sin_precio' end,
             case when producto_id is not null and formato_distinto then 'formato_distinto' end,
             case when multiplicador < c.multiplicador_min_vino then 'multiplicador_bajo' end,
             case when multiplicador_tienda < c.multiplicador_min_tienda then 'tienda_bajo' end,
             case when variacion_pct > c.subida_coste_pct and not precio_ajustado then 'sube_coste' end
           ], null) as banderas
      from vi3b
  ),
  -- POR PESO (20261115410000) ------------------------------------------------
  pe as (
    select pl.id, pl.nombre, pl.categoria, pl.precio, pl.unidad, pl.orden, pl.gramos_venta,
           e.producto_id, pc.nombre as producto, e.origen,
           k.eur_base, k.medida, k.eur_base_6m, k.lineas, k.ultima, k.iva_pct, k.iva_origen,
           r.revisado, r.sin_mapear_motivo
      from pl
      left join lateral (
        select e.producto_id, e.origen from escandallo_platos e
         where e.plato_id = pl.id order by e.orden, e.id limit 1
      ) e on true
      left join productos_catalogo pc on pc.id = e.producto_id
      left join k on k.producto_id = e.producto_id
      left join rev r on r.tipo = 'plato' and r.articulo_id = pl.id
     where pl.gramos_venta is not null
  ),
  pe2 as (
    select pe.*,
           case when precio > 0 then round(precio / gramos_venta * 1000, 2) end as venta_kg_iva,
           case when precio > 0 then round(precio / gramos_venta * 1000 / v_iva, 2) end as venta_kg,
           case when medida = 'kg' then round(eur_base, 2) end as compra_kg,
           case when medida = 'kg' then round(eur_base * (1 + coalesce(iva_pct, 10) / 100), 2) end as compra_kg_iva,
           case when medida = 'kg' then round(eur_base_6m, 2) end as compra_kg_6m,
           u.proveedor as ultimo_proveedor, u.fecha as ultima_fecha
      from pe
      left join lateral (
        select coalesce(pr.nombre, fa.proveedor::text, 'Sin proveedor') as proveedor, fa.fecha
          from productos_factura pf
          join facturas fa on fa.id = pf.factura_id
          left join proveedores pr on pr.id = fa.proveedor_id
         where pf.producto_id = pe.producto_id
           and fa.fecha is not null and fa.fecha <= v_hoy
           and fa.local is distinct from 'touza'
           and not (fa.tipo = 'albaran' and fa.facturado_en_id is not null)
           and coalesce(fa.total, 0) >= 0
           and pf.total > 0 and pf.cantidad > 0
         order by fa.fecha desc, pf.id desc
         limit 1
      ) u on pe.producto_id is not null
  ),
  pe3 as (
    select pe2.*,
           case when venta_kg > 0 and compra_kg > 0 then round(venta_kg / compra_kg, 2) end as multiplicador,
           case when venta_kg > 0 and compra_kg > 0 then round(compra_kg / venta_kg * 100, 2) end as pct,
           case when compra_kg_6m > 0 and compra_kg > 0 and compra_kg_6m <> compra_kg then round((compra_kg / compra_kg_6m - 1) * 100, 2) end as variacion_pct,
           exists (select 1 from ajustes a where a.tipo_carta = 'platos' and a.id = pe2.id) as precio_ajustado,
           case
             when producto_id is null then coalesce(sin_mapear_motivo, 'Sin producto de compra asociado')
             when lineas is null then 'No hay compras de «' || producto || '»'
             when medida is distinct from 'kg' then 'Las compras de «' || producto || '» no traen el peso (se compran por pieza o unidad)'
           end as motivo_sin_datos
      from pe2
  ),
  pe4 as (
    select pe3.*,
           array_remove(array[
             case when producto_id is null then 'sin_mapear' end,
             case when producto_id is not null and compra_kg is null then 'sin_datos' end,
             case when venta_kg is null then 'sin_precio' end,
             case when multiplicador < c.multiplicador_min_peso then 'multiplicador_bajo' end,
             case when variacion_pct > c.subida_coste_pct and not precio_ajustado then 'sube_coste' end
           ], null) as banderas
      from pe3
  )
  select jsonb_build_object(
    'hoy', v_hoy,
    'config', jsonb_build_object(
      'coste_max_plato_pct', c.coste_max_plato_pct, 'multiplicador_min_vino', c.multiplicador_min_vino,
      'subida_coste_pct', c.subida_coste_pct, 'iva_pct', c.iva_pct, 'dias_referencia', c.dias_referencia,
      'multiplicador_min_peso', c.multiplicador_min_peso,
      'iva_tienda_pct', c.iva_tienda_pct, 'multiplicador_min_tienda', c.multiplicador_min_tienda),
    'tienda', jsonb_build_object('activa', v_t_activa, 'descuento_pct', v_t_desc),
    'resumen', jsonb_build_object(
      'platos', (select jsonb_build_object(
          'total', count(*),
          'con_datos', count(*) filter (where pct is not null),
          'food_cost_medio', round(avg(pct), 1),
          'food_cost_mediana', round((percentile_cont(0.5) within group (order by pct))::numeric, 1),
          'en_rojo', count(*) filter (where 'coste_alto' = any(banderas)),
          'sube_coste', count(*) filter (where 'sube_coste' = any(banderas)),
          'sin_datos', count(*) filter (where pct is null),
          'incompletos', count(*) filter (where 'incompleto' = any(banderas)),
          'revisados', count(*) filter (where revisado))
        from pc3),
      'vinos', (select jsonb_build_object(
          'total', count(*),
          'con_datos', count(*) filter (where multiplicador is not null),
          'multiplicador_medio', round(avg(multiplicador), 2),
          'multiplicador_mediana', round((percentile_cont(0.5) within group (order by multiplicador))::numeric, 2),
          'en_rojo', count(*) filter (where 'multiplicador_bajo' = any(banderas)),
          'sube_coste', count(*) filter (where 'sube_coste' = any(banderas)),
          'sin_datos', count(*) filter (where multiplicador is null),
          'revisados', count(*) filter (where revisado),
          'en_tienda', count(*) filter (where en_tienda),
          'multiplicador_tienda_mediana', round((percentile_cont(0.5) within group (order by multiplicador_tienda))::numeric, 2),
          'tienda_en_rojo', count(*) filter (where 'tienda_bajo' = any(banderas)))
        from vi4)),
    'platos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'nombre', nombre, 'categoria', categoria, 'precio', precio, 'unidad', unidad,
        'gramos_venta', gramos_venta, 'venta', venta, 'coste', coste, 'coste_6m', case when n_6m = n then coste_6m end,
        'coste_iva', case when n_con > 0 then coste_iva end, 'iva_supuesto', coalesce(iva_supuesto, false),
        'pct', pct, 'margen', margen, 'variacion_pct', variacion_pct, 'precio_ajustado', precio_ajustado,
        'principal', principal, 'principal_coste', principal_coste,
        'origen', case when n is null then null when manual then 'manual' else 'estimado' end,
        'revisado', coalesce(revisado, false), 'motivo', sin_mapear_motivo,
        'banderas', to_jsonb(banderas), 'ingredientes', coalesce(ingredientes, '[]'::jsonb)
      ) order by categoria, orden, nombre) from pc3), '[]'::jsonb),
    'vinos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'nombre', nombre, 'categoria', categoria, 'precio', precio, 'precio_copa', precio_copa,
        'venta', venta, 'producto_id', producto_id, 'producto', producto, 'litros', litros,
        'litros_producto', litros_producto, 'formato_distinto', formato_distinto,
        'coste', coste, 'coste_6m', coste_6m, 'coste_iva', coste_iva,
        'iva_compra_pct', case when coste is not null then iva_pct end,
        'iva_origen', case when coste is not null then iva_origen end,
        'multiplicador', multiplicador, 'pct', pct, 'margen', margen,
        'en_tienda', en_tienda, 'precio_tienda', precio_tienda, 'venta_tienda', venta_tienda,
        'multiplicador_tienda', multiplicador_tienda, 'pct_tienda', pct_tienda, 'margen_tienda', margen_tienda,
        'variacion_pct', variacion_pct, 'precio_ajustado', precio_ajustado,
        'lineas', lineas, 'ultima', ultima, 'origen', origen, 'nota', nota,
        'revisado', coalesce(revisado, false), 'motivo', sin_mapear_motivo,
        'banderas', to_jsonb(banderas)
      ) order by categoria, orden, nombre) from vi4), '[]'::jsonb),
    'peso', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'nombre', nombre, 'categoria', categoria, 'precio', precio, 'unidad', unidad,
        'gramos_venta', gramos_venta, 'venta_kg_iva', venta_kg_iva, 'venta_kg', venta_kg,
        'producto_id', producto_id, 'producto', producto, 'compra_kg', compra_kg, 'compra_kg_6m', compra_kg_6m,
        'compra_kg_iva', compra_kg_iva,
        'iva_compra_pct', case when compra_kg is not null then iva_pct end,
        'iva_origen', case when compra_kg is not null then iva_origen end,
        'medida', medida, 'lineas', lineas, 'ultimo_proveedor', ultimo_proveedor, 'ultima_fecha', ultima_fecha,
        'multiplicador', multiplicador, 'pct', pct, 'variacion_pct', variacion_pct, 'precio_ajustado', precio_ajustado,
        'origen', origen, 'revisado', coalesce(revisado, false), 'motivo', motivo_sin_datos,
        'banderas', to_jsonb(banderas)
      ) order by categoria, orden, nombre) from pe4), '[]'::jsonb)
  ) into v_res;
  return v_res;
end;
$$;
revoke all on function public.margenes_carta_datos(date) from public, anon, authenticated;
grant execute on function public.margenes_carta_datos(date) to service_role;

create or replace function public.margenes_generar_avisos(p_hoy date default current_date, p_solo_estado boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
-- 20261125110000_avisos_margen_bajo. Ver la cabecera de la migración.
declare
  v_hoy     date := coalesce(p_hoy, current_date);
  m         jsonb := public.margenes_carta_datos(v_hoy);
  cf        jsonb := m -> 'config';
  v_tienda  boolean := coalesce((m -> 'tienda' ->> 'activa')::boolean, false);
  r         record;
  v_prod    bigint;
  v_prod_n  text;
  v_eur     numeric;
  v_eur_a   numeric;
  v_med     text;
  v_fac     bigint;
  v_fecha   date;
  v_prov    text;
  v_txt     text;
  v_tg      text;
  v_tit     text;
  v_fuente  text;
  v_nuevos  int := 0;
  v_cad     int := 0;
  v_n       int := 0;
begin
  create temp table if not exists _margenes_hoy (
    canal text, articulo_id text, nombre text, bajo boolean, valor numeric, limite numeric,
    coste numeric, producto_id bigint, producto text, detalle jsonb
  ) on commit drop;
  truncate _margenes_hoy;

  insert into _margenes_hoy
  select 'vino', e ->> 'id', e ->> 'nombre', e -> 'banderas' ? 'multiplicador_bajo',
         (e ->> 'multiplicador')::numeric, (cf ->> 'multiplicador_min_vino')::numeric,
         (e ->> 'coste')::numeric, (e ->> 'producto_id')::bigint, e ->> 'producto', '{}'::jsonb
    from jsonb_array_elements(m -> 'vinos') e
   where e ->> 'multiplicador' is not null
  union all
  select 'tienda', e ->> 'id', e ->> 'nombre', e -> 'banderas' ? 'tienda_bajo',
         (e ->> 'multiplicador_tienda')::numeric, (cf ->> 'multiplicador_min_tienda')::numeric,
         (e ->> 'coste')::numeric, (e ->> 'producto_id')::bigint, e ->> 'producto', '{}'::jsonb
    from jsonb_array_elements(m -> 'vinos') e
   where e ->> 'multiplicador_tienda' is not null and (e ->> 'en_tienda')::boolean
  union all
  select 'peso', e ->> 'id', e ->> 'nombre', e -> 'banderas' ? 'multiplicador_bajo',
         (e ->> 'multiplicador')::numeric, (cf ->> 'multiplicador_min_peso')::numeric,
         (e ->> 'compra_kg')::numeric, (e ->> 'producto_id')::bigint, e ->> 'producto', '{}'::jsonb
    from jsonb_array_elements(m -> 'peso') e
   where e ->> 'multiplicador' is not null
  union all
  -- Platos del borrador (no al peso), solo los revisados. detalle: coste de cada ingrediente.
  select 'plato', e ->> 'id', e ->> 'nombre', e -> 'banderas' ? 'coste_alto',
         (e ->> 'pct')::numeric, (cf ->> 'coste_max_plato_pct')::numeric,
         (e ->> 'coste')::numeric, null, null,
         coalesce((select jsonb_object_agg(i ->> 'producto_id', jsonb_build_object(
                     'producto', i ->> 'producto', 'eur', i -> 'eur', 'coste', i -> 'coste',
                     'medida', case when i ->> 'unidad' = 'ud' then coalesce(i ->> 'unidad_compra', 'ud') else i ->> 'medida' end))
                     from jsonb_array_elements(e -> 'ingredientes') i
                    where i ->> 'coste' is not null), '{}'::jsonb)
    from jsonb_array_elements(m -> 'platos') e
   where e ->> 'pct' is not null and (e ->> 'revisado')::boolean and e ->> 'gramos_venta' is null;

  if not p_solo_estado then
    for r in
      select h.*, s.coste as coste_antes, s.detalle as detalle_antes
        from _margenes_hoy h
        join margenes_avisos_estado s on s.canal = h.canal and s.articulo_id = h.articulo_id
       where h.bajo and not s.bajo
         and h.coste > s.coste
         and (h.canal <> 'tienda' or v_tienda)
    loop
      v_prod := r.producto_id; v_prod_n := r.producto; v_eur := r.coste; v_eur_a := r.coste_antes; v_med := null;
      if r.canal = 'plato' then
        -- El ingrediente cuyo coste más ha subido desde el último cálculo.
        select d.key::bigint, d.value ->> 'producto', (d.value ->> 'eur')::numeric, (a.value ->> 'eur')::numeric, d.value ->> 'medida'
          into v_prod, v_prod_n, v_eur, v_eur_a, v_med
          from jsonb_each(r.detalle) d
          left join jsonb_each(r.detalle_antes) a on a.key = d.key
         where (d.value ->> 'coste')::numeric > coalesce((a.value ->> 'coste')::numeric, 0)
           and a.key is not null
         order by (d.value ->> 'coste')::numeric - (a.value ->> 'coste')::numeric desc
         limit 1;
        if not found then v_prod := null; end if;
      end if;

      v_fac := null; v_fecha := null; v_prov := null;
      if v_prod is not null then
        select fa.id, fa.fecha, coalesce(pr.nombre, fa.proveedor::text)
          into v_fac, v_fecha, v_prov
          from productos_factura pf
          join facturas fa on fa.id = pf.factura_id
          left join proveedores pr on pr.id = fa.proveedor_id
         where pf.producto_id = v_prod
           and fa.fecha is not null and fa.fecha <= v_hoy
           and fa.local is distinct from 'touza'
           and not (fa.tipo = 'albaran' and fa.facturado_en_id is not null)
           and coalesce(fa.total, 0) >= 0
           and pf.total > 0 and pf.cantidad > 0
         order by fa.fecha desc, pf.id desc
         limit 1;
      end if;
      v_fuente := case when v_fac is not null
                       then format(', según la factura de %s del %s', coalesce(v_prov, 'proveedor sin nombre'), to_char(v_fecha, 'DD/MM'))
                       else '' end;

      if r.canal = 'plato' then
        v_tit := left(format('Margen bajo: %s (%s %% de coste)', r.nombre, margenes_num(r.valor, 0)), 120);
        v_txt := format('El coste del plato «%s» es ya el %s %% del precio (límite %s %%)',
                        r.nombre, margenes_num(r.valor, 0), margenes_num(r.limite, 0))
                 || case when v_prod is not null and v_eur_a is not null
                         then format(': sube %s de %s a %s € %s%s', v_prod_n, facturas_alertas_num(v_eur_a, 2), facturas_alertas_num(v_eur, 2),
                                     case v_med when 'kg' then 'el kilo' when 'l' then 'el litro' when 'ud' then 'la unidad'
                                                when null then 'la unidad' else 'la ' || v_med end,
                                     v_fuente)
                         else '' end || '.';
        v_tg := v_txt;
      else
        v_tit := left(format('Margen bajo: %s%s (%s×)', r.nombre, case r.canal when 'tienda' then ' en la tienda' else '' end,
                             margenes_num(r.valor, 2)), 120);
        v_txt := format('%s ha bajado a %s× (límite %s×): %s te cuesta ahora %s € (antes %s €)%s.',
                        case r.canal
                          when 'vino' then format('El vino «%s»', r.nombre)
                          when 'tienda' then format('En la tienda, el vino «%s»', r.nombre)
                          else format('«%s» (al peso)', r.nombre) end,
                        margenes_num(r.valor, 2), margenes_num(r.limite, 2),
                        case when r.canal = 'peso' then format('el kilo de %s', coalesce(r.producto, 'compra')) else 'la botella' end,
                        facturas_alertas_num(r.coste, 2), facturas_alertas_num(r.coste_antes, 2), v_fuente);
        v_tg := v_txt;
      end if;

      insert into notificaciones_dashboard (tipo, titulo, mensaje, referencia_tipo, prioridad, clave, caduca_en, datos, leida)
      values ('facturas_margen_bajo', v_tit, v_txt || ' Precios sin IVA.', 'facturas_alerta', 'alta',
              format('margen_bajo:%s:%s:%s', r.canal, r.articulo_id, v_hoy), (v_hoy + 30)::timestamptz,
              jsonb_build_object(
                'enlace', case when v_fac is not null then '?tab=compras&modo=documentos&doc=' || v_fac
                               else '?tab=margenes&articulo=' || case when r.canal in ('vino', 'tienda') then 'vino' else 'plato' end
                                    || ':' || r.articulo_id end,
                'enlace_margenes', '?tab=margenes&articulo=' || case when r.canal in ('vino', 'tienda') then 'vino' else 'plato' end
                                   || ':' || r.articulo_id,
                'canal', r.canal, 'articulo_id', r.articulo_id, 'nombre', r.nombre,
                'valor', r.valor, 'limite', r.limite, 'coste', r.coste, 'coste_antes', r.coste_antes,
                'producto_id', v_prod, 'producto', v_prod_n, 'eur', v_eur, 'eur_antes', v_eur_a,
                'factura_id', v_fac, 'fecha', v_fecha, 'proveedor', v_prov,
                'desde', v_hoy, 'hasta', v_hoy, 'mes', to_char(v_hoy, 'YYYY-MM'), 'local', 'casa_tomas',
                'campana', true, 'texto_telegram', v_tg),
              false)
      on conflict (clave) where clave is not null do nothing;
      get diagnostics v_n = row_count;
      v_nuevos := v_nuevos + v_n;
    end loop;

    -- Ya no está por debajo: su aviso caduca (y queda leído).
    update notificaciones_dashboard n
       set caduca_en = now(), leida = true
     where n.tipo = 'facturas_margen_bajo'
       and (n.caduca_en is null or n.caduca_en > now())
       and exists (select 1 from _margenes_hoy h
                    where h.canal = n.datos ->> 'canal' and h.articulo_id = n.datos ->> 'articulo_id' and not h.bajo);
    get diagnostics v_cad = row_count;
    delete from notificaciones_dashboard n
     where n.tipo = 'facturas_margen_bajo' and n.caduca_en < now() - interval '90 days';
  end if;

  insert into margenes_avisos_estado (canal, articulo_id, bajo, valor, coste, detalle, updated_at)
  select canal, articulo_id, bajo, valor, coste, detalle, now() from _margenes_hoy
  on conflict (canal, articulo_id) do update
     set bajo = excluded.bajo, valor = excluded.valor, coste = excluded.coste,
         detalle = excluded.detalle, updated_at = excluded.updated_at;
  delete from margenes_avisos_estado where updated_at < now() - interval '180 days';

  return jsonb_build_object('articulos', (select count(*) from _margenes_hoy),
                            'por_debajo', (select count(*) from _margenes_hoy where bajo),
                            'nuevos', v_nuevos, 'caducados', v_cad, 'solo_estado', p_solo_estado);
end;
$$;
revoke all on function public.margenes_generar_avisos(date, boolean) from public, anon, authenticated;
grant execute on function public.margenes_generar_avisos(date, boolean) to service_role;

drop function if exists public.margenes_carta_ultima(bigint[], date, integer);

select public.margenes_generar_avisos(current_date, true);

select 'margenes_ultima_factura: deshecha' as resultado;
