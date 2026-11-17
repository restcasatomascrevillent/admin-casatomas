set client_encoding = 'UTF8';
-- ============================================================================
-- 20261208213000_margenes_vinos_coste_efectivo — UN solo coste por vino (17/11/2026)
-- ----------------------------------------------------------------------------
-- Problema: Facturas › Márgenes tenía dos números para el mismo vino. «Coste
-- vinos» (vinos_coste_carta_datos, 20261207150000) usa el coste EFECTIVO: total
-- pagado ÷ (botellas pagadas + sin cargo). La pestaña «Vinos» y los avisos de
-- margen bajo (margenes_carta_datos) usaban el precio de la factura. Godeval:
-- 16,85 € de factura frente a 11,23 € efectivo, y dos multiplicadores distintos.
--
-- Una sola fuente: el coste efectivo lo calcula vinos_coste_carta_datos y nadie
-- más repite la fórmula.
--   1. margenes_carta_datos (la de 20261128140000) pasa a llamarse
--      margenes_carta_datos_base: el mismo cuerpo, sin tocar (platos, al peso y
--      vinos con el precio de factura).
--   2. margenes_carta_datos(hoy) nueva = base + los vinos con botellas sin cargo
--      sustituyen su coste por el efectivo (coste, coste_iva, multiplicador, %,
--      margen, los tres de la tienda, las banderas multiplicador_bajo y
--      tienda_bajo y el resumen de vinos). El precio de factura queda aparte
--      (coste_factura) con botellas_sin_cargo y botellas_pagadas. Los vinos sin
--      botellas sin cargo salen EXACTAMENTE igual que antes. Platos y al peso,
--      sin cambios. Lo que cuelga de margenes_carta_datos (pestaña «Vinos»,
--      margenes_carta, margenes_generar_avisos y con ella Telegram, informe y
--      chat) da ya el mismo número que «Coste vinos».
--   3. vinos_coste_carta_datos parte ahora de margenes_carta_datos_base (si no,
--      se llamarían en círculo) y, si le pasan un margenes ya corregido (el chat
--      lo hace), lee el precio de factura de coste_factura. Mismo cuerpo que el
--      de 20261207150000 salvo esas dos líneas.
--
-- Cálculos distintos a propósito: la mediana de 90 días y la variación a 6 meses
-- siguen siendo de precio de factura (contexto, factura contra factura).
-- Vinos de otro formato (magnum frente a 75 cl): la pestaña «Vinos» los sigue
-- calculando como antes; «Coste vinos» no les da multiplicador.
--
-- Idempotente (el renombrado solo se hace si no está hecho).
-- Rollback: supabase/rollbacks/20261208213000_margenes_vinos_coste_efectivo_ROLLBACK.sql
-- Tests:    npm run test:coste-carta-vinos:db (PGlite)
-- ============================================================================
set lock_timeout = '5s';

-- ─── 1. El cálculo con precio de factura pasa a «_base» ─────────────────────
do $$
begin
  if to_regprocedure('public.margenes_carta_datos_base(date)') is null then
    alter function public.margenes_carta_datos(date) rename to margenes_carta_datos_base;
  end if;
end $$;
revoke all on function public.margenes_carta_datos_base(date) from public, anon, authenticated;
grant execute on function public.margenes_carta_datos_base(date) to service_role;

-- ─── 2. vinos_coste_carta_datos: parte de la base ───────────────────────────
create or replace function public.vinos_coste_carta_datos(
  p_hoy date default null, p_meses integer default null, p_margenes jsonb default null)
