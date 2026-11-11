set client_encoding = 'UTF8';
-- ROLLBACK de 20261125100000_margenes_sin_iva_tienda: margenes_carta y
-- margenes_guardar_config vuelven a su versión de producción del 11/11/2026
-- (multiplicador del vino = carta CON IVA ÷ coste; coste con el envase del producto),
-- el límite del vino guardado vuelve a su equivalente con IVA (2,3 → 2,5) y se borran
-- iva_tienda_pct, multiplicador_min_tienda (se pierden esos dos valores),
-- margenes_carta_datos y margenes_carta_iva.
-- Aplicar DESPUÉS del rollback de 20261125110000 (que usa margenes_carta_datos) y
-- desplegar antes el panel sin la tienda ni el interruptor de IVA.
set lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.margenes_carta(p_hoy date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- 20261115410000_margenes_por_peso (base: 20261115200000_analisis_margenes_carta).
declare
  v_hoy date := coalesce(p_hoy, current_date);
  c public.margenes_carta_config%rowtype;
  v_ids bigint[];
  v_iva numeric;
  v_res jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not (select public.can_read_section('facturas')) then
    raise exception 'Sin permiso para ver los márgenes de la carta' using errcode = '42501';
  end if;
  select * into c from public.margenes_carta_config where id;
  if not found then
    c.coste_max_plato_pct := 35; c.multiplicador_min_vino := 2.5; c.subida_coste_pct := 10;
    c.iva_pct := 10; c.dias_referencia := 90; c.multiplicador_min_peso := 2;
  end if;
  v_iva := 1 + c.iva_pct / 100;

  select coalesce(array_agg(distinct x.producto_id), '{}') into v_ids
    from (select e.producto_id from escandallo_platos e union select vp.producto_id from vino_producto vp) x;

  with k as materialized (
    select * from margenes_carta_costes(v_ids, v_hoy, c.dias_referencia)
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
           k.medida, k.unidad_compra, k.lineas, k.ultima,
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
           count(*) as n, count(coste) as n_con, count(coste_6m) as n_6m,
           bool_or(origen = 'manual') as manual,
           (array_agg(producto order by coste desc nulls last))[1] as principal,
           (array_agg(coste order by coste desc nulls last))[1] as principal_coste,
           jsonb_agg(jsonb_build_object(
             'id', id, 'producto_id', producto_id, 'producto', producto,
             'cantidad', cantidad, 'unidad', unidad, 'origen', origen, 'nota', nota,
             'medida', medida, 'unidad_compra', unidad_compra, 'eur', eur, 'eur_6m', eur_6m,
             'coste', coste, 'coste_6m', coste_6m, 'lineas', lineas, 'ultima', ultima
           ) order by orden, id) as ingredientes
      from ing2
     group by plato_id
  ),
  pc1 as (
    select pl.*, pp.coste, pp.coste_6m, pp.n, pp.n_con, pp.n_6m, pp.manual, pp.principal, pp.principal_coste, pp.ingredientes,
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
           case when pc.envase_unidad = 'l' and pc.envase_cantidad > 0 then pc.envase_cantidad else 0.75 end as litros,
           k.eur_base, k.eur_ud, k.eur_base_6m, k.eur_ud_6m, k.lineas, k.ultima, k.unidad_compra,
           r.revisado, r.sin_mapear_motivo
      from "Vinos" v
      left join vino_producto vp on vp.vino_id = v.id
      left join productos_catalogo pc on pc.id = vp.producto_id
      left join k on k.producto_id = vp.producto_id
      left join rev r on r.tipo = 'vino' and r.articulo_id = v.id
     where v.activado and v.restaurante and v.precio_eur is not null
  ),
  vi2 as (
    select vi.*,
           round(coalesce(eur_base * litros, eur_ud), 4) as coste,
           round(coalesce(eur_base_6m * litros, eur_ud_6m), 4) as coste_6m,
           case when precio > 0 then round(precio / v_iva, 4) end as venta
      from vi
  ),
  vi3 as (
    select vi2.*,
           -- Multiplicador sobre el precio de CARTA (con IVA): «me cuesta 10 y la vendo a 25» = 2,5×.
           case when venta > 0 and coste > 0 then round(precio / coste, 2) end as multiplicador,
           case when venta > 0 and coste > 0 then round(coste / venta * 100, 2) end as pct,
           case when venta > 0 and coste > 0 then round(venta - coste, 2) end as margen,
           case when coste_6m > 0 and coste > 0 and coste_6m <> coste then round((coste / coste_6m - 1) * 100, 2) end as variacion_pct,
           exists (select 1 from ajustes a where a.tipo_carta = 'vinos' and a.id = vi2.id) as precio_ajustado
      from vi2
  ),
  vi4 as (
    select vi3.*,
           array_remove(array[
             case when producto_id is null then 'sin_mapear' end,
             case when producto_id is not null and coste is null then 'sin_datos' end,
             case when venta is null then 'sin_precio' end,
             case when multiplicador < c.multiplicador_min_vino then 'multiplicador_bajo' end,
             case when variacion_pct > c.subida_coste_pct and not precio_ajustado then 'sube_coste' end
           ], null) as banderas
      from vi3
  ),
  -- POR PESO (20261115410000) ------------------------------------------------
  pe as (
    select pl.id, pl.nombre, pl.categoria, pl.precio, pl.unidad, pl.orden, pl.gramos_venta,
           e.producto_id, pc.nombre as producto, e.origen,
           k.eur_base, k.medida, k.eur_base_6m, k.lineas, k.ultima,
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
      'multiplicador_min_peso', c.multiplicador_min_peso),
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
          'revisados', count(*) filter (where revisado))
        from vi4)),
    'platos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'nombre', nombre, 'categoria', categoria, 'precio', precio, 'unidad', unidad,
        'gramos_venta', gramos_venta, 'venta', venta, 'coste', coste, 'coste_6m', case when n_6m = n then coste_6m end,
        'pct', pct, 'margen', margen, 'variacion_pct', variacion_pct, 'precio_ajustado', precio_ajustado,
        'principal', principal, 'principal_coste', principal_coste,
        'origen', case when n is null then null when manual then 'manual' else 'estimado' end,
        'revisado', coalesce(revisado, false), 'motivo', sin_mapear_motivo,
        'banderas', to_jsonb(banderas), 'ingredientes', coalesce(ingredientes, '[]'::jsonb)
      ) order by categoria, orden, nombre) from pc3), '[]'::jsonb),
    'vinos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'nombre', nombre, 'categoria', categoria, 'precio', precio, 'precio_copa', precio_copa,
        'venta', venta, 'producto_id', producto_id, 'producto', producto, 'litros', litros,
        'coste', coste, 'coste_6m', coste_6m, 'multiplicador', multiplicador, 'pct', pct, 'margen', margen,
        'variacion_pct', variacion_pct, 'precio_ajustado', precio_ajustado,
        'lineas', lineas, 'ultima', ultima, 'origen', origen, 'nota', nota,
        'revisado', coalesce(revisado, false), 'motivo', sin_mapear_motivo,
        'banderas', to_jsonb(banderas)
      ) order by categoria, orden, nombre) from vi4), '[]'::jsonb),
    'peso', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'nombre', nombre, 'categoria', categoria, 'precio', precio, 'unidad', unidad,
        'gramos_venta', gramos_venta, 'venta_kg_iva', venta_kg_iva, 'venta_kg', venta_kg,
        'producto_id', producto_id, 'producto', producto, 'compra_kg', compra_kg, 'compra_kg_6m', compra_kg_6m,
        'medida', medida, 'lineas', lineas, 'ultimo_proveedor', ultimo_proveedor, 'ultima_fecha', ultima_fecha,
        'multiplicador', multiplicador, 'pct', pct, 'variacion_pct', variacion_pct, 'precio_ajustado', precio_ajustado,
        'origen', origen, 'revisado', coalesce(revisado, false), 'motivo', motivo_sin_datos,
        'banderas', to_jsonb(banderas)
      ) order by categoria, orden, nombre) from pe4), '[]'::jsonb)
  ) into v_res;
  return v_res;
