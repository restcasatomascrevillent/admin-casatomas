set client_encoding = 'UTF8';
-- ============================================================================
-- 20261125100000_margenes_sin_iva_tienda — Márgenes SIEMPRE sin IVA, margen de
-- la tienda de vinos e IVA de las compras (11/11/2026, decisiones del dueño)
-- ----------------------------------------------------------------------------
-- 1. El margen se calcula sin IVA en los dos lados:
--      · venta del restaurante = precio de carta ÷ (1 + IVA del restaurante, 10 %)
--      · venta de la tienda    = precio de tienda ÷ (1 + IVA de la tienda, 21 %),
--        con precio de tienda = tienda_precio_venta(carta, descuento) (carta − 30 %)
--      · coste                 = compra sin IVA (productos_factura.total), como hasta ahora.
--    Platos y «al peso» ya eran sin IVA ÷ sin IVA: no cambian. Cambia el vino:
--    su multiplicador era precio de CARTA CON IVA ÷ coste sin IVA; ahora es venta
--    sin IVA ÷ coste sin IVA.
-- 2. Límite del vino: 2,5× con IVA equivale a 2,5 ÷ 1,10 = 2,27× sin IVA,
--    redondeado a 2,3×. MIGRACIÓN DE DATOS: el valor guardado en
--    margenes_carta_config.multiplicador_min_vino se pasa a su equivalente sin IVA
--    (valor ÷ (1 + iva_pct/100), a 1 decimal: 2,5 → 2,3), una sola vez (solo si la
--    columna iva_tienda_pct aún no existía), para que no cambie qué vinos salen en
--    rojo. Con los datos de producción del 11/11/2026 ningún vino cambia de color.
-- 3. Tienda (configuracion_tienda): cada vino que estaría a la venta (activado,
--    restaurante IS TRUE, precio_eur > 0 y no excluido) tiene también su margen de
--    tienda, se calcula aunque la tienda esté desactivada (el panel lo indica con
--    'tienda.activa'). Límite propio multiplicador_min_tienda, por defecto 1,5×:
--      · es el margen mínimo habitual de una vinoteca (1,5× = 33 % de margen
--        bruto sobre la venta sin IVA: cubre almacén, merma y dinero parado);
--      · es el mismo listón que el restaurante pasado por el descuento y el IVA:
--        2,3 × 0,70 × 1,10 ÷ 1,21 = 1,46 ≈ 1,5. Un vino justo en el límite del
--        restaurante queda justo en el de la tienda.
--    Bandera nueva 'tienda_bajo' (multiplicador de tienda < su límite).
-- 4. Configuración: iva_pct pasa a ser «IVA del restaurante» (10) y se añaden
--    iva_tienda_pct (21) y multiplicador_min_tienda (1,5), editables desde
--    margenes_guardar_config.
-- 5. Costes y precios CON IVA (interruptor del panel; el margen sigue sin IVA):
--    margenes_carta_iva(ids, hoy, días) da, por producto, el IVA de sus compras en
--    la misma ventana que el coste: el de cada línea (productos_factura.iva_pct);
--    si la línea no lo tiene, el general de su factura (iva ÷ subtotal); y si
--    tampoco, 10 % (comida y bebida). iva_origen = 'linea' | 'factura' | 'supuesto'
--    (el peor de las líneas usadas) para que el panel diga cuándo es supuesto.
-- 6. margenes_carta(hoy) se parte en dos: margenes_carta_datos(hoy) (interna, sin
--    comprobar permisos: la usa también el cron de avisos de 20261125110000) y
--    margenes_carta(hoy), que comprueba el permiso como antes y la llama.
-- 7. Formato del vino (encargo del 11/11/2026): el coste usa el formato de la
--    CARTA, no el del producto comprado. litros = envase_texto(nombre del vino de
--    carta) («Magnum» = 1,5 l); si no se lee, el envase del producto (catálogo o
--    su nombre) salvo que pase de 75 cl (la carta no dice «Magnum»: es botella);
--    en último caso 0,75. coste = €/l de las compras × litros de la
--    carta; si solo hay €/ud, se escala por litros carta ÷ litros producto.
--    Bandera 'formato_distinto' cuando carta y compra difieren (coste estimado).
--
-- Cuerpos tomados de PRODUCCIÓN (pg_get_functiondef, 11/11/2026), no de las
-- migraciones viejas.
-- Rollback: supabase/rollbacks/20261125100000_margenes_sin_iva_tienda_ROLLBACK.sql
-- Test:     supabase/tests/margenes_sin_iva_tienda_test.sql
-- ============================================================================
set lock_timeout = '5s';

-- ─── 1. Configuración + migración de datos del límite del vino ──────────────
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'margenes_carta_config' and column_name = 'iva_tienda_pct') then
    alter table public.margenes_carta_config
      add column iva_tienda_pct numeric(5,2) not null default 21 check (iva_tienda_pct >= 0 and iva_tienda_pct < 100),
      add column multiplicador_min_tienda numeric(5,2) not null default 1.5 check (multiplicador_min_tienda > 0 and multiplicador_min_tienda <= 20);
    -- El límite guardado era «carta CON IVA ÷ coste»: pasa a «venta SIN IVA ÷ coste» (2,5 → 2,3).
    update public.margenes_carta_config
       set multiplicador_min_vino = round(multiplicador_min_vino / (1 + iva_pct / 100), 1)
     where id;
  end if;
