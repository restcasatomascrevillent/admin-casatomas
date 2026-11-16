set client_encoding = 'UTF8';
-- ============================================================================
-- 20261207150000_coste_carta_vinos — «Coste de la carta de vinos» (16/11/2026)
-- ----------------------------------------------------------------------------
-- La pregunta más repetida al chat de Facturas es «precio de la botella de…»
-- (evaluación del 16/11/2026). Esta migración da UNA sola fuente para el coste de
-- cada vino de la carta, para la pantalla Facturas › Márgenes › Coste vinos y
-- para el chat (margenes_carta_agente):
--
-- 1. vinos_coste_nombre_base(texto): nombre sin tildes, añadas ni signos, para
--    comparar un vino de la carta con el catálogo de compras (pg_trgm).
-- 2. vinos_coste_carta_datos(hoy, meses, márgenes) (interna): una fila por vino.
--    Parte de margenes_carta_datos (última factura, formato, IVA: no se duplica)
--    y añade:
--      · COSTE EFECTIVO: en la última factura del producto se suman las botellas
--        sin cargo (líneas del mismo producto con total 0): total pagado ÷
--        (botellas pagadas + sin cargo). «30 + 6 sin cargo a 19,30 €» = 16,08 €.
--        Con `meses`, lo mismo sobre todas las facturas de esos meses.
--        Las cajas se pasan a botellas con volumen_linea (como el coste).
--      · estado: sin_precio, sin_enlazar, sin_compra, revisar (el producto
--        enlazado es de otro formato: no se compara magnum con 75 cl y no hay
--        multiplicador), dudoso (coste mayor que la carta, coste por caja,
--        salto de precio ≥ ×2,5 frente a la compra anterior, coste < 1/8 de la
--        venta), bajo (multiplicador < mínimo) o bien.
--      · avisos: los motivos de dudoso/revisar y «anada_distinta» (la añada de
--        la carta no es la de la última compra) y «sin_cargo_sin_convertir».
--      · margen € y %, precio de carta sugerido para llegar al mínimo (hacia
--        arriba a 0,50 €, como avisos_precio_sugerido), y margen por copa
--        suponiendo 6 copas por botella.
--      · mejor_candidato: para los vinos sin enlazar, el producto comprado que
--        más se parece por nombre (word_similarity ≥ 0,6).
--      · resumen: con coste, sin coste, dudosos, por revisar, mediana y por
--        debajo del mínimo (solo cuentan bien y bajo).
-- 3. vinos_coste_carta(hoy, meses): lo mismo con permiso (ver Facturas).
-- 4. vinos_coste_candidatos(vino, límite): productos del catálogo parecidos por
--    nombre, con su última compra, para enlazar desde la pantalla. Guardar o
--    quitar el enlace sigue siendo margenes_guardar_vino (origen 'manual',
--    exige «Editar» en Facturas).
-- 5. margenes_carta_agente: los VINOS salen de vinos_coste_carta_datos
--    (coste_botella = coste efectivo; coste_factura y botellas_sin_cargo aparte;
--    estado y avisos). Sin texto ya no salen como «peores» los dudosos ni los de
--    otro formato. Peso y platos, sin cambios. Cuerpo de partida: el de la demo
--    (pg_get_functiondef, 16/11/2026) = 20261128150000_chatbot_ultima_factura.
--
-- margenes_carta_datos NO cambia: la pestaña «Vinos» y los avisos de margen bajo
-- siguen con el precio de la última factura sin descontar las botellas sin cargo.
--
-- Rollback: supabase/rollbacks/20261207150000_coste_carta_vinos_ROLLBACK.sql
-- Tests:    npm run test:coste-carta-vinos:db (PGlite)
--           supabase/tests/coste_carta_vinos_test.sql (contra la demo)
-- ============================================================================
set lock_timeout = '5s';

-- ─── 1. Nombre para comparar ────────────────────────────────────────────────
create or replace function public.vinos_coste_nombre_base(p text)
returns text
language sql
immutable
set search_path = public
as $$
  -- 20261207150000_coste_carta_vinos
  select btrim(regexp_replace(
           regexp_replace(public._norm_agente(p), '\m(19[5-9]\d|20[0-4]\d)\M', ' ', 'g'),
           '[^a-z0-9]+', ' ', 'g'))