end;
$function$
;
revoke all on function public.margenes_carta(date) from public, anon;
grant execute on function public.margenes_carta(date) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.margenes_guardar_config(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- 20261115410000_margenes_por_peso (base: 20261115200000_analisis_margenes_carta)
begin
  perform margenes_exigir_edicion();
  insert into margenes_carta_config (id) values (true) on conflict (id) do nothing;
  update margenes_carta_config set
    coste_max_plato_pct = coalesce((p->>'coste_max_plato_pct')::numeric, coste_max_plato_pct),
    multiplicador_min_vino = coalesce((p->>'multiplicador_min_vino')::numeric, multiplicador_min_vino),
    multiplicador_min_peso = coalesce((p->>'multiplicador_min_peso')::numeric, multiplicador_min_peso),
    subida_coste_pct = coalesce((p->>'subida_coste_pct')::numeric, subida_coste_pct),
    iva_pct = coalesce((p->>'iva_pct')::numeric, iva_pct),
    dias_referencia = coalesce((p->>'dias_referencia')::integer, dias_referencia),
    updated_at = now(), updated_by = auth.uid()
  where id;
  return (select to_jsonb(x) - 'id' - 'updated_by' from margenes_carta_config x where id);
end;
$function$
;
revoke all on function public.margenes_guardar_config(jsonb) from public, anon;
grant execute on function public.margenes_guardar_config(jsonb) to authenticated, service_role;

drop function if exists public.margenes_carta_datos(date);
drop function if exists public.margenes_carta_iva(bigint[], date, integer);

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'margenes_carta_config' and column_name = 'iva_tienda_pct') then
    update public.margenes_carta_config
       set multiplicador_min_vino = round(multiplicador_min_vino * (1 + iva_pct / 100), 1)
     where id;
    alter table public.margenes_carta_config drop column iva_tienda_pct, drop column multiplicador_min_tienda;
  end if;
end $$;
alter table public.margenes_carta_config alter column multiplicador_min_vino set default 2.5;