end $$;
alter table public.margenes_carta_config alter column multiplicador_min_vino set default 2.3;
comment on column public.margenes_carta_config.iva_pct is 'IVA del restaurante (carta), %. 20261125100000.';
comment on column public.margenes_carta_config.iva_tienda_pct is 'IVA de la tienda de vinos, %. 20261125100000.';
comment on column public.margenes_carta_config.multiplicador_min_vino is 'Vino en rojo (restaurante) si venta SIN IVA ÷ coste sin IVA baja de esto. 20261125100000.';
comment on column public.margenes_carta_config.multiplicador_min_tienda is 'Vino en rojo (tienda) si precio de tienda SIN IVA ÷ coste sin IVA baja de esto. 20261125100000.';

-- ─── 2. IVA de las compras por producto (interna) ───────────────────────────
create or replace function public.margenes_carta_iva(p_ids bigint[], p_hoy date, p_dias integer)
returns table (producto_id bigint, iva_pct numeric, iva_origen text)
language sql
stable
set search_path = public
as $$
  -- 20261125100000_margenes_sin_iva_tienda. Mismas líneas y ventana que margenes_carta_costes.
  with l as (
    select pf.producto_id, pf.id, fa.fecha,
           case when pf.iva_pct is not null then 'linea'
                when fa.subtotal > 0 and fa.iva >= 0 then 'factura'
                else 'supuesto' end as origen,
           coalesce(pf.iva_pct::numeric,
                    case when fa.subtotal > 0 and fa.iva >= 0 then round(fa.iva / fa.subtotal * 100, 1) end,
                    10) as iva
      from productos_factura pf
      join facturas fa on fa.id = pf.factura_id
     where pf.producto_id = any(p_ids)
       and fa.fecha is not null and fa.fecha <= p_hoy
       and fa.local is distinct from 'touza'
       and not (fa.tipo = 'albaran' and fa.facturado_en_id is not null)
       and coalesce(fa.total, 0) >= 0
       and pf.total > 0 and pf.cantidad > 0
  ),
  w as (
    select l.*,
           row_number() over (partition by l.producto_id order by l.fecha desc, l.id desc) as rn,
           count(*) filter (where l.fecha > p_hoy - p_dias) over (partition by l.producto_id) as n_vent
      from l
  )
  select w.producto_id,
         round((percentile_cont(0.5) within group (order by w.iva))::numeric, 1),
         case when bool_or(w.origen = 'supuesto') then 'supuesto'
              when bool_or(w.origen = 'factura') then 'factura'
              else 'linea' end
    from w
   where (w.n_vent > 0 and w.fecha > p_hoy - p_dias) or (w.n_vent = 0 and w.rn <= 3)
   group by w.producto_id
$$;
revoke all on function public.margenes_carta_iva(bigint[], date, integer) from public, anon, authenticated;
grant execute on function public.margenes_carta_iva(bigint[], date, integer) to service_role;

-- ─── 3. Márgenes de la carta (interna, sin permisos) ────────────────────────
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

-- ─── 4. margenes_carta (panel y chatbot): permiso + datos ───────────────────
create or replace function public.margenes_carta(p_hoy date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
-- 20261125100000_margenes_sin_iva_tienda: el cálculo vive en margenes_carta_datos.
-- Permiso igual que en 20261116100000 (service_role para chat-facturas, o ver Facturas).
begin
  if coalesce(auth.role(), '') <> 'service_role' and not (select public.can_read_section('facturas')) then
    raise exception 'Sin permiso para ver los márgenes de la carta' using errcode = '42501';
  end if;
  return public.margenes_carta_datos(p_hoy);
end;
$$;
revoke all on function public.margenes_carta(date) from public, anon;
grant execute on function public.margenes_carta(date) to authenticated, service_role;

-- ─── 5. Guardar la configuración (con IVA y límite de la tienda) ────────────
create or replace function public.margenes_guardar_config(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
-- 20261125100000_margenes_sin_iva_tienda (base: producción, 20261115410000_margenes_por_peso)
begin
  perform margenes_exigir_edicion();
  insert into margenes_carta_config (id) values (true) on conflict (id) do nothing;
  update margenes_carta_config set
    coste_max_plato_pct = coalesce((p->>'coste_max_plato_pct')::numeric, coste_max_plato_pct),
    multiplicador_min_vino = coalesce((p->>'multiplicador_min_vino')::numeric, multiplicador_min_vino),
    multiplicador_min_peso = coalesce((p->>'multiplicador_min_peso')::numeric, multiplicador_min_peso),
    multiplicador_min_tienda = coalesce((p->>'multiplicador_min_tienda')::numeric, multiplicador_min_tienda),
    subida_coste_pct = coalesce((p->>'subida_coste_pct')::numeric, subida_coste_pct),
    iva_pct = coalesce((p->>'iva_pct')::numeric, iva_pct),
    iva_tienda_pct = coalesce((p->>'iva_tienda_pct')::numeric, iva_tienda_pct),
    dias_referencia = coalesce((p->>'dias_referencia')::integer, dias_referencia),
    updated_at = now(), updated_by = auth.uid()
  where id;
  return (select to_jsonb(x) - 'id' - 'updated_by' from margenes_carta_config x where id);
end;
$$;
revoke all on function public.margenes_guardar_config(jsonb) from public, anon;
grant execute on function public.margenes_guardar_config(jsonb) to authenticated, service_role;