returns jsonb
language plpgsql
stable
set search_path = public, extensions
as $$
-- 20261208213000 (base: 20261207150000). p_margenes: margenes ya calculado (base o corregido) (para no repetirlo).
declare
  v_hoy    date := coalesce(p_hoy, current_date);
  m        jsonb := coalesce(p_margenes, public.margenes_carta_datos_base(coalesce(p_hoy, current_date)));
  v_min    numeric := coalesce((m #>> '{config,multiplicador_min_vino}')::numeric, 2.3);
  v_iva    numeric := 1 + coalesce((m #>> '{config,iva_pct}')::numeric, 10) / 100;
  v_meses  integer := case when p_meses between 1 and 36 then p_meses end;
  v_desde  date;
  v_copas  constant numeric := 6;
  v_res    jsonb;
begin
  v_desde := case when v_meses is not null then (v_hoy - make_interval(months => v_meses))::date end;

  with v as materialized (
    select e ->> 'id' as id, e ->> 'nombre' as nombre, e ->> 'categoria' as categoria, t.ord,
           (e ->> 'precio')::numeric as precio, (e ->> 'venta')::numeric as venta,
           (e ->> 'precio_copa')::numeric as precio_copa,
           (e ->> 'producto_id')::bigint as producto_id, e ->> 'producto' as producto,
           e ->> 'origen' as origen, e ->> 'nota' as nota,
           (e ->> 'litros')::numeric as litros, (e ->> 'litros_producto')::numeric as litros_producto,
           coalesce(nullif((e ->> 'litros_producto')::numeric, 0), 0.75) as litros_botella,
           coalesce((e ->> 'formato_distinto')::boolean, false) as formato_distinto,
           coalesce((e ->> 'coste_factura')::numeric, (e ->> 'coste')::numeric) as coste_factura, (e ->> 'coste_mediana')::numeric as coste_mediana,
           (e ->> 'coste_anterior')::numeric as coste_anterior, (e ->> 'variacion_pct')::numeric as variacion_pct,
           (e ->> 'iva_compra_pct')::numeric as iva_compra_pct,
           nullif(e -> 'factura', 'null'::jsonb) as factura, (e #>> '{factura,id}')::bigint as factura_id,
           e ->> 'motivo' as motivo_sin_mapear
      from jsonb_array_elements(m -> 'vinos') with ordinality as t(e, ord)
  ),
  -- Líneas del producto en la última factura (o en los últimos `meses`), TAMBIÉN las de total 0
  -- (sin cargo). Mismas reglas de documento que margenes_carta_ultima.
  l as materialized (
    select v.id as vino_id, pf.factura_id, pf.cantidad, pf.total as importe,
           case when vl.medida = 'l' and vl.cantidad_base > 0 then vl.cantidad_base / v.litros_botella
                when coalesce(unidad_agente(pf.unidad::text), 'ud') in ('ud', 'botella', 'bt', 'bs') then pf.cantidad
           end as botellas
      from v
      join productos_factura pf on pf.producto_id = v.producto_id
      join facturas fa on fa.id = pf.factura_id
      join productos_catalogo pc on pc.id = pf.producto_id
      left join categorias_producto c on c.id = pc.categoria_id
      left join lateral volumen_linea(pf.nombre::text, pf.unidad::text, pf.cantidad,
             coalesce(pf.precio_unitario, pf.total / nullif(pf.cantidad, 0)),
             pf.contenido_cantidad, pf.contenido_unidad, pc.envase_cantidad, pc.envase_unidad,
             pc.envases_por_bulto, volumen_max_eur_litro(c.nombre)) vl on true
     where v.factura_id is not null
       and pf.cantidad > 0 and pf.total >= 0
       and fa.fecha is not null and fa.fecha <= v_hoy
       and fa.local is distinct from 'touza'
       and not (fa.tipo = 'albaran' and fa.facturado_en_id is not null)
       and coalesce(fa.total, 0) >= 0
       and (pf.factura_id = v.factura_id or (v_desde is not null and fa.fecha > v_desde))
  ),
  g as (
    select l.vino_id,
           sum(l.importe) filter (where l.importe > 0) as importe,
           sum(l.botellas) filter (where l.importe > 0) as pagadas,
           coalesce(sum(l.botellas) filter (where l.importe = 0), 0) as gratis,
           count(*) filter (where l.importe > 0 and l.botellas is null) as pag_sin_convertir,
           count(*) filter (where l.importe = 0 and l.botellas is null) as gratis_sin_convertir,
           count(distinct l.factura_id) filter (where l.importe > 0) as facturas
      from l
     group by l.vino_id
  ),
  c1 as (
    select v.*, g.importe, g.pagadas, g.gratis, g.facturas,
           coalesce(g.gratis_sin_convertir, 0) > 0 as gratis_sin_convertir,
           vv.copeo,
           coalesce(case when not coalesce(vv.sin_anada, false) then vv.anada::int end,
                    (regexp_match(v.nombre, '\m(19[5-9]\d|20[0-4]\d)\M'))[1]::int) as anada_carta,
           coalesce((regexp_match(v.factura ->> 'nombre_linea', '\m(19[5-9]\d|20[0-4]\d)\M'))[1]::int,
                    (regexp_match(v.producto, '\m(19[5-9]\d|20[0-4]\d)\M'))[1]::int) as anada_compra,
           -- Total pagado ÷ (botellas pagadas + sin cargo), en el formato de la carta.
           case when v.coste_factura is null then null
                when g.pagadas > 0 and g.pag_sin_convertir = 0 and (g.gratis > 0 or v_desde is not null)
                  then round(g.importe / (g.pagadas + g.gratis) * v.litros / v.litros_botella, 4)
                else v.coste_factura end as coste_efectivo
      from v
      left join g on g.vino_id = v.id
      left join "Vinos" vv on vv.id = v.id
  ),
  c2 as (
    select c1.*,
           case when venta > 0 and coste_efectivo > 0 then round(venta / coste_efectivo, 2) end as mult,
           array_remove(array[
             case when producto_id is not null and formato_distinto then 'formato_distinto' end,
             case when venta > 0 and coste_efectivo > venta then 'coste_mayor_que_carta' end,
             case when coste_factura is not null and factura ->> 'medida' is null
                   and coalesce(factura ->> 'unidad_compra', 'ud') not in ('ud', 'botella', 'bt', 'bs') then 'coste_por_caja' end,
             case when coste_factura > 0 and (
                        (coste_anterior > 0 and (coste_factura / coste_anterior >= 2.5 or coste_factura / coste_anterior <= 0.4))
                     or (coste_mediana > 0 and (coste_factura / coste_mediana >= 2.5 or coste_factura / coste_mediana <= 0.4)))
                  then 'salto_precio' end,
             case when venta > 0 and coste_efectivo > 0 and venta / coste_efectivo > 8 then 'coste_muy_bajo' end,
             case when anada_carta is not null and anada_compra is not null and anada_carta <> anada_compra then 'anada_distinta' end,
             case when gratis_sin_convertir then 'sin_cargo_sin_convertir' end
           ], null) as avisos
      from c1
  ),
  c3 as (
    select c2.*,
           case when venta is null then 'sin_precio'
                when producto_id is null then 'sin_enlazar'
                when coste_factura is null then 'sin_compra'
                when 'formato_distinto' = any(avisos) then 'revisar'
                when avisos && array['coste_mayor_que_carta', 'coste_por_caja', 'salto_precio', 'coste_muy_bajo'] then 'dudoso'
                when mult < v_min then 'bajo'
                else 'bien' end as estado
      from c2
  ),
  -- Vinos del catálogo comprados alguna vez (Casa Tomás), para proponer enlace a los vinos sin enlazar.
  sin as materialized (
    select c3.id, vinos_coste_nombre_base(c3.nombre) as n from c3 where c3.estado = 'sin_enlazar'
  ),
  cat as materialized (
    select pc.id, pc.nombre, vinos_coste_nombre_base(pc.nombre) as n
      from productos_catalogo pc
      join categorias_producto cp on cp.id = pc.categoria_id
     where exists (select 1 from sin)
       and cp.nombre ~* 'vino|champ|cava|espum'
       and exists (select 1 from productos_factura pf join facturas fa on fa.id = pf.factura_id
                    where pf.producto_id = pc.id and pf.total > 0 and fa.local is distinct from 'touza')
  ),
  cand as (
    select s.id as vino_id, x.id as producto_id, x.nombre, x.sim
      from sin s
      cross join lateral (
        select cat.id, cat.nombre, word_similarity(s.n, cat.n) as sim
          from cat
         where char_length(s.n) >= 3
         order by 3 desc, cat.id
         limit 1) x
     where x.sim >= 0.6
  ),
  f as (
    select c3.*,
           -- Con otro formato no hay multiplicador (no se compara magnum con 75 cl).
           case when estado in ('bien', 'bajo', 'dudoso') then mult end as multiplicador,
           case when estado in ('bien', 'bajo', 'dudoso') then round(venta - coste_efectivo, 2) end as margen,
           case when estado in ('bien', 'bajo', 'dudoso') and venta > 0 then round((venta - coste_efectivo) / venta * 100, 1) end as margen_pct,
           case when estado = 'bajo' then round(ceil(coste_efectivo * v_min * v_iva * 2) / 2, 2) end as precio_sugerido,
           (estado in ('bien', 'bajo') and precio_copa > 0) as con_copa,
           case when precio_copa > 0 then round(precio_copa / v_iva, 4) end as venta_copa,
           round(coste_efectivo / v_copas, 4) as coste_copa
      from c3
  )
  select jsonb_build_object(
    'hoy', v_hoy,
    'meses', v_meses,
    'copas_por_botella', v_copas,
    'config', jsonb_build_object('multiplicador_min_vino', v_min, 'iva_pct', (v_iva - 1) * 100),
    'resumen', (select jsonb_build_object(
        'total', count(*),
        'con_coste', count(*) filter (where estado in ('bien', 'bajo')),
        'sin_coste', count(*) filter (where estado in ('sin_precio', 'sin_enlazar', 'sin_compra')),
        'sin_enlazar', count(*) filter (where estado = 'sin_enlazar'),
        'sin_compra', count(*) filter (where estado = 'sin_compra'),
        'sin_precio', count(*) filter (where estado = 'sin_precio'),
        'dudosos', count(*) filter (where estado = 'dudoso'),
        'revisar', count(*) filter (where estado = 'revisar'),
        'anada_distinta', count(*) filter (where 'anada_distinta' = any(avisos)),
        'por_debajo', count(*) filter (where estado = 'bajo'),
        'con_sin_cargo', count(*) filter (where gratis > 0),
        'con_candidato', (select count(*) from cand),
        'multiplicador_mediana', round((percentile_cont(0.5) within group (order by multiplicador)
                                         filter (where estado in ('bien', 'bajo')))::numeric, 2))
      from f),
    'vinos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', f.id, 'nombre', f.nombre, 'categoria', f.categoria, 'precio', f.precio, 'venta', f.venta,
        'producto_id', f.producto_id, 'producto', f.producto, 'origen', f.origen, 'nota', f.nota,
        'litros', f.litros, 'litros_producto', f.litros_producto,
        'coste_factura', f.coste_factura, 'coste_efectivo', f.coste_efectivo,
        'botellas_pagadas', round(f.pagadas, 2), 'botellas_sin_cargo', round(f.gratis, 2),
        'importe_pagado', f.importe, 'facturas', f.facturas,
        'factura', f.factura, 'iva_compra_pct', f.iva_compra_pct,
        'coste_mediana', f.coste_mediana, 'coste_anterior', f.coste_anterior, 'variacion_pct', f.variacion_pct,
        'multiplicador', f.multiplicador, 'margen', f.margen, 'margen_pct', f.margen_pct,
        'estado', f.estado, 'avisos', to_jsonb(f.avisos), 'precio_sugerido', f.precio_sugerido,
        'anada_carta', f.anada_carta, 'anada_compra', f.anada_compra,
        'motivo', f.motivo_sin_mapear,
        'copeo', coalesce(f.copeo, false), 'precio_copa', f.precio_copa,
        'copa', case when f.con_copa then jsonb_build_object(
            'venta', f.venta_copa, 'coste', f.coste_copa,
            'multiplicador', case when f.coste_copa > 0 then round(f.venta_copa / f.coste_copa, 2) end,
            'margen', round(f.venta_copa - f.coste_copa, 2),
            'margen_pct', round((f.venta_copa - f.coste_copa) / f.venta_copa * 100, 1)) end,
        'mejor_candidato', case when k.producto_id is not null then jsonb_build_object(
            'id', k.producto_id, 'nombre', k.nombre, 'similitud', round(k.sim::numeric, 2)) end
      ) order by f.ord)
      from f left join cand k on k.vino_id = f.id), '[]'::jsonb)
  ) into v_res;
  return v_res;
end;
$$;
revoke all on function public.vinos_coste_carta_datos(date, integer, jsonb) from public, anon, authenticated;
grant execute on function public.vinos_coste_carta_datos(date, integer, jsonb) to service_role;

-- ─── 3. margenes_carta_datos: la base con el coste efectivo de los vinos ────
create or replace function public.margenes_carta_datos(p_hoy date default null)
returns jsonb
language plpgsql
stable
set search_path = public, extensions
as $$
-- 20261208213000_margenes_vinos_coste_efectivo. Base: margenes_carta_datos_base (= 20261128140000).
declare
  v_hoy   date := coalesce(p_hoy, current_date);
  b       jsonb := public.margenes_carta_datos_base(v_hoy);
  vc      jsonb := public.vinos_coste_carta_datos(v_hoy, null, b);
  v_min   numeric := coalesce((b #>> '{config,multiplicador_min_vino}')::numeric, 2.3);
  v_min_t numeric := coalesce((b #>> '{config,multiplicador_min_tienda}')::numeric, 1.5);
  v_vinos jsonb;
  v_res   jsonb;
begin
  with x as (
    select t.ord, t.e,
           (t.e ->> 'venta')::numeric as venta, (t.e ->> 'venta_tienda')::numeric as venta_t,
           (t.e ->> 'coste')::numeric as coste,
           (vv.e ->> 'coste_efectivo')::numeric as efectivo,
           coalesce((vv.e ->> 'botellas_sin_cargo')::numeric, 0) as gratis,
           (vv.e ->> 'botellas_pagadas')::numeric as pagadas
      from jsonb_array_elements(b -> 'vinos') with ordinality as t(e, ord)
      left join jsonb_array_elements(vc -> 'vinos') as vv(e) on vv.e ->> 'id' = t.e ->> 'id'
  ),
  y as (
    select x.*, (gratis > 0 and efectivo > 0 and efectivo is distinct from coste) as cambia,
           case when gratis > 0 and efectivo > 0 then efectivo else coste end as c
      from x
  ),
  z as (
    select y.*,
           case when cambia then case when venta > 0 and c > 0 then round(venta / c, 2) end
                else (e ->> 'multiplicador')::numeric end as mult,
           case when cambia then case when venta_t > 0 and c > 0 then round(venta_t / c, 2) end
                else (e ->> 'multiplicador_tienda')::numeric end as mult_t
      from y
  ),
  w as (
    select z.ord, z.mult, z.mult_t,
           z.e
           || jsonb_build_object('coste_factura', z.coste, 'botellas_sin_cargo', z.gratis,
                                 'botellas_pagadas', round(z.pagadas, 2))
           || case when z.cambia then jsonb_build_object(
                'coste', z.c,
                'coste_iva', round(z.c * (1 + coalesce((z.e ->> 'iva_compra_pct')::numeric, 10) / 100), 4),
                'multiplicador', z.mult,
                'pct', case when z.venta > 0 and z.c > 0 then round(z.c / z.venta * 100, 2) end,
                'margen', case when z.venta > 0 and z.c > 0 then round(z.venta - z.c, 2) end,
                'multiplicador_tienda', z.mult_t,
                'pct_tienda', case when z.venta_t > 0 and z.c > 0 then round(z.c / z.venta_t * 100, 2) end,
                'margen_tienda', case when z.venta_t > 0 and z.c > 0 then round(z.venta_t - z.c, 2) end,
                'banderas',
                  (select coalesce(jsonb_agg(f), '[]'::jsonb) from jsonb_array_elements_text(z.e -> 'banderas') as f
                    where f not in ('multiplicador_bajo', 'tienda_bajo'))
                  || case when z.mult < v_min then '["multiplicador_bajo"]'::jsonb else '[]'::jsonb end
                  || case when z.mult_t < v_min_t then '["tienda_bajo"]'::jsonb else '[]'::jsonb end)
              else '{}'::jsonb end as nuevo
      from z
  )
  select coalesce(jsonb_agg(w.nuevo order by w.ord), '[]'::jsonb),
         (b #> '{resumen,vinos}') || jsonb_build_object(
           'con_datos', count(*) filter (where w.mult is not null),
           'multiplicador_medio', round(avg(w.mult), 2),
           'multiplicador_mediana', round((percentile_cont(0.5) within group (order by w.mult))::numeric, 2),
           'en_rojo', count(*) filter (where w.mult < v_min),
           'sin_datos', count(*) filter (where w.mult is null),
           'multiplicador_tienda_mediana', round((percentile_cont(0.5) within group (order by w.mult_t))::numeric, 2),
           'tienda_en_rojo', count(*) filter (where w.mult_t < v_min_t))
    into v_vinos, v_res
    from w;

  return jsonb_set(jsonb_set(b, '{vinos}', v_vinos), '{resumen,vinos}', v_res);
end;
$$;
revoke all on function public.margenes_carta_datos(date) from public, anon, authenticated;
grant execute on function public.margenes_carta_datos(date) to service_role;