$$;
revoke all on function public.vinos_coste_nombre_base(text) from public, anon;
grant execute on function public.vinos_coste_nombre_base(text) to authenticated, service_role;

-- ─── 2. Coste de la carta de vinos (interna, sin permisos) ──────────────────
create or replace function public.vinos_coste_carta_datos(
  p_hoy date default null, p_meses integer default null, p_margenes jsonb default null)
returns jsonb
language plpgsql
stable
set search_path = public, extensions
as $$
-- 20261207150000_coste_carta_vinos. p_margenes: margenes_carta_datos ya calculado (para no repetirlo).
declare
  v_hoy    date := coalesce(p_hoy, current_date);
  m        jsonb := coalesce(p_margenes, public.margenes_carta_datos(coalesce(p_hoy, current_date)));
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
           (e ->> 'coste')::numeric as coste_factura, (e ->> 'coste_mediana')::numeric as coste_mediana,
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

-- ─── 3. Para el panel: permiso + datos ──────────────────────────────────────
create or replace function public.vinos_coste_carta(p_hoy date default null, p_meses integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
-- 20261207150000_coste_carta_vinos. Permiso igual que margenes_carta.
begin
  if coalesce(auth.role(), '') <> 'service_role' and not (select public.can_read_section('facturas')) then
    raise exception 'Sin permiso para ver el coste de la carta de vinos' using errcode = '42501';
  end if;
  return public.vinos_coste_carta_datos(p_hoy, p_meses, null);
end;
$$;
revoke all on function public.vinos_coste_carta(date, integer) from public, anon;
grant execute on function public.vinos_coste_carta(date, integer) to authenticated, service_role;

-- ─── 4. Candidatos del catálogo para enlazar un vino ────────────────────────
create or replace function public.vinos_coste_candidatos(p_vino_id text, p_limite integer default 6)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
-- 20261207150000_coste_carta_vinos
declare
  v_nombre text;
  v_venta  numeric;
  v_n      text;
  v_litros numeric;
  v_ids    bigint[];
  v_lim    integer := least(greatest(coalesce(p_limite, 6), 1), 20);
begin
  if coalesce(auth.role(), '') <> 'service_role' and not (select public.can_read_section('facturas')) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  select v.nombre, v.precio_eur::numeric / (1 + coalesce((select c.iva_pct from margenes_carta_config c where c.id), 10) / 100)
    into v_nombre, v_venta from "Vinos" v where v.id = p_vino_id;
  if not found then
    raise exception 'El vino no existe' using errcode = 'P0002';
  end if;
  v_n := vinos_coste_nombre_base(v_nombre);
  v_litros := coalesce((select et.volumen from envase_texto(v_nombre) et where et.unidad = 'l' and et.volumen > 0 limit 1), 0.75);
  if char_length(v_n) < 3 then
    return '[]'::jsonb;
  end if;

  select coalesce(array_agg(x.id), '{}') into v_ids
    from (select pc.id
            from productos_catalogo pc
            left join categorias_producto cp on cp.id = pc.categoria_id
           -- Los vinos del catálogo primero; lo que no está clasificado como vino, solo si se parece mucho.
           where word_similarity(v_n, vinos_coste_nombre_base(pc.nombre))
                 >= case when cp.nombre ~* 'vino|champ|cava|espum' then 0.45 else 0.7 end
           order by (cp.nombre ~* 'vino|champ|cava|espum') is true desc,
                    word_similarity(v_n, vinos_coste_nombre_base(pc.nombre)) desc, pc.id
           limit 40) x;

  return coalesce((
    select jsonb_agg(y.j order by y.es_vino desc, y.con_compra desc, y.sim desc, y.ultima desc nulls last, y.id)
      from (
        select pc.id, round(word_similarity(v_n, vinos_coste_nombre_base(pc.nombre))::numeric, 2) as sim,
               (u.lineas > 0) is true as con_compra, u.ultima, (cp.nombre ~* 'vino|champ|cava|espum') is true as es_vino,
               jsonb_build_object(
                 'id', pc.id, 'nombre', pc.nombre, 'categoria', cp.nombre,
                 'similitud', round(word_similarity(v_n, vinos_coste_nombre_base(pc.nombre))::numeric, 2),
                 'lineas', coalesce(u.lineas, 0), 'ultima', u.ultima,
                 'litros', lp.litros,
                 'formato_distinto', coalesce(lp.litros is not null and abs(lp.litros - v_litros) > 0.01, false),
                 -- Coste de la botella TAL COMO SE COMPRA (su formato), de la última factura.
                 'coste_botella', round(coalesce(u.base_eur * coalesce(lp.litros, 0.75), u.ud_eur), 4),
                 'factura', case when u.base_eur is not null then u.base_factura else u.ud_factura end,
                 -- Dato dudoso: cuesta más que la carta (sin IVA) o el precio es de una caja.
                 'dudoso', coalesce(coalesce(u.base_eur * coalesce(lp.litros, 0.75), u.ud_eur) > v_venta, false)
                           or (u.base_eur is null and u.ud_eur is not null
                               and coalesce(u.ud_factura ->> 'unidad_compra', 'ud') not in ('ud', 'botella', 'bt', 'bs')),
                 'enlazado_a', (select jsonb_agg(v2.nombre order by v2.nombre)
                                  from vino_producto vp join "Vinos" v2 on v2.id = vp.vino_id
                                 where vp.producto_id = pc.id and vp.vino_id <> p_vino_id)) as j
          from productos_catalogo pc
          left join categorias_producto cp on cp.id = pc.categoria_id
          left join margenes_carta_ultima(v_ids, current_date, 90) u on u.producto_id = pc.id
          left join lateral (
            select coalesce(case when pc.envase_unidad = 'l' and pc.envase_cantidad > 0 then pc.envase_cantidad end,
                            (select et.volumen from envase_texto(pc.nombre::text) et
                              where et.unidad = 'l' and et.volumen > 0 limit 1)) as litros
          ) lp on true
         where pc.id = any(v_ids)
         order by 5 desc, 3 desc, 2 desc, 4 desc nulls last, 1
         limit v_lim) y
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.vinos_coste_candidatos(text, integer) from public, anon;
grant execute on function public.vinos_coste_candidatos(text, integer) to authenticated, service_role;

-- ─── 5. Chat: los vinos de margenes_carta_agente, con el coste efectivo ─────
create or replace function public.margenes_carta_agente(p_texto text DEFAULT NULL::text, p_vista text DEFAULT NULL::text, p_solo_problemas boolean DEFAULT false, p_limite integer DEFAULT 15)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
-- 20261207150000_coste_carta_vinos: los VINOS salen de vinos_coste_carta_datos (coste efectivo).
-- 20261116100000_chatbot_margenes_alertas + 20261128150000_chatbot_ultima_factura: el coste es el de la
-- ÚLTIMA factura (margenes_carta, 20261128140000): cada fila trae ultima_factura (fecha, proveedor, número,
-- precio tal como se compró) y la mediana de 90 días aparte, como contexto.
declare
  m jsonb := public.margenes_carta();
  -- Vinos: una sola fuente con el coste efectivo (20261207150000_coste_carta_vinos).
  vc jsonb := public.vinos_coste_carta_datos(null, null, m);
  c public.margenes_carta_config%rowtype;
  v_min_peso numeric; v_min_vino numeric; v_max_pct numeric;
  v_txt text := nullif(public._norm_agente(btrim(p_texto)), '');
  v_lim int := least(greatest(coalesce(p_limite, 15), 1), 40);
  v_vista text := nullif(lower(btrim(coalesce(p_vista, ''))), '');
  v_solo boolean := coalesce(p_solo_problemas, false);
begin
  if v_vista is not null and v_vista not in ('peso', 'vinos', 'platos') then
    return jsonb_build_object('error', 'vista debe ser peso, vinos, platos o null');
  end if;
  select * into c from public.margenes_carta_config where id;
  v_min_peso := coalesce(c.multiplicador_min_peso, 2);
  v_min_vino := coalesce(c.multiplicador_min_vino, 2.5);
  v_max_pct  := coalesce(c.coste_max_plato_pct, 35);

  return jsonb_strip_nulls(jsonb_build_object(
    'umbrales', jsonb_build_object('multiplicador_min_peso', v_min_peso, 'multiplicador_min_vino', v_min_vino,
                                   'coste_max_plato_pct', v_max_pct, 'iva_pct', coalesce(c.iva_pct, 10)),
    'como_leer', 'El coste (compra_kg, coste_botella, coste) es el de la ULTIMA factura: da primero ultima_factura (fecha, proveedor, '
                 || 'numero: citalo para el enlace; precio por su unidad); *_mediana = mediana de 90 dias, solo despues y como contexto. '
                 || 'multiplicador = cuantas veces cobras lo que pagas (venta SIN IVA / compra SIN IVA; peso: euros/kg de carta frente a '
                 || 'euros/kg comprado; vino: botella frente a botella). pct_coste = % del precio de VENTA sin IVA que se va en coste '
                 || '(de cada 100 euros que cobras, X son coste); no es un % sobre el coste. Platos con revisado=false son ESTIMACIONES de '
                 || 'escandallo: dilo y no las des como dato firme; sin texto solo salen platos revisados (resumen.platos dice cuantos hay). '
                 || 'VINOS: coste_botella es el coste EFECTIVO (ultima factura contando botellas_sin_cargo); coste_factura es el precio de la '
                 || 'factura. estado dudoso o revisar (mira avisos): dilo y no des su margen como firme. precio_sugerido = carta para llegar '
                 || 'al minimo. Pantalla: Facturas > Margenes (vinos: Coste vinos).',
    'resumen', jsonb_build_object(
      'peso', (select jsonb_build_object('articulos', count(*),
                 'por_debajo', count(*) filter (where (e ->> 'multiplicador')::numeric < v_min_peso),
                 'sin_datos', count(*) filter (where e ->> 'multiplicador' is null),
                 'mediana', round((percentile_cont(0.5) within group (order by (e ->> 'multiplicador')::numeric))::numeric, 2))
               from jsonb_array_elements(m -> 'peso') e),
      'vinos', jsonb_build_object('vinos', vc #> '{resumen,total}', 'con_coste', vc #> '{resumen,con_coste}',
                 'por_debajo', vc #> '{resumen,por_debajo}', 'mediana', vc #> '{resumen,multiplicador_mediana}',
                 'dudosos', vc #> '{resumen,dudosos}', 'otro_formato', vc #> '{resumen,revisar}',
                 'sin_enlazar', vc #> '{resumen,sin_enlazar}', 'sin_compra', vc #> '{resumen,sin_compra}'),
      'platos', (select jsonb_build_object('platos', count(*), 'con_escandallo', count(e ->> 'coste'),
                 'revisados', count(*) filter (where (e ->> 'revisado')::boolean),
                 'por_encima_pct', count(*) filter (where (e ->> 'pct')::numeric > v_max_pct))
               from jsonb_array_elements(m -> 'platos') e)),
    'peso', case when v_vista is null or v_vista = 'peso' then (
      select coalesce(jsonb_agg(r.j order by r.mult nulls last), '[]'::jsonb) from (
        select (e ->> 'multiplicador')::numeric as mult,
               jsonb_build_object('nombre', e ->> 'nombre', 'precio_carta', e -> 'precio', 'unidad_carta', e ->> 'unidad',
                 'venta_kg_sin_iva', e -> 'venta_kg', 'producto_comprado', e ->> 'producto', 'compra_kg', e -> 'compra_kg',
                 'multiplicador', e -> 'multiplicador', 'por_debajo', (e ->> 'multiplicador')::numeric < v_min_peso,
                 'variacion_coste_pct', e -> 'variacion_pct', 'ultima_factura', public._factura_agente(e -> 'factura'),
                 'compra_kg_mediana', e -> 'compra_kg_mediana', 'lineas', e -> 'lineas', 'sin_datos', e ->> 'motivo') as j
          from jsonb_array_elements(m -> 'peso') e
         where (v_txt is null or public._norm_agente(e ->> 'nombre') like '%' || v_txt || '%'
                              or public._norm_agente(e ->> 'producto') like '%' || v_txt || '%')
           and (not v_solo or (e ->> 'multiplicador')::numeric < v_min_peso)
         order by (e ->> 'multiplicador')::numeric nulls last limit v_lim) r) end,
    'vinos', case when v_vista is null or v_vista = 'vinos' then (
      select coalesce(jsonb_agg(r.j order by r.mult nulls last), '[]'::jsonb) from (
        select (e ->> 'multiplicador')::numeric as mult,
               jsonb_build_object('nombre', e ->> 'nombre', 'categoria', e ->> 'categoria', 'precio_carta', e -> 'precio',
                 'precio_copa', e -> 'precio_copa', 'producto_comprado', e ->> 'producto', 'coste_botella', e -> 'coste_efectivo',
                 'coste_factura', e -> 'coste_factura',
                 'botellas_sin_cargo', case when (e ->> 'botellas_sin_cargo')::numeric > 0 then e -> 'botellas_sin_cargo' end,
                 'botellas_pagadas', case when (e ->> 'botellas_sin_cargo')::numeric > 0 then e -> 'botellas_pagadas' end,
                 'multiplicador', e -> 'multiplicador', 'por_debajo', e ->> 'estado' = 'bajo',
                 'estado', e ->> 'estado', 'avisos', nullif(e -> 'avisos', '[]'::jsonb),
                 'precio_sugerido', e -> 'precio_sugerido', 'margen_copa', e #> '{copa,margen}',
                 'variacion_coste_pct', e -> 'variacion_pct', 'ultima_factura', public._factura_agente(e -> 'factura'),
                 'coste_mediana', e -> 'coste_mediana', 'sin_datos', e ->> 'motivo') as j
          from jsonb_array_elements(vc -> 'vinos') e
         where (v_txt is null or public._norm_agente(e ->> 'nombre') like '%' || v_txt || '%'
                              or public._norm_agente(e ->> 'producto') like '%' || v_txt || '%')
           and (not v_solo or e ->> 'estado' = 'bajo')
           -- Sin texto: solo los comparables (ni dudosos ni de otro formato salen como «los peores»).
           and (v_txt is not null or e ->> 'estado' in ('bien', 'bajo'))
         order by (e ->> 'multiplicador')::numeric nulls last limit v_lim) r) end,
    'platos', case when v_vista is null or v_vista = 'platos' then (
      select coalesce(jsonb_agg(r.j order by r.pct desc nulls last), '[]'::jsonb) from (
        select (e ->> 'pct')::numeric as pct,
               jsonb_build_object('nombre', e ->> 'nombre', 'categoria', e ->> 'categoria', 'precio_carta', e -> 'precio',
                 'coste', e -> 'coste', 'pct_coste', e -> 'pct', 'margen', e -> 'margen',
                 'ingrediente_principal', e ->> 'principal', 'revisado', e -> 'revisado', 'origen', e ->> 'origen',
                 'variacion_coste_pct', e -> 'variacion_pct', 'ultima_factura', public._factura_agente(e -> 'factura'),
                 'coste_mediana', e -> 'coste_mediana', 'pct_mediana', e -> 'pct_mediana', 'sin_datos', e ->> 'motivo') as j
          from jsonb_array_elements(m -> 'platos') e
         where (v_txt is null or public._norm_agente(e ->> 'nombre') like '%' || v_txt || '%'
                              or public._norm_agente(e ->> 'principal') like '%' || v_txt || '%')
           and (not v_solo or (e ->> 'pct')::numeric > v_max_pct)
           -- Sin texto, solo escandallos revisados: los estimados (lata entera frente a la
           -- ración) salían como «los peores» sin serlo. Por nombre sí salen, marcados.
           and (v_txt is not null or (e ->> 'coste' is not null and (e ->> 'revisado')::boolean))
         order by (e ->> 'pct')::numeric desc nulls last limit v_lim) r) end));
end;
$$;
revoke all on function public.margenes_carta_agente(text, text, boolean, integer) from public, anon, authenticated;
grant execute on function public.margenes_carta_agente(text, text, boolean, integer) to service_role;

select 'coste_carta_vinos: aplicada' as resultado;
